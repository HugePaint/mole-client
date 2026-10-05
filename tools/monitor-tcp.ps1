# 持续采样指定进程的对外 TCP 连接，记录到日志。
# 用途：游戏登录会连 123.206.131.236:1863，之后可能立刻断开；轮询式检查容易漏掉。
# 用法: .\monitor-tcp.ps1 -ProcessId 1234 -LogFile I:\61mole\logs\tcp-observed.log
param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$LogFile,
    [int]$IntervalMs = 400,
    [int]$MaxMinutes = 120
)

$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$deadline = (Get-Date).AddMinutes($MaxMinutes)
Add-Content -Path $LogFile -Value ("--- monitor start pid=$ProcessId at " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " ---")

while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) {
        Add-Content -Path $LogFile -Value ("--- monitor end: process exited at " + (Get-Date -Format 'HH:mm:ss') + " ---")
        break
    }
    try {
        Get-NetTCPConnection -OwningProcess $ProcessId -ErrorAction SilentlyContinue |
            Where-Object { $_.RemoteAddress -notin @('0.0.0.0', '::', '127.0.0.1', '::1') } |
            ForEach-Object {
                $key = "$($_.RemoteAddress):$($_.RemotePort)/$($_.State)"
                if ($seen.Add($key)) {
                    Add-Content -Path $LogFile -Value ((Get-Date -Format 'HH:mm:ss.fff') + "  " + $key)
                }
            }
    } catch { }
    Start-Sleep -Milliseconds $IntervalMs
}
