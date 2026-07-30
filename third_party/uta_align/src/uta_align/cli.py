from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .alignment import AlignmentError
from .backends import Backend, FasterWhisperBackend, JsonBackend
from .config import AlignConfig
from .lyrics import load_lyrics
from .output import write_json, write_lrc, write_srt
from .pipeline import align_lyrics


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="uta-align",
        description="Align known Japanese lyric lines to singing audio.",
    )
    parser.add_argument("audio", type=Path)
    parser.add_argument("lyrics", type=Path)
    parser.add_argument("-o", "--output", required=True, type=Path, help="required JSON output")
    parser.add_argument("--srt", type=Path)
    parser.add_argument("--lrc", type=Path)
    parser.add_argument("--vocal-stem", type=Path)
    parser.add_argument(
        "--vocal-only",
        action="store_const",
        const=True,
        default=None,
        help="declare the main audio to be an isolated-vocal signal",
    )
    parser.add_argument("--backend", choices=("faster-whisper", "json"), default="faster-whisper")
    parser.add_argument("--transcript-json", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--model")
    parser.add_argument("--language")
    parser.add_argument("--device")
    parser.add_argument("--compute-type")
    parser.add_argument("--window-seconds", type=float)
    parser.add_argument("--overlap-seconds", type=float)
    parser.add_argument("--retry-window-seconds", type=float)
    parser.add_argument("--long-gap-seconds", type=float)
    parser.add_argument("--hard-gap-seconds", type=float)
    parser.add_argument("--boundary-search-seconds", type=float)
    parser.add_argument("--adaptive-boundary-seconds", type=float)
    parser.add_argument("--max-line-seconds", type=float)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        config = AlignConfig.from_json(args.config) if args.config else AlignConfig()
        config = config.merged(
            {
                "model": args.model,
                "language": args.language,
                "device": args.device,
                "compute_type": args.compute_type,
                "window_seconds": args.window_seconds,
                "overlap_seconds": args.overlap_seconds,
                "retry_window_seconds": args.retry_window_seconds,
                "long_gap_seconds": args.long_gap_seconds,
                "hard_gap_seconds": args.hard_gap_seconds,
                "boundary_search_seconds": args.boundary_search_seconds,
                "adaptive_boundary_seconds": args.adaptive_boundary_seconds,
                "max_line_seconds": args.max_line_seconds,
                "input_audio_is_vocal_only": args.vocal_only,
            }
        )
        if args.backend == "json":
            if args.transcript_json is None:
                raise ValueError("--transcript-json is required with --backend json")
            backend: Backend = JsonBackend(args.transcript_json)
        else:
            backend = FasterWhisperBackend()
        result = align_lyrics(
            args.audio,
            load_lyrics(args.lyrics),
            backend,
            config=config,
            vocal_stem_path=args.vocal_stem,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_json(result, args.output)
        if args.srt:
            args.srt.parent.mkdir(parents=True, exist_ok=True)
            write_srt(result, args.srt)
        if args.lrc:
            args.lrc.parent.mkdir(parents=True, exist_ok=True)
            write_lrc(result, args.lrc)
    except (AlignmentError, OSError, RuntimeError, ValueError) as error:
        print(f"uta-align: error: {error}", file=sys.stderr)
        if isinstance(error, AlignmentError):
            print(
                json.dumps(
                    {
                        "error": error.code,
                        "message": str(error),
                        "diagnostics": error.diagnostics,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                file=sys.stderr,
            )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
