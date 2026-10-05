using System.IO;
using System.Text.Json.Serialization;

namespace MoleLauncher.Models;

/// <summary>
/// 启动器配置。持久化到 %APPDATA%\MoleLauncher\settings.json。
/// 所有路径都允许为空，为空时由 <see cref="Services.PathResolver"/> 自动探测。
/// </summary>
public sealed class AppSettings
{
    /// <summary>项目根目录（含 molemirror\、runtime\ruffle\、cache\）。</summary>
    public string ProjectRoot { get; set; } = "";

    public string NodePath { get; set; } = "";
    public string RufflePath { get; set; } = "";

    /// <summary>本地镜像的端口。需与 molemirror 读取的环境变量一致。</summary>
    public int ProxyPort { get; set; } = 8899;
    public int ControlPort { get; set; } = 8898;
    public int OriginPort { get; set; } = 8080;

    /// <summary>离线模式：镜像拒绝一切回源，用于验证资源本地化完整性。</summary>
    public bool OfflineMode { get; set; }

    /// <summary>是否让 Ruffle 走本地镜像（关闭则直连官方 CDN）。</summary>
    public bool UseProxy { get; set; } = true;

    public int Width { get; set; } = 1000;
    public int Height { get; set; } = 620;
    public bool Fullscreen { get; set; }
    public bool NoGui { get; set; } = true;

    /// <summary>高级：追加给 Ruffle 的额外参数。</summary>
    public string ExtraRuffleArgs { get; set; } = "";

    /// <summary>关闭窗口时最小化到托盘而不是退出。</summary>
    public bool MinimizeToTray { get; set; } = true;

    /// <summary>启动时自动拉起本地镜像。</summary>
    public bool AutoStartMirror { get; set; } = true;
}
