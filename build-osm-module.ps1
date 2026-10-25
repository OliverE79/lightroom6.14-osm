[CmdletBinding()]
param(
    [string]$ModulePath = (Join-Path $PSScriptRoot 'Location.lrmodule'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '_build_\Location.lrmodule'),
    [string]$ResourceHackerPath = $env:RESOURCE_HACKER,
    [string]$TileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ResourceHackerPath)) {
    throw 'Set RESOURCE_HACKER or pass -ResourceHackerPath with the path to ResourceHacker.exe.'
}

$ModulePath = (Resolve-Path -LiteralPath $ModulePath).Path
$ResourceHackerPath = (Resolve-Path -LiteralPath $ResourceHackerPath).Path
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if ($OutputPath -eq $ModulePath) {
    throw 'OutputPath must not be the input module. Keep the original Location.lrmodule as a backup.'
}
if ($TileUrl -notmatch '\{z\}' -or $TileUrl -notmatch '\{x\}' -or $TileUrl -notmatch '\{y\}') {
    throw "TileUrl must contain {z}, {x} and {y} placeholders."
}

$osmDir = Join-Path $PSScriptRoot 'osm'
$buildDir = Split-Path -Parent $OutputPath
$workDir = Join-Path $buildDir 'work'
$extractDir = Join-Path $workDir 'extracted'
$patchedDir = Join-Path $workDir 'patched'
$verifyDir = Join-Path $workDir 'verify'

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
if (Test-Path -LiteralPath $workDir) {
    Remove-Item -LiteralPath $workDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $patchedDir | Out-Null

function Invoke-ResourceHacker([string[]]$Arguments, [string]$LogFile) {
    $process = Start-Process -FilePath $ResourceHackerPath -ArgumentList ($Arguments + @('-log', "`"$LogFile`"")) -Wait -PassThru -WindowStyle Hidden
    $log = if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Raw -Encoding Unicode } else { '' }
    if ($process.ExitCode -ne 0 -or $log -notmatch 'Success!') {
        throw "Resource Hacker failed (exit code $($process.ExitCode)). See '$LogFile'."
    }
}

Write-Host '1. Extracting resources'
& (Join-Path $PSScriptRoot 'extract-lrmodule.ps1') -ModulePath $ModulePath -OutputDir $extractDir -ResourceHackerPath $ResourceHackerPath -Force | Out-Null

$originalClusterer = Join-Path $extractDir 'MARKERCLUSTERER.JS.txt'
$originalText = [IO.File]::ReadAllText($originalClusterer)
if ($originalText -match 'gmaps-leaflet-shim') {
    throw "'$ModulePath' is already patched for OpenStreetMap. Use the original Adobe Location.lrmodule as input."
}

Write-Host '2. Building MARKERCLUSTERER.JS (Leaflet + Google Maps shim + MarkerClusterer)'
$leafletDir = Join-Path $osmDir 'vendor\leaflet'
$leafletJs = [IO.File]::ReadAllText((Join-Path $leafletDir 'leaflet.js'))
$leafletCss = [IO.File]::ReadAllText((Join-Path $leafletDir 'leaflet.css'))
$shim = [IO.File]::ReadAllText((Join-Path $osmDir 'gmaps-leaflet-shim.js'))
$tileUrlJs = $TileUrl.Replace('\', '\\').Replace("'", "\'")
$shim = $shim.Replace('__OSM_TILE_URL__', $tileUrlJs)
$cssLiteral = ConvertTo-Json -InputObject $leafletCss -Compress

$bundle = New-Object System.Text.StringBuilder
[void]$bundle.AppendLine('/* gmaps-leaflet-shim: OpenStreetMap for the Lightroom 6.14 Map module */')
[void]$bundle.AppendLine('/* Leaflet 1.9.4 (c) 2010-2023 Volodymyr Agafonkin, (c) 2010-2011 CloudMade, BSD-2-Clause license */')
[void]$bundle.AppendLine($leafletJs)
[void]$bundle.AppendLine(';window.__osmLeafletCss = ' + $cssLiteral + ';')
[void]$bundle.AppendLine($shim)
[void]$bundle.Append($originalText)
$bundleText = $bundle.ToString()
if ($bundleText -match '[^\x00-\x7F]') {
    throw 'MARKERCLUSTERER.JS bundle contains non-ASCII characters.'
}
$clustererOut = Join-Path $patchedDir 'MARKERCLUSTERER.JS.txt'
[IO.File]::WriteAllText($clustererOut, $bundleText, (New-Object System.Text.ASCIIEncoding))

Write-Host '3. Patching Lua resources'
$luaResources = 'LOCATIONMAPVIEW', 'AGREVERSEGEOCODESERVICE', 'REVERSEGEOCODESERVICEFALLBACK', 'LOCATIONVIEWCONTROLLER'
foreach ($name in $luaResources) {
    $patchFile = Join-Path $osmDir ('patches\' + $name.ToLowerInvariant() + '.patch')
    $outFile = Join-Path $patchedDir "$name.LUA.bin"
    $output = & $Python (Join-Path $PSScriptRoot 'patchluastr.py') (Join-Path $extractDir "$name.LUA.bin") -p $patchFile -o $outFile 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $output -match 'not found|Error' -or -not (Test-Path -LiteralPath $outFile)) {
        Write-Host $output
        throw "Patching $name failed."
    }
    Write-Host "   $name patched"
}

Write-Host '4. Writing patched module'
# Resource Hacker can't select or compile resource names containing a dot,
# so build a .res file with all replacements and merge it in one step.
$resources = @(@{ File = $clustererOut; Type = 'JS'; Name = 'MARKERCLUSTERER.JS' })
foreach ($name in $luaResources) {
    $resources += @{ File = (Join-Path $patchedDir "$name.LUA.bin"); Type = 'LUA'; Name = "$name.LUA" }
}
$resFile = Join-Path $workDir 'osm.res'
$resArgs = @()
foreach ($res in $resources) {
    $resArgs += $res.Type, $res.Name, $res.File
}
& $Python (Join-Path $osmDir 'make_res.py') $resFile @resArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Creating osm.res failed.'
}
$patchedModule = Join-Path $workDir 'Location.lrmodule'
Invoke-ResourceHacker -Arguments @(
    '-open', "`"$ModulePath`"",
    '-save', "`"$patchedModule`"",
    '-action', 'addoverwrite',
    '-res', "`"$resFile`"",
    '-mask', ',,'
) -LogFile (Join-Path $workDir 'addoverwrite.log')
$modified = ([regex]::Matches((Get-Content -LiteralPath (Join-Path $workDir 'addoverwrite.log') -Raw -Encoding Unicode), 'Modified:')).Count
if ($modified -ne $resources.Count) {
    throw "Expected $($resources.Count) modified resources, Resource Hacker reported $modified."
}
Copy-Item -LiteralPath $patchedModule -Destination $OutputPath -Force

Write-Host '5. Verifying'
& (Join-Path $PSScriptRoot 'extract-lrmodule.ps1') -ModulePath $OutputPath -OutputDir $verifyDir -ResourceHackerPath $ResourceHackerPath -Force | Out-Null
$originalCount = (Get-ChildItem -LiteralPath $extractDir -File).Count
$verifyCount = (Get-ChildItem -LiteralPath $verifyDir -File).Count
if ($originalCount -ne $verifyCount) {
    throw "Resource count changed ($originalCount -> $verifyCount)."
}
foreach ($res in $resources) {
    $name = Split-Path -Leaf $res.File
    $expected = (Get-FileHash -LiteralPath $res.File).Hash
    $actual = (Get-FileHash -LiteralPath (Join-Path $verifyDir $name)).Hash
    if ($expected -ne $actual) {
        throw "Resource $name was not written correctly."
    }
}
$leftovers = Get-ChildItem -LiteralPath $verifyDir -Filter '*.LUA.bin' | Where-Object {
    [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($_.FullName)) -match 'maps(-api-ssl)?\.google(apis)?\.com/maps/api/(js|geocode)'
}
if ($leftovers) {
    Write-Warning ("Google Maps API URLs remain in: " + (($leftovers | ForEach-Object Name) -join ', '))
}

Write-Host ''
Write-Host "Done: $OutputPath"
Write-Host "Back up the original Location.lrmodule before replacing it in the Lightroom installation folder."
