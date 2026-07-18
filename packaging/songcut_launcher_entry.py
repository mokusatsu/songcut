from __future__ import annotations

import logging
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
import win_safesubprocess as subprocess

from songcut.api import app as api_app
from songcut.api import find_free_port


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def distribution_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def configure_logging(root: Path) -> Path:
    log_dir = root / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "songcut-launcher.log"
    logging.basicConfig(
        filename=log_path,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        encoding="utf-8",
    )
    return log_path


def configure_environment(root: Path, base_url: str) -> dict[str, str]:
    os.environ["SONGCUT_GUI_DIST"] = "1"
    os.environ["SONGCUT_REPO_ROOT"] = str(root)
    os.environ.setdefault("SONGCUT_MODEL_DIR", str(root / "models"))
    os.environ.setdefault("OV_CACHE_DIR", str(root / "ov-cache"))
    os.environ.setdefault("HF_HOME", str(root / "hf-home"))
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["OV_TELEMETRY_ENABLE"] = "NO"
    os.environ["PYTHONUTF8"] = "1"
    os.environ["SONGCUT_API_BASE_URL"] = base_url
    return os.environ.copy()


def wait_for_health(base_url: str, timeout_seconds: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=2) as response:
                if 200 <= response.status < 300:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(0.25)
    if last_error:
        raise RuntimeError(f"songcut API did not become ready: {last_error}") from last_error
    raise RuntimeError("songcut API did not become ready.")


def show_startup_error(log_path: Path, error: Exception) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            f"songcut failed to start.\n\n{error}\n\nSee log:\n{log_path}",
            "songcut",
            0x10,
        )
    except Exception:
        logging.exception("Failed to show startup error dialog.")


def run(argv: list[str] | None = None) -> int:
    root = distribution_root()
    log_path = configure_logging(root)
    electron_process: subprocess.Popen | None = None
    server: uvicorn.Server | None = None
    try:
        port = find_free_port()
        base_url = f"http://127.0.0.1:{port}"
        env = configure_environment(root, base_url)

        config = uvicorn.Config(api_app, host="127.0.0.1", port=port, log_level="info", log_config=None)
        server = uvicorn.Server(config)
        api_thread = threading.Thread(target=server.run, name="songcut-api", daemon=True)
        api_thread.start()
        wait_for_health(base_url)

        electron_exe = root / "electron" / "songcut-electron.exe"
        app_dir = root / "app"
        if not electron_exe.exists():
            raise FileNotFoundError(f"Electron executable was not found: {electron_exe}")
        if not app_dir.exists():
            raise FileNotFoundError(f"Electron application directory was not found: {app_dir}")

        electron_args = [str(electron_exe), *(argv or sys.argv[1:]), str(app_dir)]
        logging.info("Launching Electron: %s", electron_args)
        with log_path.open("a", encoding="utf-8") as log_file:
            electron_process = subprocess.Popen(
                electron_args,
                cwd=root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=log_file,
                text=True,
                creationflags=CREATE_NO_WINDOW,
            )
            return_code = electron_process.wait()
        logging.info("Electron exited with code %s", return_code)
        return int(return_code or 0)
    except Exception as exc:
        logging.exception("songcut launcher failed.")
        show_startup_error(log_path, exc)
        if electron_process and electron_process.poll() is None:
            electron_process.terminate()
        return 1
    finally:
        if server:
            server.should_exit = True


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
