"""Command-line interface for ass-effects23."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .core import Effect, EffectContext, Rect, decorate_dialogue


def _value(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _param(text: str) -> tuple[str, Any]:
    if "=" not in text:
        raise argparse.ArgumentTypeError("parameter must be KEY=VALUE")
    name, value = text.split("=", 1)
    if not name:
        raise argparse.ArgumentTypeError("parameter name cannot be empty")
    return name, _value(value)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ass-effects23",
        description="Apply one of 23 effects to one ASS Dialogue line.",
    )
    parser.add_argument(
        "dialogue",
        nargs="?",
        help="Dialogue line, or '-' to read one line from standard input",
    )
    parser.add_argument("--start-ms", type=int)
    parser.add_argument("--end-ms", type=int)
    parser.add_argument(
        "--effect",
        help="1..23 or an effect name such as slide",
    )
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        type=_param,
        metavar="KEY=VALUE",
        help="effect-specific parameter; repeatable",
    )
    parser.add_argument(
        "--play-res-x",
        type=int,
        help="PlayResX; coordinate-based effects require this and --play-res-y",
    )
    parser.add_argument(
        "--play-res-y",
        type=int,
        help="PlayResY; coordinate-based effects require this and --play-res-x",
    )
    parser.add_argument("--anchor-x", type=int)
    parser.add_argument("--anchor-y", type=int)
    parser.add_argument(
        "--text-box",
        nargs=4,
        type=int,
        metavar=("X1", "Y1", "X2", "Y2"),
    )
    parser.add_argument(
        "--list-effects",
        action="store_true",
        help="list effect numbers and names, then exit",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.list_effects:
        for index, effect in enumerate(Effect, 1):
            print(f"{index:02d} {effect.value}")
        return 0
    missing: list[str] = []
    if args.dialogue is None:
        missing.append("dialogue")
    if args.start_ms is None:
        missing.append("--start-ms")
    if args.end_ms is None:
        missing.append("--end-ms")
    if args.effect is None:
        missing.append("--effect")
    if missing:
        parser.error("the following arguments are required: " + ", ".join(missing))
    dialogue = sys.stdin.readline().rstrip("\r\n") if args.dialogue == "-" else args.dialogue
    params = dict(args.param)
    context_values = (
        args.play_res_x,
        args.play_res_y,
        args.anchor_x,
        args.anchor_y,
        args.text_box,
    )
    context = None
    if any(value is not None for value in context_values):
        if args.play_res_x is None or args.play_res_y is None:
            parser.error(
                "--play-res-x and --play-res-y are both required when "
                "supplying EffectContext options"
            )
        box = Rect(*args.text_box) if args.text_box else None
        context = EffectContext(
            play_res_x=args.play_res_x,
            play_res_y=args.play_res_y,
            anchor_x=args.anchor_x,
            anchor_y=args.anchor_y,
            text_box=box,
        )
    try:
        lines = decorate_dialogue(
            dialogue,
            args.start_ms,
            args.end_ms,
            args.effect,
            params=params,
            context=context,
        )
    except ValueError as exc:
        parser.exit(2, f"error: {exc}\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
