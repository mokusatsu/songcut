param(
  [string]$PackageName = "songcut-win-x64",
  [string]$Python = $env:SONGCUT_PYTHON,
  [string]$Pnpm = $env:SONGCUT_PNPM,
  [string]$Node = $env:SONGCUT_NODE,
  [string]$Git = $env:SONGCUT_GIT
)

$ErrorActionPreference = "Stop"

function Resolve-ToolPath {
  param(
    [string]$Name,
    [string]$Candidate,
    [string]$CommandName,
    [string]$EnvName,
    [string]$ParameterName
  )

  if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $Candidate).ProviderPath
    }

    $CandidateCommand = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($CandidateCommand) {
      return $CandidateCommand.Source
    }

    throw "$Name was not found: $Candidate"
  }

  $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }

  throw "$Name was not found. Install it on PATH, set `$env:$EnvName, or pass -$ParameterName."
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$GuiRoot = Join-Path $RepoRoot "gui"
$DistRoot = Join-Path $RepoRoot "dist"
$PackageRoot = Join-Path $DistRoot $PackageName
$PyinstallerDist = Join-Path $DistRoot "pyinstaller"
$PyinstallerWork = Join-Path $RepoRoot "build\pyinstaller"
$VersionFile = Join-Path $RepoRoot "VERSION"
$AppIcon = Join-Path $RepoRoot "assets\icons\songcut.ico"
$PythonExe = Resolve-ToolPath -Name "Python" -Candidate $Python -CommandName "python" -EnvName "SONGCUT_PYTHON" -ParameterName "Python"
$NodeExe = Resolve-ToolPath -Name "Node.js" -Candidate $Node -CommandName "node" -EnvName "SONGCUT_NODE" -ParameterName "Node"
$env:PATH = "$(Split-Path -Parent $NodeExe);$env:PATH"
$PnpmExe = Resolve-ToolPath -Name "pnpm" -Candidate $Pnpm -CommandName "pnpm.cmd" -EnvName "SONGCUT_PNPM" -ParameterName "Pnpm"
$GitExe = Resolve-ToolPath -Name "git" -Candidate $Git -CommandName "git" -EnvName "SONGCUT_GIT" -ParameterName "Git"

if (-not (Test-Path $VersionFile)) {
  throw "VERSION file was not found: $VersionFile"
}

if (-not (Test-Path -LiteralPath $AppIcon -PathType Leaf)) {
  throw "Application icon was not found: $AppIcon"
}

$BaseVersion = (Get-Content -Raw -Path $VersionFile).Trim()
if ($BaseVersion -notmatch "^\d+\.\d+$") {
  throw "VERSION must be MAJOR.MINOR, for example 1.0: $BaseVersion"
}

$BuildNumber = (& $GitExe -C $RepoRoot rev-list --count HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "git rev-list --count HEAD failed with exit code $LASTEXITCODE"
}
if ($BuildNumber -notmatch "^\d+$") {
  throw "Build number must be numeric: $BuildNumber"
}
$AppVersion = "$BaseVersion.$BuildNumber"

$env:CI = "true"

New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null

Push-Location $GuiRoot
try {
  & $PnpmExe run build
  if ($LASTEXITCODE -ne 0) {
    throw "GUI build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

& $PythonExe -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --windowed `
  --contents-directory runtime `
  --name songcut `
  --icon $AppIcon `
  --distpath $PyinstallerDist `
  --workpath $PyinstallerWork `
  --specpath $PyinstallerWork `
  --collect-all openvino `
  --collect-all openvino_genai `
  --collect-all openvino_tokenizers `
  --collect-all fastapi `
  --collect-all uvicorn `
  --collect-all starlette `
  --collect-all pydantic `
  --collect-all pydantic_core `
  --collect-all win_safesubprocess `
  --exclude-module torch `
  --exclude-module tensorflow `
  --exclude-module transformers `
  --exclude-module optimum `
  --exclude-module pandas `
  --exclude-module scipy `
  --exclude-module sklearn `
  --exclude-module PIL `
  --exclude-module matplotlib `
  --exclude-module openpyxl `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.websockets.auto `
  --hidden-import httptools.parser.parser `
  (Join-Path $RepoRoot "packaging\songcut_launcher_entry.py")
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

if (Test-Path $PackageRoot) {
  Remove-Item -LiteralPath $PackageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null

$LauncherBundle = Join-Path $PyinstallerDist "songcut"
if (-not (Test-Path $LauncherBundle)) {
  throw "PyInstaller output was not found: $LauncherBundle"
}
Copy-Item -Path (Join-Path $LauncherBundle "*") -Destination $PackageRoot -Recurse

$ElectronRuntime = Join-Path $GuiRoot "node_modules\electron\dist"
if (-not (Test-Path $ElectronRuntime)) {
  throw "Electron runtime was not found: $ElectronRuntime. Run pnpm install --frozen-lockfile in gui first."
}
$ElectronTarget = Join-Path $PackageRoot "electron"
Copy-Item -Path $ElectronRuntime -Destination $ElectronTarget -Recurse
Rename-Item -LiteralPath (Join-Path $ElectronTarget "electron.exe") -NewName "songcut-electron.exe"
$ElectronExe = Join-Path $ElectronTarget "songcut-electron.exe"
$SetWindowsExeIcon = Join-Path $RepoRoot "packaging\set_windows_exe_icon.py"
# Reuse PyInstaller's Windows resource support so the copied Electron runtime
# has the same embedded icon as the launcher without another build dependency.
& $PythonExe $SetWindowsExeIcon --exe $ElectronExe --icon $AppIcon
if ($LASTEXITCODE -ne 0) {
  throw "Setting the Electron executable icon failed with exit code $LASTEXITCODE"
}

$AppTarget = Join-Path $PackageRoot "app"
New-Item -ItemType Directory -Force -Path $AppTarget | Out-Null
Copy-Item -Path (Join-Path $GuiRoot "dist") -Destination (Join-Path $AppTarget "dist") -Recurse
Copy-Item -Path (Join-Path $GuiRoot "dist-electron") -Destination (Join-Path $AppTarget "dist-electron") -Recurse
$PackageJsonTarget = Join-Path $AppTarget "package.json"
Copy-Item -Path (Join-Path $GuiRoot "package.json") -Destination $PackageJsonTarget
$PackageJson = Get-Content -Raw -Path $PackageJsonTarget | ConvertFrom-Json
$PackageJson.version = $AppVersion
$PackageJson | ConvertTo-Json -Depth 20 | Set-Content -Path $PackageJsonTarget -Encoding UTF8

$ThirdPartySource = Join-Path $RepoRoot "third_party"
if (Test-Path $ThirdPartySource) {
  Copy-Item -Path $ThirdPartySource -Destination (Join-Path $PackageRoot "third_party") -Recurse
}

$ModelSource = Join-Path $RepoRoot ".models\openvino\whisper-small"
if (Test-Path $ModelSource) {
  $ModelTarget = Join-Path $PackageRoot "models\openvino"
  New-Item -ItemType Directory -Force -Path $ModelTarget | Out-Null
  Copy-Item -Path $ModelSource -Destination (Join-Path $ModelTarget "whisper-small") -Recurse
}

New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "ov-cache") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "hf-home") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "logs") | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "packaging\README_DIST.txt") -Destination (Join-Path $PackageRoot "README.txt")

Write-Host "Created portable package: $PackageRoot"
Write-Host "Version: $AppVersion"
