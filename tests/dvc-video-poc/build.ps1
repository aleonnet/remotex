#Requires -Version 7
# Build the agent on windows-ci-build and bring the binary back to tmp/dvc-video-poc.
# The agent is a member of the root workspace, which cargo loads whole, so the tree
# goes over, not the agent alone. Its own directory, not start-agent.ps1's, which the
# running agent holds open.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$Out = Join-Path $Root 'tmp' 'dvc-video-poc'
New-Item -ItemType Directory -Force $Out | Out-Null
$Archive = Join-Path $Out 'src.tgz'
& tar -C $Root --exclude=./target --exclude=./tmp --exclude=./.git `
  --exclude=./frontend/node_modules --exclude=./frontend/dist `
  --exclude=./tests/playwright/node_modules --exclude=./build -czf $Archive .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
$s = New-PSSession -HostName windows-ci-build -SSHTransport
try {
  $Dir = 'C:\ci-workspaces\dvc-video-poc-src'
  Invoke-Command -Session $s {
    param($Dir)
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    New-Item -ItemType Directory $Dir | Out-Null
  } -ArgumentList $Dir
  Copy-Item -ToSession $s -Path $Archive -Destination "$Dir\src.tgz"
  $code = Invoke-Command -Session $s {
    param($Dir)
    Set-Location $Dir
    & tar -xzf src.tgz 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    cargo build --locked --profile qa -p dvc-video-agent 2>&1 | ForEach-Object { "$_" }
    return $LASTEXITCODE
  } -ArgumentList $Dir
  $code | Select-Object -SkipLast 1
  $exit = $code[-1]
  if ($exit -eq 0) {
    Copy-Item -FromSession $s -Path C:\ci-workspaces\cargo-target\qa\dvc-video-agent.exe -Destination "$Out/"
  }
}
finally {
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
  Remove-PSSession $s
}
exit $exit
