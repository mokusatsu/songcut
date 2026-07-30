from __future__ import annotations

import json
import math
import shutil
import re
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Mapping, Sequence

import numpy as np

from .ffmpeg_tools import find_ffmpeg, probe_duration
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


@dataclass(frozen=True)
class MmsRefinementDiagnostics:
    applied_line_indexes: list[int]
    candidate_line_count: int
    first_reliable_whisper_line: int | None
    path_score: float
    star_ratio: float
    variant: str


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
        token_ids = tuple(vocabulary[character] for character in alignable if character in vocabulary)
        coverage = len(token_ids) / max(1, len(alignable))
        prepared.append(
            PreparedLyricsLine(
                index=index,
                text=text,
                romanized=romanized,
                token_ids=token_ids,
                token_coverage=coverage,
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
        session: object | None = None,
    ) -> None:
        if session is None:
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError("onnxruntime is required for MMS alignment.") from exc
            session = ort.InferenceSession(str(model_path), providers=list(providers))
        self._session = session
        self._input_name = str(session.get_inputs()[0].name)

    def emissions(self, audio: np.ndarray) -> np.ndarray:
        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        if samples.size == 0:
            raise ValueError("MMS input audio is empty.")
        variance = float(np.var(samples))
        normalized = (samples - float(np.mean(samples))) / math.sqrt(variance + 1e-7)
        outputs = self._session.run(None, {self._input_name: normalized[np.newaxis, :]})
        logits = np.asarray(outputs[0], dtype=np.float32)
        if logits.ndim != 3 or logits.shape[0] != 1:
            raise ValueError(f"Unexpected MMS ONNX logits shape: {logits.shape}")
        return log_softmax(logits[0])


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
    for line_position, line in enumerate(usable_lines):
        targets.extend(line.token_ids)
        target_line_indexes.extend([line.index] * len(line.token_ids))
        if star_between_lines or line_position == len(usable_lines) - 1:
            targets.append(star_id)
            target_line_indexes.append(None)

    state_path, frame_scores = _ctc_viterbi_path(
        extended_emissions,
        targets,
        blank_id=blank_id,
    )
    target_positions_by_line: dict[int, list[int]] = {}
    for target_position, line_index in enumerate(target_line_indexes):
        if line_index is not None:
            target_positions_by_line.setdefault(line_index, []).append(target_position)

    line_lookup = {line.index: line for line in usable_lines}
    output: list[CtcLineSpan] = []
    for line_index, target_positions in target_positions_by_line.items():
        target_states = {2 * position + 1 for position in target_positions}
        frames = np.flatnonzero(np.isin(state_path, list(target_states)))
        if frames.size == 0:
            continue
        selected_scores = frame_scores[frames]
        confidence = math.exp(min(0.0, float(np.mean(selected_scores))))
        line = line_lookup[line_index]
        output.append(
            CtcLineSpan(
                index=line.index,
                text=line.text,
                start=round(time_offset + int(frames[0]) * frame_seconds, 3),
                end=round(time_offset + (int(frames[-1]) + 1) * frame_seconds, 3),
                confidence=round(confidence, 4),
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


def refine_standard_alignment_with_mms(
    vocals_path: Path,
    document: LyricsDocument,
    alignment: LyricsAlignmentResult,
    *,
    language: str,
    progress_callback: Callable[[float], None] | None = None,
) -> tuple[LyricsAlignmentResult, MmsRefinementDiagnostics]:
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
    emissions = MmsOnnxRunner(mms_onnx_model_path(model_dir)).emissions(audio)
    if progress_callback is not None:
        progress_callback(0.85)
    ctc_alignment = align_prepared_lines(
        emissions,
        prepared,
        blank_id=int(vocabulary.get("<blank>", 0)),
        frame_seconds=MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE,
    )
    refined, diagnostics = merge_mms_onset_into_standard_alignment(
        alignment,
        ctc_alignment,
    )
    if progress_callback is not None:
        progress_callback(1.0)
    return refined, diagnostics


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
