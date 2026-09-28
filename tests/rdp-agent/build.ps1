#Requires -Version 7
# Build remotex-agent on windows-ci-build with the qa profile and bring the binary back to
# tmp/rdp-agent, for the probe's scripts to deploy. -Check runs its clippy and its tests
# first, which AGENTS.md asks for after a change to the crate.
#
# The agent is a member of the root workspace, which cargo loads whole, so the tree goes
# over, not the crate alone.
param([switch] $Check)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$Out = Join-Path $Root 'tmp' 'rdp-agent'
New-Item -ItemType Directory -Force $Out | Out-Null
$Archive = Join-Path $Out 'src.tgz'
& tar -C $Root --exclude=./target --exclude=./tmp --exclude=./.git `
  --exclude=./frontend/node_modules --exclude=./frontend/dist `
  --exclude=./tests/playwright/node_modules --exclude=./build -czf $Archive .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
$s = New-PSSession -HostName windows-ci-build -SSHTransport
try {
  $Dir = 'C:\ci-workspaces\rdp-agent-src'
  Invoke-Command -Session $s {
    param($Dir)
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    New-Item -ItemType Directory $Dir | Out-Null
  } -ArgumentList $Dir
  Copy-Item -ToSession $s -Path $Archive -Destination "$Dir\src.tgz"
  $code = Invoke-Command -Session $s {
    param($Dir, $Check)
    Set-Location $Dir
    & tar -xzf src.tgz 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    if ($Check) {
      cargo clippy --locked -p remotex-agent --all-targets -- -D warnings 2>&1 | ForEach-Object { "$_" }
      if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
      cargo test --locked -p remotex-agent 2>&1 | ForEach-Object { "$_" }
      if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    }
    cargo build --locked --profile qa -p remotex-agent 2>&1 | ForEach-Object { "$_" }
    $LASTEXITCODE
  } -ArgumentList $Dir, $Check.IsPresent
  $code | Select-Object -SkipLast 1
  $exit = $code[-1]
  if ($exit -eq 0) {
    $target = Invoke-Command -Session $s { if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { "C:\ci-workspaces\rdp-agent-src\target" } }
    Copy-Item -FromSession $s -Path "$target\qa\remotex-agent.exe" -Destination "$Out/"
  }
}
finally {
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
  Remove-PSSession $s
}
exit $exit
