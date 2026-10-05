using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace MoleLauncher.Services;

/// <summary>一条 Ruffle 输出经筛选后的处置方式。</summary>
public enum RuffleLogVerdict
{
    /// <summary>原样记录。</summary>
    Pass,

    /// <summary>属于已知噪声，丢弃（只计数，稍后汇总）。</summary>
    Suppress,

    /// <summary>丢弃原行，改为记录 <c>text</c>（用于一次性提示）。</summary>
    Note,
}

/// <summary>
/// Ruffle 输出的降噪与提示过滤器。
///
/// 背景：Ruffle 会为每个 SWF 里重复的帧标签打一条 WARN。摩尔客户端的 SWF 里这类标签很多，
/// 实测一次 55 分钟的游玩产生 1120 条 `Movie clip N: Duplicated frame label`，
/// 占 launcher.log 全文的 85%，把真正有用的告警（404、AVM2 异常、字体回退）全埋了。
/// 这些告警对运行没有任何影响，因此在这里折叠，并在游戏退出时汇总条数，
/// 保证"信息不丢、噪声不刷屏"。
///
/// 另外顺手把 `Unknown device font` 变成一次性提示 —— 它意味着某段文本没能用上原版字体，
/// 正是 tools\install-xp-simsun.ps1 要解决的问题（详见 docs/fonts.md）。
///
/// 约定：本类不做线程切分，调用方（RuffleService）在 stdout 回调线程里用它，
/// 内部用锁保护计数；WriteSummary 由 UI 线程调用。
/// </summary>
public sealed class RuffleLogFilter
{
    /// <summary>命中即折叠的噪声特征（正则）。新增一条前请先确认它确实无害。</summary>
    private static readonly (string Name, Regex Pattern)[] Noise =
    {
        ("Duplicated frame label", new Regex(@"Movie clip \d+: Duplicated frame label", RegexOptions.Compiled)),
    };

    private static readonly Regex DeviceFontMiss =
        new(@"Unknown device font ""(?<name>[^""]+)""", RegexOptions.Compiled);

    private readonly object _lock = new();
    private readonly Dictionary<string, int> _suppressed = new();
    private readonly HashSet<string> _hintedFonts = new();

    /// <summary>筛选一行 Ruffle 输出。返回 Suppress 时调用方应直接丢弃该行。</summary>
    public RuffleLogVerdict Classify(string line, out string text)
    {
        text = line;

        foreach (var (name, pattern) in Noise)
        {
            if (!pattern.IsMatch(line)) continue;
            lock (_lock)
            {
                _suppressed.TryGetValue(name, out var n);
                _suppressed[name] = n + 1;
            }
            return RuffleLogVerdict.Suppress;
        }

        var miss = DeviceFontMiss.Match(line);
        if (miss.Success)
        {
            var font = miss.Groups["name"].Value;
            lock (_lock)
            {
                if (!_hintedFonts.Add(font)) return RuffleLogVerdict.Suppress;
            }
            text = $"未能使用设备字体 \"{font}\"（Ruffle 回退到自带字体，字形会与原版不一致）。" +
                   "需要还原原版宋体请运行 tools\\install-xp-simsun.ps1，详见 docs\\fonts.md";
            return RuffleLogVerdict.Note;
        }

        return RuffleLogVerdict.Pass;
    }

    /// <summary>取走并清空折叠统计；游戏退出或界面需要时调用。</summary>
    public IReadOnlyList<string> DrainSummaries()
    {
        var result = new List<string>();
        lock (_lock)
        {
            foreach (var (name, count) in _suppressed)
            {
                if (count > 0) result.Add($"已折叠 {count} 条 \"{name}\" 告警（对运行无影响，可用 tools\\filter-ruffle-log.js 还原原文）");
            }
            _suppressed.Clear();
        }
        return result;
    }
}
