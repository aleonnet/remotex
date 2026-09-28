#Requires -Version 7
# Deploy the agent to the sandbox and start it in andrew's interactive session.
$ErrorActionPreference = 'Stop'
$Out = Join-Path $PSScriptRoot '..' '..' 'tmp' 'dvc-video-poc'
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport
Invoke-Command -Session $s {
  Get-Process dvc-video-agent -ErrorAction SilentlyContinue | Stop-Process -Force
  New-Item -ItemType Directory -Force C:\ci-workspaces\dvc-video-poc | Out-Null
}
Copy-Item -ToSession $s -Path "$Out/dvc-video-agent.exe" -Destination C:\ci-workspaces\dvc-video-poc\
Invoke-Command -Session $s {
  $a = New-ScheduledTaskAction -Execute C:\ci-workspaces\dvc-video-poc\dvc-video-agent.exe -WorkingDirectory C:\ci-workspaces\dvc-video-poc
  $p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  $t = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries
  Register-ScheduledTask -TaskName RemotexDvcVideoAgent -Action $a -Principal $p -Settings $t -Force | Out-Null
  Start-ScheduledTask -TaskName RemotexDvcVideoAgent
  Start-Sleep 2
  query user
  Get-Process dvc-video-agent -ErrorAction SilentlyContinue | Select-Object Id, SessionId, StartTime | Format-Table | Out-String
}
Remove-PSSession $s
