from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from songcut.source_separation import (
    DEMUCS_DIRECTORY_NAME,
    DEMUCS_MODEL,
    DEMUCS_REQUIRED_FILES,
    DEMUCS_SEGMENT_SAMPLES,
    _torch_compatible_istft,
    _torch_compatible_stft,
    demucs_model_status,
    demucs_model_ready,
    separate_vocals,
    writable_demucs_model_dir,
)


class SourceSeparationTests(unittest.TestCase):
    def test_model_directory_uses_shared_songcut_model_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory, mock.patch.dict(
            "os.environ",
            {"SONGCUT_MODEL_DIR": temporary_directory},
            clear=False,
        ):
            self.assertEqual(
                writable_demucs_model_dir(),
                Path(temporary_directory) / "openvino" / DEMUCS_DIRECTORY_NAME,
            )

    def test_model_is_ready_only_when_xml_and_bin_are_nonempty(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory)
            for relative_path in DEMUCS_REQUIRED_FILES:
                path = target / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"model")
            self.assertTrue(demucs_model_ready(target))
            (target / DEMUCS_REQUIRED_FILES[1]).write_bytes(b"")
            self.assertFalse(demucs_model_ready(target))

    def test_model_status_reports_missing_download_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory, mock.patch.dict(
            "os.environ",
            {
                "SONGCUT_MODEL_DIR": temporary_directory,
                "SONGCUT_BUNDLED_MODEL_DIR": str(Path(temporary_directory) / "bundled"),
            },
            clear=False,
        ):
            status = demucs_model_status()

        self.assertFalse(status["ready"])
        self.assertIsNone(status["source"])
        self.assertEqual(
            Path(str(status["model_dir"])),
            Path(temporary_directory) / "openvino" / DEMUCS_DIRECTORY_NAME,
        )

    def test_spectrogram_frontend_has_openvino_model_shape_and_roundtrips(self) -> None:
        time = np.arange(DEMUCS_SEGMENT_SAMPLES, dtype=np.float32) / 44_100
        mix = np.stack(
            (
                0.1 * np.sin(2 * np.pi * 220 * time),
                0.1 * np.sin(2 * np.pi * 330 * time),
            )
        ).astype(np.float32)
        model_input = _torch_compatible_stft(mix)
        self.assertEqual(model_input.shape, (1, 4, 2_048, 336))
        pairs = model_input.reshape(1, 2, 2, 2_048, 336)[0]
        spectrum = pairs[:, 0] + 1j * pairs[:, 1]
        reconstructed = _torch_compatible_istft(
            spectrum[np.newaxis],
            DEMUCS_SEGMENT_SAMPLES,
        )[0]
        self.assertTrue(np.isfinite(reconstructed).all())
        self.assertLess(float(np.mean(np.abs(reconstructed - mix))), 0.002)

    def test_separate_vocals_writes_openvino_results(self) -> None:
        sample_count = 4_410
        decoded = np.zeros((2, sample_count), dtype=np.float32)
        decoded[0] = np.linspace(-0.2, 0.2, sample_count, dtype=np.float32)
        decoded[1] = decoded[0] * 0.8
        normalized_vocals = np.full((2, sample_count + 11_025), 0.25, dtype=np.float32)
        normalized_no_vocals = np.full((2, sample_count + 11_025), -0.25, dtype=np.float32)
        progress: list[float] = []

        fake_core = mock.Mock()
        fake_core.compile_model.return_value = mock.sentinel.compiled_model
        fake_openvino = mock.Mock()
        fake_openvino.Core.return_value = fake_core

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            model_dir = root / "model"
            model_xml = model_dir / "htdemucs_v4" / "htdemucs_fwd.xml"
            model_xml.parent.mkdir(parents=True)
            model_xml.write_text("xml", encoding="utf-8")
            with (
                mock.patch.dict("sys.modules", {"openvino": fake_openvino}),
                mock.patch("songcut.source_separation.ensure_demucs_model", return_value=model_dir),
                mock.patch("songcut.source_separation._decode_source", return_value=decoded),
                mock.patch(
                    "songcut.source_separation._separate_normalized_mix",
                    return_value=(normalized_vocals, normalized_no_vocals),
                ) as separate_mix,
            ):
                result = separate_vocals(
                    Path("source.mp4"),
                    root / "output",
                    progress_callback=progress.append,
                )

            self.assertEqual(result.model, DEMUCS_MODEL)
            self.assertTrue(result.vocals.is_file())
            self.assertTrue(result.no_vocals.is_file())
            self.assertEqual(progress[-1], 1.0)
            fake_core.compile_model.assert_called_once_with(model_xml, "CPU")
            passed_mix = separate_mix.call_args.args[1]
            self.assertEqual(passed_mix.shape[-1], sample_count + 11_025)


if __name__ == "__main__":
    unittest.main()
