from __future__ import annotations

import wave
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture
def wav_factory(tmp_path: Path):
    def make(
        duration: float = 24.0,
        active: list[tuple[float, float]] | None = None,
        name: str = "audio.wav",
    ) -> Path:
        sample_rate = 8000
        times = np.arange(round(duration * sample_rate)) / sample_rate
        samples = np.zeros_like(times)
        for start, end in active or [(0.0, duration)]:
            mask = (times >= start) & (times < end)
            fade = np.minimum(
                np.clip((times - start) / 0.05, 0, 1),
                np.clip((end - times) / 0.05, 0, 1),
            )
            samples += mask * fade * 0.25 * np.sin(2 * np.pi * 220 * times)
        pcm = np.clip(samples * 32767, -32768, 32767).astype("<i2")
        path = tmp_path / name
        with wave.open(str(path), "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(sample_rate)
            writer.writeframes(pcm.tobytes())
        return path

    return make
