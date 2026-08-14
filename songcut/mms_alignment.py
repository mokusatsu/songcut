from __future__ import annotations

import json
import math
import shutil
import re
import tempfile
import threading
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Mapping, Sequence

import numpy as np

from .ffmpeg_tools import find_ffmpeg, probe_duration
from .lyrics_elements import (
    CtcTokenSpan,
    DisplayAlignmentResult,
    align_display_elements,
    attach_token_ranges,
    map_pronunciation_to_tokens,
    split_display_elements,
)
from .transcription import (
    _download_progress_tqdm,
    bundled_model_root,
    default_model_root,
    directory_size,
    extract_segment_wav,
    huggingface_cache_dir,
    read_wav_mono_16k,
)

if TYPE_CHECKING:
    from .lyrics_alignment import AlignedLyricsLine, LyricsAlignmentResult, LyricsDocument


MMS_ONNX_REPO_ID = "onnx-community/mms-300m-1130-forced-aligner-ONNX"
MMS_MODEL = "mms-300m-1130-forced-aligner-q4"
MMS_DIRECTORY_NAME = "mms-300m-1130-forced-aligner"
MMS_DEFAULT_VARIANT = "q4"
MMS_ONNX_MODEL_FILES = {
    "q4": ("onnx/model_q4.onnx", 241_000_000),
    "int8": ("onnx/model_int8.onnx", 317_000_000),
    "fp16": ("onnx/model_fp16.onnx", 632_000_000),
}
MMS_ONNX_AUXILIARY_FILES = (
    "config.json",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "vocab.json",
)
MMS_SAMPLE_RATE = 16_000
MMS_INPUTS_TO_LOGITS_RATIO = 320

# Whisper uses ISO 639-1-like codes while the forced aligner's Uroman
# preprocessing accepts ISO 639-3. Keep this explicit and dependency-free so
# project files remain stable when language packages are upgraded.
WHISPER_TO_MMS_LANGUAGE = {
    "ja": "jpn",
    "en": "eng",
    "ko": "kor",
    "zh": "cmn",
    "de": "deu",
    "fr": "fra",
    "es": "spa",
    "it": "ita",
    "pt": "por",
    "ru": "rus",
    "ar": "ara",
    "hi": "hin",
    "id": "ind",
    "th": "tha",
    "vi": "vie",
}


@dataclass(frozen=True)
class PreparedLyricsLine:
    index: int
    text: str
    romanized: str
    token_ids: tuple[int, ...]
    token_coverage: float
    token_texts: tuple[str, ...] = ()


@dataclass(frozen=True)
class CtcLineSpan:
    index: int
    text: str
    start: float
    end: float
    confidence: float
    token_count: int
    token_coverage: float


@dataclass(frozen=True)
class CtcAlignmentResult:
    lines: list[CtcLineSpan]
    frame_seconds: float
    path_score: float
    star_ratio: float
    tokens: tuple[CtcTokenSpan, ...] = ()


@dataclass(frozen=True)
class MmsRefinementDiagnostics:
    applied_line_indexes: list[int]
    candidate_line_count: int
    first_reliable_whisper_line: int | None
    path_score: float
    star_ratio: float
    variant: str
    device_used: str = "CPU"


@dataclass(frozen=True)
class StandardDisplayAlignmentResult:
    """既存の行補正と表示素詳細タイミングを一度のMMS推論で返す。"""

    alignment: LyricsAlignmentResult
    diagnostics: MmsRefinementDiagnostics
    elements_by_line: dict[int, DisplayAlignmentResult]


@dataclass(frozen=True)
class MmsStandardAlignmentContext:
    """初回MMS推論をopening補正と行内詳細解析で共有する内部context。"""

    alignment: LyricsAlignmentResult
    diagnostics: MmsRefinementDiagnostics
    prepared_lines: tuple[PreparedLyricsLine, ...]
    vocabulary: Mapping[str, int]
    frame_seconds: float
    emissions: np.ndarray = field(repr=False)
    audio: np.ndarray | None = field(default=None, repr=False)


def normalize_whisper_to_mms_language(language: str | None) -> str:
    value = str(language or "").strip().lower()
    if value.startswith("<|") and value.endswith("|>"):
        value = value[2:-2]
    if value in {"", "auto"}:
        raise ValueError("A detected Whisper language is required for MMS alignment.")
    if len(value) == 3:
        return value
    try:
        return WHISPER_TO_MMS_LANGUAGE[value]
    except KeyError as exc:
        raise ValueError(f"No MMS/Uroman language mapping is registered for Whisper language: {value}") from exc


def writable_mms_onnx_model_dir() -> Path:
    return default_model_root() / "onnx" / MMS_DIRECTORY_NAME


def bundled_mms_onnx_model_dir() -> Path | None:
    root = bundled_model_root()
    return root / "onnx" / MMS_DIRECTORY_NAME if root is not None else None


def mms_onnx_model_path(model_dir: Path | None = None, *, variant: str = "q4") -> Path:
    try:
        relative_path, _expected_bytes = MMS_ONNX_MODEL_FILES[variant]
    except KeyError as exc:
        supported = ", ".join(MMS_ONNX_MODEL_FILES)
        raise ValueError(f"Unsupported MMS ONNX variant '{variant}'. Choose one of: {supported}") from exc
    return (model_dir or writable_mms_onnx_model_dir()) / relative_path


def mms_onnx_model_ready(
    model_dir: Path,
    *,
    variant: str = MMS_DEFAULT_VARIANT,
) -> bool:
    try:
        required = (
            mms_onnx_model_path(model_dir, variant=variant),
            *(model_dir / filename for filename in MMS_ONNX_AUXILIARY_FILES),
        )
        return all(path.is_file() and path.stat().st_size > 0 for path in required)
    except OSError:
        return False


def resolve_mms_onnx_model_dir(
    *,
    variant: str = MMS_DEFAULT_VARIANT,
) -> tuple[Path, str] | None:
    writable = writable_mms_onnx_model_dir()
    if mms_onnx_model_ready(writable, variant=variant):
        return writable, "downloaded"
    bundled = bundled_mms_onnx_model_dir()
    if bundled is not None and mms_onnx_model_ready(bundled, variant=variant):
        return bundled, "bundled"
    return None


def mms_onnx_model_status(
    *,
    variant: str = MMS_DEFAULT_VARIANT,
) -> dict[str, str | bool | int | None]:
    resolved = resolve_mms_onnx_model_dir(variant=variant)
    model_dir, source = (
        resolved if resolved is not None else (writable_mms_onnx_model_dir(), None)
    )
    return {
        "model": MMS_MODEL,
        "variant": variant,
        "repo_id": MMS_ONNX_REPO_ID,
        "ready": resolved is not None,
        "source": source,
        "model_dir": str(model_dir),
        "installed_bytes": directory_size(model_dir) if resolved is not None else None,
    }


def download_mms_onnx_model(
    target: Path,
    *,
    variant: str = MMS_DEFAULT_VARIANT,
    progress_callback: Callable[[int, int], None] | None = None,
) -> None:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError("huggingface-hub is required to download the MMS ONNX model.") from exc

    relative_path, _expected_bytes = MMS_ONNX_MODEL_FILES[variant]
    allow_patterns = [relative_path, *MMS_ONNX_AUXILIARY_FILES]
    dry_run_files = snapshot_download(
        repo_id=MMS_ONNX_REPO_ID,
        local_dir=target,
        cache_dir=huggingface_cache_dir(),
        allow_patterns=allow_patterns,
        tqdm_class=_download_progress_tqdm(None),
        dry_run=True,
    )
    total_bytes = sum(int(file.file_size) for file in dry_run_files)
    if progress_callback is not None:
        progress_callback(0, total_bytes)

    def report(downloaded_bytes: int, _dynamic_total: int) -> None:
        if progress_callback is not None:
            progress_callback(min(downloaded_bytes, total_bytes), total_bytes)

    snapshot_download(
        repo_id=MMS_ONNX_REPO_ID,
        local_dir=target,
        cache_dir=huggingface_cache_dir(),
        allow_patterns=allow_patterns,
        tqdm_class=_download_progress_tqdm(report),
    )
    if progress_callback is not None:
        progress_callback(total_bytes, total_bytes)
    if not mms_onnx_model_ready(target, variant=variant):
        raise RuntimeError(f"Downloaded {MMS_ONNX_REPO_ID}, but the MMS Q4 model is incomplete.")


def ensure_mms_onnx_model(
    model_dir: Path | None = None,
    *,
    variant: str = "q4",
    progress_callback: Callable[[int, int], None] | None = None,
) -> Path:
    if model_dir is None:
        resolved = resolve_mms_onnx_model_dir(variant=variant)
        if resolved is not None:
            return mms_onnx_model_path(resolved[0], variant=variant)
    target_dir = model_dir or writable_mms_onnx_model_dir()
    if mms_onnx_model_ready(target_dir, variant=variant):
        return mms_onnx_model_path(target_dir, variant=variant)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_target = target_dir.with_name(f"{target_dir.name}.downloading")
    if temporary_target.exists():
        shutil.rmtree(temporary_target)
    download_mms_onnx_model(
        temporary_target,
        variant=variant,
        progress_callback=progress_callback,
    )
    if target_dir.exists():
        shutil.rmtree(target_dir)
    temporary_target.rename(target_dir)
    return mms_onnx_model_path(target_dir, variant=variant)


def load_mms_vocabulary(model_dir: Path) -> dict[str, int]:
    path = model_dir / "vocab.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"MMS vocabulary must be a JSON object: {path}")
    vocabulary = {str(token): int(index) for token, index in payload.items()}
    if not vocabulary:
        raise ValueError(f"MMS vocabulary is empty: {path}")
    return vocabulary


def _default_romanize(text: str, language: str) -> str:
    if language == "jpn":
        try:
            from pykakasi import kakasi
        except ImportError as exc:
            raise RuntimeError(
                "pykakasi is required to convert Japanese lyrics to their spoken reading."
            ) from exc
        return "".join(str(item["hepburn"]) for item in kakasi().convert(text))
    try:
        from uroman import Uroman
    except ImportError as exc:
        raise RuntimeError("uroman is required to prepare multilingual MMS alignment text.") from exc
    return str(Uroman().romanize_string(text, lcode=language))


def normalize_romanized_text(text: str) -> str:
    lowered = text.casefold()
    lowered = re.sub(r"[^a-z' ]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def prepare_lyrics_lines(
    lines: Sequence[str],
    *,
    language: str,
    vocabulary: Mapping[str, int],
    romanize: Callable[[str, str], str] | None = None,
) -> list[PreparedLyricsLine]:
    mms_language = normalize_whisper_to_mms_language(language)
    romanizer = romanize or _default_romanize
    prepared: list[PreparedLyricsLine] = []
    for index, text in enumerate(lines, start=1):
        romanized = normalize_romanized_text(romanizer(text, mms_language))
        alignable = [character for character in romanized if not character.isspace()]
        token_texts = tuple(character for character in alignable if character in vocabulary)
        token_ids = tuple(vocabulary[character] for character in token_texts)
        coverage = len(token_ids) / max(1, len(alignable))
        prepared.append(
            PreparedLyricsLine(
                index=index,
                text=text,
                romanized=romanized,
                token_ids=token_ids,
                token_coverage=coverage,
                token_texts=token_texts,
            )
        )
    return prepared


def log_softmax(values: np.ndarray, *, axis: int = -1) -> np.ndarray:
    array = np.asarray(values, dtype=np.float32)
    maximum = np.max(array, axis=axis, keepdims=True)
    shifted = array - maximum
    return shifted - np.log(np.sum(np.exp(shifted), axis=axis, keepdims=True))


class MmsOnnxRunner:
    def __init__(
        self,
        model_path: Path,
        *,
        providers: Sequence[str] = ("CPUExecutionProvider",),
        device: str = "auto",
        session: object | None = None,
    ) -> None:
        self._session = session
        self._compiled_model: object | None = None
        self.device_used = "CPU"
        if session is not None:
            self._input_name = str(session.get_inputs()[0].name)
        else:
            try:
                import openvino as ov
            except ImportError as exc:
                raise RuntimeError("OpenVINO is required for MMS alignment.") from exc
            normalized_device = device.strip().upper() or "AUTO"
            if normalized_device not in {"AUTO", "GPU", "CPU"}:
                raise ValueError("MMS device must be one of: auto, gpu, cpu")
            core = ov.Core()
            reported_devices = getattr(core, "available_devices", ("CPU",))
            if not isinstance(reported_devices, (list, tuple, set, frozenset)):
                reported_devices = ("CPU",)
            available_devices = {str(item).upper() for item in reported_devices}
            candidates = ("GPU", "CPU") if normalized_device == "AUTO" else (normalized_device,)
            errors: list[str] = []
            for candidate in candidates:
                if candidate != "CPU" and candidate not in available_devices:
                    errors.append(f"{candidate} is not available")
                    continue
                try:
                    self._compiled_model = core.compile_model(str(model_path), candidate)
                    self.device_used = candidate
                    break
                except Exception as exc:
                    errors.append(f"{candidate}: {exc}")
                    if normalized_device != "AUTO":
                        raise RuntimeError(f"MMS could not be compiled for {candidate}: {exc}") from exc
            if self._compiled_model is None:
                raise RuntimeError(f"MMS has no usable OpenVINO device ({'; '.join(errors)}).")

    def emissions(self, audio: np.ndarray) -> np.ndarray:
        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            raise ValueError("MMS input audio is empty.")
        variance = float(np.var(samples))
        normalized = (samples - float(np.mean(samples))) / math.sqrt(variance + 1e-7)
        if self._session is not None:
            outputs = self._session.run(None, {self._input_name: normalized[np.newaxis, :]})
            logits = np.asarray(outputs[0], dtype=np.float32)
        else:
            assert self._compiled_model is not None
            outputs = self._compiled_model([normalized[np.newaxis, :]])
            logits = np.asarray(next(iter(outputs.values())), dtype=np.float32)
        if logits.ndim != 3 or logits.shape[0] != 1:
            raise ValueError(f"Unexpected MMS ONNX logits shape: {logits.shape}")
        return log_softmax(logits[0])


_MMS_RUNNER_POOL_LOCK = threading.Lock()
_MMS_INFERENCE_LOCK = threading.Lock()
_MMS_RUNNER_POOL: dict[tuple[str, str], MmsOnnxRunner] = {}


def _pooled_mms_runner(model_path: Path, *, device: str) -> MmsOnnxRunner:
    """局所再解析間でcompile済みMMS runnerを再利用する。"""

    key = (str(model_path.resolve()), device.strip().lower() or "auto")
    with _MMS_RUNNER_POOL_LOCK:
        runner = _MMS_RUNNER_POOL.get(key)
        if runner is None:
            runner = MmsOnnxRunner(model_path, device=device)
            _MMS_RUNNER_POOL[key] = runner
        return runner


def align_prepared_lines(
    log_probabilities: np.ndarray,
    lines: Sequence[PreparedLyricsLine],
    *,
    blank_id: int = 0,
    frame_seconds: float = MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE,
    time_offset: float = 0.0,
    star_between_lines: bool = True,
) -> CtcAlignmentResult:
    emissions = np.asarray(log_probabilities, dtype=np.float32)
    if emissions.ndim != 2 or emissions.shape[0] == 0 or emissions.shape[1] < 2:
        raise ValueError("CTC emissions must have shape [frames, vocabulary].")
    usable_lines = [line for line in lines if line.token_ids]
    if not usable_lines:
        raise ValueError("Lyrics do not contain any MMS-alignable tokens.")

    star_id = emissions.shape[1]
    extended_emissions = np.concatenate(
        (emissions, np.zeros((emissions.shape[0], 1), dtype=np.float32)),
        axis=1,
    )
    targets: list[int] = [star_id]
    target_line_indexes: list[int | None] = [None]
    target_token_metadata: list[tuple[int, int, int, str] | None] = [None]
    token_index = 0
    for line_position, line in enumerate(usable_lines):
        for local_index, token_id in enumerate(line.token_ids):
            targets.append(token_id)
            target_line_indexes.append(line.index)
            token_text = (
                line.token_texts[local_index]
                if local_index < len(line.token_texts)
                else str(token_id)
            )
            target_token_metadata.append((token_index, token_id, line.index, token_text))
            token_index += 1
        if star_between_lines or line_position == len(usable_lines) - 1:
            targets.append(star_id)
            target_line_indexes.append(None)
            target_token_metadata.append(None)

    state_path, frame_scores = _ctc_viterbi_path(
        extended_emissions,
        targets,
        blank_id=blank_id,
    )
    token_spans: list[CtcTokenSpan] = []
    for target_position, metadata in enumerate(target_token_metadata):
        if metadata is None:
            continue
        token_number, token_id, line_index, token_text = metadata
        frames = np.flatnonzero(state_path == 2 * target_position + 1)
        if frames.size == 0:
            continue
        # Confidence is evidence for this token, not the cumulative Viterbi
        # score accumulated before reaching it.  Using ``frame_scores`` here
        # made otherwise clear tokens later in a real song exponentially less
        # confident merely because more audio preceded them.
        selected_scores = emissions[frames, token_id]
        confidence = math.exp(min(0.0, float(np.mean(selected_scores))))
        token_spans.append(
            CtcTokenSpan(
                token_index=token_number,
                token_id=token_id,
                token_text=token_text,
                line_index=line_index,
                start=round(time_offset + int(frames[0]) * frame_seconds, 3),
                end=round(time_offset + (int(frames[-1]) + 1) * frame_seconds, 3),
                confidence=round(confidence, 4),
            )
        )

    line_lookup = {line.index: line for line in usable_lines}
    output: list[CtcLineSpan] = []
    for line_index, line in line_lookup.items():
        line_tokens = [token for token in token_spans if token.line_index == line_index]
        if not line_tokens:
            continue
        output.append(
            CtcLineSpan(
                index=line.index,
                text=line.text,
                start=min(token.start for token in line_tokens),
                end=max(token.end for token in line_tokens),
                confidence=round(
                    sum(token.confidence for token in line_tokens) / len(line_tokens),
                    4,
                ),
                token_count=len(line.token_ids),
                token_coverage=round(line.token_coverage, 4),
            )
        )

    star_states = {
        2 * position + 1
        for position, line_index in enumerate(target_line_indexes)
        if line_index is None
    }
    star_frames = int(np.count_nonzero(np.isin(state_path, list(star_states))))
    return CtcAlignmentResult(
        lines=output,
        frame_seconds=frame_seconds,
        path_score=float(np.mean(frame_scores)),
        star_ratio=star_frames / len(state_path),
        tokens=tuple(token_spans),
    )


def _ctc_viterbi_path(
    log_probabilities: np.ndarray,
    targets: Sequence[int],
    *,
    blank_id: int,
) -> tuple[np.ndarray, np.ndarray]:
    emissions = np.asarray(log_probabilities, dtype=np.float32)
    if not targets:
        raise ValueError("CTC targets must not be empty.")
    if min(targets) < 0 or max(targets) >= emissions.shape[1]:
        raise ValueError("CTC target token is outside the emission vocabulary.")

    expanded = np.full(2 * len(targets) + 1, blank_id, dtype=np.int64)
    expanded[1::2] = np.asarray(targets, dtype=np.int64)
    frame_count, _class_count = emissions.shape
    state_count = expanded.size
    if frame_count < len(targets) + sum(
        left == right for left, right in zip(targets, targets[1:])
    ):
        raise ValueError("CTC emission is too short for the target sequence.")

    negative_infinity = np.float32(-np.inf)
    previous = np.full(state_count, negative_infinity, dtype=np.float32)
    backpointers = np.full((frame_count, state_count), -1, dtype=np.int32)
    previous[0] = emissions[0, blank_id]
    previous[1] = emissions[0, expanded[1]]
    backpointers[0, 0] = 0
    backpointers[0, 1] = 1

    for frame in range(1, frame_count):
        current = np.full(state_count, negative_infinity, dtype=np.float32)
        for state in range(state_count):
            best_previous = state
            best_score = previous[state]
            if state > 0 and previous[state - 1] > best_score:
                best_previous = state - 1
                best_score = previous[state - 1]
            if (
                state > 1
                and expanded[state] != blank_id
                and expanded[state] != expanded[state - 2]
                and previous[state - 2] > best_score
            ):
                best_previous = state - 2
                best_score = previous[state - 2]
            if np.isfinite(best_score):
                current[state] = best_score + emissions[frame, expanded[state]]
                backpointers[frame, state] = best_previous
        previous = current

    final_candidates = (state_count - 1, state_count - 2)
    final_state = max(final_candidates, key=lambda state: previous[state])
    if not np.isfinite(previous[final_state]):
        raise ValueError("No valid CTC alignment path was found.")

    state_path = np.empty(frame_count, dtype=np.int32)
    state = final_state
    for frame in range(frame_count - 1, -1, -1):
        state_path[frame] = state
        if frame:
            state = int(backpointers[frame, state])
            if state < 0:
                raise ValueError("CTC alignment backtrace is incomplete.")
    frame_scores = emissions[np.arange(frame_count), expanded[state_path]]
    return state_path, frame_scores.astype(np.float32, copy=False)


def merge_mms_onset_into_standard_alignment(
    alignment: LyricsAlignmentResult,
    ctc_alignment: CtcAlignmentResult,
    *,
    reliable_confidence: float = 0.45,
    minimum_advance_seconds: float = 0.25,
) -> tuple[LyricsAlignmentResult, MmsRefinementDiagnostics]:
    """Use MMS only for the opening region that Whisper did not anchor reliably."""
    candidates = {line.index: line for line in ctc_alignment.lines}
    first_reliable_position = next(
        (
            position
            for position, line in enumerate(alignment.lines)
            if line.source == "whisper-chunk" and line.confidence >= reliable_confidence
        ),
        None,
    )
    first_reliable_index = (
        alignment.lines[first_reliable_position].index
        if first_reliable_position is not None
        else None
    )
    eligible_end = (
        first_reliable_position if first_reliable_position is not None else len(alignment.lines) - 1
    )
    merged: list[AlignedLyricsLine] = []
    applied: list[int] = []
    for position, line in enumerate(alignment.lines):
        candidate = candidates.get(line.index)
        if candidate is None or position > eligible_end:
            merged.append(line)
            continue
        if first_reliable_position is not None and position == first_reliable_position:
            if candidate.start > line.start - minimum_advance_seconds:
                merged.append(line)
                continue
            merged.append(
                replace(
                    line,
                    start=max(0.0, candidate.start),
                    source="whisper-chunk+mms-onset",
                )
            )
            applied.append(line.index)
            continue

        next_start = (
            alignment.lines[position + 1].start
            if position + 1 < len(alignment.lines)
            else max(candidate.end, line.end)
        )
        start = max(0.0, candidate.start)
        end = max(start + 0.05, min(candidate.end, next_start))
        merged.append(
            replace(
                line,
                start=start,
                end=end,
                confidence=max(line.confidence, candidate.confidence),
                source="mms-ctc",
            )
        )
        applied.append(line.index)

    return (
        replace(alignment, lines=merged),
        MmsRefinementDiagnostics(
            applied_line_indexes=applied,
            candidate_line_count=len(candidates),
            first_reliable_whisper_line=first_reliable_index,
            path_score=ctc_alignment.path_score,
            star_ratio=ctc_alignment.star_ratio,
            variant=MMS_DEFAULT_VARIANT,
        ),
    )


def prepare_standard_alignment_with_mms(
    vocals_path: Path,
    document: LyricsDocument,
    alignment: LyricsAlignmentResult,
    *,
    language: str,
    device: str = "auto",
    progress_callback: Callable[[float], None] | None = None,
) -> MmsStandardAlignmentContext:
    """MMSを一度だけ実行し、行補正と後続の局所表示素解析用contextを作る。"""

    resolved = resolve_mms_onnx_model_dir()
    if resolved is None:
        raise RuntimeError(
            "The MMS forced-alignment model is not installed. "
            "Download it from Settings before running Songcut-Align."
        )
    model_dir, _source = resolved
    if progress_callback is not None:
        progress_callback(0.05)
    vocabulary = load_mms_vocabulary(model_dir)
    prepared = prepare_lyrics_lines(
        document.lines,
        language=language,
        vocabulary=vocabulary,
    )
    audio = read_media_mono_16k(vocals_path)
    if progress_callback is not None:
        progress_callback(0.15)
    runner = MmsOnnxRunner(mms_onnx_model_path(model_dir), device=device)
    with _MMS_INFERENCE_LOCK:
        emissions = runner.emissions(audio)
    if progress_callback is not None:
        progress_callback(0.85)
    frame_seconds = MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE
    ctc_alignment = align_prepared_lines(
        emissions,
        prepared,
        blank_id=int(vocabulary.get("<blank>", 0)),
        frame_seconds=frame_seconds,
    )
    refined, diagnostics = merge_mms_onset_into_standard_alignment(
        alignment,
        ctc_alignment,
    )
    if progress_callback is not None:
        progress_callback(1.0)
    return MmsStandardAlignmentContext(
        alignment=refined,
        diagnostics=replace(diagnostics, device_used=runner.device_used),
        prepared_lines=tuple(prepared),
        vocabulary=dict(vocabulary),
        frame_seconds=frame_seconds,
        emissions=emissions,
        audio=audio,
    )


def detect_silence_intervals(
    audio: np.ndarray,
    *,
    time_offset: float = 0.0,
    sample_rate: int = MMS_SAMPLE_RATE,
    frame_seconds: float = 0.02,
    hop_seconds: float = 0.01,
    minimum_silence_seconds: float = 0.15,
    relative_threshold_db: float = 25.0,
) -> tuple[tuple[float, float], ...]:
    """短い歌唱窓から、blank候補となる正時間長の無音区間を返す。

    絶対音量ではなく窓内95 percentileからの相対dBを使い、録音level差を
    吸収する。150ms未満の無声子音や瞬間的な谷はblankにしない。
    """

    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    frame_size = max(1, int(round(frame_seconds * sample_rate)))
    hop_size = max(1, int(round(hop_seconds * sample_rate)))
    if samples.size < frame_size:
        return ()
    rms = np.asarray(
        [
            math.sqrt(float(np.mean(np.square(samples[offset : offset + frame_size]))) + 1e-12)
            for offset in range(0, samples.size - frame_size + 1, hop_size)
        ],
        dtype=np.float64,
    )
    levels = 20.0 * np.log10(rms + 1e-9)
    threshold = float(np.percentile(levels, 95)) - relative_threshold_db
    inactive = levels <= threshold
    minimum_frames = max(1, int(math.ceil(minimum_silence_seconds / hop_seconds)))
    intervals: list[tuple[float, float]] = []
    position = 0
    while position < inactive.size:
        if not inactive[position]:
            position += 1
            continue
        start = position
        while position < inactive.size and inactive[position]:
            position += 1
        if position - start < minimum_frames:
            continue
        interval_start = time_offset + start * hop_seconds
        interval_end = time_offset + (position - 1) * hop_seconds + frame_seconds
        if interval_end - interval_start >= minimum_silence_seconds:
            intervals.append((interval_start, interval_end))
    return tuple(intervals)


def align_standard_display_elements(
    context: MmsStandardAlignmentContext,
    lines: Sequence[AlignedLyricsLine],
    *,
    language: str,
    reliable_confidence: float = 0.45,
    normal_padding_seconds: float = 0.75,
    low_confidence_padding_seconds: float = 1.5,
    progress_callback: Callable[[float], None] | None = None,
) -> dict[int, DisplayAlignmentResult]:
    """最終行境界を固定し、共有emissions上で各行の局所CTCを実行する。"""

    if normal_padding_seconds < 0 or low_confidence_padding_seconds < normal_padding_seconds:
        raise ValueError("Display alignment padding must be non-negative and ordered.")
    prepared_by_index = {line.index: line for line in context.prepared_lines}
    mms_language = normalize_whisper_to_mms_language(language)
    media_end = context.emissions.shape[0] * context.frame_seconds
    output: dict[int, DisplayAlignmentResult] = {}
    for position, line in enumerate(lines):
        seeds = split_display_elements(
            line.text,
            line_id=line.index,
            language=mms_language,
            romanize=_default_romanize,
        )
        mappings = map_pronunciation_to_tokens(seeds, context.vocabulary)
        seeds = attach_token_ranges(seeds, mappings)
        padding = (
            low_confidence_padding_seconds
            if line.confidence < reliable_confidence or not line.source.startswith("whisper-chunk")
            else normal_padding_seconds
        )
        window_start = max(0.0, line.start - padding)
        window_end = min(media_end, line.end + padding)
        next_position = next(
            (
                candidate_position
                for candidate_position in range(position + 1, len(lines))
                if lines[candidate_position].confidence >= reliable_confidence
                and lines[candidate_position].source.startswith("whisper-chunk")
                and lines[candidate_position].index in prepared_by_index
            ),
            None,
        )
        target_prepared = prepared_by_index.get(line.index)
        local_tokens: tuple[CtcTokenSpan, ...] = ()
        observed_star_ratio: float | None = None
        next_anchor = lines[next_position].start if next_position is not None else None
        next_anchor_candidate: float | None = None
        if target_prepared is not None and target_prepared.token_ids and window_end > window_start:
            local_lines = [target_prepared]
            if next_position is not None:
                next_prepared = prepared_by_index[lines[next_position].index]
                # Only the first trusted token cluster is needed as the next
                # anchor. Requiring an entire following lyric line inside a
                # 0.75s anchor window forces impossible CTC paths for long
                # lines and falsely rejects an otherwise good target line.
                local_lines.append(
                    replace(
                        next_prepared,
                        token_ids=next_prepared.token_ids[:3],
                        token_texts=next_prepared.token_texts[:3],
                    )
                )
                window_end = min(
                    media_end,
                    max(window_end, lines[next_position].start + normal_padding_seconds),
                )
            frame_start = max(0, int(math.floor(window_start / context.frame_seconds)))
            frame_end = min(
                context.emissions.shape[0],
                int(math.ceil(window_end / context.frame_seconds)),
            )
            try:
                local_ctc = align_prepared_lines(
                    context.emissions[frame_start:frame_end],
                    local_lines,
                    blank_id=int(context.vocabulary.get("<blank>", 0)),
                    frame_seconds=context.frame_seconds,
                    time_offset=frame_start * context.frame_seconds,
                    star_between_lines=True,
                )
                local_tokens = tuple(
                    token for token in local_ctc.tokens if token.line_index == line.index
                )
                observed_star_ratio = local_ctc.star_ratio
                if next_position is not None:
                    next_span = next(
                        (
                            span
                            for span in local_ctc.lines
                            if span.index == lines[next_position].index
                        ),
                        None,
                    )
                    next_anchor_candidate = next_span.start if next_span is not None else None
            except ValueError:
                # 窓が短い、またはCTC pathが成立しない行はline-proportionalへ落とす。
                local_tokens = ()
        output[line.index] = align_display_elements(
            seeds,
            local_tokens,
            line_start=line.start,
            line_end=line.end,
            mappings=mappings,
            line_id=line.index,
            parent_revision=line.display_element_revision,
            start_locked=line.start_locked,
            end_locked=line.end_locked,
            next_anchor=next_anchor,
            next_anchor_candidate=next_anchor_candidate,
            observed_star_ratio=observed_star_ratio,
            window_start=window_start,
            window_end=window_end,
            blank_intervals=(
                detect_silence_intervals(
                    context.audio[
                        max(0, int(math.floor(line.start * MMS_SAMPLE_RATE))) :
                        min(context.audio.size, int(math.ceil(line.end * MMS_SAMPLE_RATE)))
                    ],
                    time_offset=line.start,
                )
                if context.audio is not None
                else ()
            ),
        )
        if progress_callback is not None:
            progress_callback((position + 1) / max(1, len(lines)))
    return output


def align_single_standard_display_line(
    vocals_path: Path,
    line: AlignedLyricsLine,
    *,
    line_id: str | int,
    language: str,
    device: str = "auto",
    next_line: AlignedLyricsLine | None = None,
    parent_revision: int | None = None,
    reliable_confidence: float = 0.45,
    normal_padding_seconds: float = 0.75,
    low_confidence_padding_seconds: float = 1.5,
    progress_callback: Callable[[float], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> tuple[DisplayAlignmentResult, str]:
    """cache済みvocalsから対象行windowだけをdecodeして表示素を再解析する。"""

    def checkpoint() -> None:
        if cancel_check is not None:
            cancel_check()

    if line.end <= line.start:
        raise ValueError("Lyric line end must be after start.")
    if normal_padding_seconds < 0 or low_confidence_padding_seconds < normal_padding_seconds:
        raise ValueError("Display alignment padding must be non-negative and ordered.")

    checkpoint()
    resolved = resolve_mms_onnx_model_dir()
    if resolved is None:
        raise RuntimeError(
            "The MMS forced-alignment model is not installed. "
            "Download it from Settings before running Songcut-Align."
        )
    model_dir, _source = resolved
    vocabulary = load_mms_vocabulary(model_dir)
    mms_language = normalize_whisper_to_mms_language(language)
    seeds = split_display_elements(
        line.text,
        line_id=line_id,
        language=mms_language,
        romanize=_default_romanize,
    )
    mappings = map_pronunciation_to_tokens(seeds, vocabulary)
    seeds = attach_token_ranges(seeds, mappings)
    prepared = prepare_lyrics_lines(
        [line.text, *([next_line.text] if next_line is not None else [])],
        language=language,
        vocabulary=vocabulary,
    )
    padding = low_confidence_padding_seconds if line.confidence < reliable_confidence else normal_padding_seconds
    media_end = probe_duration(find_ffmpeg().ffprobe, vocals_path)
    window_start = max(0.0, line.start - padding)
    window_end = min(media_end, line.end + padding)
    if next_line is not None:
        window_end = min(media_end, max(window_end, next_line.start + normal_padding_seconds))
    if window_end <= window_start:
        raise ValueError("The lyric line analysis window is empty.")
    audio = read_media_window_mono_16k(vocals_path, start=window_start, end=window_end)
    checkpoint()
    if progress_callback is not None:
        progress_callback(0.15)

    runner = _pooled_mms_runner(mms_onnx_model_path(model_dir), device=device)
    checkpoint()
    with _MMS_INFERENCE_LOCK:
        emissions = runner.emissions(audio)
    checkpoint()
    if progress_callback is not None:
        progress_callback(0.85)

    local_lines = [prepared[0]]
    if next_line is not None and len(prepared) > 1:
        local_lines.append(
            replace(
                prepared[1],
                token_ids=prepared[1].token_ids[:3],
                token_texts=prepared[1].token_texts[:3],
            )
        )
    target_tokens: tuple[CtcTokenSpan, ...] = ()
    observed_star_ratio: float | None = None
    next_anchor_candidate: float | None = None
    try:
        local_ctc = align_prepared_lines(
            emissions,
            local_lines,
            blank_id=int(vocabulary.get("<blank>", 0)),
            frame_seconds=MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE,
            time_offset=window_start,
            star_between_lines=True,
        )
        target_tokens = tuple(token for token in local_ctc.tokens if token.line_index == 1)
        observed_star_ratio = local_ctc.star_ratio
        if next_line is not None:
            next_span = next((span for span in local_ctc.lines if span.index == 2), None)
            next_anchor_candidate = next_span.start if next_span is not None else None
    except ValueError:
        target_tokens = ()
    checkpoint()

    line_audio_start = max(0, int(math.floor((line.start - window_start) * MMS_SAMPLE_RATE)))
    line_audio_end = min(audio.size, int(math.ceil((line.end - window_start) * MMS_SAMPLE_RATE)))
    result = align_display_elements(
        seeds,
        target_tokens,
        line_start=line.start,
        line_end=line.end,
        mappings=mappings,
        line_id=line_id,
        parent_revision=line.display_element_revision if parent_revision is None else parent_revision,
        start_locked=line.start_locked,
        end_locked=line.end_locked,
        next_anchor=next_line.start if next_line is not None else None,
        next_anchor_candidate=next_anchor_candidate,
        observed_star_ratio=observed_star_ratio,
        window_start=window_start,
        window_end=window_end,
        blank_intervals=detect_silence_intervals(
            audio[line_audio_start:line_audio_end],
            time_offset=line.start,
        ),
    )
    checkpoint()
    if progress_callback is not None:
        progress_callback(1.0)
    return result, runner.device_used


def refine_standard_alignment_with_mms(
    vocals_path: Path,
    document: LyricsDocument,
    alignment: LyricsAlignmentResult,
    *,
    language: str,
    device: str = "auto",
    progress_callback: Callable[[float], None] | None = None,
) -> tuple[LyricsAlignmentResult, MmsRefinementDiagnostics]:
    """既存呼び出し向けに、共有contextから行補正結果だけを返す。"""

    context = prepare_standard_alignment_with_mms(
        vocals_path,
        document,
        alignment,
        language=language,
        device=device,
        progress_callback=progress_callback,
    )
    return context.alignment, context.diagnostics


def read_media_mono_16k(source: Path) -> np.ndarray:
    """Decode arbitrary media, including Demucs 44.1 kHz stereo WAV, for MMS."""
    ffmpeg_paths = find_ffmpeg()
    duration = probe_duration(ffmpeg_paths.ffprobe, source)
    if duration <= 0:
        raise ValueError(f"Could not determine MMS input audio duration: {source}")
    with tempfile.TemporaryDirectory(prefix="songcut-mms-audio-") as temporary_directory:
        converted = Path(temporary_directory) / "mms-input.wav"
        extract_segment_wav(
            ffmpeg_paths.ffmpeg,
            source,
            converted,
            start=0.0,
            end=duration,
        )
        return read_wav_mono_16k(converted)


def read_media_window_mono_16k(source: Path, *, start: float, end: float) -> np.ndarray:
    """任意mediaの指定windowだけをMMS用16kHz monoへdecodeする。"""

    if start < 0 or end <= start:
        raise ValueError("MMS window end must be after its non-negative start.")
    ffmpeg_paths = find_ffmpeg()
    with tempfile.TemporaryDirectory(prefix="songcut-mms-window-") as temporary_directory:
        converted = Path(temporary_directory) / "mms-window.wav"
        extract_segment_wav(
            ffmpeg_paths.ffmpeg,
            source,
            converted,
            start=start,
            end=end,
        )
        return read_wav_mono_16k(converted)
