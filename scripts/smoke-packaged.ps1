$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$executable = Join-Path $workspaceRoot 'release\win-unpacked\captured.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the unpacked Windows app before running this smoke test.' }

$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$smokeRoot = Join-Path $tempParent ('captured-smoke-' + [guid]::NewGuid().ToString('N'))
$profilePath = Join-Path $smokeRoot 'profile'
$logPath = Join-Path $smokeRoot 'electron.log'
$stdoutPath = Join-Path $smokeRoot 'stdout.log'
$stderrPath = Join-Path $smokeRoot 'stderr.log'
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null

$process = $null
try {
  $process = Start-Process -FilePath $executable -ArgumentList @('--user-data-dir=' + $profilePath, '--no-sandbox', '--headless=new', '--enable-logging', '--log-file=' + $logPath) -WorkingDirectory (Split-Path $executable) -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  Start-Sleep -Seconds 8
  $process.Refresh()
  $started = -not $process.HasExited
  if ($started) { & taskkill.exe /T /F /PID $process.Id | Out-Null }
  Write-Output ('startup_alive=' + $started)
  if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 40 }
  if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Tail 40 }
  if (-not $started) { throw 'The packaged app exited during its startup window.' }
} finally {
  if ($process) { $process.Refresh(); if (-not $process.HasExited) { & taskkill.exe /T /F /PID $process.Id | Out-Null } }
  $resolvedSmokeRoot = [IO.Path]::GetFullPath($smokeRoot)
  if (-not $resolvedSmokeRoot.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Temporary smoke path escaped the system temp folder.' }
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try { Remove-Item -LiteralPath $resolvedSmokeRoot -Recurse -Force; break }
    catch { if ($attempt -eq 9) { throw }; Start-Sleep -Milliseconds 250 }
  }
}
