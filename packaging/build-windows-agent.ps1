# Build remotex-agent's release artifacts for Windows x86-64:
#
#   dist\remotex-agent-windows-x86_64.msi  installs the agent and its RemotexAgent service
#                                          (windows/remotex-agent.wxs, WiX 5)
#   dist\remotex-agent-windows-x86_64.zip  the same three files, for running
#                                          `remotex-agent session` by hand without the service
#
# Both carry remotex-agent.exe with the Visual C++ runtime beside it: libvpx's prebuilt archive
# is built against the DLL C runtime, and neither may depend on a machine having the
# redistributable. The runtime is the toolset's own copy from VC\Redist.
#
# Runs on Windows under PowerShell 7 with cargo, the MSVC build tools and WiX 5 on PATH
# (`dotnet tool install --global wix --version 5.0.2`); libvpx arrives as its `-prebuilt`
# crate's static archive. packaging/verify-windows-agent-msi.ps1 then installs the MSI, checks
# the service, and removes it.
#Requires -Version 7
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    throw 'wix is not on PATH: dotnet tool install --global wix --version 5.0.2'
}
# The wizard's pages, and the service's restart on failure.
$extensions = 'WixToolset.UI.wixext', 'WixToolset.Util.wixext'
foreach ($ext in $extensions) {
    & wix extension add -g "$ext/5.0.2"
    if ($LASTEXITCODE -ne 0) { throw "wix extension add $ext failed (exit $LASTEXITCODE)" }
}

$metadata = & cargo metadata --no-deps --format-version 1 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "cargo metadata failed (exit $LASTEXITCODE)" }
$version = ($metadata.packages | Where-Object { $_.name -eq 'remotex-agent' }).version
if ($version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
    throw "invalid version in Cargo.toml: '$version'"
}
# An MSI ProductVersion is three numbers; a pre-release suffix is kept in `--version` only.
$msiVersion = $version -replace '[-+].*$', ''
$parts = $msiVersion.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -gt 255 -or $parts[1] -gt 255 -or $parts[2] -gt 65535) {
    throw "$msiVersion does not fit an MSI ProductVersion (255.255.65535)"
}

Write-Host ">> building remotex-agent $version"
& cargo build --release --locked -p remotex-agent
if ($LASTEXITCODE -ne 0) { throw "cargo build failed (exit $LASTEXITCODE)" }
$exe = Join-Path $metadata.target_directory 'release\remotex-agent.exe'
$reported = (& $exe --version) -join ' '
if ($LASTEXITCODE -ne 0 -or $reported -ne "remotex-agent $version") {
    throw "the built agent reports '$reported', not remotex-agent $version"
}

# The runtime from the build tools that linked the executable: VC\Redist holds the same
# version as VC\Tools.
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) {
    throw "vswhere found no Visual Studio installation (exit $LASTEXITCODE)"
}
$crt = Get-ChildItem "$vs\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT" -Directory |
    Where-Object { $_.Parent.Parent.Name -match '^\d+(\.\d+)+$' } |
    Sort-Object { [version]$_.Parent.Parent.Name } | Select-Object -Last 1
if (-not $crt) { throw "no x64 Visual C++ runtime under $vs\VC\Redist\MSVC" }
Write-Host ">> Visual C++ runtime from $($crt.FullName)"

$stage = Join-Path ([System.IO.Path]::GetTempPath()) "remotex-agent-$PID"
try {
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Force -Path $stage, dist | Out-Null
    Copy-Item $exe $stage
    Copy-Item (Join-Path $crt.FullName 'vcruntime140.dll'), (Join-Path $crt.FullName 'vcruntime140_1.dll') $stage

    # Unversioned, like the gateway's: the version is inside, and the release page's
    # `latest/download` URL stays stable.
    $msi = Join-Path (Resolve-Path dist).Path 'remotex-agent-windows-x86_64.msi'
    $zip = Join-Path (Resolve-Path dist).Path 'remotex-agent-windows-x86_64.zip'
    Remove-Item -Force $msi, $zip -ErrorAction SilentlyContinue
    Write-Host ">> building the MSI for remotex-agent $version"
    & wix build -arch x64 @($extensions | ForEach-Object { '-ext', $_ }) -d "Version=$msiVersion" -d "Stage=$stage" -o $msi packaging\windows\remotex-agent.wxs
    if ($LASTEXITCODE -ne 0) { throw "wix build failed (exit $LASTEXITCODE)" }
    if (-not (Test-Path $msi)) { throw "wix build wrote no $msi" }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
    foreach ($made in $msi, $zip) {
        Write-Host ">> wrote dist\$(Split-Path $made -Leaf) ($([math]::Round((Get-Item $made).Length / 1MB, 1)) MB)"
    }
} finally {
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
