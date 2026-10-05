using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace MoleLauncher.Services;

/// <summary>
/// 从 Ruffle 官方 GitHub Releases 下载 Windows x64 版并解压到指定目录。
///
/// 抽成独立服务的原因：
///   1. 设置窗口的「下载…」按钮与命令行 <c>--download-ruffle</c> 共用同一份逻辑；
///   2. 下载逻辑可以**被自动化验证**，不必靠人工点按钮。
/// </summary>
public static class RuffleDownloader
{
    public sealed record Result(bool Ok, string Message, string? ExePath, string? Tag);

    /// <summary>
    /// 下载并解压到 <paramref name="targetDir"/>。
    /// </summary>
    /// <param name="targetDir">Ruffle 的落地目录（通常是 &lt;root&gt;\runtime\ruffle）</param>
    /// <param name="stagingDir">
    /// 压缩包的临时落盘目录。**默认不要用 %TEMP%**：
    /// 实测本机这个未签名的自编译 exe 写 <c>%TEMP%</c> / <c>%APPDATA%</c> 会稳定被拒
    /// （Access denied），而同一进程写项目内目录完全正常，
    /// 且 cmd.exe / node.exe 这类受信任程序写 %TEMP% 也没问题。
    /// 因此暂存文件一律放在项目内，既绕开该限制，也符合"本地/便携"的定位。
    /// 为空时退化为 &lt;targetDir&gt;\..\..\data\temp。
    /// </param>
    /// <param name="progress">进度回调（用于 UI 或日志）</param>
    public static async Task<Result> DownloadAsync(string targetDir, string? stagingDir = null,
        Action<string>? progress = null)
    {
        void Say(string m) => progress?.Invoke(m);

        if (string.IsNullOrWhiteSpace(stagingDir))
            stagingDir = Path.GetFullPath(Path.Combine(targetDir, "..", "..", "data", "temp"));

        try
        {
            Directory.CreateDirectory(stagingDir);

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("MoleLauncher/0.1");

            Say("正在查询 Ruffle 最新版本…");
            var relJson = await http.GetStringAsync(
                "https://api.github.com/repos/ruffle-rs/ruffle/releases?per_page=5");
            using var doc = JsonDocument.Parse(relJson);

            string? zipUrl = null, tag = null;
            foreach (var rel in doc.RootElement.EnumerateArray())
            {
                if (!rel.TryGetProperty("assets", out var assets)) continue;
                foreach (var a in assets.EnumerateArray())
                {
                    var name = a.GetProperty("name").GetString() ?? "";
                    if (name.Contains("windows-x86_64", StringComparison.OrdinalIgnoreCase)
                        && name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        zipUrl = a.GetProperty("browser_download_url").GetString();
                        tag = rel.GetProperty("tag_name").GetString();
                        break;
                    }
                }
                if (zipUrl != null) break;
            }

            if (zipUrl == null)
            {
                return new Result(false,
                    "未能在 GitHub 上找到 Windows x64 版 Ruffle 的下载地址。\n" +
                    "可手动从 https://ruffle.rs/downloads 下载后指定路径。",
                    null, null);
            }

            Say($"找到 {tag}，开始下载…");

            var tmp = Path.Combine(stagingDir, "ruffle-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (var resp = await http.GetAsync(zipUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    resp.EnsureSuccessStatusCode();
                    var total = resp.Content.Headers.ContentLength ?? -1;
                    await using var src = await resp.Content.ReadAsStreamAsync();
                    await using var dst = File.Create(tmp);

                    var buf = new byte[81920];
                    long read = 0;
                    int n;
                    int lastPct = -1;
                    while ((n = await src.ReadAsync(buf)) > 0)
                    {
                        await dst.WriteAsync(buf.AsMemory(0, n));
                        read += n;
                        if (total > 0)
                        {
                            var pct = (int)(read * 100 / total);
                            if (pct / 10 != lastPct / 10) { Say($"  下载中 {pct}%"); lastPct = pct; }
                        }
                    }
                }

                Say("正在解压…");
                Directory.CreateDirectory(targetDir);
                ZipFile.ExtractToDirectory(tmp, targetDir, overwriteFiles: true);
            }
            finally
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            }

            // 定位 ruffle.exe（压缩包内可能是平铺的，也可能带一层目录）
            var exe = Path.Combine(targetDir, "ruffle.exe");
            if (!File.Exists(exe))
            {
                var found = Directory.GetFiles(targetDir, "ruffle.exe", SearchOption.AllDirectories);
                if (found.Length > 0) exe = found[0];
            }

            if (!File.Exists(exe))
                return new Result(false, $"已解压 {tag} 到 {targetDir}，但其中找不到 ruffle.exe。", null, tag);

            Say($"完成：{exe}");
            return new Result(true, $"已下载并解压 {tag}", exe, tag);
        }
        catch (Exception ex)
        {
            return new Result(false, "下载失败：" + ex.Message, null, null);
        }
    }
}
