# Builds the Firefox package (dist/Folio-firefox.zip and dist/Folio-firefox.xpi) from this repository.
# Firefox needs its own manifest (it does not run Chrome's background service workers), so the package
# contains manifest.firefox.json saved as manifest.json, plus only the files the extension needs.
#
# Usage (PowerShell 5.1 or 7):   .\scripts\build-firefox.ps1
param([string]$OutDir = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'dist' }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$ff = Get-Content (Join-Path $root 'manifest.firefox.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$ch = Get-Content (Join-Path $root 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ff.version -ne $ch.version) { throw "Version mismatch: manifest.firefox.json is $($ff.version) but manifest.json is $($ch.version)" }
if ($ff.background.service_worker) { throw 'Firefox manifest must use background.scripts, not service_worker' }
if (-not $ff.browser_specific_settings.gecko.id) { throw 'Firefox manifest needs browser_specific_settings.gecko.id' }

# Files the extension needs (web-app-only files such as sw.js, oauth.html and index.html are left out).
$include = @('app.html', 'app.css', 'background.js', 'README.md', 'INSTALL.md')
$dirs = @('icons', 'js', 'lib')

$zipPath = Join-Path $OutDir 'Folio-firefox.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  # Entry names must use forward slashes (Compress-Archive in Windows PowerShell 5.1 writes backslashes, which Firefox rejects).
  $add = {
    param($path, $name)
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $path, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
  & $add (Join-Path $root 'manifest.firefox.json') 'manifest.json'
  foreach ($f in $include) { & $add (Join-Path $root $f) $f }
  foreach ($d in $dirs) {
    Get-ChildItem (Join-Path $root $d) -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
      & $add $_.FullName $rel
    }
  }
} finally { $zip.Dispose() }

# Sanity checks: every file the manifest points at must be inside the package.
$z = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $names = $z.Entries | ForEach-Object { $_.FullName }
  $need = @($ff.background.scripts) + @($ff.icons.PSObject.Properties.Value)
  foreach ($n in $need) { if ($names -notcontains $n) { throw "Package is missing $n" } }
  if ($names | Where-Object { $_ -match '\\' }) { throw 'Backslash in a zip entry name' }
  Write-Host "Built $zipPath ($($names.Count) entries, $([math]::Round((Get-Item $zipPath).Length / 1KB)) KB), version $($ff.version)"
} finally { $z.Dispose() }

Copy-Item $zipPath (Join-Path $OutDir 'Folio-firefox.xpi') -Force   # an .xpi is just a zip with another name
Write-Host "Also wrote $(Join-Path $OutDir 'Folio-firefox.xpi')"
