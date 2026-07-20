# Build

These instructions are for a normal Windows development machine. Codex-specific
runtime injection is documented separately in `CODEX.md`. Unless a section says
otherwise, run commands from the repository root.

## Prerequisites

- Python 3.11 or newer
- Node.js
- pnpm
- Git
- PowerShell

Bundled `ffmpeg.exe` and `ffprobe.exe` are optional for development. The app
searches the repository/package root first, then falls back to `PATH`.

`pnpm` must be able to find `node` in the same shell where you run frontend
commands. If a `pnpm` command fails with `node is not recognized`, fix the
Node.js `PATH` entry first and rerun the command.

## Python Setup

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

For GUI/API development or portable packaging, install the GUI extra too:

```powershell
python -m pip install -e ".[gui,dev]"
```

Run the Python tests with:

```powershell
python -m pytest
```

The repository does not include proprietary media fixtures. Tests that require
local media should skip themselves when those files are not present.

## Frontend Setup

From `gui/`:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

## Development GUI

Use two terminals.

Terminal 1, from `gui/`:

```powershell
pnpm run dev
```

Terminal 2, from the repository root:

```powershell
$env:SONGCUT_PYTHON = (Get-Command python).Source
$env:SONGCUT_REPO_ROOT = (Resolve-Path .).Path
cd gui
pnpm run electron:dev
```

The backend API can also be started manually:

```powershell
python -m songcut.api --host 127.0.0.1 --port 8765
```

## Portable Package

Install the GUI Python dependencies and frontend dependencies first:

```powershell
python -m pip install -e ".[gui,dev]"
cd gui
pnpm install --frozen-lockfile
cd ..
```

`packaging/build_dist.ps1` discovers tools from `PATH` by default. You can also
inject explicit tool paths with environment variables:

```powershell
$env:SONGCUT_PYTHON = (Get-Command python).Source
$env:SONGCUT_NODE = (Get-Command node).Source
$env:SONGCUT_PNPM = (Get-Command pnpm.cmd).Source
$env:SONGCUT_GIT = (Get-Command git).Source
.\packaging\build_dist.ps1
```

The script runs the production GUI build itself. Running `pnpm run typecheck`
and `pnpm run build` beforehand is still useful when you want an explicit
frontend validation step before packaging.

Or pass them as parameters:

```powershell
.\packaging\build_dist.ps1 `
  -Python "C:\Path\To\python.exe" `
  -Node "C:\Path\To\node.exe" `
  -Pnpm "C:\Path\To\pnpm.cmd" `
  -Git "C:\Path\To\git.exe"
```

The default command is a normal distribution build. It updates only
`dist\songcut-win-x64` and does not create or update release archives. Close any
running copy of the packaged app before rebuilding so Windows can delete the
previous Electron runtime files.

When an automated build is explicitly asked to update `dist`, it may close
running processes whose executable files are inside `dist\songcut-win-x64`
without an additional confirmation prompt. It must verify the executable paths
first and must not stop same-named processes from another package or directory.
Save work in the packaged app before requesting an automated `dist` update.

To create a release build, pass `-Release`:

```powershell
.\packaging\build_dist.ps1 -Release
```

After updating `dist\songcut-win-x64`, the release build also creates:

```text
dist\songcut-[version]-full.zip
dist\songcut-[version].zip
```

The full archive contains every file from `songcut-win-x64`. The standard
archive contains the same package, but keeps `third_party` and `models` as empty
directories. Archive contents start at `songcut.exe`; there is no enclosing
`songcut-win-x64` directory inside either ZIP file.

The package version is `VERSION` plus the Git commit count, for example
`1.0.3`. If `.models\openvino\whisper-small` exists in the repository, it is
copied to `models\openvino\whisper-small` in the portable package. If it is not
present, the package is still created without a bundled Whisper model.

The Full package reads its bundled Small model in place. Downloaded Tiny/Base/
Small models plus Hugging Face and OpenVINO caches are stored under
`%LOCALAPPDATA%\songcut`; the extracted portable package is treated as
read-only.

A minimal successful package should contain:

```text
dist\songcut-win-x64\songcut.exe
dist\songcut-win-x64\runtime\
dist\songcut-win-x64\app\dist\
dist\songcut-win-x64\app\dist-electron\
dist\songcut-win-x64\electron\songcut-electron.exe
dist\songcut-win-x64\README.txt
```
