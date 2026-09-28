#Requires -Version 7
# Every 5 s for $Seconds, print each process's cumulative CPU seconds on the sandbox:
# "<unix seconds> <pid> <name> <cpu seconds> <services>", services for svchost only.
param([int]$Seconds = 360)
Invoke-Command -HostName windows-ent-sandbox -SSHTransport -ArgumentList $Seconds {
  param($Seconds)
  "cores $([Environment]::ProcessorCount)"
  $services = @{}
  Get-CimInstance Win32_Service -Filter "State = 'Running'" | ForEach-Object {
    $services[[int]$_.ProcessId] += @($_.Name)
  }
  $end = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $end) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000
    foreach ($p in Get-Process) {
      $cpu = try { $p.TotalProcessorTime.TotalSeconds } catch { $null }
      if ($null -ne $cpu) {
        $svc = if ($services.ContainsKey($p.Id)) { ($services[$p.Id] | Select-Object -First 4) -join ',' } else { '-' }
        "{0:F2} {1} {2} {3:F3} {4}" -f $now, $p.Id, $p.ProcessName, $cpu, $svc
      }
    }
    Start-Sleep -Milliseconds 4500
  }
}
