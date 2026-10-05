using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using MoleLauncher.Models;

namespace MoleLauncher.Services;

/// <summary>
/// Ruffle 引擎的启动参数装配与进程管理。
///
/// ⚠️ 这里的参数组合是 **Phase 0 实测验证过**的那一套（见 docs/spike-0.md），
/// 每一行都有具体原因，改动前请先读注释：
///
///   --spoof-url        破 Client.swf 的域名守卫（检测到自己不在官网会 navigateToURL 弹走）
///   --base             相对资源路径（version/ resource/ config/ dll/）的解析基准
///   --config           **必须显式指定**：默认的 %LOCALAPPDATA%\ruffle 创建会被拒
///                      （os error 5），Ruffle 会静默退出且不打印任何东西
///   --tcp-connections  放行裸 TCP（游戏用 flash.net.Socket 连官方服务器）
///   --socket-allow     白名单：登录服 1863 / 游戏服 1865 / Server.xml 声明的 3200
///   --player-version   伪装成 Flash 32（客户端按 plugin 版本判断兼容性）
///   --scale show-all   强制等比缩放（客户端自设 NoScale，小窗口会溢出）
/// </summary>
public sealed class RuffleService : IDisposable
{
    private readonly LogService _log;
    private Process? _process;

    public bool IsRunning => _process is { HasExited: false };

    public RuffleService(LogService log) => _log = log;

    public void Dispose() => Stop();

    /// <summary>组装完整命令行（同时供 UI 展示，便于排查）。</summary>
    public static List<string> BuildArguments(AppSettings s)
    {
        var args = new List<string>
        {
            "http://mole.61.com/Client.swf",
            "--base", "http://mole.61.com/",
            "--spoof-url", "http://mole.61.com/Client.swf",
            "--config", Path.Combine(s.ProjectRoot, "data", "config"),
            "--cache-directory", Path.Combine(s.ProjectRoot, "data", "cache"),
            "--storage", "disk",
            "--save-directory", Path.Combine(s.ProjectRoot, "data", "SharedObjects"),
            "--tcp-connections", "allow",
            "--socket-allow", "123.206.131.236:1863",
            "--socket-allow", "123.206.131.236:1865",
            "--socket-allow", "123.206.131.63:3200",
            "--player-version", "32",
            "--scale", "show-all",
            "--force-scale",
            "--width", s.Width.ToString(),
            "--height", s.Height.ToString(),
        };

        if (s.UseProxy)
        {
            args.Add("--proxy");
            args.Add($"http://127.0.0.1:{s.ProxyPort}");
        }

        if (s.Fullscreen) args.Add("--fullscreen");
        if (s.NoGui) args.Add("--no-gui");

        if (!string.IsNullOrWhiteSpace(s.ExtraRuffleArgs))
        {
            foreach (var extra in s.ExtraRuffleArgs.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                args.Add(extra);
        }
        return args;
    }

    public static string BuildCommandLine(AppSettings s)
    {
        var sb = new StringBuilder();
        sb.Append('"').Append(s.RufflePath).Append('"');
        foreach (var a in BuildArguments(s))
        {
            sb.Append(' ');
            if (a.Contains(' ')) sb.Append('"').Append(a).Append('"');
            else sb.Append(a);
        }
        return sb.ToString();
    }

    /// <summary>启动 Ruffle。返回 null 表示成功，否则返回错误说明。</summary>
    public string? Start(AppSettings s)
    {
        if (IsRunning) return null;

        if (string.IsNullOrWhiteSpace(s.RufflePath) || !File.Exists(s.RufflePath))
            return "找不到 Ruffle，请在设置里指定 ruffle.exe 的路径。";

        // 引擎需要的目录先建好，避免它自己创建失败
        foreach (var dir in new[]
                 {
                     Path.Combine(s.ProjectRoot, "data", "config"),
                     Path.Combine(s.ProjectRoot, "data", "cache"),
                     Path.Combine(s.ProjectRoot, "data", "SharedObjects"),
                 })
        {
            try { Directory.CreateDirectory(dir); } catch { }
        }

        var psi = new ProcessStartInfo
        {
            FileName = s.RufflePath,
            WorkingDirectory = s.ProjectRoot,
            UseShellExecute = false,
            CreateNoWindow = false,   // 游戏窗口本身要可见
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // 显式 UTF-8：否则非 ASCII 输出（含中文）会按系统 ANSI 代码页解成乱码
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in BuildArguments(s)) psi.ArgumentList.Add(a);

        // Ruffle 用 reqwest 加载资源，直接读标准的代理环境变量
        if (s.UseProxy)
        {
            var proxy = $"http://127.0.0.1:{s.ProxyPort}";
            psi.Environment["HTTP_PROXY"] = proxy;
            psi.Environment["HTTPS_PROXY"] = proxy;
            psi.Environment["http_proxy"] = proxy;
            psi.Environment["https_proxy"] = proxy;
        }
        psi.Environment["RUST_LOG"] = "ruffle_core=info,ruffle_desktop=warn,wgpu=error";

        try
        {
            _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _log.Info("ruffle", e.Data); };
            _process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _log.Error("ruffle", e.Data); };
            _process.Exited += (_, _) => _log.Info("ruffle", "游戏进程已退出");
            _process.Start();
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            return $"启动 Ruffle 失败：{ex.Message}";
        }

        _log.Ok("ruffle", $"游戏已启动 (PID {_process.Id})，{s.Width}×{s.Height}"
                          + (s.UseProxy ? "，走本地镜像" : "，直连官方 CDN"));
        return null;
    }

    public void Stop()
    {
        var p = _process;
        if (p == null) return;
        try
        {
            if (!p.HasExited)
            {
                p.Kill(entireProcessTree: true);
                p.WaitForExit(3000);
                _log.Info("ruffle", "游戏已停止");
            }
        }
        catch (Exception ex) { _log.Warn("ruffle", $"停止游戏时出错：{ex.Message}"); }
        finally
        {
            try { p.Dispose(); } catch { }
            _process = null;
        }
    }
}
