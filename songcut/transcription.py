from __future__ import annotations

import math
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


@dataclass(frozen=True)
class WhisperModelSpec:
    key: str
    display_name: str
    model_id: str
    openvino_repo_id: str
    directory_name: str
    speed: str
    quality: str


WHISPER_MODELS: dict[str, WhisperModelSpec] = {
    "tiny": WhisperModelSpec(
        key="tiny",
        display_name="Tiny",
        model_id="openai/whisper-tiny",
        openvino_repo_id="OpenVINO/whisper-tiny-fp16-ov",
        directory_name="whisper-tiny",
        speed="Fastest",
        quality="Basic",
    ),
    "base": WhisperModelSpec(
        key="base",
        display_name="Base",
        model_id="openai/whisper-base",
        openvino_repo_id="OpenVINO/whisper-base-fp16-ov",
        directory_name="whisper-base",
        speed="Balanced",
        quality="Good",
    ),
    "small": WhisperModelSpec(
        key="small",
        display_name="Small",
        model_id="openai/whisper-small",
        openvino_repo_id="OpenVINO/whisper-small-fp16-ov",
        directory_name="whisper-small",
        speed="Slower",
        quality="Best",
    ),
}

# Backward-compatible aliases for callers that assumed the only model was Small.
WHISPER_MODEL_ID = WHISPER_MODELS["small"].model_id
WHISPER_MODEL_NAME = WHISPER_MODELS["small"].directory_name
WHISPER_OPENVINO_REPO_ID = WHISPER_MODELS["small"].openvino_repo_id

# The multilingual Whisper vocabulary. The API exposes stable language codes and
# converts them to OpenVINO GenAI's token form only at the inference boundary.
WHISPER_LANGUAGES: dict[str, str] = {
    "en": "English", "zh": "Chinese", "de": "German", "es": "Spanish", "ru": "Russian",
    "ko": "Korean", "fr": "French", "ja": "Japanese", "pt": "Portuguese", "tr": "Turkish",
    "pl": "Polish", "ca": "Catalan", "nl": "Dutch", "ar": "Arabic", "sv": "Swedish",
    "it": "Italian", "id": "Indonesian", "hi": "Hindi", "fi": "Finnish", "vi": "Vietnamese",
    "he": "Hebrew", "uk": "Ukrainian", "el": "Greek", "ms": "Malay", "cs": "Czech",
    "ro": "Romanian", "da": "Danish", "hu": "Hungarian", "ta": "Tamil", "no": "Norwegian",
    "th": "Thai", "ur": "Urdu", "hr": "Croatian", "bg": "Bulgarian", "lt": "Lithuanian",
    "la": "Latin", "mi": "Maori", "ml": "Malayalam", "cy": "Welsh", "sk": "Slovak",
    "te": "Telugu", "fa": "Persian", "lv": "Latvian", "bn": "Bengali", "sr": "Serbian",
    "az": "Azerbaijani", "sl": "Slovenian", "kn": "Kannada", "et": "Estonian",
    "mk": "Macedonian", "br": "Breton", "eu": "Basque", "is": "Icelandic", "hy": "Armenian",
    "ne": "Nepali", "mn": "Mongolian", "bs": "Bosnian", "kk": "Kazakh", "sq": "Albanian",
    "sw": "Swahili", "gl": "Galician", "mr": "Marathi", "pa": "Punjabi", "si": "Sinhala",
    "km": "Khmer", "sn": "Shona", "yo": "Yoruba", "so": "Somali", "af": "Afrikaans",
    "oc": "Occitan", "ka": "Georgian", "be": "Belarusian", "tg": "Tajik", "sd": "Sindhi",
    "gu": "Gujarati", "am": "Amharic", "yi": "Yiddish", "lo": "Lao", "uz": "Uzbek",
    "fo": "Faroese", "ht": "Haitian Creole", "ps": "Pashto", "tk": "Turkmen",
    "nn": "Nynorsk", "mt": "Maltese", "sa": "Sanskrit", "lb": "Luxembourgish",
    "my": "Myanmar", "bo": "Tibetan", "tl": "Tagalog", "mg": "Malagasy", "as": "Assamese",
    "tt": "Tatar", "haw": "Hawaiian", "ln": "Lingala", "ha": "Hausa", "ba": "Bashkir",
    "jw": "Javanese", "su": "Sundanese", "yue": "Cantonese",
}
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


def _absolute_chunk_bounds(segment_start: float, segment_end: float, chunk: Any) -> tuple[float, float]:
    """Convert relative timestamps, including OpenVINO's -1 end sentinel, to safe media times."""
    duration = max(0.0, segment_end - segment_start)

    def bounded(value: Any, default: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return default
        if not math.isfinite(number) or number < 0:
            return default
        return min(number, duration)

    relative_start = bounded(getattr(chunk, "start_ts", None), 0.0)
    relative_end = bounded(getattr(chunk, "end_ts", None), duration)
    relative_end = max(relative_start, relative_end)
    return round(segment_start + relative_start, 3), round(segment_start + relative_end, 3)


def default_model_root() -> Path:
    base = os.environ.get("SONGCUT_MODEL_DIR")
    if base:
        return Path(base)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "songcut" / "models"
    return Path.home() / ".songcut" / "models"


def bundled_model_root() -> Path | None:
    base = os.environ.get("SONGCUT_BUNDLED_MODEL_DIR")
    return Path(base) if base else None


def huggingface_cache_dir() -> Path:
    configured = os.environ.get("HF_HOME")
    root = Path(configured) if configured else default_model_root().parent / "hf-home"
    return root / "hub"


def require_whisper_model(model_key: str = "small") -> WhisperModelSpec:
    normalized = model_key.strip().lower()
    try:
        return WHISPER_MODELS[normalized]
    except KeyError as exc:
        supported = ", ".join(WHISPER_MODELS)
        raise ValueError(f"Whisper model must be one of: {supported}") from exc


def whisper_model_dir(model_name: str = WHISPER_MODEL_NAME) -> Path:
    """Return a writable model directory (legacy model-name API retained)."""
    return default_model_root() / "openvino" / model_name


def writable_whisper_model_dir(model_key: str = "small") -> Path:
    return whisper_model_dir(require_whisper_model(model_key).directory_name)


def bundled_whisper_model_dir(model_key: str = "small") -> Path | None:
    root = bundled_model_root()
    if root is None:
        return None
    return root / "openvino" / require_whisper_model(model_key).directory_name


def resolve_whisper_model_dir(model_key: str = "small") -> tuple[Path, str] | None:
    writable = writable_whisper_model_dir(model_key)
    if whisper_model_ready(writable):
        return writable, "downloaded"
    bundled = bundled_whisper_model_dir(model_key)
    if bundled is not None and whisper_model_ready(bundled):
        return bundled, "bundled"
    return None


def whisper_model_ready(model_dir: Path | None = None) -> bool:
    target = model_dir or whisper_model_dir()
    return (target / "openvino_encoder_model.xml").exists() and (target / "generation_config.json").exists()


def ensure_whisper_model(
    model_dir: Path | None = None,
    *,
    model_key: str = "small",
    quantized_int8: bool = False,
) -> Path:
    del quantized_int8  # The selectable models are fixed official FP16 artifacts.
    spec = require_whisper_model(model_key)
    if model_dir is None:
        resolved = resolve_whisper_model_dir(model_key)
        if resolved is not None:
            return resolved[0]
    target = model_dir or writable_whisper_model_dir(model_key)
    if whisper_model_ready(target):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_target = target.with_name(f"{target.name}.downloading")
    if tmp_target.exists():
        shutil.rmtree(tmp_target)

    download_preconverted_whisper(tmp_target, repo_id=spec.openvino_repo_id)

    if target.exists():
        shutil.rmtree(target)
    tmp_target.rename(target)
    return target


def download_preconverted_whisper(target: Path, *, repo_id: str = WHISPER_OPENVINO_REPO_ID) -> None:
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError("huggingface-hub is required to download the OpenVINO Whisper model.") from exc

    snapshot_download(
        repo_id=repo_id,
        local_dir=target,
        cache_dir=huggingface_cache_dir(),
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
        raise RuntimeError(f"Downloaded {repo_id}, but required OpenVINO Whisper files were not found.")


def directory_size(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    except OSError:
        return None


def whisper_model_statuses() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key, spec in WHISPER_MODELS.items():
        resolved = resolve_whisper_model_dir(key)
        path, source = resolved if resolved is not None else (writable_whisper_model_dir(key), None)
        rows.append(
            {
                "key": key,
                "display_name": spec.display_name,
                "model_id": spec.model_id,
                "repo_id": spec.openvino_repo_id,
                "ready": resolved is not None,
                "source": source,
                "model_dir": str(path),
                "installed_bytes": directory_size(path) if resolved is not None else None,
                "speed": spec.speed,
                "quality": spec.quality,
            }
        )
    return rows


def whisper_language_options() -> list[dict[str, str]]:
    pinned = ["ja", "en", "zh", "ko"]
    rows = [{"code": "auto", "label": "Auto detect"}]
    rows.extend({"code": code, "label": WHISPER_LANGUAGES[code]} for code in pinned)
    rows.extend(
        {"code": code, "label": label}
        for code, label in sorted(WHISPER_LANGUAGES.items(), key=lambda item: item[1])
        if code not in pinned
    )
    return rows


def normalize_whisper_language(language: str | None) -> tuple[str, str | None]:
    """Return the stable project/API code and the OpenVINO token."""
    if language is None or not str(language).strip() or str(language).strip().lower() == "auto":
        return "auto", None
    value = str(language).strip().lower()
    if value.startswith("<|") and value.endswith("|>"):
        value = value[2:-2]
    if value not in WHISPER_LANGUAGES:
        raise ValueError(f"Unsupported Whisper language code: {value}")
    return value, f"<|{value}|>"


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
    model_key: str = "small",
    requested_device: str = "auto",
    language: str | None = "<|ja|>",
    initial_prompt: str | None = None,
    on_segment: Callable[[int, int, SegmentTranscript], None] | None = None,
) -> list[SegmentTranscript]:
    spec = require_whisper_model(model_key)
    _language_code, language_token = normalize_whisper_language(language)
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
                model_id=spec.model_id,
                error=f"openvino_genai unavailable: {exc.__class__.__name__}",
            )
            for item in segments
        ]
        if on_segment:
            for index, item in enumerate(unavailable, start=1):
                on_segment(index, len(unavailable), item)
        return unavailable

    runtime = select_whisper_runtime(requested_device)
    target_model = ensure_whisper_model(model_dir, model_key=model_key)
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
                if language_token:
                    kwargs["language"] = language_token
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
                chunks = []
                for chunk in (getattr(decoded, "chunks", None) or []):
                    chunk_start, chunk_end = _absolute_chunk_bounds(start, end, chunk)
                    chunks.append(
                        TranscriptChunk(
                            start=chunk_start,
                            end=chunk_end,
                            text=str(chunk.text).strip(),
                        )
                    )
                text = str(getattr(decoded, "texts", [""])[0] if hasattr(decoded, "texts") else decoded).strip()
                transcript = SegmentTranscript(
                    segment_id=segment_id,
                    text=text,
                    language=getattr(decoded, "language", None),
                    chunks=chunks,
                    backend=active_runtime.backend,
                    device_used=active_runtime.device_used,
                    model_id=spec.model_id,
                )
            except Exception as exc:
                transcript = SegmentTranscript(
                    segment_id=segment_id,
                    text="",
                    language=None,
                    chunks=[],
                    backend=runtime.backend,
                    device_used=runtime.device_used,
                    model_id=spec.model_id,
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
