[CmdletBinding()]
param(
    [string]$ModulePath = (Join-Path $PSScriptRoot 'Location.lrmodule'),
    [string]$OutputDir = (Join-Path $PSScriptRoot '_temp_'),
    [string]$ResourceHackerPath = $env:RESOURCE_HACKER,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ResourceHackerPath)) {
    throw 'Set RESOURCE_HACKER or pass -ResourceHackerPath with the path to ResourceHacker.exe.'
}

$ModulePath = (Resolve-Path -LiteralPath $ModulePath).Path
$ResourceHackerPath = (Resolve-Path -LiteralPath $ResourceHackerPath).Path
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

$resourceScript = Join-Path $OutputDir 'resources.rc'
$logFile = Join-Path $OutputDir 'resourcehacker.log'
$arguments = @(
    '-open', "`"$ModulePath`"",
    '-save', "`"$resourceScript`"",
    '-action', 'extract',
    '-mask', ',,',
    '-log', "`"$logFile`""
)

$process = Start-Process -FilePath $ResourceHackerPath -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
$log = if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Raw -Encoding Unicode } else { '' }

if ($process.ExitCode -ne 0 -or $log -notmatch 'Success!') {
    throw "Resource Hacker extraction failed (exit code $($process.ExitCode)). See '$logFile'."
}

$files = Get-ChildItem -LiteralPath $OutputDir -File
Write-Host "Extracted $($files.Count - 2) resources from '$ModulePath' to '$OutputDir'."
$files | Group-Object Extension | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-5} {1}" -f $_.Name, $_.Count) }
