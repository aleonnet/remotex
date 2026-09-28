#Requires -Version 7
# Stop the agent start-agent.ps1 started, remove its task and folder, and bring its log
# back to tmp/rdp-agent/session.log.
$ErrorActionPreference = 'Stop'
$Out = Join-Path $PSScriptRoot '..' '..' 'tmp' 'rdp-agent'
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport
try {
  $log = Invoke-Command -Session $s {
    Stop-ScheduledTask -TaskName RemotexAgentProbe -ErrorAction SilentlyContinue
    Get-Process remotex-agent -ErrorAction SilentlyContinue | Stop-Process -Force
    Unregister-ScheduledTask -TaskName RemotexAgentProbe -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep 1
    Remove-Item -Recurse -Force C:\ci-workspaces\rdp-agent -ErrorAction SilentlyContinue
    Join-Path $env:LOCALAPPDATA 'remotex-agent\session.log'
  }
  Copy-Item -FromSession $s -Path $log -Destination "$Out/session.log" -ErrorAction Continue
}
finally {
  Remove-PSSession $s
}
