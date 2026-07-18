from unittest import mock
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

import numpy as np

from songcut.transcription import WhisperRuntime, select_whisper_runtime, transcribe_segments


class TranscriptionRuntimeTests(unittest.TestCase):
    def test_auto_prefers_npu_then_gpu_then_cpu(self) -> None:
        with mock.patch("songcut.transcription.detect_openvino_devices", return_value=(["GPU", "NPU", "CPU"], None)):
            runtime = select_whisper_runtime("auto")
        self.assertEqual(runtime.device_used, "NPU")
        self.assertEqual(runtime.backend, "openvino-genai")

    def test_auto_falls_back_to_gpu(self) -> None:
        with mock.patch("songcut.transcription.detect_openvino_devices", return_value=(["GPU", "CPU"], None)):
            runtime = select_whisper_runtime("auto")
        self.assertEqual(runtime.device_used, "GPU")

    def test_auto_uses_cpu_without_openvino_devices(self) -> None:
        with mock.patch("songcut.transcription.detect_openvino_devices", return_value=([], "OpenVINO unavailable")):
            runtime = select_whisper_runtime("auto")
        self.assertEqual(runtime.device_used, "CPU")
        self.assertIn("OpenVINO unavailable", runtime.fallbacks)

    def test_strict_npu_requires_npu(self) -> None:
        with mock.patch("songcut.transcription.detect_openvino_devices", return_value=(["CPU"], None)):
            with self.assertRaises(RuntimeError):
                select_whisper_runtime("npu")

    def test_auto_generation_failure_retries_cpu(self) -> None:
        created_devices: list[str] = []

        class Decoded:
            texts = ["BGM"]
            language = "ja"
            chunks = []

        class FakePipe:
            def __init__(self, _model: str, device: str) -> None:
                self.device = device
                created_devices.append(device)

            def generate(self, _speech: np.ndarray, **_kwargs: object) -> Decoded:
                if self.device == "GPU":
                    raise RuntimeError("gpu failed")
                return Decoded()

        def runtime(requested: str) -> WhisperRuntime:
            if requested == "auto":
                return WhisperRuntime("openvino-genai", "auto", "GPU", ["GPU", "CPU"])
            return WhisperRuntime("openvino-genai", requested, requested.upper(), ["GPU", "CPU"])

        with (
            mock.patch.dict(sys.modules, {"openvino_genai": SimpleNamespace(WhisperPipeline=FakePipe)}),
            mock.patch("songcut.transcription.select_whisper_runtime", side_effect=runtime),
            mock.patch("songcut.transcription.ensure_whisper_model", return_value=Path("model")),
            mock.patch("songcut.transcription.extract_segment_wav"),
            mock.patch("songcut.transcription.read_wav_mono_16k", return_value=np.zeros(16000, dtype=np.float32)),
        ):
            result = transcribe_segments(
                SimpleNamespace(ffmpeg=Path("ffmpeg")),
                Path("source.mp4"),
                [{"id": "seg-001", "start": 0.0, "end": 1.0}],
                requested_device="auto",
            )

        self.assertEqual(created_devices, ["GPU", "CPU"])
        self.assertEqual(result[0].text, "BGM")
        self.assertEqual(result[0].device_used, "CPU")
        self.assertIsNone(result[0].error)

    def test_strict_generation_failure_is_reported_without_cpu_retry(self) -> None:
        created_devices: list[str] = []

        class FakePipe:
            def __init__(self, _model: str, device: str) -> None:
                self.device = device
                created_devices.append(device)

            def generate(self, _speech: np.ndarray, **_kwargs: object) -> object:
                raise RuntimeError("gpu failed")

        with (
            mock.patch.dict(sys.modules, {"openvino_genai": SimpleNamespace(WhisperPipeline=FakePipe)}),
            mock.patch(
                "songcut.transcription.select_whisper_runtime",
                return_value=WhisperRuntime("openvino-genai", "gpu", "GPU", ["GPU", "CPU"]),
            ),
            mock.patch("songcut.transcription.ensure_whisper_model", return_value=Path("model")),
            mock.patch("songcut.transcription.extract_segment_wav"),
            mock.patch("songcut.transcription.read_wav_mono_16k", return_value=np.zeros(16000, dtype=np.float32)),
        ):
            result = transcribe_segments(
                SimpleNamespace(ffmpeg=Path("ffmpeg")),
                Path("source.mp4"),
                [{"id": "seg-001", "start": 0.0, "end": 1.0}],
                requested_device="gpu",
            )

        self.assertEqual(created_devices, ["GPU"])
        self.assertEqual(result[0].device_used, "GPU")
        self.assertIn("gpu failed", result[0].error or "")


if __name__ == "__main__":
    unittest.main()
