using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using MoleLauncher.Models;

namespace MoleLauncher.Services;

/// <summary>molemirror 的 /__status 响应（只取启动器关心的字段）。</summary>
public sealed class MirrorStatus
{
    [JsonPropertyName("offline")] public bool Offline { get; set; }
    [JsonPropertyName("requests")] public long Requests { get; set; }
    [JsonPropertyName("cacheHits")] public long CacheHits { get; set; }
    [JsonPropertyName("cacheMisses")] public long CacheMisses { get; set; }
    [JsonPropertyName("upstreamOk")] public long UpstreamOk { get; set; }
    [JsonPropertyName("upstreamErr")] public long UpstreamErr { get; set; }
    [JsonPropertyName("cachedEntries")] public long CachedEntries { get; set; }
    [JsonPropertyName("cachedBytes")] public long CachedBytes { get; set; }
    [JsonPropertyName("cacheDir")] public string CacheDir { get; set; } = "";
    [JsonPropertyName("logFile")] public string LogFile { get; set; } = "";

    public double CachedMegabytes => CachedBytes / 1048576.0;
    public double HitRate => Requests > 0 ? (double)CacheHits / Requests : 0;
}

/// <summary>
/// 本地镜像进程的生命周期管理。
///
/// 只负责「启动 / 探活 / 停止」三件事。端口通过环境变量传给 molemirror
/// （见 molemirror/index.js 的 CONFIG 读取逻辑）。
/// </summary>
public sealed class MirrorService : IDisposable
{
    private readonly LogService _log;
    private Process? _process;
    private bool _attached;      // 复用了已在运行的实例（不是我们拉起的）
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };

    public bool IsRunning => _attached || _process is { HasExited: false };

    public MirrorService(LogService log) => _log = log;

    public string ControlUrl(AppSettings s) => $"http://127.0.0.1:{s.ControlPort}";
    public string ProxyUrl(AppSettings s) => $"http://127.0.0.1:{s.ProxyPort}";

    /// <summary>启动镜像并等待控制接口就绪。返回 null 表示成功，否则返回错误说明。</summary>
    public async Task<string?> StartAsync(AppSettings s, CancellationToken ct = default)
    {
        if (IsRunning) return null;

        // 已有别的实例在跑（例如用户先前手工启动、或上一轮遗留）？
        // 直接接管，避免再 spawn 一个然后因端口占用而失败。
        //
        // 但必须校验它服务的是**同一个缓存目录**：若机器上有另一份安装占着同一端口，
        // 盲目复用会让本安装读到别人的 cache，表现为「资源莫名其妙是全的/是缺的」。
        var existing = await TryGetStatusAsync(s);
        if (existing != null)
        {
            var expected = Path.GetFullPath(Path.Combine(s.ProjectRoot, "cache"));
            var actual = "";
            try { actual = Path.GetFullPath(existing.CacheDir ?? ""); } catch { }

            if (!string.IsNullOrEmpty(actual) &&
                !string.Equals(actual.TrimEnd('\\'), expected.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                return $"端口 {s.ProxyPort}/{s.ControlPort} 已被另一个镜像实例占用，" +
                       "但它服务的是**别的**缓存目录：\n" +
                       $"  它     : {actual}\n" +
                       $"  本安装 : {expected}\n\n" +
                       "若那是另一个安装的客户端，请先停掉它；\n" +
                       "或在本安装的「设置 → 镜像端口」里换一组端口（三个都要改）。";
            }

            _attached = true;
            _log.Ok("mirror", $"检测到已有镜像实例在运行，直接复用（{existing.CachedEntries} 个资源，缓存目录一致）");
            return null;
        }
        _attached = false;

        if (string.IsNullOrWhiteSpace(s.ProjectRoot) || !Directory.Exists(Path.Combine(s.ProjectRoot, "molemirror")))
            return "找不到 molemirror 目录，请在设置里指定项目根目录。";
        if (string.IsNullOrWhiteSpace(s.NodePath) || !File.Exists(s.NodePath))
            return "找不到 node.exe，请在设置里指定。";

        var psi = new ProcessStartInfo
        {
            FileName = s.NodePath,
            WorkingDirectory = Path.Combine(s.ProjectRoot, "molemirror"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // node 以 UTF-8 输出中文；不显式指定就会用系统 ANSI 代码页去解，日志全是乱码
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("index.js");
        if (s.OfflineMode) psi.ArgumentList.Add("--offline");

        psi.Environment["MOLEMIRROR_PROXY_PORT"] = s.ProxyPort.ToString();
        psi.Environment["MOLEMIRROR_CONTROL_PORT"] = s.ControlPort.ToString();
        psi.Environment["MOLEMIRROR_ORIGIN_PORT"] = s.OriginPort.ToString();

        try
        {
            _process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _log.Info("mirror", e.Data); };
            _process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) _log.Error("mirror", e.Data); };
            _process.Exited += (_, _) => _log.Warn("mirror", "镜像进程已退出");
            _process.Start();
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            return $"启动镜像失败：{ex.Message}";
        }

        _log.Info("mirror", $"已启动 (PID {_process.Id})，模式={(s.OfflineMode ? "离线" : "在线")}");

        // 探活：最多等 15 秒
        for (int i = 0; i < 30; i++)
        {
            if (ct.IsCancellationRequested) return "已取消";
            if (_process.HasExited) return "镜像进程启动后立即退出，请查看日志。";
            var st = await TryGetStatusAsync(s);
            if (st != null)
            {
                _log.Ok("mirror", $"控制接口就绪：{st.CachedEntries} 个资源 / {st.CachedMegabytes:F1} MB");
                return null;
            }
            await Task.Delay(500, ct);
        }
        return "等待镜像控制接口超时（15 秒）。";
    }

    public void Stop()
    {
        var p = _process;
        _attached = false;
        if (p == null)
        {
            // 复用的外部实例：不主动杀别人的进程，只是不再使用
            return;
        }
        try
        {
            if (!p.HasExited)
            {
                p.Kill(entireProcessTree: true);
                p.WaitForExit(3000);
                _log.Info("mirror", "镜像已停止");
            }
        }
        catch (Exception ex)
        {
            _log.Warn("mirror", $"停止镜像时出错：{ex.Message}");
        }
        finally
        {
            try { p.Dispose(); } catch { }
            _process = null;
        }
    }

    /// <summary>查询 /__status。失败返回 null（不抛异常，供轮询用）。</summary>
    public async Task<MirrorStatus?> TryGetStatusAsync(AppSettings s)
    {
        try
        {
            var json = await _http.GetStringAsync($"{ControlUrl(s)}/__status");
            return JsonSerializer.Deserialize<MirrorStatus>(json);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
    }
}
