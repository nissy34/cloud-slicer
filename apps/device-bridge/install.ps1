# Cloud Slicer bridge for Windows, in one PowerShell line. Cloud Slicer gives it
# with your setup code (Printers & bridges, Add a bridge):
#
#   irm "__RELAY_URL__/install.ps1?code=XXXX-XXXX" | iex
#
# Downloads the bridge, adds it to your Cloud Slicer account with the setup code
# (it works once, within the hour; if it expired, this asks for a new one) and
# makes it start by itself whenever you sign in to Windows, with no window.
# Run it again to update. Remove it with Remove bridge in Cloud Slicer.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $relay = '__RELAY_URL__'
  $code = '__SETUP_CODE__'
  $exe = Join-Path $env:TEMP 'cloud-slicer-bridge-setup.exe'
  Write-Host 'Downloading Cloud Slicer Bridge...'
  Invoke-WebRequest -UseBasicParsing -Uri "$relay/download/windows-x64" -OutFile $exe
  try {
    while ($true) {
      $argv = @('install', '--no-browser')
      if ($code) { $argv += @('--code', $code) }
      # The bridge writes to this window; exit status 3 means the setup code didn't work.
      $p = Start-Process -FilePath $exe -ArgumentList $argv -NoNewWindow -Wait -PassThru
      if ($p.ExitCode -ne 3) { break }
      $code = (Read-Host 'Paste the new setup code here').Trim()
      if (-not $code) { Write-Host 'Nothing installed.'; break }
    }
  } finally {
    Remove-Item -LiteralPath $exe -ErrorAction SilentlyContinue
  }
}
