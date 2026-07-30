from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .config import AlignConfig
from .models import BoundarySupport, Observation, TranscriptionRequest

_BOUNDARY_SUPPORT_VALUES = frozenset({"word", "segment", "line", "unknown"})


def _request_identifier(request: TranscriptionRequest) -> str:
    return (
        f"{request.kind}:{request.start:.3f}-{request.end:.3f}:"
        f"{request.prompt_strategy}"
    )


def _boundary_support(value: object, *, default: BoundarySupport) -> BoundarySupport:
    if value is None:
        return default
    if not isinstance(value, str) or value not in _BOUNDARY_SUPPORT_VALUES:
        raise ValueError(
            "boundary_support must be one of: word, segment, line, unknown"
        )
    if value == "word":
        return "word"
    if value == "segment":
        return "segment"
    if value == "line":
        return "line"
    return "unknown"


class Backend(Protocol):
    def transcribe(
        self,
        audio_path: str | Path,
        request: TranscriptionRequest,
        config: AlignConfig,
    ) -> list[Observation]: ...


@dataclass(frozen=True)
class _ScriptedRecord:
    observation: Observation
    visible_in: frozenset[str] | None


class JsonBackend:
    """Deterministic backend for reproducible runs and model-free tests.

    Timestamps in the JSON file are absolute. ``visible_in`` can restrict a record
    to request kinds, which makes missing-head retry regressions deterministic.
    """

    def __init__(self, path: str | Path):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        records = raw["observations"] if isinstance(raw, dict) else raw
        if not isinstance(records, list):
            raise ValueError("JSON backend expects an observations array")
        self._records: list[_ScriptedRecord] = []
        for item in records:
            if not isinstance(item, dict):
                raise ValueError("each JSON observation must be an object")
            visible = item.get("visible_in")
            visible_in = frozenset(str(x) for x in visible) if visible is not None else None
            self._records.append(
                _ScriptedRecord(
                    Observation(
                        start=float(item["start"]),
                        end=float(item["end"]),
                        text=str(item["text"]),
                        confidence=float(item.get("confidence", 0.8)),
                        no_speech_prob=float(item.get("no_speech_prob", 0.0)),
                        provenance=str(item.get("provenance", "json")),
                        request_kind="json",
                        boundary_support=_boundary_support(
                            item.get("boundary_support"),
                            default="segment",
                        ),
                    ),
                    visible_in,
                )
            )

    def transcribe(
        self,
        audio_path: str | Path,
        request: TranscriptionRequest,
        config: AlignConfig,
    ) -> list[Observation]:
        del audio_path, config
        result: list[Observation] = []
        for record in self._records:
            observation = record.observation
            if record.visible_in is not None and request.kind not in record.visible_in:
                continue
            if observation.end <= request.start or observation.start >= request.end:
                continue
            result.append(
                Observation(
                    start=observation.start,
                    end=observation.end,
                    text=observation.text,
                    confidence=observation.confidence,
                    no_speech_prob=observation.no_speech_prob,
                    provenance=f"{observation.provenance}:{request.kind}",
                    request_kind=request.kind,
                    boundary_support=observation.boundary_support,
                    request_id=_request_identifier(request),
                    prompt_strategy=request.prompt_strategy,
                    source_family=request.source_family,
                    independence_group=request.independence_group,
                    prompt_strategies=(request.prompt_strategy,),
                    source_families=(request.source_family,),
                    independence_groups=(request.independence_group,),
                )
            )
        return result


class FakeBackend:
    """In-memory deterministic backend intended for unit tests and embedding."""

    def __init__(
        self,
        observations: list[Observation],
        visible_in: dict[int, set[str]] | None = None,
    ):
        self.observations = observations
        self.visible_in = visible_in or {}
        self.requests: list[TranscriptionRequest] = []

    def transcribe(
        self,
        audio_path: str | Path,
        request: TranscriptionRequest,
        config: AlignConfig,
    ) -> list[Observation]:
        del audio_path, config
        self.requests.append(request)
        result: list[Observation] = []
        for index, observation in enumerate(self.observations):
            allowed = self.visible_in.get(index)
            if allowed is not None and request.kind not in allowed:
                continue
            if observation.end <= request.start or observation.start >= request.end:
                continue
            result.append(
                Observation(
                    start=observation.start,
                    end=observation.end,
                    text=observation.text,
                    confidence=observation.confidence,
                    no_speech_prob=observation.no_speech_prob,
                    provenance=f"{observation.provenance}:{request.kind}",
                    request_kind=request.kind,
                    boundary_support=observation.boundary_support,
                    request_id=_request_identifier(request),
                    prompt_strategy=request.prompt_strategy,
                    source_family=request.source_family,
                    independence_group=request.independence_group,
                    prompt_strategies=(request.prompt_strategy,),
                    source_families=(request.source_family,),
                    independence_groups=(request.independence_group,),
                )
            )
        return result


class FasterWhisperBackend:
    """Lazy faster-whisper backend with word timestamps and absolute clip times."""

    def __init__(self) -> None:
        self._model: Any = None
        self._model_key: tuple[str, str, str] | None = None

    def _get_model(self, config: AlignConfig) -> Any:
        key = (config.model, config.device, config.compute_type)
        if self._model is not None and self._model_key == key:
            return self._model
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise RuntimeError(
                "faster-whisper is not installed; install with `pip install uta-align[whisper]`"
            ) from error
        self._model = WhisperModel(
            config.model,
            device=config.device,
            compute_type=config.compute_type,
        )
        self._model_key = key
        return self._model

    def transcribe(
        self,
        audio_path: str | Path,
        request: TranscriptionRequest,
        config: AlignConfig,
    ) -> list[Observation]:
        model = self._get_model(config)
        kwargs: dict[str, Any] = {
            "language": config.language,
            "beam_size": config.beam_size,
            "word_timestamps": True,
            "condition_on_previous_text": not request.context_reset,
            "clip_timestamps": f"{request.start:.3f},{request.end:.3f}",
            "vad_filter": False,
        }
        initial_prompt = request.initial_prompt or request.prompt
        if initial_prompt and request.hotwords:
            raise ValueError(
                "initial_prompt and hotwords cannot be used together"
            )
        if initial_prompt:
            kwargs["initial_prompt"] = initial_prompt
        elif request.hotwords:
            kwargs["hotwords"] = request.hotwords
        segments, _ = model.transcribe(str(audio_path), **kwargs)
        observations: list[Observation] = []
        for segment in segments:
            probability = float(math.exp(min(0.0, float(segment.avg_logprob))))
            no_speech = float(segment.no_speech_prob)
            words = list(segment.words or [])
            # Keep the model segment boundary as a second, broader timing hypothesis.
            # Sung vowels often extend well beyond the lexical word timestamp.
            observations.append(
                Observation(
                    start=float(segment.start),
                    end=float(segment.end),
                    text=str(segment.text),
                    confidence=probability,
                    no_speech_prob=no_speech,
                    provenance=f"faster-whisper:{request.kind}:segment",
                    request_kind=request.kind,
                    boundary_support="segment",
                    request_id=_request_identifier(request),
                    prompt_strategy=request.prompt_strategy,
                    source_family=request.source_family,
                    independence_group=request.independence_group,
                    prompt_strategies=(request.prompt_strategy,),
                    source_families=(request.source_family,),
                    independence_groups=(request.independence_group,),
                )
            )
            if words:
                for word in words:
                    observations.append(
                        Observation(
                            start=float(word.start),
                            end=float(word.end),
                            text=str(word.word),
                            confidence=float(getattr(word, "probability", probability)),
                            no_speech_prob=no_speech,
                            provenance=f"faster-whisper:{request.kind}:word",
                            request_kind=request.kind,
                            boundary_support="word",
                            request_id=_request_identifier(request),
                            prompt_strategy=request.prompt_strategy,
                            source_family=request.source_family,
                            independence_group=request.independence_group,
                    prompt_strategies=(request.prompt_strategy,),
                    source_families=(request.source_family,),
                    independence_groups=(request.independence_group,),
                        )
                    )
        return observations
