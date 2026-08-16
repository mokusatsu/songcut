from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from lossless_audio_gain import detect_media
from lossless_audio_gain.exceptions import UnsupportedFormatError


def require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("ffmpeg/ffprobe is not available")


@pytest.mark.integration
def test_detect_aac_lc_mp4(tmp_path: Path):
    require_ffmpeg()
    source = tmp_path / "test.m4a"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=0.1",
            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            str(source),
        ],
        check=True,
    )
    media = detect_media(source)
    assert media.codec == "aac"
    assert media.profile == "LC"
    assert media.audio_streams == 1


@pytest.mark.integration
def test_reject_raw_adts_aac(tmp_path: Path):
    require_ffmpeg()
    source = tmp_path / "test.aac"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=0.1",
            "-c:a",
            "aac",
            "-f",
            "adts",
            str(source),
        ],
        check=True,
    )
    with pytest.raises(UnsupportedFormatError, match="Raw/ADTS"):
        detect_media(source)


@pytest.mark.integration
def test_reject_multiple_audio_streams(tmp_path: Path):
    require_ffmpeg()
    source = tmp_path / "multi.m4a"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=500:duration=0.1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=0.1",
            "-map",
            "0:a",
            "-map",
            "1:a",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
    )
    with pytest.raises(UnsupportedFormatError, match="Exactly one audio stream"):
        detect_media(source)
