#Requires -Version 7
# Remove the agent's MSI from the sandbox, the RemotexAgent service with it, and bring the
# service's log back to tmp/rdp-agent/service.log and the logged-on user's session log to
# tmp/rdp-agent/session.log.
#
# The product is found by its uninstall entry, not Win32_Product, whose query checks every
# installed package and takes minutes. Nothing here waits unbounded: msiexec is given
# -Minutes, and a run that outlasts it fails and names the log it left.
param([int] $Minutes = 3)
$ErrorActionPreference = 'Stop'
$Out = Join-Path $PSScriptRoot '..' '..' 'tmp' 'rdp-agent'
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport -ConnectingTimeout 30000
try {
  $logs = Invoke-Command -Session $s -ArgumentList $Minutes {
    param($Minutes)
    $entry = Get-ChildItem HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall |
      Get-ItemProperty | Where-Object DisplayName -EQ 'remotex agent' | Select-Object -First 1
    if ($entry) {
      $log = 'C:\ci-workspaces\rdp-agent-msi\uninstall.log'
      New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
      $started = Get-Date
      $p = Start-Process msiexec -ArgumentList '/x', $entry.PSChildName, '/qn', '/norestart', '/l*v', $log -PassThru
      $null = $p.Handle  # keeps the exit code readable after the wait
      if (-not $p.WaitForExit($Minutes * 60000)) { throw "msiexec /x still running after $Minutes minutes; see $log" }
      "msiexec /x exited $($p.ExitCode) after $([int]((Get-Date) - $started).TotalMilliseconds) ms"
      if ($p.ExitCode -ne 0) { Get-Content $log | Select-Object -Last 40; throw "msiexec /x exited $($p.ExitCode)" }
    }
    Remove-Item -Recurse -Force C:\ci-workspaces\rdp-agent-msi -ErrorAction SilentlyContinue
    if (Get-Service RemotexAgent -ErrorAction SilentlyContinue) { throw 'the RemotexAgent service is still there' }
    if (Get-Process remotex-agent -ErrorAction SilentlyContinue) { throw 'a remotex-agent process is still running' }
    (Join-Path $env:SystemRoot 'System32\LogFiles\remotex-agent\service.log'), (Join-Path $env:LOCALAPPDATA 'remotex-agent\session.log')
  }
  $logs | Select-Object -SkipLast 2
  $logs = $logs | Select-Object -Last 2
  Copy-Item -FromSession $s -Path $logs[0] -Destination "$Out/service.log" -ErrorAction Continue
  Copy-Item -FromSession $s -Path $logs[1] -Destination "$Out/session.log" -ErrorAction Continue
}
finally {
  Remove-PSSession $s
}
