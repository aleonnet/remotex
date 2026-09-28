#Requires -Version 7
# Stop the agent, remove its task, and bring its log back to tmp/dvc-video-poc/agent.log.
$ErrorActionPreference = 'Stop'
$Out = Join-Path $PSScriptRoot '..' '..' 'tmp' 'dvc-video-poc'
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport
Invoke-Command -Session $s {
  Stop-ScheduledTask -TaskName RemotexDvcVideoAgent -ErrorAction SilentlyContinue
  Get-Process dvc-video-agent -ErrorAction SilentlyContinue | Stop-Process -Force
  Unregister-ScheduledTask -TaskName RemotexDvcVideoAgent -Confirm:$false -ErrorAction SilentlyContinue
}
Copy-Item -FromSession $s -Path C:\ci-workspaces\dvc-video-poc\agent.log -Destination "$Out/agent.log"
Remove-PSSession $s
