#Requires -Version 7
# Install the agent's MSI on the sandbox, which starts the RemotexAgent service there, for
# the probe's `the_service_gives_each_connection_an_agent`. The MSI is the one
# packaging/build-windows-agent.ps1 wrote, brought to tmp/rdp-agent; -Msi names another.
param(
  [string] $Msi = (Join-Path $PSScriptRoot '..' '..' 'tmp' 'rdp-agent' 'remotex-agent-windows-x86_64.msi'),
  [int] $Minutes = 3
)
$ErrorActionPreference = 'Stop'
$Msi = (Resolve-Path $Msi).Path
$s = New-PSSession -HostName windows-ent-sandbox -SSHTransport -ConnectingTimeout 30000
try {
  Invoke-Command -Session $s { New-Item -ItemType Directory -Force C:\ci-workspaces\rdp-agent-msi | Out-Null }
  Copy-Item -ToSession $s -Path $Msi -Destination C:\ci-workspaces\rdp-agent-msi\remotex-agent.msi
  Invoke-Command -Session $s -ArgumentList $Minutes {
    param($Minutes)
    $log = 'C:\ci-workspaces\rdp-agent-msi\install.log'
    $p = Start-Process msiexec -ArgumentList '/i', 'C:\ci-workspaces\rdp-agent-msi\remotex-agent.msi', '/qn', '/norestart', '/l*v', $log -PassThru
    $null = $p.Handle  # keeps the exit code readable after the wait
    if (-not $p.WaitForExit($Minutes * 60000)) { throw "msiexec /i still running after $Minutes minutes; see $log" }
    if ($p.ExitCode -ne 0) { Get-Content $log | Select-Object -Last 40; throw "msiexec /i exited $($p.ExitCode)" }
    Get-Service RemotexAgent | Format-Table Name, Status, StartType | Out-String
  }
}
finally {
  Remove-PSSession $s
}
