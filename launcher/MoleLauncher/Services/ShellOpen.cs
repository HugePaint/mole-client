using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace MoleLauncher.Services;

/// <summary>
/// 用资源管理器打开目录 —— 按"需不需要新起进程"分层的兜底实现。
///
/// 这个功能前后踩了三个坑，都是本机实测复现的（详见 docs/launcher.md）：
///
/// 1. 把「目录」交给 <c>ShellExecute</c> 解析 <c>open</c> 动词 → 抛 Win32 5（拒绝访问）。
/// 2. 改成直接 <c>CreateProcess("explorer.exe", dir)</c> → <c>Process.Start</c> 不抛异常，
///    但子进程在 DLL 初始化阶段就死（0xc0000142 = STATUS_DLL_INIT_FAILED），
///    Windows 弹"explorer.exe - 应用程序错误"。系统日志 Application Popup 可查。
/// 3. <c>cmd /c start</c> 会返回 0（委托成功），但 shell 随后仍可能弹
///    "Windows 无法访问指定设备、路径或文件"。
///
/// 共同点：**失败的都不是"我们这段代码"，而是"新起 / 委托出去的那个进程"**，
/// 且同一段代码从别的上下文（例如 pwsh、WMI）跑就是好的 —— 取决于进程上下文。
/// 所以这里既分层重试，又用 <c>Shell.Application</c> **回头确认窗口真的开了**，
/// 不再出现"日志写成功、用户看到报错框"的情况。
/// </summary>
public static class ShellOpen
{
    [DllImport("kernel32.dll")]
    private static extern uint SetErrorMode(uint uMode);

    private const uint SEM_FAILCRITICALERRORS = 0x0001;
    private const uint SEM_NOOPENFILEERRORBOX = 0x8000;

    /// <summary>打开目录。返回 (是否成功, 说明)；成功是"确认到窗口已打开"，失败带每种方式的结局。</summary>
    public static (bool Ok, string Message) Folder(string dir)
    {
        try
        {
            Directory.CreateDirectory(dir);
        }
        catch (Exception ex)
        {
            return (false, $"目录不可用：{ex.Message}");
        }

        var failures = new List<string>();
        var previous = SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX);
        try
        {
            // ① 委托给已经在跑的 shell（COM，不新建进程）——最不容易受当前上下文影响
            if (TryShellComExplore(dir, out var comDetail)) return (true, $"已让资源管理器打开 {dir}（Shell.Application：{comDetail}）");
            failures.Add("Shell.Application：" + comDetail);

            // ② cmd 的 start：同样走 shell 的 open
            var r2 = Run(new ProcessStartInfo("cmd.exe", $"/c start \"\" \"{dir}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = SafeWorkingDirectory(),
            }, watch: true);
            if (r2.Ok) return (true, $"已用 cmd start 打开 {dir}（{Note(dir)}）");
            failures.Add("cmd start：" + r2.Detail);

            // ③ ShellExecute 直接给目录
            var r3 = Run(new ProcessStartInfo { FileName = dir, UseShellExecute = true }, watch: false);
            if (r3.Ok) return (true, $"已用 ShellExecute 打开 {dir}（{Note(dir)}）");
            failures.Add("ShellExecute：" + r3.Detail);

            // ④ 最后才自己起 explorer.exe（最可能踩 0xc0000142 的一条）
            var r4 = Run(new ProcessStartInfo("explorer.exe", $"\"{dir}\"")
            {
                UseShellExecute = false,
                WorkingDirectory = SafeWorkingDirectory(),   // 别让它继承可能有问题的工作目录
            }, watch: true);
            if (r4.Ok) return (true, $"已用 explorer.exe 打开 {dir}（{Note(dir)}）");
            failures.Add("explorer.exe：" + r4.Detail);
        }
        finally
        {
            SetErrorMode(previous);
        }

        return (false, $"打不开 {dir}（可以把这行路径复制到资源管理器地址栏）—— " + string.Join("；", failures));
    }

    /// <summary>
    /// 措辞按"能不能确认"分两档：确认到窗口就说确认；否则明确说"没确认到，若没弹出请自己粘贴路径"。
    /// 不做"调用没抛异常就算成功、还不告诉用户可能没开"这种事 —— 那正是让人看着日志"成功"却对着报错框的原因。
    /// 以管理员身份运行时额外点明：Windows 会挡住从高完整性进程发起的 shell 打开操作。
    /// </summary>
    private static string Note(string dir)
    {
        if (WaitUntilOpen(dir, 2000)) return "已确认窗口";
        var extra = IsElevated()
            ? "；注意：本进程当前是**管理员权限**，Windows 会拦住这类打开操作，请用普通权限重开启动器再试"
            : "";
        return "未能确认窗口，若没弹出请把该路径粘贴到资源管理器地址栏" + extra;
    }

    /// <summary>当前进程是否已提权（普通用户下的管理员组不算）。</summary>
    private static bool IsElevated()
    {
        try
        {
            using var identity = System.Security.Principal.WindowsIdentity.GetCurrent();
            return new System.Security.Principal.WindowsPrincipal(identity)
                .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    /// <summary>用一个到处都在的目录当工作目录，避免继承到可疑/受限的 CWD。</summary>
    private static string SafeWorkingDirectory()
    {
        var win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return Directory.Exists(win) ? win : Path.GetTempPath();
    }

    // ── 确认窗口是否真的开了（Shell.Application 枚举已打开的窗口）──────────
    private static bool WaitUntilOpen(string dir, int timeoutMs)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        do
        {
            if (IsFolderOpen(dir)) return true;
            System.Threading.Thread.Sleep(200);
        } while (Environment.TickCount64 < deadline);
        return false;
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
        catch { /* 没有 Shell.Application（极少见）就当作无法确认 */ }
        return false;
    }

    /// <summary>让已在运行的资源管理器打开目录（COM，不新建进程）。</summary>
    private static bool TryShellComExplore(string dir, out string detail)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) { detail = "本机没有 Shell.Application"; return false; }
            dynamic shell = Activator.CreateInstance(shellType)!;
            shell.Explore(dir);
            detail = Note(dir);
            return true;
        }
        catch (Exception ex)
        {
            detail = Describe(ex);
            return false;
        }
    }

    private readonly record struct Attempt(bool Ok, string Detail);

    /// <summary>
    /// 启动一个进程并判断"到底成没成"。
    /// watch=true 时等一小会儿看子进程是否立刻挂掉：退出码落在 NTSTATUS 错误区间
    /// （0xC0000000 以上，例如 0xC0000142）才算失败；退 1 是 explorer 常见的"我已委托给现有 shell"。
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
                return new Attempt(true, $"子进程退出码 {code}（已委托给现有 shell）");
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
