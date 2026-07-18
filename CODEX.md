# Codex Build Notes

Public build instructions live in `docs/BUILD.md` and `docs/BUILD.ja.md`.
Keep Codex-specific runtime paths out of README and public build docs.

When building inside Codex, inject the bundled runtime paths through the
environment variables supported by `packaging/build_dist.ps1`. Keep these
commands in the same PowerShell session as the later `pnpm` and build commands;
the `PATH` update is what lets `pnpm` find `node.exe`.

```powershell
$CodexDeps = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$env:SONGCUT_PYTHON = Join-Path $CodexDeps "python\python.exe"
$env:SONGCUT_NODE = Join-Path $CodexDeps "node\bin\node.exe"
$env:SONGCUT_PNPM = Join-Path $CodexDeps "bin\fallback\pnpm.cmd"
$env:SONGCUT_GIT = Join-Path $CodexDeps "native\git\cmd\git.exe"
$env:PATH = "$(Split-Path -Parent $env:SONGCUT_NODE);$env:PATH"
```

Then install the local dependencies and build:

```powershell
& $env:SONGCUT_PYTHON -m pip install -e ".[gui,dev]"
Push-Location gui
& $env:SONGCUT_PNPM install --frozen-lockfile
Pop-Location
.\packaging\build_dist.ps1
```

For a fuller pre-package validation pass, run the tests and frontend checks
before `build_dist.ps1`:

```powershell
& $env:SONGCUT_PYTHON -m pytest
Push-Location gui
& $env:SONGCUT_PNPM run typecheck
& $env:SONGCUT_PNPM run build
Pop-Location
```

If a `pnpm` command fails with `node is not recognized`, rerun the environment
injection block above in the current shell before trying again.

The script also accepts the same tools as parameters:

```powershell
.\packaging\build_dist.ps1 `
  -Python $env:SONGCUT_PYTHON `
  -Node $env:SONGCUT_NODE `
  -Pnpm $env:SONGCUT_PNPM `
  -Git $env:SONGCUT_GIT
```

`build_dist.ps1` runs the GUI production build internally and writes
`dist\songcut-win-x64`. It sets the packaged GUI version from `VERSION` plus
`git rev-list --count HEAD`, and copies `.models\openvino\whisper-small` only
when that local model directory exists.

Close any running `dist\songcut-win-x64\songcut.exe` or
`songcut-electron.exe` processes before rebuilding the portable package,
because Windows can keep Electron runtime files locked.
