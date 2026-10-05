using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace MoleLauncher.Services;

/// <summary>
/// 用资源管理器打开目录 —— 按"当前进程是否提权"分两条路，各自分层兜底。
///
/// 为什么这么绕（每一步都是本机实测踩出来的，证据见 docs/launcher.md）：
///
/// * 提权进程发起的 shell 交接会被 Windows 拦掉：
///   - <c>ShellExecute</c> 解析目录的 <c>open</c> 动词 → Win32 5（拒绝访问）；
///   - <c>cmd /c start</c> → 返回 0，但 shell 随后弹"Windows 无法访问指定设备、路径或文件"；
///   - 直接 <c>CreateProcess("explorer.exe")</c> → 子进程 0xc0000142（Explorer 不允许以管理员身份运行）。
///   而**这台机器 UAC 是关的**（<c>EnableLUA=0</c>），也就是"别用管理员运行"根本做不到 ——
///   所以提权时必须换思路：**先把 explorer 降权起来**。
///   实测两条可行：<c>runas /trustlevel:0x20000</c> 与 WMI <c>Win32_Process.Create</c>。
///
/// * 非提权进程走常规委托即可（Shell.Application → cmd start → ShellExecute → explorer.exe）。
///
/// 另外：<c>Shell.Application.Windows()</c> 在"没有消息泵"的验证模式（--open-logs）里枚举不到窗口，
/// 所以确认不到窗口≠没打开；这里据此分两档措辞，绝不把"调用没抛异常"说成"已确认"。
/// </summary>
public static class ShellOpen
{
    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint uMode);

    private const uint SEM_FAILCRITICALERRORS = 0x0001;
    private const uint SEM_NOOPENFILEERRORBOX = 0x8000;

    /// <summary>打开目录。返回 (是否成功, 说明)；失败时说明里带每种方式的结局与可复制的路径。</summary>
    /// <summary>
    /// 打开目录。返回 (调用是否成功, 是否确认到窗口, 说明)。
    ///
    /// 三个返回值是刻意的：调用没抛异常 ≠ 用户看到了窗口（实测踩过：runas 返回 0 却什么都没开）。
    /// 调用方据此决定是"静默记录"还是"把路径复制到剪贴板并告诉用户"。
    /// </summary>
    public static (bool Ok, bool Confirmed, string Message) Folder(string dir)
    {
        dir = dir.TrimEnd('\\');                 // runas 的参数里末尾反斜杠会破坏转义
        try
        {
            Directory.CreateDirectory(dir);
        }
        catch (Exception ex)
        {
            return (false, false, $"目录不可用：{ex.Message}");
        }

        // 提权时 shell 交接必被拦，所以先把"降权起来"的两条排在最前面
        var strategies = new List<(string Name, Func<string, (bool Ok, string Detail)> Run)>();
        if (IsElevated())
        {
            strategies.Add(("runas /trustlevel 降权", TryRunAsBasic));
            strategies.Add(("WMI Win32_Process.Create", TryWmiExplore));
        }
        strategies.Add(("Shell.Application", TryShellComExplore));
        strategies.Add(("cmd start", TryCmdStart));
        strategies.Add(("ShellExecute", TryShellExecute));
        strategies.Add(("explorer.exe", TryExplorerExe));

        var failures = new List<string>();
        var unconfirmed = new List<string>();
        var previous = SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX);
        try
        {
            foreach (var (name, run) in strategies)
            {
                var (ok, detail) = run(dir);

                if (!ok)
                {
                    failures.Add($"{name}：{detail}");
                    continue;                       // 明确失败 → 换下一种
                }

                // 调用没抛异常还不够：必须**确认窗口真的开了**才算成功。
                // （实测踩过：runas 返回 0 却什么都没开，若在这里就返回"成功"，
                //   后面的 WMI 那条可行路径就永远轮不到。）
                if (WaitUntilOpen(dir, 2500)) return (true, true, $"已打开 {dir}（{name}，已确认窗口）");

                unconfirmed.Add($"{name}（调用成功但未确认窗口：{detail}）");
            }
        }
        finally
        {
            SetErrorMode(previous);
        }

        if (unconfirmed.Count > 0)
        {
            return (true, false,
                $"已依次尝试打开 {dir}，但都没能确认到窗口：" + string.Join("；", unconfirmed) +
                "。若仍未弹出，请把该路径粘贴到资源管理器地址栏" +
                (failures.Count > 0 ? "；另有失败：" + string.Join("；", failures) : "") +
                $"〔{TokenSummary()}〕");
        }

        return (false, false,
            $"打不开 {dir}（可以把这行路径复制到资源管理器地址栏）—— " + string.Join("；", failures) +
            $"〔{TokenSummary()}〕");
    }

    /// <summary>
    /// 一句话说清"当前进程是什么身份"——这个功能的成败完全由它决定，所以写进日志便于定位：
    /// 提权进程无法把打开目录的请求交给 shell（Win32 5 / 0xc0000142 都是这个原因）。
    /// </summary>
    private static string TokenSummary()
    {
        try
        {
            using var id = System.Security.Principal.WindowsIdentity.GetCurrent();
            var admin = new System.Security.Principal.WindowsPrincipal(id)
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);

            var integrity = "?";
            if (id.Groups != null)
            {
                foreach (var g in id.Groups)
                {
                    if (!g.Value.StartsWith("S-1-16-", StringComparison.Ordinal)) continue;
                    integrity = g.Value switch
                    {
                        "S-1-16-4096" => "Low",
                        "S-1-16-8192" => "Medium",
                        "S-1-16-12288" => "High",
                        "S-1-16-16384" => "System",
                        _ => g.Value,
                    };
                    break;
                }
            }

            var uacOff = false;
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System");
                uacOff = key?.GetValue("EnableLUA") is int lua && lua == 0;
            }
            catch { }

            return $"token={id.Name} admin={admin} 完整性={integrity} UAC关闭={uacOff}";
        }
        catch
        {
            return "token=?";
        }
    }

    // ── 各种尝试（每个都返回"调用是否成功"+细节；真正的成功判定由上面的确认步骤负责）──

    private static (bool Ok, string Detail) TryCmdStart(string dir)
    {
        var r = Run(new ProcessStartInfo("cmd.exe", $"/c start \"\" \"{dir}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = SafeWorkingDirectory(),
        }, watch: true);
        return (r.Ok, r.Detail);
    }

    private static (bool Ok, string Detail) TryShellExecute(string dir)
    {
        var r = Run(new ProcessStartInfo { FileName = dir, UseShellExecute = true }, watch: false);
        return (r.Ok, r.Detail);
    }

    private static (bool Ok, string Detail) TryExplorerExe(string dir)
    {
        var r = Run(new ProcessStartInfo("explorer.exe", $"\"{dir}\"")
        {
            UseShellExecute = false,
            WorkingDirectory = SafeWorkingDirectory(),
        }, watch: true);
        return (r.Ok, r.Detail);
    }

    // ── 提权环境下的两条可行路径 ────────────────────────────────────────

    /// <summary>
    /// <c>runas /trustlevel:0x20000</c>：把命令降到 Basic User 令牌再跑，
    /// 于是 explorer.exe 不再是"管理员身份的 Explorer"，可以正常起来。
    /// 依赖 Secondary Logon 服务；不可用时返回失败，交给下一条。
    /// </summary>
    private static (bool Ok, string Detail) TryRunAsBasic(string dir)
    {
        try
        {
            var psi = new ProcessStartInfo("runas.exe", $"/trustlevel:0x20000 \"explorer.exe \\\"{dir}\\\"\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = SafeWorkingDirectory(),
            };
            var r = Run(psi, watch: true);
            // 把 runas 自己的退出码带上：它返回 0 不代表 explorer 真起来了（实测踩过）
            return (r.Ok, r.Detail);
        }
        catch (Exception ex)
        {
            return (false, Describe(ex));
        }
    }

    /// <summary>
    /// 通过 WMI 的 <c>Win32_Process.Create</c> 起 explorer：进程由 WMI 服务创建，
    /// 不受"父进程是提权进程"的影响（本机实测能开出窗口）。
    /// 用 COM 版的 WMI 脚本对象，避免给启动器引入 System.Management 依赖。
    /// </summary>
    private static (bool Ok, string Detail) TryWmiExplore(string dir)
    {
        try
        {
            var locatorType = Type.GetTypeFromProgID("WbemScripting.SWbemLocator");
            if (locatorType == null) return (false, "本机没有 WMI 脚本对象");

            dynamic locator = Activator.CreateInstance(locatorType)!;
            dynamic service = locator.ConnectServer(".", @"root\cimv2");
            dynamic processClass = service.Get("Win32_Process");
            dynamic inParams = processClass.Methods_("Create").InParameters.SpawnInstance_();
            inParams.CommandLine = $"explorer.exe \"{dir}\"";
            dynamic outParams = processClass.ExecMethod_("Create", inParams);

            int ret = (int)outParams.ReturnValue;
            int pid = (int)outParams.ProcessId;
            return ret == 0
                ? (true, $"Win32_Process.Create 返回 0，PID {pid}")
                : (false, $"Win32_Process.Create 返回 {ret}");
        }
        catch (Exception ex)
        {
            return (false, Describe(ex));
        }
    }

    /// <summary>让已在运行的资源管理器打开目录（COM，不新建进程）。</summary>
    private static (bool Ok, string Detail) TryShellComExplore(string dir)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) return (false, "本机没有 Shell.Application");
            dynamic shell = Activator.CreateInstance(shellType)!;
            shell.Explore(dir);
            return (true, "Explore() 已调用");
        }
        catch (Exception ex)
        {
            return (false, Describe(ex));
        }
    }

    // ── 判断与确认 ──────────────────────────────────────────────────────

    /// <summary>
    /// 当前进程是否"提权"。两层判断：
    /// ① 令牌里管理员组是否启用（真正的提权）；
    /// ② 机器层面 UAC 是否关闭（<c>EnableLUA=0</c>）—— 此时所有进程都带完整管理员令牌，
    ///    同样需要走降权路径，而个别令牌查询可能拿不到管理员组，所以补这一条。
    /// </summary>
    private static bool IsElevated()
    {
        try
        {
            using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            if (new System.Security.Principal.WindowsPrincipal(identity)
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)) return true;
        }
        catch { /* 拿不到令牌就继续看 UAC 开关 */ }

        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System");
            if (key?.GetValue("EnableLUA") is int lua && lua == 0) return true;
        }
        catch { /* 读不到注册表就当非提权，走常规路径 */ }

        return false;
    }

    /// <summary>用一个到处都在的目录当工作目录，避免继承到可疑/受限的 CWD。</summary>
    private static string SafeWorkingDirectory()
    {
        var win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return Directory.Exists(win) ? win : Path.GetTempPath();
    }

    private static bool WaitUntilOpen(string dir, int timeoutMs)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        do
        {
            if (IsFolderOpen(dir)) return true;
            Pump(150);
        } while (Environment.TickCount64 < deadline);
        return false;
    }

    /// <summary>
    /// 等待期间抽空处理消息。**这一步是必须的**：<c>Shell.Application.Windows()</c> 在没有消息泵的
    /// 上下文里（例如 --open-logs 这种"不启 UI"的验证模式）会枚举不到任何窗口，
    /// 于是"明明开了却说没确认"。（点按钮时 WPF 消息泵在跑，本来就没这个问题。）
    /// </summary>
    private static void Pump(int ms)
    {
        try
        {
            var frame = new System.Windows.Threading.DispatcherFrame();
            var timer = new System.Windows.Threading.DispatcherTimer(
                TimeSpan.FromMilliseconds(ms),
                System.Windows.Threading.DispatcherPriority.Background,
                (_, _) => frame.Continue = false,
                System.Windows.Threading.Dispatcher.CurrentDispatcher);
            timer.Start();
            System.Windows.Threading.Dispatcher.PushFrame(frame);
            timer.Stop();
        }
        catch
        {
            System.Threading.Thread.Sleep(ms);   // 拿不到 Dispatcher 就退回硬等
        }
    }

    private static bool IsFolderOpen(string dir)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) return false;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic windows = shell.Windows();
            int count = windows.Count;
            for (int i = 0; i < count; i++)
            {
                try
                {
                    dynamic w = windows.Item(i);
                    string url = (string)w.LocationURL;
                    if (string.IsNullOrEmpty(url)) continue;
                    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) continue;
                    if (string.Equals(uri.LocalPath.TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch { /* 某个窗口拿不到属性就跳过 */ }
            }
        }
        catch { /* 没有 Shell.Application 就当作无法确认 */ }
        return false;
    }

    private readonly record struct Attempt(bool Ok, string Detail);

    /// <summary>
    /// 启动一个进程并判断"到底成没成"。
    /// watch=true 时等一小会儿看子进程是否立刻挂掉：退出码落在 NTSTATUS 错误区间
    /// （0xC0000000 以上，例如 0xC0000142）才算失败；退 1 是 explorer/runas 常见的"已委托"。
    /// </summary>
    private static Attempt Run(ProcessStartInfo psi, bool watch)
    {
        try
        {
            using var process = Process.Start(psi);
            if (process == null) return new Attempt(true, "已交给现有 shell 处理");

            if (watch && process.WaitForExit(1500))
            {
                var code = process.ExitCode;
                if (unchecked((uint)code) >= 0xC0000000u)
                    return new Attempt(false, $"子进程启动失败，退出码 0x{unchecked((uint)code):X8}");
                return new Attempt(true, $"子进程退出码 {code}（已委托）");
            }
            return new Attempt(true, "进程已启动");
        }
        catch (Exception ex)
        {
            return new Attempt(false, Describe(ex));
        }
    }

    private static string Describe(Exception ex)
        => ex is Win32Exception w32 ? $"{ex.Message}（Win32 {w32.NativeErrorCode}）" : ex.Message;
}
