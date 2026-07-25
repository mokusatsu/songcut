from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from songcut.source_separation import separate_vocals


class _WritableStem:
    def __init__(self, value: float) -> None:
        self.values = np.array([value], dtype=np.float32)

    def clone(self) -> "_WritableStem":
        return _WritableStem(float(self.values[0]))

    def add_(self, other: "_WritableStem") -> "_WritableStem":
        self.values += other.values
        return self


class SourceSeparationTests(unittest.TestCase):
    def test_separate_vocals_saves_vocals_and_combined_non_vocal_stems(self) -> None:
        saved: dict[str, float] = {}

        class FakeSeparator:
            samplerate = 44100

            def __init__(self, **kwargs: object) -> None:
                self.callback = kwargs["callback"]

            def separate_audio_file(self, source: Path):
                self.callback({"state": "end"})
                return None, {
                    "vocals": _WritableStem(1.0),
                    "drums": _WritableStem(2.0),
                    "bass": _WritableStem(3.0),
                    "other": _WritableStem(4.0),
                }

        def fake_save_audio(stem, path, samplerate, **kwargs):
            target = Path(path)
            target.write_bytes(b"wav")
            saved[target.name] = float(stem.values[0])

        fake_api = types.SimpleNamespace(Separator=FakeSeparator, save_audio=fake_save_audio)
        fake_demucs = types.ModuleType("demucs")
        fake_demucs.api = fake_api

        with tempfile.TemporaryDirectory() as temporary_directory, mock.patch.dict(
            sys.modules,
            {"demucs": fake_demucs, "demucs.api": fake_api},
        ):
            progress: list[float] = []
            result = separate_vocals(
                Path("source.webm"),
                Path(temporary_directory),
                progress_callback=progress.append,
            )

        self.assertEqual(saved, {"vocals.wav": 1.0, "no_vocals.wav": 9.0})
        self.assertEqual(result.model, "htdemucs")
        self.assertEqual(progress[-1], 1.0)


if __name__ == "__main__":
    unittest.main()
