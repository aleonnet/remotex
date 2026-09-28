#Requires -Version 7
# Deploy the agent built by build.ps1 to the sandbox and start a session's agent in the
# logged-on user's interactive session, by scheduled task, with the switches given:
# `--patch`, `--big <bytes>`. Refused while the RemotexAgent service runs there: it keeps
# an agent of its own in the session, and two would contend for the channel.
param([string]$AgentArgs = '')
$ErrorActionPreference = 'Stop'
$Out = Join-Path $PSScriptRoot '..' '..' 'tmp' 'rdp-agent'
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport
try {
  Invoke-Command -Session $s {
    if ((Get-Service RemotexAgent -ErrorAction SilentlyContinue).Status -eq 'Running') {
      throw 'the RemotexAgent service runs an agent in the session already: uninstall-service.ps1, or Stop-Service RemotexAgent'
    }
    Get-Process remotex-agent -ErrorAction SilentlyContinue | Stop-Process -Force
    New-Item -ItemType Directory -Force C:\ci-workspaces\rdp-agent | Out-Null
  }
  Copy-Item -ToSession $s -Path "$Out/remotex-agent.exe" -Destination C:\ci-workspaces\rdp-agent\
  Invoke-Command -Session $s -ArgumentList $AgentArgs {
    param($AgentArgs)
    $action = @{
      Execute = 'C:\ci-workspaces\rdp-agent\remotex-agent.exe'
      Argument = "session $AgentArgs".Trim()
      WorkingDirectory = 'C:\ci-workspaces\rdp-agent'
    }
    $a = New-ScheduledTaskAction @action
    $p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
    $t = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries
    Register-ScheduledTask -TaskName RemotexAgentProbe -Action $a -Principal $p -Settings $t -Force | Out-Null
    Start-ScheduledTask -TaskName RemotexAgentProbe
    Start-Sleep 2
    query user
    Get-Process remotex-agent -ErrorAction SilentlyContinue | Select-Object Id, SessionId, StartTime | Format-Table | Out-String
  }
}
finally {
  Remove-PSSession $s
}
