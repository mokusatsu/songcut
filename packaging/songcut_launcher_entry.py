from __future__ import annotations

import json
import logging
import os
import sys
import threading
import tempfile
import time
import urllib.error
import uuid
import urllib.request
from pathlib import Path

import uvicorn
import win_safesubprocess as subprocess

from songcut.api import app as api_app
from songcut.api import find_free_port


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
SOFTWARE_DECODER_RESTART_EXIT_CODE = 75
SOFTWARE_DECODER_RESTART_REQUEST_ENV = "SONGCUT_LAUNCHER_RESTART_REQUEST"
SOFTWARE_DECODER_RESUME_ARG_PREFIX = "--songcut-software-decoder-resume="


def create_software_decoder_restart_request_path() -> Path:
    """Return a unique, one-shot request path shared with the Electron child."""
    return Path(tempfile.gettempdir()) / f"songcut-software-decoder-restart-{uuid.uuid4().hex}.json"


def consume_software_decoder_restart_args(request_path: Path) -> list[str] | None:
    """Read and remove the launcher's one-shot decoder-restart request."""
    try:
        payload = json.loads(request_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    finally:
        try:
            request_path.unlink(missing_ok=True)
        except OSError:
            logging.warning("Could not remove software decoder restart request.")

    args = payload.get("args") if isinstance(payload, dict) else None
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        return None
    return args


def redact_electron_args_for_logging(args: list[str]) -> list[str]:
    """Keep one-shot resume paths out of launcher logs while retaining diagnostic flags."""
    return [
        f"{SOFTWARE_DECODER_RESUME_ARG_PREFIX}<redacted>"
        if arg.startswith(SOFTWARE_DECODER_RESUME_ARG_PREFIX)
        else arg
        for arg in args
    ]


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


def configure_standard_streams(log_path: Path) -> None:
    """Give console-oriented libraries writable streams in a windowed PyInstaller build."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    stream = log_path.open("a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


def configure_environment(root: Path, base_url: str) -> dict[str, str]:
    local_app_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    writable_root = local_app_data / "songcut"
    os.environ["SONGCUT_GUI_DIST"] = "1"
    os.environ["SONGCUT_REPO_ROOT"] = str(root)
    os.environ.setdefault("SONGCUT_BUNDLED_MODEL_DIR", str(root / "models"))
    os.environ.setdefault("SONGCUT_MODEL_DIR", str(writable_root / "models"))
    os.environ.setdefault("OV_CACHE_DIR", str(writable_root / "ov-cache"))
    os.environ.setdefault("HF_HOME", str(writable_root / "hf-home"))
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
    configure_standard_streams(log_path)
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

        electron_launch_args = list(argv if argv is not None else sys.argv[1:])
        while True:
            restart_request_path = create_software_decoder_restart_request_path()
            electron_env = env.copy()
            electron_env[SOFTWARE_DECODER_RESTART_REQUEST_ENV] = str(restart_request_path)
            electron_args = [str(electron_exe), *electron_launch_args, str(app_dir)]
            logging.info("Launching Electron: %s", redact_electron_args_for_logging(electron_args))
            with log_path.open("a", encoding="utf-8") as log_file:
                electron_process = subprocess.Popen(
                    electron_args,
                    cwd=root,
                    env=electron_env,
                    stdin=subprocess.DEVNULL,
                    stdout=log_file,
                    stderr=log_file,
                    text=True,
                    creationflags=CREATE_NO_WINDOW,
                )
                return_code = electron_process.wait()
            logging.info("Electron exited with code %s", return_code)
            if return_code != SOFTWARE_DECODER_RESTART_EXIT_CODE:
                restart_request_path.unlink(missing_ok=True)
                return int(return_code or 0)

            next_args = consume_software_decoder_restart_args(restart_request_path)
            if next_args is None:
                logging.error("Software decoder restart request was missing or invalid.")
                return 1
            logging.info("Restarting Electron with the one-shot software decoder mode.")
            electron_launch_args = next_args
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
