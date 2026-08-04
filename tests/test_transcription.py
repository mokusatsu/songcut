from unittest import mock
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest

import numpy as np

from songcut.transcription import (
    DEFAULT_WHISPER_MODEL_KEY,
    WHISPER_MODELS,
    WHISPER_REQUIRED_FILES,
    WhisperRuntime,
    download_preconverted_whisper,
    huggingface_cache_dir,
    normalize_whisper_language,
    resolve_whisper_model_dir,
    select_whisper_runtime,
    transcribe_segments,
    whisper_language_options,
    whisper_model_ready,
    whisper_model_statuses,
)


class TranscriptionRuntimeTests(unittest.TestCase):
    @staticmethod
    def write_ready_model(target: Path) -> None:
        target.mkdir(parents=True, exist_ok=True)
        for filename in WHISPER_REQUIRED_FILES:
            (target / filename).write_text("model", encoding="utf-8")

    def test_headless_model_download_reports_bytes_without_console_stream(self) -> None:
        progress: list[tuple[int, int]] = []

        def fake_snapshot_download(**kwargs: object):
            if kwargs.get("dry_run"):
                return [SimpleNamespace(file_size=100)]
            target = Path(str(kwargs["local_dir"]))
            self.write_ready_model(target)
            tqdm_class = kwargs["tqdm_class"]
            bar = tqdm_class(
                name="huggingface_hub.snapshot_download",
                desc="Reconstructing",
                total=100,
                initial=0,
                unit="B",
            )
            bar.update(25)
            bar.update(75)
            bar.close()

        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch("huggingface_hub.snapshot_download", side_effect=fake_snapshot_download):
                download_preconverted_whisper(
                    Path(temp_dir),
                    progress_callback=lambda downloaded, total: progress.append((downloaded, total)),
                )

        self.assertIn((25, 100), progress)
        self.assertIn((100, 100), progress)

    def test_model_registry_includes_large_v3_turbo_int8_openvino(self) -> None:
        self.assertEqual(
            list(WHISPER_MODELS),
            ["tiny", "base", "small", "whisper-large-v3-turbo-int8-ov"],
        )
        self.assertEqual(WHISPER_MODELS["base"].openvino_repo_id, "OpenVINO/whisper-base-fp16-ov")
        self.assertEqual(
            WHISPER_MODELS["whisper-large-v3-turbo-int8-ov"].openvino_repo_id,
            "OpenVINO/whisper-large-v3-turbo-int8-ov",
        )
        self.assertEqual(DEFAULT_WHISPER_MODEL_KEY, "whisper-large-v3-turbo-int8-ov")

    def test_language_normalization_accepts_auto_code_and_legacy_token(self) -> None:
        self.assertEqual(normalize_whisper_language("auto"), ("auto", None))
        self.assertEqual(normalize_whisper_language("ja"), ("ja", "<|ja|>"))
        self.assertEqual(normalize_whisper_language("<|ja|>"), ("ja", "<|ja|>"))
        with self.assertRaises(ValueError):
            normalize_whisper_language("not-a-language")

    def test_language_options_pin_common_languages_first(self) -> None:
        options = whisper_language_options()
        self.assertEqual([row["code"] for row in options[:5]], ["auto", "ja", "en", "zh", "ko"])

    def test_downloaded_model_takes_precedence_over_bundled_model(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            writable = root / "writable"
            bundled = root / "bundled"
            for model_root in (writable, bundled):
                ready = model_root / "openvino" / "whisper-small"
                self.write_ready_model(ready)
            with mock.patch.dict(
                "os.environ",
                {"SONGCUT_MODEL_DIR": str(writable), "SONGCUT_BUNDLED_MODEL_DIR": str(bundled)},
                clear=False,
            ):
                resolved = resolve_whisper_model_dir("small")
                statuses = whisper_model_statuses()
        self.assertEqual(resolved, (writable / "openvino" / "whisper-small", "downloaded"))
        small = next(row for row in statuses if row["key"] == "small")
        self.assertTrue(small["ready"])
        self.assertEqual(small["source"], "downloaded")

    def test_model_is_not_ready_when_a_required_binary_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "whisper-small"
            self.write_ready_model(target)
            (target / "openvino_encoder_model.bin").unlink()
            self.assertFalse(whisper_model_ready(target))

    def test_model_is_not_ready_when_a_required_file_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "whisper-small"
            self.write_ready_model(target)
            (target / "openvino_decoder_model.bin").write_bytes(b"")
            self.assertFalse(whisper_model_ready(target))

    def test_huggingface_cache_defaults_beside_the_writable_model_root(self) -> None:
        with mock.patch.dict("os.environ", {"SONGCUT_MODEL_DIR": "C:\\local\\songcut\\models"}, clear=True):
            self.assertEqual(huggingface_cache_dir(), Path("C:\\local\\songcut\\hf-home\\hub"))

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

    def test_auto_language_omits_language_argument_and_uses_selected_model_id(self) -> None:
        generated_kwargs: dict[str, object] = {}

        class Decoded:
            texts = ["hello"]
            language = "en"
            chunks = []

        class FakePipe:
            def __init__(self, _model: str, _device: str) -> None:
                pass

            def generate(self, _speech: np.ndarray, **kwargs: object) -> Decoded:
                generated_kwargs.update(kwargs)
                return Decoded()

        with (
            mock.patch.dict(sys.modules, {"openvino_genai": SimpleNamespace(WhisperPipeline=FakePipe)}),
            mock.patch(
                "songcut.transcription.select_whisper_runtime",
                return_value=WhisperRuntime("openvino-genai", "cpu", "CPU", ["CPU"]),
            ),
            mock.patch("songcut.transcription.ensure_whisper_model", return_value=Path("model")),
            mock.patch("songcut.transcription.extract_segment_wav"),
            mock.patch("songcut.transcription.read_wav_mono_16k", return_value=np.zeros(16000, dtype=np.float32)),
        ):
            result = transcribe_segments(
                SimpleNamespace(ffmpeg=Path("ffmpeg")),
                Path("source.mp4"),
                [{"id": "seg-001", "start": 0.0, "end": 1.0}],
                model_key="tiny",
                requested_device="cpu",
                language="auto",
            )

        self.assertNotIn("language", generated_kwargs)
        self.assertEqual(result[0].model_id, "openai/whisper-tiny")

    def test_chunk_end_sentinel_is_clamped_to_segment_bounds(self) -> None:
        class Decoded:
            texts = ["hello"]
            language = "en"
            chunks = [SimpleNamespace(start_ts=0.0, end_ts=-1.0, text="hello")]

        class FakePipe:
            def __init__(self, _model: str, _device: str) -> None:
                pass

            def generate(self, _speech: np.ndarray, **_kwargs: object) -> Decoded:
                return Decoded()

        with (
            mock.patch.dict(sys.modules, {"openvino_genai": SimpleNamespace(WhisperPipeline=FakePipe)}),
            mock.patch(
                "songcut.transcription.select_whisper_runtime",
                return_value=WhisperRuntime("openvino-genai", "cpu", "CPU", ["CPU"]),
            ),
            mock.patch("songcut.transcription.ensure_whisper_model", return_value=Path("model")),
            mock.patch("songcut.transcription.extract_segment_wav"),
            mock.patch("songcut.transcription.read_wav_mono_16k", return_value=np.zeros(16000, dtype=np.float32)),
        ):
            result = transcribe_segments(
                SimpleNamespace(ffmpeg=Path("ffmpeg")),
                Path("source.mp4"),
                [{"id": "seg-002", "start": 2.0, "end": 4.0}],
                requested_device="cpu",
            )

        self.assertEqual(result[0].chunks[0].start, 2.0)
        self.assertEqual(result[0].chunks[0].end, 4.0)


if __name__ == "__main__":
    unittest.main()
