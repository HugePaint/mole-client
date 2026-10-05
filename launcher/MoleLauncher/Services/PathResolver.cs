using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace MoleLauncher.Services;

/// <summary>
/// 自动探测项目根目录、node、Ruffle 的路径。
///
/// 探测顺序刻意设计过：**先看项目内，再看系统**。
/// 项目内自带 Ruffle 时（runtime\ruffle\ruffle.exe）就完全自足，
/// 不必依赖用户机器上装了什么。
/// </summary>
public static class PathResolver
{
    /// <summary>从可执行文件所在目录向上找，直到发现含 molemirror 特征的目录。</summary>
    public static string? FindProjectRoot()
    {
        var candidates = new List<string>();
        var baseDir = AppContext.BaseDirectory;
        candidates.Add(baseDir);

        // 启动器通常位于 <root>\launcher\MoleLauncher\bin\Debug\net7.0-windows\
        var dir = new DirectoryInfo(baseDir);
        for (int i = 0; i < 8 && dir != null; i++)
        {
            candidates.Add(dir.FullName);
            dir = dir.Parent;
        }

        // 也考虑启动器被拷到别处、但配置里记着根目录的情况
        foreach (var c in candidates)
        {
            if (LooksLikeProjectRoot(c)) return c;
        }
        return null;
    }

    private static bool LooksLikeProjectRoot(string dir)
    {
        try
        {
            return Directory.Exists(Path.Combine(dir, "molemirror"))
                && File.Exists(Path.Combine(dir, "molemirror", "index.js"));
        }
        catch { return false; }
    }

    /// <summary>探测 node.exe：先配置、再 PATH、再常见安装位置。</summary>
    public static string? FindNode(string configured)
    {
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

        var onPath = Where("node.exe");
        if (onPath != null) return onPath;

        foreach (var p in new[]
                 {
                     @"C:\Program Files\nodejs\node.exe",
                     @"C:\Program Files (x86)\nodejs\node.exe",
                 })
        {
            if (File.Exists(p)) return p;
        }
        return null;
    }

    /// <summary>探测 Ruffle：先配置、再项目内 runtime\ruffle\、再常见位置。</summary>
    public static string? FindRuffle(string configured, string? projectRoot)
    {
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

        if (projectRoot != null)
        {
            foreach (var rel in new[]
                     {
                         @"runtime\ruffle\ruffle.exe",
                         @"runtime\ruffle.exe",
                         @"ruffle\ruffle.exe",
                     })
            {
                var p = Path.Combine(projectRoot, rel);
                if (File.Exists(p)) return p;
            }
        }

        var onPath = Where("ruffle.exe");
        if (onPath != null) return onPath;

        // Ruffle 安装包（setup.msi）默认装到 LocalAppData
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var rel in new[] { @"Ruffle\ruffle.exe", @"Programs\Ruffle\ruffle.exe" })
        {
            var p = Path.Combine(local, rel);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    /// <summary>简易 where：遍历 PATH 找可执行文件（不依赖 shell 调用）。</summary>
    private static string? Where(string exeName)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var seg in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var full = Path.Combine(seg.Trim(), exeName);
                if (File.Exists(full)) return full;
            }
            catch { }
        }
        return null;
    }
}
