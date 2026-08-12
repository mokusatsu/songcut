[CmdletBinding()]
param(
    [string]$MSBuild,
    [string]$Configuration = "Release",
    [string]$PlatformToolset,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

if ($Configuration -ne "Release") {
    throw "The native resolver is released and tested as x64 Release only."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$solution = Join-Path $repoRoot "native\windows_font_resolver\songcut_font_resolver.sln"
$outputDir = Join-Path $repoRoot "build\native\windows_font_resolver\x64\Release"
$dllPath = Join-Path $outputDir "songcut_font_resolver.dll"
$testPath = Join-Path $outputDir "songcut_font_resolver_tests.exe"

function Resolve-MSBuildPath {
    param([string]$Requested)

    $candidates = @()
    if ($Requested) { $candidates += $Requested }
    if ($env:SONGCUT_MSBUILD) { $candidates += $env:SONGCUT_MSBUILD }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere) {
        $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($LASTEXITCODE -eq 0 -and $installPath) {
            $candidates += Join-Path $installPath "MSBuild\Current\Bin\MSBuild.exe"
        }
    }
    $candidates += "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
    $candidates += "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "MSBuild.exe was not found. Pass -MSBuild or set SONGCUT_MSBUILD; Visual Studio C++ x64 tools are required."
}

$msbuildPath = Resolve-MSBuildPath $MSBuild
Write-Host "MSBuild: $msbuildPath"
Write-Host "Solution: $solution"

if (-not $PlatformToolset) {
    $vsRoot = Split-Path (Split-Path (Split-Path (Split-Path $msbuildPath -Parent) -Parent) -Parent) -Parent
    $toolsetRoot = Join-Path $vsRoot "VC\Auxiliary\Build"
    if (Test-Path (Join-Path $toolsetRoot "v145")) {
        $PlatformToolset = "v145"
    } elseif (Test-Path (Join-Path $toolsetRoot "v143")) {
        $PlatformToolset = "v143"
    } else {
        throw "Neither v145 nor v143 MSVC platform tools were found below $toolsetRoot."
    }
}
Write-Host "Platform toolset: $PlatformToolset"

& $msbuildPath $solution /m /nologo /v:minimal `
    /p:Configuration=$Configuration /p:Platform=x64 `
    /p:SCUT_FONT_PLATFORM_TOOLSET=$PlatformToolset /p:PreferredToolArchitecture=x64
if ($LASTEXITCODE -ne 0) {
    throw "MSBuild failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $dllPath)) {
    throw "Native resolver DLL was not produced at $dllPath"
}
if (-not $SkipTests) {
    if (-not (Test-Path -LiteralPath $testPath)) {
        throw "Native resolver test executable was not produced at $testPath"
    }
    & $testPath
    if ($LASTEXITCODE -ne 0) {
        throw "Native resolver tests failed with exit code $LASTEXITCODE."
    }
}

$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $dllPath).Hash
$dllBytes = [System.IO.File]::ReadAllBytes($dllPath)
if ($dllBytes.Length -lt 0x40) {
    throw "Native resolver DLL is shorter than a PE header."
}
$peOffset = [BitConverter]::ToInt32($dllBytes, 0x3c)
if ($peOffset -lt 0 -or $peOffset + 6 -gt $dllBytes.Length -or
    $dllBytes[$peOffset] -ne 0x50 -or $dllBytes[$peOffset + 1] -ne 0x45) {
    throw "Native resolver output is not a PE image."
}
$machine = [BitConverter]::ToUInt16($dllBytes, $peOffset + 4)
if ($machine -ne 0x8664) {
    throw ("Native resolver output machine is 0x{0:X4}; x64 (0x8664) is required." -f $machine)
}

Write-Host "Native resolver DLL: $dllPath"
Write-Host "Native resolver SHA256: $sha256"
Write-Host ("Native resolver machine: 0x{0:X4}" -f $machine)
