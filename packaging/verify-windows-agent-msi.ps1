# Install the MSI packaging/build-windows-agent.ps1 wrote, prove it installed the agent and a
# running RemotexAgent service as the package says, remove the package, and prove the service
# and the files went with it. The release workflow's Windows row and ci/windows/ci.ps1 -Package
# run it; it needs an elevated PowerShell 7 (msiexec /qn installs per machine) on a machine
# with no agent installed.
#
# A machine reached over ssh has no session attached over RDP, so the service starts no
# session's agent here: that it does in a session is tests/rdp_dvc_video_probe.rs's
# `the_service_gives_each_connection_an_agent`, against a real host.
#Requires -Version 7
param([string] $Msi = 'dist\remotex-agent-windows-x86_64.msi')
$ErrorActionPreference = 'Stop'
$Msi = (Resolve-Path $Msi).Path
$root = Join-Path $env:ProgramFiles 'remotex-agent'
$exe = Join-Path $root 'remotex-agent.exe'
$serviceLog = Join-Path $env:SystemRoot 'System32\LogFiles\remotex-agent\service.log'

function Invoke-Msiexec([string[]] $Arguments, [string] $What) {
    $log = Join-Path $env:TEMP "remotex-agent-msi-$What.log"
    $p = Start-Process msiexec -ArgumentList ($Arguments + @('/qn', '/norestart', '/l*v', $log)) -Wait -PassThru
    if ($p.ExitCode -ne 0) {
        Get-Content $log | Select-Object -Last 40
        throw "msiexec $What exited $($p.ExitCode)"
    }
}
function Get-AgentService { Get-CimInstance Win32_Service -Filter "Name='RemotexAgent'" }

if (Test-Path $root) { throw "$root exists before the install: remove the installed agent first" }
if (Get-AgentService) { throw 'a RemotexAgent service exists before the install: remove it first' }
$logBefore = if (Test-Path $serviceLog) { (Get-Item $serviceLog).Length } else { 0 }

Write-Host ">> installing $Msi"
Invoke-Msiexec @('/i', $Msi) 'install'
foreach ($file in 'remotex-agent.exe', 'vcruntime140.dll', 'vcruntime140_1.dll') {
    if (-not (Test-Path (Join-Path $root $file))) { throw "the install lacks $file" }
}
$reported = (& $exe --version) -join ' '
if ($LASTEXITCODE -ne 0) { throw "remotex-agent --version exited $LASTEXITCODE" }
Write-Host "   $reported"

$service = Get-AgentService
if (-not $service) { throw 'the install registered no RemotexAgent service' }
if ($service.PathName -ne "`"$exe`" service") { throw "the service runs '$($service.PathName)'" }
if ($service.StartMode -ne 'Auto') { throw "the service starts '$($service.StartMode)', not at boot" }
if ($service.StartName -ne 'LocalSystem') { throw "the service runs as '$($service.StartName)', not LocalSystem" }
# Started by the install, and started as the program's own service: it reports running only
# once its control handler is registered, and writes the line below then.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-AgentService).State -ne 'Running' -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if ((Get-AgentService).State -ne 'Running') { throw "the service is '$((Get-AgentService).State)' after the install" }
$said = Get-Content $serviceLog -Raw -ErrorAction SilentlyContinue
if (-not $said -or $said.Substring([math]::Min($logBefore, $said.Length)) -notmatch 'service start') {
    throw "the service wrote no start to $serviceLog"
}
$actions = (& sc.exe qfailure RemotexAgent) -join "`n"
if ($actions -notmatch 'RESTART') { throw "the service is not restarted on failure:`n$actions" }
Write-Host '   RemotexAgent runs as LocalSystem, starts at boot, is restarted on failure, and logged its start'

Write-Host '>> removing it'
Invoke-Msiexec @('/x', $Msi) 'uninstall'
if (Get-AgentService) { throw 'the RemotexAgent service survived the uninstall' }
if (Get-Process remotex-agent -ErrorAction SilentlyContinue) { throw 'a remotex-agent process survived the uninstall' }
if (Test-Path $root) { throw "$root survived the uninstall" }
Write-Host '   removed cleanly: the service, its process and its files'
