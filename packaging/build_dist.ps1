param(
  [string]$PackageName = "songcut-win-x64"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$GuiRoot = Join-Path $RepoRoot "gui"
$DistRoot = Join-Path $RepoRoot "dist"
$PackageRoot = Join-Path $DistRoot $PackageName
$PyinstallerDist = Join-Path $DistRoot "pyinstaller"
$PyinstallerWork = Join-Path $RepoRoot "build\pyinstaller"
$Python = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$Pnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
$NodeBin = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"

if (-not (Test-Path $Python)) {
  throw "Python was not found: $Python"
}
if (-not (Test-Path $Pnpm)) {
  throw "pnpm was not found: $Pnpm"
}

$env:PATH = "$NodeBin;$env:PATH"
$env:CI = "true"

New-Item -ItemType Directory -Force -Path $DistRoot | Out-Null

Push-Location $GuiRoot
try {
  & $Pnpm run build
  if ($LASTEXITCODE -ne 0) {
    throw "GUI build failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name songcut-api `
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
  (Join-Path $RepoRoot "packaging\songcut_api_entry.py")
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

if (Test-Path $PackageRoot) {
  Remove-Item -LiteralPath $PackageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null

$ElectronRuntime = Join-Path $GuiRoot "node_modules\electron\dist"
$ElectronTarget = Join-Path $PackageRoot "electron"
Copy-Item -Path $ElectronRuntime -Destination $ElectronTarget -Recurse
Rename-Item -LiteralPath (Join-Path $ElectronTarget "electron.exe") -NewName "songcut.exe"

$AppTarget = Join-Path $PackageRoot "app"
New-Item -ItemType Directory -Force -Path $AppTarget | Out-Null
Copy-Item -Path (Join-Path $GuiRoot "dist") -Destination (Join-Path $AppTarget "dist") -Recurse
Copy-Item -Path (Join-Path $GuiRoot "dist-electron") -Destination (Join-Path $AppTarget "dist-electron") -Recurse
Copy-Item -Path (Join-Path $GuiRoot "package.json") -Destination (Join-Path $AppTarget "package.json")

$BackendTarget = Join-Path $PackageRoot "backend"
New-Item -ItemType Directory -Force -Path $BackendTarget | Out-Null
Copy-Item -Path (Join-Path $PyinstallerDist "songcut-api") -Destination (Join-Path $BackendTarget "songcut-api") -Recurse

Copy-Item -Path (Join-Path $RepoRoot "third_party") -Destination (Join-Path $PackageRoot "third_party") -Recurse

$ModelSource = Join-Path $RepoRoot ".models\openvino\whisper-small"
if (Test-Path $ModelSource) {
  $ModelTarget = Join-Path $PackageRoot "models\openvino"
  New-Item -ItemType Directory -Force -Path $ModelTarget | Out-Null
  Copy-Item -Path $ModelSource -Destination (Join-Path $ModelTarget "whisper-small") -Recurse
}

New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "ov-cache") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PackageRoot "hf-home") | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "packaging\Start-Songcut.bat") -Destination (Join-Path $PackageRoot "Start-Songcut.bat")
Copy-Item -Path (Join-Path $RepoRoot "packaging\README_DIST.txt") -Destination (Join-Path $PackageRoot "README.txt")

Write-Host "Created portable package: $PackageRoot"
