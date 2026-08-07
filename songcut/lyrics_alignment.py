from __future__ import annotations

import argparse
import json
import math
import tempfile
import unicodedata
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

import numpy as np

from .ffmpeg_tools import find_ffmpeg, probe_duration
from .transcription import (
    DEFAULT_WHISPER_MODEL_KEY,
    TranscriptChunk,
    ensure_whisper_model,
    extract_segment_wav,
    normalize_whisper_language,
    read_wav_mono_16k,
    select_whisper_runtime,
)
from .whisper_execution import WhisperExecutionSession


@dataclass(frozen=True)
class LyricsDocument:
    title: str | None
    lines: list[str]


@dataclass(frozen=True)
class CharacterObservation:
    character: str
    start: float
    end: float
    chunk_index: int


@dataclass(frozen=True)
class AlignedLyricsLine:
    index: int
    text: str
    start: float
    end: float
    confidence: float
    source: str
    matched_characters: int
    exact_characters: int
    total_characters: int


@dataclass(frozen=True)
class LyricsAlignmentResult:
    title: str | None
    lines: list[AlignedLyricsLine]
    whisper_text: str
    whisper_chunks: list[TranscriptChunk]
    edit_cost: float
    lyrics_characters: int
    recognized_characters: int


@dataclass(frozen=True)
class _LineDraft:
    index: int
    text: str
    normalized: str
    start: float | None
    end: float | None
    confidence: float
    source: str
    matched_characters: int
    exact_characters: int


WHISPER_AUDIO_SAMPLE_RATE = 16_000
WHISPER_SILENCE_THRESHOLD_DB = -40.0
WHISPER_SILENCE_FRAME_SECONDS = 0.020
WHISPER_MIN_SILENCE_SECONDS = 0.250
WHISPER_MIN_ACTIVE_SECONDS = 0.100


def find_whisper_active_intervals(
    audio: np.ndarray,
    *,
    sample_rate: int = WHISPER_AUDIO_SAMPLE_RATE,
    threshold_db: float = WHISPER_SILENCE_THRESHOLD_DB,
    frame_seconds: float = WHISPER_SILENCE_FRAME_SECONDS,
    min_silence_seconds: float = WHISPER_MIN_SILENCE_SECONDS,
    min_active_seconds: float = WHISPER_MIN_ACTIVE_SECONDS,
) -> list[tuple[int, int]]:
    """Locate audio to send to Whisper, splitting at sustained -40 dBFS silence."""
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        return []
    frame_samples = max(1, int(round(sample_rate * frame_seconds)))
    frame_count = math.ceil(samples.size / frame_samples)
    padded = np.pad(samples, (0, frame_count * frame_samples - samples.size))
    frames = padded.reshape(frame_count, frame_samples)
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float32), axis=1))
    threshold = 10.0 ** (threshold_db / 20.0)
    active = rms > threshold
    if not np.any(active):
        return []

    # A short dip inside a syllable is not a silence boundary. Only close gaps
    # whose duration reaches min_silence_seconds are excluded from Whisper.
    minimum_silent_frames = max(1, math.ceil(min_silence_seconds / frame_seconds))
    first_active = int(np.flatnonzero(active)[0])
    last_active = int(np.flatnonzero(active)[-1])
    frame_intervals: list[tuple[int, int]] = []
    interval_start = first_active
    index = first_active
    while index <= last_active:
        if active[index]:
            index += 1
            continue
        silence_start = index
        while index <= last_active and not active[index]:
            index += 1
        if index - silence_start >= minimum_silent_frames:
            frame_intervals.append((interval_start, silence_start))
            interval_start = index
    frame_intervals.append((interval_start, last_active + 1))

    minimum_active_samples = max(1, int(round(sample_rate * min_active_seconds)))
    intervals: list[tuple[int, int]] = []
    for start_frame, end_frame in frame_intervals:
        start = start_frame * frame_samples
        end = min(samples.size, end_frame * frame_samples)
        if end - start >= minimum_active_samples:
            intervals.append((start, end))
    return intervals


def parse_lyrics(text: str, *, auto_title: bool = True) -> LyricsDocument:
    """Parse non-empty lyric lines while optionally recognizing a leading title block."""
    raw_lines = [line.strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    first = next((index for index, line in enumerate(raw_lines) if line), None)
    if first is None:
        raise ValueError("Lyrics text does not contain any non-empty lines.")

    title: str | None = None
    lyric_start = first
    if auto_title and first + 1 < len(raw_lines) and not raw_lines[first + 1]:
        remaining = [line for line in raw_lines[first + 2 :] if line]
        if remaining:
            title = raw_lines[first]
            lyric_start = first + 2

    lines = [line for line in raw_lines[lyric_start:] if line]
    if not lines:
        raise ValueError("Lyrics text does not contain any lyric lines.")
    return LyricsDocument(title=title, lines=lines)


def read_lyrics(path: Path, *, auto_title: bool = True) -> LyricsDocument:
    return parse_lyrics(path.read_text(encoding="utf-8-sig"), auto_title=auto_title)


def normalize_alignment_text(text: str) -> str:
    """Return a conservative Japanese-friendly representation used only for matching."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    output: list[str] = []
    for character in normalized:
        codepoint = ord(character)
        if 0x30A1 <= codepoint <= 0x30F6:
            character = chr(codepoint - 0x60)
        if unicodedata.category(character)[0] in {"L", "N"}:
            output.append(character)
    return "".join(output)


def chunks_to_character_observations(chunks: Sequence[TranscriptChunk]) -> list[CharacterObservation]:
    observations: list[CharacterObservation] = []
    for chunk_index, chunk in enumerate(chunks):
        characters = normalize_alignment_text(chunk.text)
        if not characters:
            continue
        start = max(0.0, float(chunk.start))
        end = max(start, float(chunk.end))
        duration = max(0.001, end - start)
        for index, character in enumerate(characters):
            observations.append(
                CharacterObservation(
                    character=character,
                    start=start + duration * index / len(characters),
                    end=start + duration * (index + 1) / len(characters),
                    chunk_index=chunk_index,
                )
            )
    return observations


def _align_characters(lyrics: str, recognized: str) -> tuple[dict[int, tuple[int, bool]], float]:
    """Globally align two character strings and return lyric-index to recognition-index mappings."""
    rows = len(lyrics) + 1
    columns = len(recognized) + 1
    deletion_cost = 1.0
    insertion_cost = 1.0
    substitution_cost = 1.15
    costs = [[0.0] * columns for _ in range(rows)]
    directions = [bytearray(columns) for _ in range(rows)]

    for row in range(1, rows):
        costs[row][0] = row * deletion_cost
        directions[row][0] = 1
    for column in range(1, columns):
        costs[0][column] = column * insertion_cost
        directions[0][column] = 2

    for row in range(1, rows):
        lyric_character = lyrics[row - 1]
        previous = costs[row - 1]
        current = costs[row]
        for column in range(1, columns):
            exact = lyric_character == recognized[column - 1]
            diagonal = previous[column - 1] + (0.0 if exact else substitution_cost)
            deletion = previous[column] + deletion_cost
            insertion = current[column - 1] + insertion_cost
            if diagonal <= deletion and diagonal <= insertion:
                current[column] = diagonal
                directions[row][column] = 0
            elif deletion <= insertion:
                current[column] = deletion
                directions[row][column] = 1
            else:
                current[column] = insertion
                directions[row][column] = 2

    mapping: dict[int, tuple[int, bool]] = {}
    row = len(lyrics)
    column = len(recognized)
    while row or column:
        direction = directions[row][column]
        if row and column and direction == 0:
            mapping[row - 1] = (column - 1, lyrics[row - 1] == recognized[column - 1])
            row -= 1
            column -= 1
        elif row and (not column or direction == 1):
            row -= 1
        else:
            column -= 1
    return mapping, costs[-1][-1]


def align_lyrics_to_chunks(
    document: LyricsDocument,
    chunks: Sequence[TranscriptChunk],
    *,
    media_duration: float,
    minimum_line_duration: float = 0.4,
) -> LyricsAlignmentResult:
    normalized_lines = [normalize_alignment_text(line) for line in document.lines]
    if not any(normalized_lines):
        raise ValueError("Lyrics do not contain alignable characters.")
    observations = chunks_to_character_observations(chunks)
    if not observations:
        raise ValueError("Whisper did not return any timestamped text chunks.")

    lyric_text = "".join(normalized_lines)
    recognized_text = "".join(observation.character for observation in observations)
    mapping, edit_cost = _align_characters(lyric_text, recognized_text)

    drafts: list[_LineDraft] = []
    lyric_offset = 0
    for index, (text, normalized) in enumerate(zip(document.lines, normalized_lines, strict=True), start=1):
        entries = [mapping[position] for position in range(lyric_offset, lyric_offset + len(normalized)) if position in mapping]
        exact_entries = [entry for entry in entries if entry[1]]
        minimum_exact = 1 if len(normalized) <= 3 else 2
        enough_exact = len(exact_entries) >= minimum_exact and len(exact_entries) / max(1, len(normalized)) >= 0.3
        if entries and enough_exact:
            observed = [observations[entry[0]] for entry in entries]
            coverage = len(entries) / max(1, len(normalized))
            exact_ratio = len(exact_entries) / max(1, len(normalized))
            chunk_span = observed[-1].chunk_index - observed[0].chunk_index + 1
            span_penalty = min(0.2, max(0, chunk_span - 3) * 0.03)
            confidence = max(0.0, min(1.0, exact_ratio * 0.75 + coverage * 0.25 - span_penalty))
            observed_start = observed[0].start
            observed_end = observed[-1].end
            # Whisper occasionally gives a short Japanese phrase a timestamp spanning a
            # long instrumental gap. Keep the start anchor, cap the subtitle duration,
            # and lower confidence so the questionable line is visible in diagnostics.
            maximum_plausible_duration = max(4.0, min(18.0, len(normalized) * 1.2))
            observed_duration = observed_end - observed_start
            if observed_duration > maximum_plausible_duration:
                confidence *= maximum_plausible_duration / observed_duration
                observed_end = observed_start + maximum_plausible_duration
            drafts.append(
                _LineDraft(
                    index=index,
                    text=text,
                    normalized=normalized,
                    start=observed_start,
                    end=observed_end,
                    confidence=confidence,
                    source="whisper-chunk",
                    matched_characters=len(entries),
                    exact_characters=len(exact_entries),
                )
            )
        else:
            drafts.append(
                _LineDraft(
                    index=index,
                    text=text,
                    normalized=normalized,
                    start=None,
                    end=None,
                    confidence=0.0,
                    source="interpolated",
                    matched_characters=len(entries),
                    exact_characters=len(exact_entries),
                )
            )
        lyric_offset += len(normalized)

    filled = _interpolate_unanchored_lines(drafts, observations, media_duration)
    finalized = _finalize_line_ranges(filled, media_duration, minimum_line_duration)
    whisper_text = "".join(chunk.text for chunk in chunks).strip()
    return LyricsAlignmentResult(
        title=document.title,
        lines=finalized,
        whisper_text=whisper_text,
        whisper_chunks=list(chunks),
        edit_cost=edit_cost,
        lyrics_characters=len(lyric_text),
        recognized_characters=len(recognized_text),
    )


def _interpolate_unanchored_lines(
    drafts: Sequence[_LineDraft], observations: Sequence[CharacterObservation], media_duration: float
) -> list[_LineDraft]:
    result = list(drafts)
    index = 0
    observation_start = observations[0].start
    observation_end = observations[-1].end
    while index < len(result):
        if result[index].start is not None:
            index += 1
            continue
        run_start = index
        while index < len(result) and result[index].start is None:
            index += 1
        run_end = index
        left = result[run_start - 1].end if run_start else observation_start
        right = result[run_end].start if run_end < len(result) else observation_end
        left = max(0.0, float(left if left is not None else observation_start))
        right = min(media_duration, float(right if right is not None else observation_end))
        if right <= left:
            right = min(media_duration, left + max(0.4, 0.4 * (run_end - run_start)))
        weights = [max(1, len(result[position].normalized)) for position in range(run_start, run_end)]
        total_weight = sum(weights)
        cursor = left
        for position, weight in zip(range(run_start, run_end), weights, strict=True):
            next_cursor = right if position == run_end - 1 else cursor + (right - left) * weight / total_weight
            draft = result[position]
            result[position] = _LineDraft(
                index=draft.index,
                text=draft.text,
                normalized=draft.normalized,
                start=cursor,
                end=next_cursor,
                confidence=0.05,
                source="interpolated",
                matched_characters=draft.matched_characters,
                exact_characters=draft.exact_characters,
            )
            cursor = next_cursor
            total_weight -= weight
            left = cursor
    return result


def _finalize_line_ranges(
    drafts: Sequence[_LineDraft], media_duration: float, minimum_line_duration: float
) -> list[AlignedLyricsLine]:
    starts: list[float] = []
    for index, draft in enumerate(drafts):
        start = max(0.0, min(media_duration, float(draft.start or 0.0)))
        if starts:
            start = max(start, starts[-1] + 0.001)
        starts.append(start)

    output: list[AlignedLyricsLine] = []
    for index, draft in enumerate(drafts):
        start = starts[index]
        raw_end = max(start, min(media_duration, float(draft.end or start)))
        end = min(media_duration, max(raw_end + 0.25, start + minimum_line_duration))
        if index + 1 < len(starts):
            next_start = starts[index + 1]
            end = min(end, max(start + 0.001, next_start - 0.02))
        if end <= start:
            end = min(media_duration, start + 0.001)
        output.append(
            AlignedLyricsLine(
                index=draft.index,
                text=draft.text,
                start=round(start, 3),
                end=round(end, 3),
                confidence=round(draft.confidence, 3),
                source=draft.source,
                matched_characters=draft.matched_characters,
                exact_characters=draft.exact_characters,
                total_characters=len(draft.normalized),
            )
        )
    return output


def format_srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def render_srt(lines: Iterable[AlignedLyricsLine]) -> str:
    blocks = [
        f"{index}\n{format_srt_timestamp(line.start)} --> {format_srt_timestamp(line.end)}\n{line.text}"
        for index, line in enumerate(lines, start=1)
    ]
    return "\n\n".join(blocks) + "\n"


def transcribe_whisper_chunks(
    source: Path,
    *,
    model_dir: Path | None = None,
    model_key: str = DEFAULT_WHISPER_MODEL_KEY,
    device: str = "cpu",
    language: str = "ja",
    progress_callback: Callable[[int, int], None] | None = None,
) -> tuple[list[TranscriptChunk], str, float, str]:
    try:
        import openvino_genai as ov_genai  # type: ignore
    except ImportError as exc:
        raise RuntimeError("openvino-genai is required for the lyrics alignment proof of concept.") from exc

    ffmpeg_paths = find_ffmpeg()
    duration = probe_duration(ffmpeg_paths.ffprobe, source)
    runtime = select_whisper_runtime(device)
    target_model = ensure_whisper_model(model_dir, model_key=model_key)
    _language_code, language_token = normalize_whisper_language(language)
    session = WhisperExecutionSession.from_openvino(
        model_path=target_model,
        runtime=runtime,
        requested_device=device,
        language_token=language_token,
    )

    with tempfile.TemporaryDirectory(prefix="songcut-lyrics-") as temporary_directory:
        wav_path = Path(temporary_directory) / "source.wav"
        extract_segment_wav(ffmpeg_paths.ffmpeg, source, wav_path, start=0.0, end=duration)
        raw_speech = read_wav_mono_16k(wav_path)
        options: dict[str, object] = {"task": "transcribe", "return_timestamps": True}
        intervals = find_whisper_active_intervals(raw_speech)
        chunks: list[TranscriptChunk] = []
        recognized_texts: list[str] = []
        for interval_index, (sample_start, sample_end) in enumerate(intervals, start=1):
            interval_audio = np.ascontiguousarray(raw_speech[sample_start:sample_end])
            interval_start = sample_start / WHISPER_AUDIO_SAMPLE_RATE
            interval_duration = (sample_end - sample_start) / WHISPER_AUDIO_SAMPLE_RATE
            decoded = session.generate(interval_audio, options)
            for chunk in session.normalize_decoded_chunks(decoded, interval_duration):
                text = chunk.text
                if not text:
                    continue
                # The active interval offset and media-duration clamp remain
                # owned by the standard lyrics caller.
                start = min(duration, interval_start + chunk.start)
                end = min(duration, interval_start + max(chunk.start, chunk.end))
                chunks.append(
                    TranscriptChunk(
                        start=round(start, 3),
                        end=round(max(start, end), 3),
                        text=text,
                    )
                )
            decoded_text = str(
                getattr(decoded, "texts", [""])[0] if hasattr(decoded, "texts") else decoded
            ).strip()
            if decoded_text:
                recognized_texts.append(decoded_text)
            if progress_callback is not None:
                progress_callback(interval_index, len(intervals))

    text = " ".join(recognized_texts).strip()
    return chunks, text, duration, session.device_used


def generate_lyrics_srt(
    source: Path,
    lyrics_path: Path,
    output_path: Path,
    *,
    diagnostics_path: Path | None = None,
    model_dir: Path | None = None,
    model_key: str = DEFAULT_WHISPER_MODEL_KEY,
    device: str = "cpu",
    language: str = "ja",
    auto_title: bool = True,
) -> LyricsAlignmentResult:
    document = read_lyrics(lyrics_path, auto_title=auto_title)
    chunks, whisper_text, duration, device_used = transcribe_whisper_chunks(
        source,
        model_dir=model_dir,
        model_key=model_key,
        device=device,
        language=language,
    )
    result = align_lyrics_to_chunks(document, chunks, media_duration=duration)
    result = LyricsAlignmentResult(
        title=result.title,
        lines=result.lines,
        whisper_text=whisper_text,
        whisper_chunks=result.whisper_chunks,
        edit_cost=result.edit_cost,
        lyrics_characters=result.lyrics_characters,
        recognized_characters=result.recognized_characters,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_srt(result.lines), encoding="utf-8-sig", newline="\n")
    if diagnostics_path is not None:
        diagnostics_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": str(source),
            "lyrics": str(lyrics_path),
            "output": str(output_path),
            "model_key": model_key,
            "language": language,
            "device_used": device_used,
            "duration": duration,
            "title": result.title,
            "edit_cost": result.edit_cost,
            "lyrics_characters": result.lyrics_characters,
            "recognized_characters": result.recognized_characters,
            "whisper_text": result.whisper_text,
            "whisper_chunks": [asdict(chunk) for chunk in result.whisper_chunks],
            "lines": [asdict(line) for line in result.lines],
        }
        diagnostics_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Proof of concept: align known lyrics with Whisper chunks and write SRT.")
    parser.add_argument("source", type=Path)
    parser.add_argument("lyrics", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--diagnostics", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument(
        "--model",
        choices=("tiny", "base", "small", "whisper-large-v3-turbo-int8-ov"),
        default=DEFAULT_WHISPER_MODEL_KEY,
    )
    parser.add_argument("--device", choices=("auto", "npu", "gpu", "cpu"), default="cpu")
    parser.add_argument("--language", default="ja")
    parser.add_argument("--keep-first-line", action="store_true", help="Treat a leading one-line block as lyrics, not a title.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output = args.output or args.source.with_suffix(".lyrics.srt")
    diagnostics = args.diagnostics or output.with_suffix(".alignment.json")
    result = generate_lyrics_srt(
        args.source,
        args.lyrics,
        output,
        diagnostics_path=diagnostics,
        model_dir=args.model_dir,
        model_key=args.model,
        device=args.device,
        language=args.language,
        auto_title=not args.keep_first_line,
    )
    low_confidence = sum(line.confidence < 0.5 for line in result.lines)
    print(
        json.dumps(
            {
                "srt": str(output),
                "diagnostics": str(diagnostics),
                "line_count": len(result.lines),
                "low_confidence_lines": low_confidence,
                "edit_cost": round(result.edit_cost, 3),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
