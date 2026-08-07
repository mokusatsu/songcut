from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from songcut.whisper_execution import WhisperExecutionSession


def runtime(device: str) -> SimpleNamespace:
    return SimpleNamespace(
        backend="openvino-genai",
        device_requested="auto" if device != "CPU" else "cpu",
        device_used=device,
        available_devices=[device, "CPU"],
        fallbacks=[],
        note="",
    )


def test_session_factory_selects_runtime_device_and_adds_language_token() -> None:
    created: list[str] = []

    class FakePipeline:
        def __init__(self, device: str) -> None:
            created.append(device)

        def generate(self, _audio: np.ndarray, **options: object) -> object:
            return SimpleNamespace(options=options)

    session = WhisperExecutionSession(
        model_path=Path("model"),
        runtime=runtime("GPU"),
        requested_device="auto",
        pipeline_factory=FakePipeline,
        language_token="<|ja|>",
    )

    decoded = session.generate(np.zeros(160, dtype=np.float32), task="transcribe")

    assert created == ["GPU"]
    assert decoded.options["language"] == "<|ja|>"
    assert decoded.options["task"] == "transcribe"
    assert session.device_used == "GPU"


def test_auto_constructor_failure_retries_once_on_cpu() -> None:
    created: list[str] = []

    def factory(device: str) -> object:
        created.append(device)
        if device == "GPU":
            raise RuntimeError("GPU unavailable")
        return SimpleNamespace(generate=lambda _audio, **_options: "cpu-result")

    session = WhisperExecutionSession(
        model_path=Path("model"),
        runtime=runtime("GPU"),
        requested_device="auto",
        pipeline_factory=factory,
    )

    assert created == ["GPU", "CPU"]
    assert session.device_used == "CPU"
    assert session.generate(np.zeros(160, dtype=np.float32)) == "cpu-result"
    assert any("pipeline creation failed" in message for message in session.fallbacks)


def test_auto_generation_failure_retries_on_cpu_and_reuses_cpu_pipeline() -> None:
    created: list[str] = []

    class FakePipeline:
        def __init__(self, device: str) -> None:
            self.device = device
            created.append(device)

        def generate(self, _audio: np.ndarray, **_options: object) -> str:
            if self.device == "GPU":
                raise RuntimeError("GPU generation failed")
            return "cpu-result"

    session = WhisperExecutionSession(
        model_path=Path("model"),
        runtime=runtime("GPU"),
        requested_device="auto",
        pipeline_factory=FakePipeline,
    )

    assert session.generate(np.zeros(160, dtype=np.float32)) == "cpu-result"
    assert session.generate(np.zeros(160, dtype=np.float32)) == "cpu-result"
    assert created == ["GPU", "CPU"]
    assert session.device_used == "CPU"
    assert any("generation failed" in message for message in session.fallbacks)


def test_strict_generation_failure_does_not_create_cpu_pipeline() -> None:
    created: list[str] = []

    class FakePipeline:
        def __init__(self, device: str) -> None:
            created.append(device)

        def generate(self, _audio: np.ndarray, **_options: object) -> object:
            raise RuntimeError("GPU generation failed")

    session = WhisperExecutionSession(
        model_path=Path("model"),
        runtime=runtime("GPU"),
        requested_device="gpu",
        pipeline_factory=FakePipeline,
    )

    with pytest.raises(RuntimeError, match="GPU generation failed"):
        session.generate(np.zeros(160, dtype=np.float32))

    assert created == ["GPU"]
    assert session.device_used == "GPU"


def test_strict_constructor_failure_does_not_create_cpu_pipeline() -> None:
    created: list[str] = []

    def factory(device: str) -> object:
        created.append(device)
        raise RuntimeError("GPU constructor failed")

    with pytest.raises(RuntimeError, match="GPU constructor failed"):
        WhisperExecutionSession(
            model_path=Path("model"),
            runtime=runtime("GPU"),
            requested_device="gpu",
            pipeline_factory=factory,
        )

    assert created == ["GPU"]


def test_chunk_normalization_keeps_relative_timestamps_and_clamps_sentinel() -> None:
    chunks = WhisperExecutionSession.normalize_chunks(
        [
            SimpleNamespace(start_ts=0.1254, end_ts=-1.0, text="歌詞"),
            SimpleNamespace(start_ts=-1.0, end_ts=99.0, text="次"),
        ],
        2.0,
    )

    assert [(chunk.start, chunk.end, chunk.text) for chunk in chunks] == [
        (pytest.approx(0.1254), 2.0, "歌詞"),
        (0.0, 2.0, "次"),
    ]


def test_word_normalization_accepts_word_attribute() -> None:
    chunks = WhisperExecutionSession.normalize_chunks(
        [SimpleNamespace(start_ts=0.2, end_ts=0.5, word="歌")],
        1.0,
        text_attribute="word",
    )

    assert chunks[0].text == "歌"
    assert chunks[0].start == 0.2
    assert chunks[0].end == 0.5
