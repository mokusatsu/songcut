from __future__ import annotations

import os
import shutil
import tempfile
import win_safesubprocess as subprocess
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .ffmpeg_tools import FfmpegPaths
from .hardware import detect_openvino_devices


WHISPER_MODEL_ID = "openai/whisper-small"
WHISPER_MODEL_NAME = "whisper-small"
WHISPER_OPENVINO_REPO_ID = "OpenVINO/whisper-small-fp16-ov"
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class WhisperRuntime:
    backend: str
    device_requested: str
    device_used: str
    available_devices: list[str] = field(default_factory=list)
    fallbacks: list[str] = field(default_factory=list)
    note: str = ""


@dataclass(frozen=True)
class TranscriptChunk:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class SegmentTranscript:
    segment_id: str
    text: str
    language: str | None
    chunks: list[TranscriptChunk]
    backend: str
    device_used: str
    model_id: str
    error: str | None = None


def default_model_root() -> Path:
    base = os.environ.get("SONGCUT_MODEL_DIR")
    if base:
        return Path(base)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "songcut" / "models"
    return Path.home() / ".songcut" / "models"


def whisper_model_dir(model_name: str = WHISPER_MODEL_NAME) -> Path:
    return default_model_root() / "openvino" / model_name


def whisper_model_ready(model_dir: Path | None = None) -> bool:
    target = model_dir or whisper_model_dir()
    return (target / "openvino_encoder_model.xml").exists() and (target / "generation_config.json").exists()


def ensure_whisper_model(model_dir: Path | None = None, *, quantized_int8: bool = False) -> Path:
    target = model_dir or whisper_model_dir()
    if whisper_model_ready(target):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_target = target.with_name(f"{target.name}.downloading")
    if tmp_target.exists():
        shutil.rmtree(tmp_target)

    optimum = shutil.which("optimum-cli")
    if optimum:
        command = [
            optimum,
            "export",
            "openvino",
            "--trust-remote-code",
            "--model",
            WHISPER_MODEL_ID,
            str(tmp_target),
        ]
        if quantized_int8:
            command.extend(["--weight-format", "int8"])
        subprocess.run(command, check=True, creationflags=CREATE_NO_WINDOW)
    else:
        download_preconverted_whisper(tmp_target)

    if target.exists():
        shutil.rmtree(target)
    tmp_target.rename(target)
    return target


def download_preconverted_whisper(target: Path) -> None:
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError("huggingface-hub is required to download the OpenVINO Whisper model.") from exc

    snapshot_download(
        repo_id=WHISPER_OPENVINO_REPO_ID,
        local_dir=target,
        allow_patterns=[
            "*.json",
            "*.txt",
            "*.model",
            "*.xml",
            "*.bin",
            "*.tiktoken",
        ],
    )
    if not whisper_model_ready(target):
        raise RuntimeError(f"Downloaded {WHISPER_OPENVINO_REPO_ID}, but required OpenVINO Whisper files were not found.")


def select_whisper_runtime(requested: str = "auto") -> WhisperRuntime:
    requested = requested.lower()
    if requested not in {"auto", "npu", "gpu", "cpu"}:
        raise ValueError("Whisper device must be one of: auto, npu, gpu, cpu")
    devices, warning = detect_openvino_devices()
    upper_devices = {device.upper() for device in devices}
    fallbacks: list[str] = []
    if warning:
        fallbacks.append(warning)

    if requested == "auto":
        for candidate in ("NPU", "GPU", "CPU"):
            if candidate == "CPU" or candidate in upper_devices:
                return WhisperRuntime(
                    backend="openvino-genai",
                    device_requested=requested,
                    device_used=candidate,
                    available_devices=devices,
                    fallbacks=fallbacks,
                    note="Auto selected OpenVINO Whisper with NPU -> GPU -> CPU priority.",
                )

    strict = requested.upper()
    if strict == "CPU" or strict in upper_devices:
        return WhisperRuntime(
            backend="openvino-genai",
            device_requested=requested,
            device_used=strict,
            available_devices=devices,
            fallbacks=fallbacks,
            note=f"Strict OpenVINO Whisper device selected: {strict}.",
        )
    detail = warning or f"available OpenVINO devices: {devices or 'none'}"
    raise RuntimeError(f"{strict} was requested for Whisper but is not available ({detail}).")


def transcribe_segments(
    ffmpeg_paths: FfmpegPaths,
    source: Path,
    segments: list[dict[str, Any]],
    *,
    model_dir: Path | None = None,
    requested_device: str = "auto",
    language: str | None = "<|ja|>",
    initial_prompt: str | None = None,
    on_segment: Callable[[int, int, SegmentTranscript], None] | None = None,
) -> list[SegmentTranscript]:
    try:
        import openvino_genai as ov_genai  # type: ignore
    except Exception as exc:
        unavailable = [
            SegmentTranscript(
                segment_id=str(item.get("id", "")),
                text="",
                language=None,
                chunks=[],
                backend="openvino-genai",
                device_used="unavailable",
                model_id=WHISPER_MODEL_ID,
                error=f"openvino_genai unavailable: {exc.__class__.__name__}",
            )
            for item in segments
        ]
        if on_segment:
            for index, item in enumerate(unavailable, start=1):
                on_segment(index, len(unavailable), item)
        return unavailable

    runtime = select_whisper_runtime(requested_device)
    target_model = ensure_whisper_model(model_dir)
    pipe = ov_genai.WhisperPipeline(str(target_model), runtime.device_used)
    cpu_pipe: Any | None = None

    results: list[SegmentTranscript] = []
    with tempfile.TemporaryDirectory(prefix="songcut-whisper-") as tmp:
        tmp_dir = Path(tmp)
        for index, item in enumerate(segments, start=1):
            segment_id = str(item.get("id", ""))
            start = float(item.get("start", 0.0))
            end = float(item.get("end", start))
            wav_path = tmp_dir / f"{segment_id or len(results)}.wav"
            try:
                extract_segment_wav(ffmpeg_paths.ffmpeg, source, wav_path, start=start, end=end)
                raw_speech = read_wav_mono_16k(wav_path)
                kwargs: dict[str, Any] = {"task": "transcribe", "return_timestamps": True}
                if language:
                    kwargs["language"] = language
                if initial_prompt:
                    kwargs["initial_prompt"] = initial_prompt
                active_runtime = runtime
                try:
                    decoded = pipe.generate(raw_speech, **kwargs)
                except Exception as primary_exc:
                    if requested_device.lower() != "auto" or runtime.device_used == "CPU":
                        raise
                    if cpu_pipe is None:
                        cpu_pipe = ov_genai.WhisperPipeline(str(target_model), "CPU")
                    try:
                        decoded = cpu_pipe.generate(raw_speech, **kwargs)
                        active_runtime = WhisperRuntime(
                            backend=runtime.backend,
                            device_requested=runtime.device_requested,
                            device_used="CPU",
                            available_devices=runtime.available_devices,
                            fallbacks=[
                                *runtime.fallbacks,
                                f"{runtime.device_used} Whisper generation failed; retried on CPU ({primary_exc.__class__.__name__}).",
                            ],
                            note="Auto Whisper device fell back to CPU after generation failure.",
                        )
                    except Exception as cpu_exc:
                        raise RuntimeError(
                            f"{runtime.device_used} Whisper generation failed: {primary_exc}; CPU fallback failed: {cpu_exc}"
                        ) from cpu_exc
                chunks = [
                    TranscriptChunk(
                        start=round(start + float(chunk.start_ts), 3),
                        end=round(start + float(chunk.end_ts), 3),
                        text=str(chunk.text).strip(),
                    )
                    for chunk in (getattr(decoded, "chunks", None) or [])
                ]
                text = str(getattr(decoded, "texts", [""])[0] if hasattr(decoded, "texts") else decoded).strip()
                transcript = SegmentTranscript(
                    segment_id=segment_id,
                    text=text,
                    language=getattr(decoded, "language", None),
                    chunks=chunks,
                    backend=active_runtime.backend,
                    device_used=active_runtime.device_used,
                    model_id=WHISPER_MODEL_ID,
                )
            except Exception as exc:
                transcript = SegmentTranscript(
                    segment_id=segment_id,
                    text="",
                    language=None,
                    chunks=[],
                    backend=runtime.backend,
                    device_used=runtime.device_used,
                    model_id=WHISPER_MODEL_ID,
                    error=str(exc),
                )
            results.append(transcript)
            if on_segment:
                on_segment(index, len(segments), transcript)
    return results


def extract_segment_wav(ffmpeg: Path, source: Path, target: Path, *, start: float, end: float) -> None:
    duration = max(0.01, end - start)
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(target),
    ]
    subprocess.run(command, check=True, creationflags=CREATE_NO_WINDOW)


def read_wav_mono_16k(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        if channels != 1 or sample_width != 2 or sample_rate != 16000:
            raise ValueError("Whisper input WAV must be mono signed 16-bit PCM at 16 kHz.")
        raw = wav.readframes(wav.getnframes())
    values = []
    for index in range(0, len(raw), 2):
        sample = int.from_bytes(raw[index : index + 2], "little", signed=True)
        values.append(max(-1.0, min(1.0, sample / 32768.0)))
    return np.asarray(values, dtype=np.float32)
