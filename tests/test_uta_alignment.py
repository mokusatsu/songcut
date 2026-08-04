from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pytest

from songcut.uta_alignment import OpenVinoWhisperBackend
from uta_align import audio as uta_audio


def test_openvino_backend_uses_hotwords_word_timestamps_and_restores_offsets(
    tmp_path: Path,
) -> None:
    constructor_calls: list[tuple[str, str, dict[str, object]]] = []
    generate_calls: list[tuple[np.ndarray, dict[str, object]]] = []

    class FakePipeline:
        def __init__(self, model: str, device: str, **options: object) -> None:
            constructor_calls.append((model, device, options))

        def generate(self, audio: np.ndarray, **options: object) -> object:
            generate_calls.append((audio, options))
            return SimpleNamespace(
                chunks=[
                    SimpleNamespace(
                        start_ts=0.1,
                        end_ts=0.8,
                        text="歌詞",
                    )
                ],
                words=[
                    SimpleNamespace(
                        start_ts=0.2,
                        end_ts=0.5,
                        word="歌",
                    )
                ],
                texts=["歌詞"],
            )

    fake_openvino = SimpleNamespace(WhisperPipeline=FakePipeline)
    audio = np.zeros(13 * 16_000, dtype=np.float32)
    audio[11 * 16_000 : 12 * 16_000] = 0.02
    request = SimpleNamespace(
        start=10.0,
        end=13.0,
        kind="overlap",
        prompt=None,
        context_reset=True,
        prompt_strategy="local_hotwords",
        source_family="overlap_window",
        independence_group="group",
        initial_prompt=None,
        hotwords="歌詞",
    )

    with (
        mock.patch.dict(sys.modules, {"openvino_genai": fake_openvino}),
        mock.patch(
            "songcut.uta_alignment.select_whisper_runtime",
            return_value=SimpleNamespace(device_used="CPU"),
        ),
        mock.patch(
            "songcut.uta_alignment.ensure_whisper_model",
            return_value=tmp_path / "model",
        ),
        mock.patch(
            "songcut.uta_alignment.read_wav_mono_16k",
            return_value=audio,
        ),
    ):
        backend = OpenVinoWhisperBackend(
            model_key="whisper-large-v3-turbo-int8-ov",
            device="auto",
            language="ja",
        )
        observations = backend.transcribe(tmp_path / "vocals.wav", request, object())

    assert constructor_calls == [
        (
            str(tmp_path / "model"),
            "CPU",
            {"word_timestamps": True},
        )
    ]
    assert len(generate_calls) == 1
    assert generate_calls[0][0].shape == (16_000,)
    assert generate_calls[0][1]["word_timestamps"] is True
    assert generate_calls[0][1]["return_timestamps"] is True
    assert generate_calls[0][1]["hotwords"] == "歌詞"
    assert generate_calls[0][1]["language"] == "<|ja|>"
    assert [(item.boundary_support, item.start, item.end) for item in observations] == [
        ("segment", pytest.approx(11.1), pytest.approx(11.8)),
        ("word", pytest.approx(11.2), pytest.approx(11.5)),
    ]


def test_openvino_backend_converts_demucs_wav_to_mono_16k(tmp_path: Path) -> None:
    class FakePipeline:
        def __init__(self, _model: str, _device: str, **_options: object) -> None:
            pass

    converted_audio = np.zeros(16_000, dtype=np.float32)
    read_wav = mock.Mock(side_effect=[ValueError("44.1 kHz stereo"), converted_audio])
    extract = mock.Mock()
    fake_openvino = SimpleNamespace(WhisperPipeline=FakePipeline)

    with (
        mock.patch.dict(sys.modules, {"openvino_genai": fake_openvino}),
        mock.patch(
            "songcut.uta_alignment.select_whisper_runtime",
            return_value=SimpleNamespace(device_used="CPU"),
        ),
        mock.patch(
            "songcut.uta_alignment.ensure_whisper_model",
            return_value=tmp_path / "model",
        ),
        mock.patch("songcut.uta_alignment.read_wav_mono_16k", read_wav),
        mock.patch(
            "songcut.uta_alignment.find_ffmpeg",
            return_value=SimpleNamespace(ffmpeg="ffmpeg", ffprobe="ffprobe"),
        ),
        mock.patch("songcut.uta_alignment.probe_duration", return_value=1.0),
        mock.patch("songcut.uta_alignment.extract_segment_wav", extract),
    ):
        backend = OpenVinoWhisperBackend()
        result = backend._audio(tmp_path / "vocals.wav")

    assert result is converted_audio
    extract.assert_called_once()
    assert extract.call_args.kwargs["start"] == 0.0
    assert extract.call_args.kwargs["end"] == 1.0


def test_uta_ffmpeg_decoder_hides_the_windows_console(tmp_path: Path) -> None:
    completed = SimpleNamespace(
        returncode=0,
        stdout=np.zeros(16, dtype="<f4").tobytes(),
        stderr=b"",
    )
    with (
        mock.patch("uta_align.audio.shutil.which", return_value="ffmpeg.exe"),
        mock.patch("uta_align.audio.subprocess.run", return_value=completed) as run,
    ):
        samples, sample_rate = uta_audio._decode_ffmpeg(tmp_path / "source.mp4")

    assert sample_rate == 16_000
    assert samples.shape == (16,)
    assert run.call_args.kwargs["creationflags"] == uta_audio.CREATE_NO_WINDOW
