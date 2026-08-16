from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from lossless_audio_gain import AAC_GAIN_STEP_DB, adjust_gain, measure_true_peak


@pytest.mark.integration
def test_aac_global_gain_with_real_mp3rgain(tmp_path: Path):
    if (
        shutil.which("ffmpeg") is None
        or shutil.which("ffprobe") is None
        or shutil.which("mp3rgain") is None
    ):
        pytest.skip("ffmpeg/ffprobe/mp3rgain is not available")

    source = tmp_path / "in.m4a"
    output = tmp_path / "out.m4a"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=997:sample_rate=48000:duration=0.5",
            "-filter:a",
            "volume=0.1",
            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            "-b:a",
            "160k",
            str(source),
        ],
        check=True,
    )

    before = measure_true_peak(source)
    result = adjust_gain(
        source,
        output,
        gain_db=AAC_GAIN_STEP_DB,
        verify=True,
    )
    after = measure_true_peak(output)

    assert result.applied_gain_db == pytest.approx(AAC_GAIN_STEP_DB, abs=1e-12)
    assert after - before == pytest.approx(AAC_GAIN_STEP_DB, abs=0.05)
    assert result.details["reversibility_checked"] is True
