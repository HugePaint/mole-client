using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace MoleSetup;

/// <summary>
/// 自解压安装引导器。
///
/// 为什么自己写而不用现成工具（这段结论是实测得来的，别轻易改回去）：
///
///   * 7-Zip 自解压：主安装包自带的 7z.sfx / 7zCon.sfx 是「简单解压器」，
///     模块里根本不含 ;!@Install@! 配置块的解析代码（已用字符串检索确认），
///     因此拼出来的 exe 只会解压、不会执行安装脚本。支持该配置的
///     7zS.sfx / 7zSD.sfx 已不再随官方包分发。
///   * iexpress：Windows 自带，但实测在文件数达到 10 个左右的组合时
///     稳定退出码 1 且不产出任何文件、不报任何原因；单文件或半数文件却都正常。
///     还伴随 libpng 警告（它在试图渲染进度对话框）。不可靠。
///
/// 关于「exe + 附加 zip」这个经典做法，本项目实测得到一个反直觉结论：
///   .NET 的 ZipArchive 读不了前面带数据的 zip ——
///   无论 ZipFile.OpenRead(路径) 还是手动 seek 到 zip 起点后再构造，
///   都返回 0 个条目（同样的内容不打前缀就正常）。
///   因此这里不使用该做法，而是在文件末尾写一个 32 字节页脚记录 zip 的位置，
///   由本引导器把这段字节单独取出来再交给 ZipArchive。
///
/// 文件布局：[引导器 exe][payload.zip][32 字节页脚]
/// </summary>
internal static class Program
{
    private const string TempPrefix = ".molesetup-";

    /// <summary>页脚魔数，16 字节（不足补 0）。</summary>
    private static readonly byte[] Magic = System.Text.Encoding.ASCII.GetBytes("MOLESETUP-V1\0\0\0\0");

    private const int FooterSize = 32;   // 16 字节魔数 + int64 偏移 + int64 长度

    private static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        var self = Environment.ProcessPath ?? Assembly.GetExecutingAssembly().Location;
        if (string.IsNullOrEmpty(self) || !File.Exists(self))
        {
            Console.Error.WriteLine("无法定位自身可执行文件。");
            return 1;
        }

        Console.WriteLine("=== 摩尔庄园本地客户端 安装程序 ===");
        Console.WriteLine();

        var exeDir = Path.GetDirectoryName(self) ?? ".";
        var workDir = PickWorkDir(exeDir);

        try
        {
            var payload = ReadPayload(self);
            if (payload == null)
            {
                Console.Error.WriteLine("这个文件里找不到安装数据（页脚缺失或损坏）。");
                Console.Error.WriteLine("请确认它是完整的 MoleClient-Setup.exe，且没有被截断。");
                return 1;
            }

            Console.WriteLine("正在解压安装文件…（" + (payload.Length / 1048576.0).ToString("F1") + " MB）");
            Directory.CreateDirectory(workDir);

            int count;
            // MemoryStream 里只有 zip 本身，所以 ZipArchive 能正常解析
            using (var ms = new MemoryStream(payload, writable: false))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                count = zip.Entries.Count;
                var root = Path.GetFullPath(workDir) + Path.DirectorySeparatorChar;

                foreach (var entry in zip.Entries)
                {
                    var dest = Path.GetFullPath(Path.Combine(workDir, entry.FullName));

                    // 防目录穿越：条目路径必须落在解压目录内
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    {
                        Console.Error.WriteLine("跳过可疑条目（越出解压目录）：" + entry.FullName);
                        continue;
                    }

                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(dest);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    entry.ExtractToFile(dest, overwrite: true);
                }
            }

            Console.WriteLine("  已解压 " + count + " 个条目");
            Console.WriteLine();

            var cmd = Path.Combine(workDir, "install.cmd");
            if (!File.Exists(cmd))
            {
                Console.Error.WriteLine("解压后找不到 install.cmd：" + cmd);
                return 1;
            }

            Console.WriteLine("正在运行安装脚本…");
            Console.WriteLine(new string('-', 60));

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c install.cmd",
                WorkingDirectory = workDir,
                UseShellExecute = false,
            };
            // 告诉安装脚本「安装包放在哪」，供它在默认位置不可写时回退。
            // 本机实测：这个未签名的自编译二进制写不了用户 profile（Access denied），
            // 所以默认的 %USERPROFILE%\MoleClient 在这里是不可用的。
            psi.Environment["MOLE_SETUP_SRCDIR"] = exeDir;

            using (var p = Process.Start(psi))
            {
                if (p == null)
                {
                    Console.Error.WriteLine("无法启动安装脚本。");
                    return 1;
                }
                p.WaitForExit();
                Console.WriteLine(new string('-', 60));
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("安装失败：" + ex.Message);
            return 1;
        }
        finally
        {
            try
            {
                if (Directory.Exists(workDir)) Directory.Delete(workDir, recursive: true);
            }
            catch
            {
                // 删不掉不影响安装结果（多半是有文件被占用）
            }
        }
    }

    /// <summary>
    /// 选一个可写的解压目录。
    /// 不能想当然用 %TEMP%：本机实测这个未签名的自编译二进制写 %TEMP% / %USERPROFILE%
    /// 会被拒（而 PowerShell / cmd / node 写同一路径正常），所以逐个候选实测。
    /// </summary>
    private static string PickWorkDir(string exeDir)
    {
        var name = TempPrefix + Guid.NewGuid().ToString("N").Substring(0, 8);
        var candidates = new List<string>
        {
            Path.Combine(exeDir, name),                              // 安装包旁边（最常见且通常可写）
            Path.Combine(Path.GetTempPath(), name),                  // 系统临时目录
            Path.Combine(Directory.GetCurrentDirectory(), name),     // 当前工作目录
        };

        foreach (var c in candidates)
        {
            try
            {
                Directory.CreateDirectory(c);
                var probe = Path.Combine(c, ".w");
                File.WriteAllText(probe, "x");
                File.Delete(probe);
                return c;
            }
            catch
            {
                // 试下一个
            }
        }

        // 全部失败也要返回一个，让后续异常带上具体路径
        return candidates[0];
    }

    /// <summary>按页脚指示，把附加在自身末尾的 zip 读出来。</summary>
    private static byte[]? ReadPayload(string selfPath)
    {
        using var fs = File.OpenRead(selfPath);
        if (fs.Length < FooterSize) return null;

        fs.Seek(-FooterSize, SeekOrigin.End);
        var footer = new byte[FooterSize];
        if (fs.Read(footer, 0, FooterSize) != FooterSize) return null;

        for (int i = 0; i < Magic.Length; i++)
            if (footer[i] != Magic[i]) return null;

        var offset = BitConverter.ToInt64(footer, 16);
        var length = BitConverter.ToInt64(footer, 24);

        if (offset < 0 || length <= 0 || offset + length > fs.Length - FooterSize) return null;

        fs.Seek(offset, SeekOrigin.Begin);
        var buf = new byte[length];
        int read = 0;
        while (read < length)
        {
            int n = fs.Read(buf, read, (int)(length - read));
            if (n <= 0) break;
            read += n;
        }
        return read == length ? buf : null;
    }
}
