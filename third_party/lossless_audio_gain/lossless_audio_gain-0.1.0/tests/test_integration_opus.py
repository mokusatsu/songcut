from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from lossless_audio_gain import measure_true_peak, normalize_true_peak


@pytest.mark.integration
def test_opus_true_peak_normalization(tmp_path: Path):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not available")
    source = tmp_path / "in.opus"
    output = tmp_path / "out.opus"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=1",
            "-filter:a",
            "volume=0.2",
            "-c:a",
            "libopus",
            "-b:a",
            "96k",
            str(source),
        ],
        check=True,
    )
    before = measure_true_peak(source)
    result = normalize_true_peak(source, output, target_true_peak_dbtp=-12.0)
    after = measure_true_peak(output)
    assert result.reencoded is False
    assert before < -12.0
    assert after <= -12.0 + 0.08
    assert after >= -12.0 - 0.10
