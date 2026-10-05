using System;
using System.Collections.ObjectModel;
using System.Windows.Threading;

namespace MoleLauncher.Services;

public enum LogLevel { Info, Ok, Warn, Error }

public sealed record LogEntry(DateTime Time, LogLevel Level, string Source, string Message)
{
    public string TimeText => Time.ToString("HH:mm:ss");

    /// <summary>UI 上的一行。带上级别字母，导出/截图时也能一眼看出严重程度。</summary>
    public string Display
    {
        get
        {
            var mark = Level switch
            {
                LogLevel.Ok => "OK ",
                LogLevel.Warn => "WRN",
                LogLevel.Error => "ERR",
                _ => "   ",
            };
            return $"[{TimeText}] {mark} {Source,-7} {Message}";
        }
    }
}

/// <summary>
/// 应用内日志。固定 1000 条上限，线程安全（通过 Dispatcher 回到 UI 线程）。
/// 同时把同一份内容写到 logs\launcher.log，便于事后排查。
/// </summary>
public sealed class LogService
{
    private const int MaxEntries = 1000;
    private readonly Dispatcher _dispatcher;
    private readonly string _logFile;
    private readonly object _fileLock = new();

    public ObservableCollection<LogEntry> Entries { get; } = new();

    public LogService(Dispatcher dispatcher, string logDirectory)
    {
        _dispatcher = dispatcher;
        try
        {
            System.IO.Directory.CreateDirectory(logDirectory);
            _logFile = System.IO.Path.Combine(logDirectory, "launcher.log");
        }
        catch
        {
            _logFile = "";
        }
    }

    public void Info(string source, string message) => Add(LogLevel.Info, source, message);
    public void Ok(string source, string message) => Add(LogLevel.Ok, source, message);
    public void Warn(string source, string message) => Add(LogLevel.Warn, source, message);
    public void Error(string source, string message) => Add(LogLevel.Error, source, message);

    public void Add(LogLevel level, string source, string message)
    {
        var entry = new LogEntry(DateTime.Now, level, source, message);

        void Apply()
        {
            Entries.Add(entry);
            while (Entries.Count > MaxEntries) Entries.RemoveAt(0);
        }

        if (_dispatcher.CheckAccess()) Apply();
        else _dispatcher.BeginInvoke(Apply);

        if (_logFile.Length > 0)
        {
            try
            {
                lock (_fileLock)
                {
                    // 带 BOM 的 UTF-8：Windows 的记事本 / VS Code 等能正确识别中文，
                    // 无 BOM 时 PowerShell 5.1 的 Get-Content 会按 ANSI 读成乱码。
                    if (!System.IO.File.Exists(_logFile))
                    {
                        System.IO.File.WriteAllText(_logFile, "",
                            new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
                    }
                    System.IO.File.AppendAllText(_logFile,
                        $"{entry.Time:yyyy-MM-dd HH:mm:ss} [{level,-5}] {source,-8} {message}{Environment.NewLine}",
                        new System.Text.UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                }
            }
            catch { /* 日志写失败不影响主流程 */ }
        }
    }
}
