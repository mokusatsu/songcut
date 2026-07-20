from __future__ import annotations

import atexit
import math
import threading
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import win_safesubprocess as subprocess


WAVEFORM_SAMPLE_RATE = 4000
WAVEFORM_CHANNELS = 1
WAVEFORM_MIN_POINTS = 2400
WAVEFORM_MAX_POINTS = 21600
WAVEFORM_SECONDS_PER_POINT = 1.0
WAVEFORM_GENERATOR = "pcm-4k-mono-stream-v1"
WAVEFORM_READ_BYTES = 64 * 1024
WAVEFORM_PUBLISH_POINTS = 256

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
BELOW_NORMAL_PRIORITY_CLASS = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)

WaveformPoint = dict[str, float | int]


class WaveformCancelled(RuntimeError):
    pass


def waveform_bucket_count(duration: float, frame_count: int) -> int:
    if duration <= 0 or frame_count <= 0:
        return 0
    requested_points = math.ceil(duration / WAVEFORM_SECONDS_PER_POINT)
    requested_points = max(WAVEFORM_MIN_POINTS, min(WAVEFORM_MAX_POINTS, requested_points))
    return min(requested_points, frame_count)


def waveform_peaks(samples: np.ndarray, duration: float) -> list[WaveformPoint]:
    if samples.ndim == 2:
        mono = np.mean(samples, axis=1)
    else:
        mono = samples
    frame_count = len(mono)
    bucket_count = waveform_bucket_count(duration, frame_count)
    if bucket_count == 0:
        return []
    peaks: list[WaveformPoint] = []
    for index in range(bucket_count):
        start = index * frame_count // bucket_count
        end = (index + 1) * frame_count // bucket_count
        chunk = mono[start:end]
        peaks.append(
            {
                "t": round(((start + end) / (2 * frame_count)) * duration, 3),
                "min": round(float(np.min(chunk)), 5),
                "max": round(float(np.max(chunk)), 5),
                "rms": round(float(np.sqrt(np.mean(chunk * chunk))), 6),
                "sample_count": end - start,
            }
        )
    return peaks


class WaveformGenerator:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._processes: dict[str, subprocess.Popen] = {}
        atexit.register(self.close)

    def generate(
        self,
        job_id: str,
        ffmpeg: Path,
        source: Path,
        *,
        duration: float,
        cancel_event: threading.Event,
        on_points: Callable[[list[WaveformPoint]], None],
        on_progress: Callable[[float, str], None] | None = None,
    ) -> list[WaveformPoint]:
        if duration <= 0:
            raise RuntimeError("source duration is not positive")
        expected_frames = max(1, int(round(duration * WAVEFORM_SAMPLE_RATE)))
        bucket_count = waveform_bucket_count(duration, expected_frames)
        if bucket_count == 0:
            return []

        command = [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            str(WAVEFORM_CHANNELS),
            "-ar",
            str(WAVEFORM_SAMPLE_RATE),
            "-f",
            "s16le",
            "pipe:1",
        ]
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS,
        )
        with self._lock:
            self._processes[job_id] = process

        stderr_tail: list[str] = []
        stderr_thread = threading.Thread(
            target=self._drain_stderr,
            args=(process, stderr_tail),
            daemon=True,
        )
        stderr_thread.start()

        points: list[WaveformPoint] = []
        pending: list[WaveformPoint] = []
        carry = b""
        decoded_frames = 0
        bucket_index = 0
        bucket_start = 0
        bucket_min = 32767
        bucket_max = -32768
        bucket_square_sum = 0
        bucket_samples = 0
        last_progress_update = 0.0

        def publish(point: WaveformPoint) -> None:
            points.append(point)
            pending.append(point)
            if len(pending) >= WAVEFORM_PUBLISH_POINTS:
                on_points(list(pending))
                pending.clear()

        def finish_bucket() -> None:
            nonlocal bucket_min, bucket_max, bucket_square_sum, bucket_samples, bucket_start
            if bucket_samples <= 0:
                return
            bucket_end = min(expected_frames, math.ceil((bucket_index + 1) * expected_frames / bucket_count))
            center_frame = (bucket_start + max(bucket_start + 1, bucket_end)) / 2
            publish(
                {
                    "t": round(min(duration, center_frame / WAVEFORM_SAMPLE_RATE), 6),
                    "min": round(bucket_min / 32768.0, 5),
                    "max": round(bucket_max / 32768.0, 5),
                    "rms": round(math.sqrt(bucket_square_sum / bucket_samples) / 32768.0, 6),
                    "sample_count": bucket_samples,
                }
            )
            bucket_min = 32767
            bucket_max = -32768
            bucket_square_sum = 0
            bucket_samples = 0
            bucket_start = bucket_end

        try:
            if process.stdout is None:
                raise RuntimeError("ffmpeg waveform pipe is unavailable")
            while True:
                if cancel_event.is_set():
                    self.cancel(job_id)
                    raise WaveformCancelled("waveform generation cancelled")
                raw = process.stdout.read(WAVEFORM_READ_BYTES)
                if not raw:
                    break
                raw = carry + raw
                even_length = len(raw) - (len(raw) % 2)
                carry = raw[even_length:]
                values = np.frombuffer(raw[:even_length], dtype="<i2")
                offset = 0
                while offset < len(values):
                    boundary = math.ceil((bucket_index + 1) * expected_frames / bucket_count)
                    if bucket_index >= bucket_count - 1:
                        take = len(values) - offset
                    else:
                        take = min(len(values) - offset, max(1, boundary - decoded_frames))
                    part = values[offset : offset + take]
                    wide = part.astype(np.int64, copy=False)
                    bucket_min = min(bucket_min, int(np.min(part)))
                    bucket_max = max(bucket_max, int(np.max(part)))
                    bucket_square_sum += int(np.dot(wide, wide))
                    bucket_samples += len(part)
                    decoded_frames += len(part)
                    offset += len(part)
                    if bucket_index < bucket_count - 1 and decoded_frames >= boundary:
                        finish_bucket()
                        bucket_index += 1

                now = time.monotonic()
                if on_progress is not None and now - last_progress_update >= 0.25:
                    last_progress_update = now
                    on_progress(
                        min(0.98, max(0.0, decoded_frames / expected_frames)),
                        "Generating waveform.",
                    )

            return_code = process.wait()
            stderr_thread.join(timeout=1.0)
            if cancel_event.is_set():
                raise WaveformCancelled("waveform generation cancelled")
            if return_code != 0:
                detail = "\n".join(stderr_tail) or f"ffmpeg exited with {return_code}"
                raise RuntimeError(detail)
            if carry:
                raise RuntimeError("ffmpeg returned an incomplete PCM sample")
            finish_bucket()
            if pending:
                on_points(list(pending))
            if not points:
                raise RuntimeError("source media has no decodable audio samples")
            return points
        finally:
            if process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=1.0)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                        process.wait(timeout=2.0)
                    except OSError:
                        pass
            with self._lock:
                if self._processes.get(job_id) is process:
                    self._processes.pop(job_id, None)

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

    def close(self) -> None:
        with self._lock:
            job_ids = list(self._processes)
        for job_id in job_ids:
            try:
                self.cancel(job_id)
            except Exception:
                pass

    @staticmethod
    def _drain_stderr(process: subprocess.Popen, output_tail: list[str]) -> None:
        if process.stderr is None:
            return
        for raw_line in process.stderr:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            output_tail.append(line)
            del output_tail[:-20]
