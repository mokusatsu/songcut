from __future__ import annotations

import atexit
import shutil
import tempfile
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path

import win_safesubprocess as subprocess

from .ffmpeg_tools import FfmpegPaths, ffprobe_json


SCRATCH_PROXY_PREFIX = "songcut-scratch-"
SCRATCH_PROXY_STALE_SECONDS = 24 * 60 * 60
SCRATCH_PROXY_SAMPLE_RATE = 48_000
SCRATCH_PROXY_CHANNELS = 1
SCRATCH_PROXY_BIT_RATE = 64_000

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
BELOW_NORMAL_PRIORITY_CLASS = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)


class ScratchProxyCancelled(RuntimeError):
    pass


class ScratchProxyManager:
    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            parent = Path(tempfile.gettempdir())
            self._prune_stale_sessions(parent)
            self.root = Path(tempfile.mkdtemp(prefix=SCRATCH_PROXY_PREFIX, dir=parent))
            self._owns_root = True
        else:
            self.root = root
            self.root.mkdir(parents=True, exist_ok=True)
            self._owns_root = False
        self._lock = threading.RLock()
        self._processes: dict[str, subprocess.Popen] = {}
        self._proxies: dict[str, Path] = {}
        atexit.register(self.close)

    def create(
        self,
        job_id: str,
        ffmpeg_paths: FfmpegPaths,
        source: Path,
        *,
        source_duration: float,
        cancel_event: threading.Event,
        on_progress: Callable[[float, str], None] | None = None,
    ) -> dict[str, object]:
        proxy_id = str(uuid.uuid4())
        target = self.root / f"scratch-{proxy_id}.m4a"
        partial = self.root / f"scratch-{proxy_id}.part.m4a"
        attempts = [
            (
                "aac_mf",
                ["-c:a", "aac_mf", "-b:a", f"{SCRATCH_PROXY_BIT_RATE // 1000}k"],
            ),
            (
                "aac",
                [
                    "-c:a",
                    "aac",
                    "-profile:a",
                    "aac_low",
                    "-aac_coder",
                    "fast",
                    "-b:a",
                    f"{SCRATCH_PROXY_BIT_RATE // 1000}k",
                    "-threads",
                    "1",
                ],
            ),
        ]
        errors: list[str] = []
        try:
            for encoder, encoder_args in attempts:
                self._unlink(partial)
                if cancel_event.is_set():
                    raise ScratchProxyCancelled("scratch proxy generation cancelled")
                try:
                    self._encode(
                        job_id,
                        ffmpeg_paths.ffmpeg,
                        source,
                        partial,
                        encoder_args,
                        source_duration=source_duration,
                        cancel_event=cancel_event,
                        on_progress=on_progress,
                    )
                    metadata = self._verify(ffmpeg_paths.ffprobe, partial)
                    partial.replace(target)
                    with self._lock:
                        self._proxies[proxy_id] = target
                    return {
                        "proxy_id": proxy_id,
                        "source_path": str(source),
                        "proxy_path": str(target),
                        "codec": "aac",
                        "profile": "LC",
                        "sample_rate": metadata["sample_rate"],
                        "channels": metadata["channels"],
                        "bit_rate": metadata["bit_rate"],
                        "encoder": encoder,
                        "duration": metadata["duration"],
                    }
                except ScratchProxyCancelled:
                    raise
                except Exception as exc:
                    errors.append(f"{encoder}: {exc}")
            raise RuntimeError("scratch proxy encoding failed (" + "; ".join(errors) + ")")
        finally:
            self._unlink(partial)

    def cancel(self, job_id: str) -> None:
        with self._lock:
            process = self._processes.get(job_id)
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
        except OSError:
            return
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
                process.wait(timeout=2.0)
            except OSError:
                pass

    def release(self, proxy_id: str) -> bool:
        with self._lock:
            path = self._proxies.pop(proxy_id, None)
        if path is None:
            return False
        self._unlink(path)
        return True

    def close(self) -> None:
        with self._lock:
            job_ids = list(self._processes)
        for job_id in job_ids:
            try:
                self.cancel(job_id)
            except Exception:
                pass
        if self._owns_root and self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def _encode(
        self,
        job_id: str,
        ffmpeg: Path,
        source: Path,
        target: Path,
        encoder_args: list[str],
        *,
        source_duration: float,
        cancel_event: threading.Event,
        on_progress: Callable[[float, str], None] | None,
    ) -> None:
        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-progress",
            "pipe:1",
            "-nostats",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-af",
            f"aresample={SCRATCH_PROXY_SAMPLE_RATE}:first_pts=0",
            "-ac",
            str(SCRATCH_PROXY_CHANNELS),
            "-ar",
            str(SCRATCH_PROXY_SAMPLE_RATE),
            *encoder_args,
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            str(target),
        ]
        creationflags = CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creationflags,
        )
        with self._lock:
            self._processes[job_id] = process
        output_tail: list[str] = []
        last_update = 0.0
        try:
            if process.stdout is not None:
                for raw_line in process.stdout:
                    line = raw_line.strip()
                    if line:
                        output_tail.append(line)
                        del output_tail[:-20]
                    if cancel_event.is_set():
                        self.cancel(job_id)
                        raise ScratchProxyCancelled("scratch proxy generation cancelled")
                    if line.startswith("out_time_us=") and source_duration > 0 and on_progress is not None:
                        try:
                            out_time = int(line.split("=", 1)[1]) / 1_000_000
                        except ValueError:
                            continue
                        now = time.monotonic()
                        if now - last_update >= 0.25:
                            last_update = now
                            ratio = min(0.98, max(0.0, out_time / source_duration))
                            on_progress(ratio, "Creating AAC scratch proxy.")
            return_code = process.wait()
            if cancel_event.is_set():
                raise ScratchProxyCancelled("scratch proxy generation cancelled")
            if return_code != 0:
                detail = "\n".join(output_tail) or f"ffmpeg exited with {return_code}"
                raise RuntimeError(detail)
        finally:
            with self._lock:
                if self._processes.get(job_id) is process:
                    self._processes.pop(job_id, None)

    def _verify(self, ffprobe: Path, target: Path) -> dict[str, int | float]:
        data = ffprobe_json(
            ffprobe,
            target,
            [
                "-show_entries",
                "format=duration,bit_rate:stream=codec_type,codec_name,profile,sample_rate,channels,bit_rate,duration",
            ],
        )
        stream = next((item for item in data.get("streams", []) if item.get("codec_type") == "audio"), None)
        if not stream:
            raise RuntimeError("generated proxy has no audio stream")
        codec = str(stream.get("codec_name") or "").lower()
        profile = str(stream.get("profile") or "").upper()
        sample_rate = self._int_value(stream.get("sample_rate"))
        channels = self._int_value(stream.get("channels"))
        bit_rate = self._int_value(stream.get("bit_rate") or data.get("format", {}).get("bit_rate"))
        duration = self._float_value(stream.get("duration") or data.get("format", {}).get("duration"))
        if codec != "aac" or profile != "LC":
            raise RuntimeError(f"unexpected proxy codec/profile: {codec}/{profile}")
        if sample_rate != SCRATCH_PROXY_SAMPLE_RATE or channels != SCRATCH_PROXY_CHANNELS:
            raise RuntimeError(f"unexpected proxy format: {sample_rate} Hz, {channels} channels")
        if not SCRATCH_PROXY_BIT_RATE * 0.75 <= bit_rate <= SCRATCH_PROXY_BIT_RATE * 1.25:
            raise RuntimeError(f"unexpected proxy bitrate: {bit_rate}")
        if duration <= 0:
            raise RuntimeError("generated proxy duration is not positive")
        return {
            "sample_rate": sample_rate,
            "channels": channels,
            "bit_rate": bit_rate,
            "duration": duration,
        }

    @staticmethod
    def _int_value(value: object) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _float_value(value: object) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _unlink(path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    @staticmethod
    def _prune_stale_sessions(parent: Path) -> None:
        cutoff = time.time() - SCRATCH_PROXY_STALE_SECONDS
        try:
            children = list(parent.iterdir())
        except OSError:
            return
        parent_resolved = parent.resolve()
        for child in children:
            if not child.is_dir() or not child.name.startswith(SCRATCH_PROXY_PREFIX):
                continue
            try:
                resolved = child.resolve()
                if resolved.parent != parent_resolved or child.stat().st_mtime >= cutoff:
                    continue
                shutil.rmtree(resolved, ignore_errors=True)
            except OSError:
                continue
