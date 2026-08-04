"""Generate a minimal ASS file containing all 23 effects."""

from __future__ import annotations

from pathlib import Path

from ass_effects23 import (
    CONTEXT_REQUIRED_EFFECTS,
    EFFECT_NAMES_JA,
    Effect,
    EffectContext,
    Rect,
    decorate_dialogue,
)


SEGMENT_MS = 4000
START_MS = 650
END_MS = 650


def ass_time(milliseconds: int) -> str:
    centiseconds = (milliseconds + 5) // 10
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    seconds, cs = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{cs:02d}"


def main() -> None:
    context = EffectContext(
        play_res_x=1280,
        play_res_y=720,
        anchor_x=640,
        anchor_y=360,
        text_box=Rect(350, 285, 930, 435),
    )
    events: list[str] = []
    for index, effect in enumerate(Effect):
        start = index * SEGMENT_MS
        end = start + SEGMENT_MS
        title = (
            f"Dialogue: 10,{ass_time(start)},{ass_time(end)},Title,,0,0,0,,"
            f"{index + 1:02d}  {EFFECT_NAMES_JA[effect]}"
        )
        sample = (
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,"
            r"{\an5\pos(640,360)}字幕テキスト"
        )
        kwargs = (
            {"context": context}
            if effect in CONTEXT_REQUIRED_EFFECTS
            else {}
        )
        events.append(title)
        events.extend(
            decorate_dialogue(
                sample,
                START_MS,
                END_MS,
                effect,
                **kwargs,
            )
        )

    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans JP Thin,64,&H00FFFFFF,&H00FFFFFF,&H00302010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,0,0,0,1
Style: Title,Noto Sans JP Thin,24,&H00FFD742,&H00FFD742,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,40,40,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    output = Path("all_23_effects.ass")
    output.write_text(header + "\n".join(events) + "\n", encoding="utf-8-sig")
    print(output.resolve())


if __name__ == "__main__":
    main()
