using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using MoleLauncher.Models;

namespace MoleLauncher.Services;

/// <summary>
/// 配置读写。
///
/// 存放位置刻意选择「项目内优先」：
/// 本机实测在 %APPDATA%\Roaming 下新建目录会被拒（Access denied），
/// 这与 Ruffle 启动时 "Failed to create configuration directory (os error 5)" 是**同一个根因**。
/// 因此配置默认写在 &lt;项目根&gt;\data\settings.json，只有那里不可写时才退回 %APPDATA%。
/// </summary>
public sealed class SettingsService
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private readonly LogService? _log;
    private readonly string _file;

    public SettingsService(string baseDirectory, LogService? log = null)
    {
        _log = log;
        _file = Path.Combine(baseDirectory, "data", "settings.json");
    }

    public string SettingsFile => _file;

    public AppSettings Settings { get; private set; } = new();

    public void Load()
    {
        // 项目内没有配置时，看一眼 %APPDATA% 有没有旧配置可以迁移过来
        var candidates = new List<string> { _file };
        try
        {
            candidates.Add(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MoleLauncher", "settings.json"));
        }
        catch { }

        foreach (var f in candidates)
        {
            try
            {
                if (!File.Exists(f)) continue;
                var json = File.ReadAllText(f);
                Settings = JsonSerializer.Deserialize<AppSettings>(json, Options) ?? new AppSettings();
                _log?.Info("config", $"已载入配置 {f}");
                return;
            }
            catch (Exception ex)
            {
                _log?.Warn("config", $"配置读取失败 {f}：{ex.Message}");
            }
        }
        Settings = new AppSettings();
    }

    public void Save()
    {
        var targets = new List<string> { _file };
        try
        {
            targets.Add(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MoleLauncher", "settings.json"));
        }
        catch { }

        var errors = new List<string>();
        foreach (var f in targets)
        {
            try
            {
                var dir = Path.GetDirectoryName(f);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(f, JsonSerializer.Serialize(Settings, Options));
                _log?.Info("config", $"配置已保存 {f}");
                return;
            }
            catch (Exception ex)
            {
                // 空的 catch 曾让「配置没写成」完全无迹可寻，这里必须留痕
                errors.Add($"{f}: {ex.Message}");
            }
        }
        _log?.Warn("config", "配置保存失败（所有候选位置都不可写）：" + string.Join(" | ", errors));
    }

    /// <summary>把探测到的路径补进配置（只在为空时填）。返回是否有改动。</summary>
    public bool FillMissingPaths()
    {
        bool changed = false;

        if (string.IsNullOrWhiteSpace(Settings.ProjectRoot))
        {
            var root = PathResolver.FindProjectRoot();
            if (root != null) { Settings.ProjectRoot = root; changed = true; }
        }

        if (string.IsNullOrWhiteSpace(Settings.NodePath))
        {
            var node = PathResolver.FindNode(Settings.NodePath);
            if (node != null) { Settings.NodePath = node; changed = true; }
        }

        if (string.IsNullOrWhiteSpace(Settings.RufflePath))
        {
            var ruffle = PathResolver.FindRuffle(Settings.RufflePath,
                string.IsNullOrWhiteSpace(Settings.ProjectRoot) ? null : Settings.ProjectRoot);
            if (ruffle != null) { Settings.RufflePath = ruffle; changed = true; }
        }

        return changed;
    }
}
