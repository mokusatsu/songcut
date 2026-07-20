from __future__ import annotations

import io
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from songcut.waveform import WaveformCancelled, WaveformGenerator


class _FakeProcess:
    def __init__(self, stdout: bytes, stderr: bytes = b"", return_code: int = 0) -> None:
        self.stdout = io.BytesIO(stdout)
        self.stderr = io.BytesIO(stderr)
        self.return_code = return_code
        self.terminated = False
        self.killed = False

    def poll(self):
        return self.return_code if not self.terminated and not self.killed else -1

    def wait(self, timeout=None):
        return self.poll()

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True


class WaveformGeneratorTests(unittest.TestCase):
    def test_streams_finalized_points_in_chunks_without_buffering_the_full_pcm(self) -> None:
        samples = np.linspace(-30000, 30000, 4000, dtype=np.int16)
        process = _FakeProcess(samples.astype("<i2").tobytes())
        published: list[list[dict[str, float | int]]] = []
        progress: list[float] = []
        generator = WaveformGenerator()

        with mock.patch("songcut.waveform.subprocess.Popen", return_value=process):
            points = generator.generate(
                "waveform-1",
                Path("ffmpeg.exe"),
                Path("source.mp4"),
                duration=1.0,
                cancel_event=threading.Event(),
                on_points=lambda chunk: published.append(chunk),
                on_progress=lambda value, _message: progress.append(value),
            )

        self.assertEqual(len(points), 2400)
        self.assertEqual(sum(int(point["sample_count"]) for point in points), len(samples))
        self.assertEqual(sum(len(chunk) for chunk in published), len(points))
        self.assertGreater(len(published), 1)
        self.assertTrue(all(float(left["t"]) < float(right["t"]) for left, right in zip(points, points[1:])))
        self.assertTrue(progress)

    def test_cancellation_terminates_the_active_ffmpeg_process(self) -> None:
        process = _FakeProcess(np.zeros(40, dtype="<i2").tobytes())
        process.return_code = None  # type: ignore[assignment]
        cancel_event = threading.Event()
        cancel_event.set()
        generator = WaveformGenerator()

        with mock.patch("songcut.waveform.subprocess.Popen", return_value=process):
            with self.assertRaises(WaveformCancelled):
                generator.generate(
                    "waveform-2",
                    Path("ffmpeg.exe"),
                    Path("source.mp4"),
                    duration=0.01,
                    cancel_event=cancel_event,
                    on_points=lambda _chunk: None,
                )

        self.assertTrue(process.terminated)

    def test_bundled_ffmpeg_streams_real_audio_as_progressive_chunks(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        ffmpeg = repo / "third_party" / "ffmpeg" / "bin" / "ffmpeg.exe"
        if not ffmpeg.exists():
            self.skipTest("bundled ffmpeg is unavailable")
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.m4a"
            subprocess.run(
                [
                    str(ffmpeg),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=48000:duration=2",
                    "-c:a",
                    "aac",
                    str(source),
                ],
                check=True,
            )
            chunks: list[list[dict[str, float | int]]] = []
            points = WaveformGenerator().generate(
                "waveform-real",
                ffmpeg,
                source,
                duration=2.0,
                cancel_event=threading.Event(),
                on_points=lambda chunk: chunks.append(chunk),
            )

        self.assertEqual(len(points), 2400)
        self.assertGreater(len(chunks), 1)
        self.assertLess(float(points[0]["t"]), float(points[-1]["t"]))


if __name__ == "__main__":
    unittest.main()
