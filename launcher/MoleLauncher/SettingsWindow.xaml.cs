using System;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;
using MoleLauncher.Models;

namespace MoleLauncher;

public partial class SettingsWindow : Window
{
    private readonly AppSettings _s;

    public SettingsWindow(AppSettings settings)
    {
        InitializeComponent();
        _s = settings;
        Load();
    }

    private void Load()
    {
        TxtRoot.Text = _s.ProjectRoot;
        TxtNode.Text = _s.NodePath;
        TxtRuffle.Text = _s.RufflePath;
        TxtProxyPort.Text = _s.ProxyPort.ToString();
        TxtControlPort.Text = _s.ControlPort.ToString();
        TxtOriginPort.Text = _s.OriginPort.ToString();
        ChkUseProxy.IsChecked = _s.UseProxy;
        ChkOffline.IsChecked = _s.OfflineMode;
        ChkAutoStart.IsChecked = _s.AutoStartMirror;
        ChkMinimizeToTray.IsChecked = _s.MinimizeToTray;
        TxtWidth.Text = _s.Width.ToString();
        TxtHeight.Text = _s.Height.ToString();
        ChkFullscreen.IsChecked = _s.Fullscreen;
        ChkNoGui.IsChecked = _s.NoGui;
        TxtExtra.Text = _s.ExtraRuffleArgs;
    }

    private static int ParseInt(string text, int fallback)
        => int.TryParse(text?.Trim(), out var v) && v > 0 && v <= 65535 ? v : fallback;

    private void OnOk(object sender, RoutedEventArgs e)
    {
        _s.ProjectRoot = TxtRoot.Text.Trim();
        _s.NodePath = TxtNode.Text.Trim();
        _s.RufflePath = TxtRuffle.Text.Trim();
        _s.ProxyPort = ParseInt(TxtProxyPort.Text, 8899);
        _s.ControlPort = ParseInt(TxtControlPort.Text, 8898);
        _s.OriginPort = ParseInt(TxtOriginPort.Text, 8080);
        _s.UseProxy = ChkUseProxy.IsChecked == true;
        _s.OfflineMode = ChkOffline.IsChecked == true;
        _s.AutoStartMirror = ChkAutoStart.IsChecked == true;
        _s.MinimizeToTray = ChkMinimizeToTray.IsChecked == true;
        _s.Width = ParseInt(TxtWidth.Text, 1000);
        _s.Height = ParseInt(TxtHeight.Text, 620);
        _s.Fullscreen = ChkFullscreen.IsChecked == true;
        _s.NoGui = ChkNoGui.IsChecked == true;
        _s.ExtraRuffleArgs = TxtExtra.Text.Trim();
        DialogResult = true;
    }

    private void OnCancel(object sender, RoutedEventArgs e) => DialogResult = false;

    private void OnReset(object sender, RoutedEventArgs e)
    {
        var def = new AppSettings();
        TxtProxyPort.Text = def.ProxyPort.ToString();
        TxtControlPort.Text = def.ControlPort.ToString();
        TxtOriginPort.Text = def.OriginPort.ToString();
        ChkUseProxy.IsChecked = def.UseProxy;
        ChkOffline.IsChecked = false;
        ChkAutoStart.IsChecked = def.AutoStartMirror;
        ChkMinimizeToTray.IsChecked = def.MinimizeToTray;
        TxtWidth.Text = def.Width.ToString();
        TxtHeight.Text = def.Height.ToString();
        ChkFullscreen.IsChecked = false;
        ChkNoGui.IsChecked = def.NoGui;
        TxtExtra.Text = "";
    }

    // ───────────────────────── 浏览 ─────────────────────────

    private void OnBrowseRoot(object sender, RoutedEventArgs e)
    {
        // 注意：WPF 的 Microsoft.Win32.OpenFolderDialog 是 .NET 8 才引入的，
        // 本项目目标 net7.0-windows，因此改用 WinForms 的 FolderBrowserDialog。
        using var dlg = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "选择项目根目录（含 molemirror 与 runtime）",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false,
        };
        if (!string.IsNullOrWhiteSpace(TxtRoot.Text) && Directory.Exists(TxtRoot.Text))
            dlg.SelectedPath = TxtRoot.Text;

        if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            TxtRoot.Text = dlg.SelectedPath;
            // 顺手把空着的 node / ruffle 补上
            if (string.IsNullOrWhiteSpace(TxtNode.Text))
                TxtNode.Text = Services.PathResolver.FindNode("") ?? "";
            if (string.IsNullOrWhiteSpace(TxtRuffle.Text))
                TxtRuffle.Text = Services.PathResolver.FindRuffle("", dlg.SelectedPath) ?? "";
        }
    }

    private void OnBrowseNode(object sender, RoutedEventArgs e) => BrowseExe(TxtNode, "选择 node.exe");

    private void OnBrowseRuffle(object sender, RoutedEventArgs e) => BrowseExe(TxtRuffle, "选择 ruffle.exe");

    private static void BrowseExe(System.Windows.Controls.TextBox target, string title)
    {
        var dlg = new OpenFileDialog { Title = title, Filter = "可执行文件|*.exe|所有文件|*.*" };
        if (File.Exists(target.Text)) dlg.InitialDirectory = Path.GetDirectoryName(target.Text);
        if (dlg.ShowDialog() == true) target.Text = dlg.FileName;
    }

    // ───────────────────────── 下载 Ruffle ─────────────────────────

    /// <summary>
    /// 从 Ruffle 官方 GitHub Releases 下载最新的 Windows x64 版并解压到 &lt;root&gt;\runtime\ruffle\。
    /// 这样分发物里不必自带第三方二进制，用户也不必手工找。
    /// 实际下载逻辑在 <see cref="Services.RuffleDownloader"/>（与 --download-ruffle 共用）。
    /// </summary>
    private async void OnDownloadRuffle(object sender, RoutedEventArgs e)
    {
        var root = TxtRoot.Text.Trim();
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
        {
            System.Windows.MessageBox.Show(this, "请先设置有效的项目根目录。", "下载 Ruffle",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var target = Path.Combine(root, "runtime", "ruffle");
        try
        {
            System.Windows.Input.Mouse.OverrideCursor = System.Windows.Input.Cursors.Wait;
            IsEnabled = false;

            var r = await Services.RuffleDownloader.DownloadAsync(
                target, Path.Combine(root, "data", "temp"));

            if (r.Ok && r.ExePath != null)
            {
                TxtRuffle.Text = r.ExePath;
                System.Windows.MessageBox.Show(this,
                    $"{r.Message}\n\n{target}\n\n已自动填入：{r.ExePath}",
                    "下载 Ruffle 完成", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            else
            {
                System.Windows.MessageBox.Show(this,
                    r.Message + "\n\n可手动从 https://ruffle.rs/downloads 下载。",
                    "下载 Ruffle", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        catch (Exception ex)
        {
            System.Windows.MessageBox.Show(this, "下载失败：" + ex.Message +
                "\n\n可手动从 https://ruffle.rs/downloads 下载。",
                "下载 Ruffle", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            System.Windows.Input.Mouse.OverrideCursor = null;
            IsEnabled = true;
        }
    }
}
