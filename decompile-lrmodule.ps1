[CmdletBinding()]
param(
    [string]$InputDir = (Join-Path $PSScriptRoot '_temp_'),
    [string]$OutputDir = (Join-Path $PSScriptRoot '_temp_decomp_'),
    [string]$UnluacPath = (Join-Path $PSScriptRoot '_tools_\unluac.jar'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$InputDir = (Resolve-Path -LiteralPath $InputDir).Path
$UnluacPath = (Resolve-Path -LiteralPath $UnluacPath).Path
$OutputDir = [IO.Path]::GetFullPath($OutputDir)

if (Test-Path -LiteralPath $OutputDir) {
    if (Get-ChildItem -LiteralPath $OutputDir -Force | Select-Object -First 1) {
        if (-not $Force) {
            throw "Output folder '$OutputDir' is not empty. Use -Force to replace its contents."
        }
        Get-ChildItem -LiteralPath $OutputDir -Force | Remove-Item -Recurse -Force
    }
}
else {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$folders = @{}
foreach ($name in 'lua', 'js', 'images', 'other') {
    $folders[$name] = Join-Path $OutputDir $name
    New-Item -ItemType Directory -Path $folders[$name] | Out-Null
}

$failures = @()
$counts = @{ lua = 0; js = 0; images = 0; other = 0 }

foreach ($file in Get-ChildItem -LiteralPath $InputDir -File) {
    if ($file.Name -in 'resources.rc', 'resourcehacker.log') {
        Copy-Item -LiteralPath $file.FullName -Destination $folders.other
        $counts.other++
    }
    elseif ($file.Name -like '*.LUA.bin') {
        $target = Join-Path $folders.lua ($file.Name -replace '\.LUA\.bin$', '.lua')
        $errorFile = "$target.error.txt"
        $output = & java -jar $UnluacPath $file.FullName 2> $errorFile
        if ($LASTEXITCODE -eq 0) {
            [IO.File]::WriteAllLines($target, [string[]]$output, [Text.UTF8Encoding]::new($false))
            if ((Get-Item -LiteralPath $errorFile).Length -eq 0) {
                Remove-Item -LiteralPath $errorFile
            }
            $counts.lua++
        }
        else {
            $failures += $file.Name
        }
    }
    elseif ($file.Name -like '*.JS.txt') {
        Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $folders.js ($file.Name -replace '\.JS\.txt$', '.js'))
        $counts.js++
    }
    elseif ($file.Name -match '\.(PNG|JPG)\.bin$') {
        Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $folders.images ($file.Name -replace '\.bin$', ''))
        $counts.images++
    }
    else {
        $targetName = if ($file.Name -match '^\d+\.bin$') { $file.BaseName + '.manifest.xml' } else { $file.Name }
        Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $folders.other $targetName)
        $counts.other++
    }
}

Write-Host "Wrote output to '$OutputDir'."
Write-Host "  Lua decompiled: $($counts.lua)"
Write-Host "  JavaScript:     $($counts.js)"
Write-Host "  Images:         $($counts.images)"
Write-Host "  Other:          $($counts.other)"

if ($failures) {
    throw "Failed to decompile: $($failures -join ', ')"
}
