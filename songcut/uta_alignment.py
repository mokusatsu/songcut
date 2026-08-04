from __future__ import annotations

import importlib.util
import math
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

from .lyrics_alignment import (
    AlignedLyricsLine,
    LyricsDocument,
    WHISPER_AUDIO_SAMPLE_RATE,
    find_whisper_active_intervals,
    normalize_alignment_text,
)
from .ffmpeg_tools import find_ffmpeg, probe_duration
from .transcription import (
    DEFAULT_WHISPER_MODEL_KEY,
    ensure_whisper_model,
    extract_segment_wav,
    normalize_whisper_language,
    read_wav_mono_16k,
    select_whisper_runtime,
)


def _ensure_uta_align_path() -> None:
    if importlib.util.find_spec("uta_align") is not None:
        return
    candidates = [
        Path(__file__).resolve().parents[1] / "third_party" / "uta_align" / "src",
        Path(sys.executable).resolve().parent / "third_party" / "uta_align" / "src",
    ]
    for candidate in candidates:
        package = candidate / "uta_align" / "__init__.py"
        if package.is_file():
            value = str(candidate)
            if value not in sys.path:
                sys.path.insert(0, value)
            return
    raise RuntimeError("Uta-Align module was not found in third_party/uta_align.")


def _request_identifier(request: Any) -> str:
    return (
        f"{request.kind}:{request.start:.3f}-{request.end:.3f}:"
        f"{request.prompt_strategy}"
    )


@dataclass(frozen=True)
class UtaAlignmentOutput:
    title: str | None
    lines: list[AlignedLyricsLine]
    whisper_text: str
    duration: float
    device_used: str
    diagnostics: dict[str, Any]


class OpenVinoWhisperBackend:
    """Uta-Align backend using Songcut's selected OpenVINO Whisper model."""

    def __init__(
        self,
        *,
        model_key: str = DEFAULT_WHISPER_MODEL_KEY,
        device: str = "auto",
        language: str = "ja",
        progress_callback: Callable[[int], None] | None = None,
    ) -> None:
        _ensure_uta_align_path()
        try:
            import openvino_genai as ov_genai  # type: ignore
        except ImportError as exc:
            raise RuntimeError("openvino-genai is required for Uta-Align.") from exc

        self._observation_type = __import__(
            "uta_align.models", fromlist=["Observation"]
        ).Observation
        runtime = select_whisper_runtime(device)
        target_model = ensure_whisper_model(model_key=model_key)
        self._requested_device = device
        self._target_model = target_model
        self._ov_genai = ov_genai
        self._language_code, self._language_token = normalize_whisper_language(language)
        try:
            self._pipeline = self._create_pipeline(runtime.device_used)
            self.device_used = runtime.device_used
        except Exception:
            if device.lower() != "auto" or runtime.device_used == "CPU":
                raise
            self._pipeline = self._create_pipeline("CPU")
            self.device_used = "CPU"
        self._cpu_pipeline: Any | None = (
            self._pipeline if self.device_used == "CPU" else None
        )
        self._audio_cache: dict[Path, np.ndarray] = {}
        self._recognized_texts: list[str] = []
        self._progress_callback = progress_callback
        self._request_count = 0
        self._temporary_directory = tempfile.TemporaryDirectory(
            prefix="songcut-uta-whisper-"
        )

    @property
    def recognized_text(self) -> str:
        return " ".join(self._recognized_texts).strip()

    def _audio(self, path: str | Path) -> np.ndarray:
        resolved = Path(path).resolve()
        cached = self._audio_cache.get(resolved)
        if cached is None:
            try:
                cached = np.asarray(read_wav_mono_16k(resolved), dtype=np.float32)
            except ValueError:
                ffmpeg_paths = find_ffmpeg()
                duration = probe_duration(ffmpeg_paths.ffprobe, resolved)
                converted = (
                    Path(self._temporary_directory.name)
                    / f"input-{len(self._audio_cache):03d}.wav"
                )
                extract_segment_wav(
                    ffmpeg_paths.ffmpeg,
                    resolved,
                    converted,
                    start=0.0,
                    end=duration,
                )
                cached = np.asarray(read_wav_mono_16k(converted), dtype=np.float32)
            self._audio_cache[resolved] = cached
        return cached

    def transcribe(self, audio_path: str | Path, request: Any, config: Any) -> list[Any]:
        del config
        full_audio = self._audio(audio_path)
        request_start_sample = max(
            0,
            min(full_audio.size, int(round(float(request.start) * WHISPER_AUDIO_SAMPLE_RATE))),
        )
        request_end_sample = max(
            request_start_sample,
            min(full_audio.size, int(round(float(request.end) * WHISPER_AUDIO_SAMPLE_RATE))),
        )
        request_audio = full_audio[request_start_sample:request_end_sample]
        active_intervals = find_whisper_active_intervals(request_audio)
        observations: list[Any] = []
        for active_start, active_end in active_intervals:
            interval_audio = np.ascontiguousarray(request_audio[active_start:active_end])
            interval_offset = (
                request_start_sample + active_start
            ) / WHISPER_AUDIO_SAMPLE_RATE
            interval_duration = (active_end - active_start) / WHISPER_AUDIO_SAMPLE_RATE
            options: dict[str, object] = {
                "task": "transcribe",
                "return_timestamps": True,
                "word_timestamps": True,
            }
            if self._language_token:
                options["language"] = self._language_token
            initial_prompt = request.initial_prompt or request.prompt
            if initial_prompt and request.hotwords:
                raise ValueError("initial_prompt and hotwords cannot be used together")
            if initial_prompt:
                options["initial_prompt"] = initial_prompt
            elif request.hotwords:
                options["hotwords"] = request.hotwords

            decoded = self._generate(interval_audio, options)
            decoded_text = str(
                getattr(decoded, "texts", [""])[0]
                if hasattr(decoded, "texts")
                else decoded
            ).strip()
            if decoded_text:
                self._recognized_texts.append(decoded_text)

            chunks = getattr(decoded, "chunks", None) or []
            for chunk in chunks:
                text = str(getattr(chunk, "text", "")).strip()
                if not text:
                    continue
                start = interval_offset + _safe_timestamp(
                    getattr(chunk, "start_ts", None), 0.0, interval_duration
                )
                end = interval_offset + _safe_timestamp(
                    getattr(chunk, "end_ts", None), interval_duration, interval_duration
                )
                observations.append(
                    self._observation(
                        request,
                        start=start,
                        end=max(start, end),
                        text=text,
                        confidence=_decoded_confidence(chunk, 0.78),
                        boundary_support="segment",
                    )
                )

            words = getattr(decoded, "words", None) or []
            for word in words:
                text = str(
                    getattr(word, "word", getattr(word, "text", ""))
                ).strip()
                if not text:
                    continue
                start = interval_offset + _safe_timestamp(
                    getattr(word, "start_ts", None), 0.0, interval_duration
                )
                end = interval_offset + _safe_timestamp(
                    getattr(word, "end_ts", None), interval_duration, interval_duration
                )
                observations.append(
                    self._observation(
                        request,
                        start=start,
                        end=max(start, end),
                        text=text,
                        confidence=_decoded_confidence(word, 0.74),
                        boundary_support="word",
                    )
                )

        self._request_count += 1
        if self._progress_callback is not None:
            self._progress_callback(self._request_count)
        return observations

    def _create_pipeline(self, device: str) -> Any:
        return self._ov_genai.WhisperPipeline(
            str(self._target_model),
            device,
            word_timestamps=True,
        )

    def _generate(self, audio: np.ndarray, options: dict[str, object]) -> Any:
        try:
            return self._pipeline.generate(audio, **options)
        except Exception:
            if self._requested_device.lower() != "auto" or self.device_used == "CPU":
                raise
            if self._cpu_pipeline is None:
                self._cpu_pipeline = self._create_pipeline("CPU")
            result = self._cpu_pipeline.generate(audio, **options)
            self._pipeline = self._cpu_pipeline
            self.device_used = "CPU"
            return result

    def _observation(
        self,
        request: Any,
        *,
        start: float,
        end: float,
        text: str,
        confidence: float,
        boundary_support: str,
    ) -> Any:
        return self._observation_type(
            start=round(start, 3),
            end=round(end, 3),
            text=text,
            confidence=confidence,
            no_speech_prob=0.0,
            provenance=f"openvino-whisper:{request.kind}:{boundary_support}",
            request_kind=request.kind,
            boundary_support=boundary_support,
            request_id=_request_identifier(request),
            prompt_strategy=request.prompt_strategy,
            source_family=request.source_family,
            independence_group=request.independence_group,
            prompt_strategies=(request.prompt_strategy,),
            source_families=(request.source_family,),
            independence_groups=(request.independence_group,),
        )


def align_lyrics_with_uta(
    source: Path,
    vocal_stem: Path,
    document: LyricsDocument,
    *,
    model_key: str = DEFAULT_WHISPER_MODEL_KEY,
    device: str = "auto",
    language: str = "ja",
    progress_callback: Callable[[int], None] | None = None,
) -> UtaAlignmentOutput:
    _ensure_uta_align_path()
    from uta_align.config import AlignConfig
    from uta_align.lyrics import parse_lyrics_text
    from uta_align.pipeline import align_lyrics

    backend = OpenVinoWhisperBackend(
        model_key=model_key,
        device=device,
        language=language,
        progress_callback=progress_callback,
    )
    lyric_lines = parse_lyrics_text("\n".join(document.lines))
    language_code, _language_token = normalize_whisper_language(language)
    config = AlignConfig(
        model=model_key,
        language="ja" if language_code == "auto" else language_code,
        device=backend.device_used,
        use_vocal_stem_for_stt=True,
        input_audio_is_vocal_only=False,
    )
    result = align_lyrics(
        source,
        lyric_lines,
        backend,
        config=config,
        vocal_stem_path=vocal_stem,
    )
    lines: list[AlignedLyricsLine] = []
    for aligned in result.lines:
        normalized = normalize_alignment_text(aligned.text)
        total = len(normalized)
        matched = min(total, max(0, round(total * float(aligned.confidence))))
        lines.append(
            AlignedLyricsLine(
                index=int(aligned.index) + 1,
                text=aligned.text,
                start=round(float(aligned.start), 3),
                end=round(float(aligned.end), 3),
                confidence=round(float(aligned.confidence), 3),
                source="uta-align",
                matched_characters=matched,
                exact_characters=matched,
                total_characters=total,
            )
        )
    return UtaAlignmentOutput(
        title=document.title,
        lines=lines,
        whisper_text=backend.recognized_text,
        duration=float(result.duration),
        device_used=backend.device_used,
        diagnostics=result.diagnostics,
    )


def _safe_timestamp(value: object, default: float, duration: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number) or number < 0:
        return default
    return min(number, duration)


def _decoded_confidence(value: object, default: float) -> float:
    for name in ("probability", "confidence"):
        try:
            number = float(getattr(value, name))
        except (AttributeError, TypeError, ValueError):
            continue
        if math.isfinite(number):
            return min(1.0, max(0.0, number))
    return default
