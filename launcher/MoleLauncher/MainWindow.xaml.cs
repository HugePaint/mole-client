using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using MoleLauncher.Services;

namespace MoleLauncher;

public partial class MainWindow : Window
{
    private readonly SettingsService _settingsService;
    private readonly LogService _log;
    private readonly MirrorService _mirror;
    private readonly RuffleService _ruffle;
    private readonly DispatcherTimer _timer;

    private System.Windows.Forms.NotifyIcon? _tray;
    private bool _reallyClose;

    public ObservableCollection<LogEntry> Logs => _log.Entries;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;

        var root = PathResolver.FindProjectRoot() ?? AppContext.BaseDirectory;
        // 注意顺序：日志服务要先建好，后面的服务才能把失败原因写进去
        _log = new LogService(Dispatcher, Path.Combine(root, "logs"));
        _mirror = new MirrorService(_log);
        _ruffle = new RuffleService(_log);
        _settingsService = new SettingsService(root, _log);

        _settingsService.Load();
        if (_settingsService.FillMissingPaths()) _settingsService.Save();

        var s = _settingsService.Settings;
        _log.Info("app", $"项目根目录：{s.ProjectRoot}");
        _log.Info("app", $"node：{s.NodePath}");
        _log.Info("app", $"Ruffle：{s.RufflePath}");

        if (string.IsNullOrWhiteSpace(s.RufflePath))
            _log.Warn("app", "未找到 Ruffle。请在设置里指定，或把 ruffle.exe 放到 runtime\\ruffle\\。");

        RefreshCommandPreview();
        SetupTray();

        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _timer.Tick += async (_, _) => await PollAsync();
        _timer.Start();

        Loaded += async (_, _) =>
        {
            if (_settingsService.Settings.AutoStartMirror)
            {
                var err = await _mirror.StartAsync(_settingsService.Settings);
                if (err != null) _log.Warn("mirror", err);
            }
            await PollAsync();

            // --play：不等用户点按钮，直接进游戏
            if (App.AutoPlay)
            {
                _log.Info("app", "--play：自动启动游戏");
                await StartGameAsync();
            }
        };

        Closing += OnClosing;
        Closed += (_, _) =>
        {
            _timer.Stop();
            _tray?.Dispose();
            _ruffle.Dispose();
            _mirror.Dispose();
        };
    }

    // ───────────────────────── 托盘 ─────────────────────────

    private void SetupTray()
    {
        try
        {
            var menu = new System.Windows.Forms.ContextMenuStrip();
            menu.Items.Add("显示主窗口", null, (_, _) => RestoreFromTray());
            menu.Items.Add("启动游戏", null, (_, _) => Dispatcher.Invoke(() => OnPlayClick(null!, null!)));
            menu.Items.Add("停止全部", null, (_, _) => Dispatcher.Invoke(() => OnStopClick(null!, null!)));
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            menu.Items.Add("退出", null, (_, _) => Dispatcher.Invoke(() =>
            {
                _reallyClose = true;
                Close();
            }));

            _tray = new System.Windows.Forms.NotifyIcon
            {
                Icon = System.Drawing.SystemIcons.Application,
                Text = "摩尔庄园 · 本地客户端",
                Visible = true,
                ContextMenuStrip = menu,
            };
            _tray.DoubleClick += (_, _) => RestoreFromTray();
            // 成功也要留痕：否则「托盘没出现」时无法区分是创建失败还是被系统隐藏
            _log.Ok("app", "托盘图标已创建");
        }
        catch (Exception ex)
        {
            _log.Warn("app", $"托盘图标初始化失败（不影响游戏）：{ex.Message}");
        }
    }

    private void RestoreFromTray()
    {
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_reallyClose || !_settingsService.Settings.MinimizeToTray) return;
        e.Cancel = true;
        Hide();
        _tray?.ShowBalloonTip(1500, "摩尔庄园", "已最小化到托盘，游戏继续运行。",
            System.Windows.Forms.ToolTipIcon.Info);
    }

    // ───────────────────────── 状态轮询 ─────────────────────────

    private async System.Threading.Tasks.Task PollAsync()
    {
        var s = _settingsService.Settings;

        var st = await _mirror.TryGetStatusAsync(s);
        if (st != null)
        {
            StatEntries.Text = st.CachedEntries.ToString("N0");
            StatSize.Text = $"{st.CachedMegabytes:F0} MB";
            StatRequests.Text = $"{st.Requests:N0} / {st.CacheHits:N0}";
            StatHit.Text = $"{st.HitRate:P0}";
            SetChip(ChipMirror, TxtMirror, "镜像 ● 运行中", "#FF2E7D32");
            SetChip(ChipMode, TxtMode, st.Offline ? "离线模式" : "在线",
                st.Offline ? "#FF8A6D00" : "#FF2D5C88");
        }
        else
        {
            SetChip(ChipMirror, TxtMirror, "镜像 ● 未运行", "#FF5A5A5A");
            SetChip(ChipMode, TxtMode, s.OfflineMode ? "离线模式" : "在线", "#FF5A5A5A");
        }

        SetChip(ChipRuffle, TxtRuffle,
            _ruffle.IsRunning ? "游戏 ● 运行中" : "游戏 ● 未运行",
            _ruffle.IsRunning ? "#FF2E7D32" : "#FF5A5A5A");

        BtnPlay.IsEnabled = !_ruffle.IsRunning;
        BtnStop.IsEnabled = _ruffle.IsRunning || _mirror.IsRunning;

        if (LogList.Items.Count > 0)
            LogList.ScrollIntoView(LogList.Items[^1]);
    }

    private static void SetChip(System.Windows.Controls.Border chip,
        System.Windows.Controls.TextBlock text, string label, string color)
    {
        text.Text = label;
        chip.Background = new System.Windows.Media.SolidColorBrush(
            (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(color));
    }

    private void RefreshCommandPreview()
    {
        var s = _settingsService.Settings;
        TxtCommand.Text = string.IsNullOrWhiteSpace(s.RufflePath)
            ? "（尚未指定 Ruffle 路径）"
            : RuffleService.BuildCommandLine(s);
    }

    // ───────────────────────── 按钮 ─────────────────────────

    private async void OnPlayClick(object sender, RoutedEventArgs e) => await StartGameAsync();

    /// <summary>「启动游戏」的完整流程：确保镜像在跑 → 拉起引擎。按钮与 --play 共用。</summary>
    private async System.Threading.Tasks.Task StartGameAsync()
    {
        if (_settingsService.FillMissingPaths()) _settingsService.Save();
        var s = _settingsService.Settings;
        RefreshCommandPreview();

        // 1) 先确保镜像在跑
        if (s.UseProxy && !_mirror.IsRunning)
        {
            _log.Info("app", "正在启动本地镜像…");
            var err = await _mirror.StartAsync(s);
            if (err != null)
            {
                _log.Error("app", err);
                ShowError(err);
                return;
            }
        }

        // 2) 起游戏
        var rerr = _ruffle.Start(s);
        if (rerr != null)
        {
            _log.Error("app", rerr);
            ShowError(rerr);
        }
        await PollAsync();
    }

    private void ShowError(string message)
    {
        // --play 是无人值守场景，弹窗会卡住；只记日志
        if (App.AutoPlay) return;
        System.Windows.MessageBox.Show(this, message, "启动失败",
            MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private async void OnStopClick(object sender, RoutedEventArgs e)
    {
        _ruffle.Stop();
        _mirror.Stop();
        await PollAsync();
    }

    private void OnSettingsClick(object sender, RoutedEventArgs e)
    {
        var w = new SettingsWindow(_settingsService.Settings) { Owner = this };
        if (w.ShowDialog() == true)
        {
            _settingsService.Save();
            _log.Info("app", "设置已保存");
            RefreshCommandPreview();
            _ = PollAsync();
        }
    }

    private void OnOpenCacheClick(object sender, RoutedEventArgs e)
    {
        var dir = Path.Combine(_settingsService.Settings.ProjectRoot, "cache");
        OpenFolder(Directory.Exists(dir) ? dir : _settingsService.Settings.ProjectRoot);
    }

    private void OnOpenLogsClick(object sender, RoutedEventArgs e)
        => OpenFolder(Path.Combine(_settingsService.Settings.ProjectRoot, "logs"));

    private void OpenFolder(string dir)
    {
        // 成功也记一行：这场"打开目录"的排查就是因为旧代码成功时静默、失败时只说"拒绝访问"
        // 而无从下手（连"Process.Start 没抛异常但子进程挂了"都看不出来）。说明里带用了哪种方式。
        var (ok, message) = ShellOpen.Folder(dir);
        if (ok) _log.Ok("app", message);
        else _log.Warn("app", $"打开目录失败：{message}");
    }
}
