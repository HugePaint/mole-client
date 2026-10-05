using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using MoleLauncher.Services;

namespace MoleLauncher;

public partial class App : Application
{
    // WinExe 默认没有控制台，--print-command 需要附着到调用方的控制台才能输出
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int dwProcessId);

    private const int ATTACH_PARENT_PROCESS = -1;

    /// <summary>--play：窗口起来后自动走一遍「启动镜像 + 启动游戏」。</summary>
    public static bool AutoPlay { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        foreach (var a in e.Args)
        {
            // 调试/自动化用：不启动 UI，只打印将要执行的 Ruffle 命令行然后退出。
            // 这样「启动器构造的参数」是可被客观验证的，而不必真的开一个游戏窗口。
            if (string.Equals(a, "--print-command", StringComparison.OrdinalIgnoreCase))
            {
                PrintCommand();
                Shutdown(0);
                return;
            }

            // 实用功能 + 端到端验证手段：窗口启动后立刻拉起镜像与游戏。
            // 配合计划任务即可实现「开机直进游戏」。
            if (string.Equals(a, "--play", StringComparison.OrdinalIgnoreCase))
                AutoPlay = true;

            // 下载 Ruffle 到 <root>\runtime\ruffle\（与设置窗口的「下载…」同一份逻辑）
            if (string.Equals(a, "--download-ruffle", StringComparison.OrdinalIgnoreCase))
            {
                // ⚠️ 不能直接 DownloadRuffle().GetAwaiter().GetResult()：
                // 那是在 UI 线程上同步等待，而 await 的续体默认要回 UI 线程 → 死锁。
                // （实测表现：进程卡住不退出、内存不动、临时文件也不建。）
                // 用 Task.Run 把整段逻辑挪到线程池，那里没有同步上下文，await 才不会回 UI 线程。
                System.Threading.Tasks.Task.Run(() => DownloadRuffle()).GetAwaiter().GetResult();
                Shutdown(0);
                return;
            }
        }

        base.OnStartup(e);
    }

    /// <summary>命令行下载模式：把进度打到父控制台，便于脚本化验证。</summary>
    private static async System.Threading.Tasks.Task DownloadRuffle()
    {
        AttachConsole(ATTACH_PARENT_PROCESS);

        var root = PathResolver.FindProjectRoot() ?? AppContext.BaseDirectory;
        var target = Path.Combine(root, "runtime", "ruffle");
        var staging = Path.Combine(root, "data", "temp");

        Console.WriteLine("目标目录: " + target);
        Console.WriteLine("暂存目录: " + staging + "   (刻意不用 %TEMP%)");

        var r = await RuffleDownloader.DownloadAsync(target, staging, m => Console.WriteLine("  " + m));

        Console.WriteLine("");
        Console.WriteLine(r.Ok ? "成功: " + r.Message : "失败: " + r.Message);
        if (r.ExePath != null) Console.WriteLine("ruffle.exe: " + r.ExePath);
        Console.Out.Flush();
    }

    private static void PrintCommand()
    {
        AttachConsole(ATTACH_PARENT_PROCESS);

        var root = PathResolver.FindProjectRoot() ?? AppContext.BaseDirectory;
        var svc = new SettingsService(root);
        svc.Load();
        svc.FillMissingPaths();

        var s = svc.Settings;

        void Out(string line)
        {
            Console.WriteLine(line);
            Console.Out.Flush();
        }

        Out("");
        Out("=== 摩尔庄园本地客户端 · 启动参数 ===");
        Out($"项目根目录 : {s.ProjectRoot}");
        Out($"node       : {s.NodePath}");
        Out($"ruffle     : {s.RufflePath}");
        Out($"配置文件   : {svc.SettingsFile}");
        Out("");
        Out("镜像启动命令:");
        Out($"  \"{s.NodePath}\" index.js{(s.OfflineMode ? " --offline" : "")}");
        Out($"  (工作目录 {Path.Combine(s.ProjectRoot, "molemirror")}，" +
            $"端口 proxy={s.ProxyPort} control={s.ControlPort} origin={s.OriginPort})");
        Out("");
        Out("Ruffle 命令行:");
        Out("  " + (string.IsNullOrWhiteSpace(s.RufflePath)
            ? "(未找到 ruffle.exe)"
            : RuffleService.BuildCommandLine(s)));
        Out("");
        Out("Ruffle 参数逐项:");
        foreach (var arg in RuffleService.BuildArguments(s))
            Out("  " + arg);
        Out("");
    }
}
