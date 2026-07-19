from __future__ import annotations

import subprocess
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from songcut.ffmpeg_tools import FfmpegPaths
from songcut.scratch_proxy import ScratchProxyManager


class ScratchProxyManagerTests(unittest.TestCase):
    def test_create_falls_back_to_native_aac_and_registers_proxy(self) -> None:
        with self.subTest("aac_mf failure falls back"):
            root = Path(self._test_dir())
            manager = ScratchProxyManager(root)
            attempts: list[list[str]] = []

            def encode(_job_id, _ffmpeg, _source, target, encoder_args, **_kwargs) -> None:
                attempts.append(encoder_args)
                if encoder_args[1] == "aac_mf":
                    raise RuntimeError("Media Foundation unavailable")
                target.write_bytes(b"proxy")

            metadata = {"sample_rate": 48_000, "channels": 1, "bit_rate": 64_100, "duration": 12.5}
            with mock.patch.object(manager, "_encode", side_effect=encode), mock.patch.object(
                manager, "_verify", return_value=metadata
            ):
                result = manager.create(
                    "job-1",
                    SimpleNamespace(ffmpeg=Path("ffmpeg"), ffprobe=Path("ffprobe")),
                    Path("source.webm"),
                    source_duration=12.5,
                    cancel_event=threading.Event(),
                )

            self.assertEqual(result["encoder"], "aac")
            self.assertEqual(attempts[0][1], "aac_mf")
            self.assertEqual(attempts[1][1], "aac")
            proxy = Path(str(result["proxy_path"]))
            self.assertTrue(proxy.exists())
            self.assertTrue(manager.release(str(result["proxy_id"])))
            self.assertFalse(proxy.exists())
            self.assertFalse(manager.release(str(result["proxy_id"])))

    def test_create_stops_before_encoding_when_cancelled(self) -> None:
        root = Path(self._test_dir())
        manager = ScratchProxyManager(root)
        cancel_event = threading.Event()
        cancel_event.set()
        with mock.patch.object(manager, "_encode") as encode:
            with self.assertRaisesRegex(RuntimeError, "cancelled"):
                manager.create(
                    "job-1",
                    SimpleNamespace(ffmpeg=Path("ffmpeg"), ffprobe=Path("ffprobe")),
                    Path("source.webm"),
                    source_duration=12.5,
                    cancel_event=cancel_event,
                )
        encode.assert_not_called()

    def test_verify_accepts_only_expected_aac_proxy(self) -> None:
        root = Path(self._test_dir())
        manager = ScratchProxyManager(root)
        payload = {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "profile": "LC",
                    "sample_rate": "48000",
                    "channels": 1,
                    "bit_rate": "64153",
                    "duration": "10.005",
                }
            ],
            "format": {"duration": "10.005"},
        }
        with mock.patch("songcut.scratch_proxy.ffprobe_json", return_value=payload):
            metadata = manager._verify(Path("ffprobe"), Path("proxy.m4a"))
        self.assertEqual(metadata["sample_rate"], 48_000)
        self.assertEqual(metadata["channels"], 1)
        self.assertAlmostEqual(float(metadata["duration"]), 10.005)

        payload["streams"][0]["codec_name"] = "opus"
        with mock.patch("songcut.scratch_proxy.ffprobe_json", return_value=payload):
            with self.assertRaisesRegex(RuntimeError, "codec/profile"):
                manager._verify(Path("ffprobe"), Path("proxy.m4a"))

    def test_cancel_terminates_active_process(self) -> None:
        root = Path(self._test_dir())
        manager = ScratchProxyManager(root)
        process = mock.Mock()
        process.poll.return_value = None
        process.wait.return_value = 0
        manager._processes["job-1"] = process
        manager.cancel("job-1")
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=1.0)

    def test_bundled_ffmpeg_creates_verified_proxy_from_opus(self) -> None:
        repo = Path(__file__).resolve().parent.parent
        ffmpeg = repo / "third_party" / "ffmpeg" / "bin" / "ffmpeg.exe"
        ffprobe = ffmpeg.with_name("ffprobe.exe")
        if not ffmpeg.exists() or not ffprobe.exists():
            self.skipTest("bundled ffmpeg is unavailable")

        root = Path(self._test_dir())
        source = root / "source.webm"
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
                "libopus",
                source,
            ],
            check=True,
        )
        manager = ScratchProxyManager(root / "proxies")
        progress: list[float] = []
        result = manager.create(
            "real-job",
            FfmpegPaths(ffmpeg=ffmpeg, ffprobe=ffprobe),
            source,
            source_duration=2.0,
            cancel_event=threading.Event(),
            on_progress=lambda value, _message: progress.append(value),
        )

        proxy = Path(str(result["proxy_path"]))
        self.assertTrue(proxy.exists())
        self.assertEqual(result["codec"], "aac")
        self.assertEqual(result["profile"], "LC")
        self.assertEqual(result["sample_rate"], 48_000)
        self.assertEqual(result["channels"], 1)
        self.assertGreater(float(result["duration"]), 1.9)
        self.assertTrue(progress)
        self.assertTrue(manager.release(str(result["proxy_id"])))

    def _test_dir(self) -> str:
        base = Path(__file__).resolve().parent.parent / "out" / "test-scratch-proxy"
        base.mkdir(parents=True, exist_ok=True)
        target = base / f"case-{time.time_ns()}"
        target.mkdir()
        self.addCleanup(lambda: self._cleanup(target))
        return str(target)

    @staticmethod
    def _cleanup(path: Path) -> None:
        import shutil

        shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
