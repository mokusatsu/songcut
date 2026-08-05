"""Shared OpenVINO Whisper execution primitives.

The callers own how audio is partitioned and how decoded timestamps are mapped
to their domain objects.  This module owns only the inference boundary:
pipeline construction, ``auto`` device fallback, generation, and safe local
chunk timestamp normalization.
"""

from __future__ import annotations

import math
from copy import copy
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping


@dataclass(frozen=True)
class WhisperChunk:
    """A decoded chunk with timestamps relative to the submitted audio."""

    start: float
    end: float
    text: str


def _runtime_with_fallback(runtime: Any, *, message: str) -> Any:
    """Copy a runtime record while retaining compatibility with test doubles."""
    try:
        fallbacks = [*getattr(runtime, "fallbacks", []), message]
        return replace(runtime, device_used="CPU", fallbacks=fallbacks)
    except (TypeError, ValueError):
        # Existing callers use lightweight ``SimpleNamespace`` runtime fakes in
        # tests.  Copy mutable test doubles as well so ``session.runtime``
        # remains an honest view of the active device after fallback.
        try:
            copied = copy(runtime)
            copied.device_used = "CPU"
            copied.fallbacks = [*getattr(runtime, "fallbacks", []), message]
            return copied
        except (AttributeError, TypeError):
            # The session's own device state remains authoritative for immutable
            # compatibility doubles that cannot be copied with updated fields.
            return runtime


class WhisperExecutionSession:
    """Own one Whisper pipeline and its explicit device fallback contract.

    ``requested_device='auto'`` may fall back to CPU when either construction or
    generation on the selected accelerator fails.  A strict device request
    never creates a second CPU pipeline.  The session is deliberately agnostic
    to model selection and to caller-specific audio partitioning.
    """

    def __init__(
        self,
        *,
        model_path: Path,
        runtime: Any,
        requested_device: str,
        pipeline_factory: Callable[[str], Any],
        language_token: str | None = None,
    ) -> None:
        self.model_path = Path(model_path)
        self._runtime = runtime
        self._requested_device = str(requested_device).strip().lower()
        self._pipeline_factory = pipeline_factory
        self.language_token = language_token
        self._device_used = str(getattr(runtime, "device_used", "CPU"))
        self._pipeline: Any | None = None
        self._cpu_pipeline: Any | None = None
        self._fallbacks = list(getattr(runtime, "fallbacks", []))
        self._create_initial_pipeline()

    @classmethod
    def from_openvino(
        cls,
        *,
        model_path: Path,
        runtime: Any,
        requested_device: str,
        language_token: str | None = None,
        pipeline_options: Mapping[str, object] | None = None,
    ) -> "WhisperExecutionSession":
        """Build a session using the installed ``openvino_genai`` factory."""
        try:
            import openvino_genai as ov_genai  # type: ignore
        except ImportError:
            raise

        options = dict(pipeline_options or {})

        def factory(device: str) -> Any:
            return ov_genai.WhisperPipeline(str(model_path), device, **options)

        return cls(
            model_path=model_path,
            runtime=runtime,
            requested_device=requested_device,
            pipeline_factory=factory,
            language_token=language_token,
        )

    @property
    def runtime(self) -> Any:
        return self._runtime

    @property
    def backend(self) -> str:
        return str(getattr(self._runtime, "backend", "openvino-genai"))

    @property
    def device_used(self) -> str:
        return self._device_used

    @property
    def fallbacks(self) -> list[str]:
        return list(self._fallbacks)

    def _create_initial_pipeline(self) -> None:
        try:
            self._pipeline = self._pipeline_factory(self._device_used)
        except Exception as primary_exc:
            if self._requested_device != "auto" or self._device_used.upper() == "CPU":
                raise
            try:
                self._cpu_pipeline = self._pipeline_factory("CPU")
            except Exception as cpu_exc:
                raise RuntimeError(
                    f"{self._device_used} Whisper pipeline creation failed: {primary_exc}; "
                    f"CPU fallback failed: {cpu_exc}"
                ) from cpu_exc
            self._pipeline = self._cpu_pipeline
            self._mark_cpu_fallback(
                f"{self._device_used} Whisper pipeline creation failed; retried on CPU "
                f"({primary_exc.__class__.__name__})."
            )

    def _mark_cpu_fallback(self, message: str) -> None:
        previous_device = self._device_used
        self._device_used = "CPU"
        self._fallbacks.append(message)
        self._runtime = _runtime_with_fallback(self._runtime, message=message)
        if previous_device.upper() != "CPU":
            self._device_used = "CPU"

    def build_options(self, options: Mapping[str, object] | None = None) -> dict[str, object]:
        """Merge caller options and add the normalized language token once."""
        result = dict(options or {})
        if self.language_token and "language" not in result:
            result["language"] = self.language_token
        return result

    def generate(
        self,
        audio: Any,
        options: Mapping[str, object] | None = None,
        **kwargs: object,
    ) -> Any:
        """Generate one caller-defined audio unit with shared fallback semantics."""
        if options is not None and kwargs:
            raise TypeError("Pass generation options either as a mapping or keyword arguments, not both.")
        generation_options = self.build_options(options if options is not None else kwargs)
        if self._pipeline is None:  # pragma: no cover - guarded by construction
            self._create_initial_pipeline()
        try:
            return self._pipeline.generate(audio, **generation_options)
        except Exception as primary_exc:
            if self._requested_device != "auto" or self._device_used.upper() == "CPU":
                raise
            if self._cpu_pipeline is None:
                try:
                    self._cpu_pipeline = self._pipeline_factory("CPU")
                except Exception as cpu_exc:
                    raise RuntimeError(
                        f"{self._device_used} Whisper generation failed: {primary_exc}; "
                        f"CPU fallback failed: {cpu_exc}"
                    ) from cpu_exc
            try:
                decoded = self._cpu_pipeline.generate(audio, **generation_options)
            except Exception as cpu_exc:
                raise RuntimeError(
                    f"{self._device_used} Whisper generation failed: {primary_exc}; "
                    f"CPU fallback failed: {cpu_exc}"
                ) from cpu_exc
            previous_device = self._device_used
            self._pipeline = self._cpu_pipeline
            self._mark_cpu_fallback(
                f"{previous_device} Whisper generation failed; retried on CPU "
                f"({primary_exc.__class__.__name__})."
            )
            return decoded

    @staticmethod
    def normalize_chunks(
        chunks: Iterable[Any] | None,
        duration: float,
        *,
        text_attribute: str = "text",
    ) -> list[WhisperChunk]:
        """Normalize local chunk timestamps without applying caller offsets."""
        safe_duration = max(0.0, float(duration))
        normalized: list[WhisperChunk] = []
        for chunk in chunks or ():
            start = WhisperExecutionSession._safe_timestamp(
                getattr(chunk, "start_ts", None), 0.0, safe_duration
            )
            end = WhisperExecutionSession._safe_timestamp(
                getattr(chunk, "end_ts", None), safe_duration, safe_duration
            )
            end = max(start, end)
            if text_attribute == "word":
                value = getattr(chunk, "word", getattr(chunk, "text", ""))
            else:
                value = getattr(chunk, text_attribute, "")
            normalized.append(
                WhisperChunk(
                    # Keep raw local values here.  Callers apply their own
                    # absolute offset and preserve their existing rounding
                    # policy at the domain boundary.
                    start=start,
                    end=end,
                    text=str(value).strip(),
                )
            )
        return normalized

    def normalize_decoded_chunks(self, decoded: Any, duration: float) -> list[WhisperChunk]:
        return self.normalize_chunks(getattr(decoded, "chunks", None), duration)

    @staticmethod
    def _safe_timestamp(value: object, default: float, duration: float) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return default
        if not math.isfinite(number) or number < 0:
            return default
        return min(number, duration)


def create_whisper_execution_session(
    *,
    model_path: Path,
    runtime: Any,
    requested_device: str,
    language_token: str | None = None,
    pipeline_options: Mapping[str, object] | None = None,
) -> WhisperExecutionSession:
    """Functional alias used by callers that prefer factory-style composition."""
    return WhisperExecutionSession.from_openvino(
        model_path=model_path,
        runtime=runtime,
        requested_device=requested_device,
        language_token=language_token,
        pipeline_options=pipeline_options,
    )
