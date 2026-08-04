from __future__ import annotations

import unittest

from songcut.ass_effects23 import (
    CONTEXT_REQUIRED_EFFECTS,
    DialogueEvent,
    Direction,
    Effect,
    EffectContext,
    EffectError,
    EffectParameterError,
    Rect,
    decorate_dialogue,
    parse_dialogue,
)


LINE = (
    "Dialogue: 2,0:00:01.00,0:00:06.00,Default,actor,10,20,30,,"
    "字幕テキスト"
)
CONTEXT = EffectContext(
    play_res_x=1920,
    play_res_y=1080,
    anchor_x=960,
    anchor_y=540,
    text_box=Rect(600, 440, 1320, 640),
)


class ParseTests(unittest.TestCase):
    def test_parse_and_format_round_trip(self) -> None:
        event = parse_dialogue(LINE)
        self.assertEqual(event.layer, 2)
        self.assertEqual(event.start_ms, 1000)
        self.assertEqual(event.end_ms, 6000)
        self.assertEqual(event.text, "字幕テキスト")
        self.assertEqual(event.format(), LINE)

    def test_commas_belong_to_text_after_ninth_separator(self) -> None:
        line = (
            "Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,"
            "one,two,three"
        )
        self.assertEqual(parse_dialogue(line).text, "one,two,three")

    def test_rejects_non_dialogue_and_multiple_lines(self) -> None:
        with self.assertRaises(EffectError):
            parse_dialogue("Comment: 0,0:00:00.00,0:00:02.00,D,,,,,,,x")
        with self.assertRaises(EffectError):
            parse_dialogue(LINE + "\n" + LINE)


class AllEffectsTests(unittest.TestCase):
    def test_all_23_effects_generate_valid_dialogue_lines(self) -> None:
        self.assertEqual(len(list(Effect)), 23)
        for effect in Effect:
            with self.subTest(effect=effect):
                kwargs = (
                    {"context": CONTEXT}
                    if effect in CONTEXT_REQUIRED_EFFECTS
                    else {}
                )
                output = decorate_dialogue(
                    LINE, 500, 500, effect, **kwargs
                )
                self.assertGreaterEqual(len(output), 1)
                parsed = [parse_dialogue(line) for line in output]
                for event in parsed:
                    self.assertGreaterEqual(event.start_ms, 1000)
                    self.assertLessEqual(event.end_ms, 6000)
                    self.assertGreater(event.end_ms, event.start_ms)

    def test_effect_can_be_number_name_or_japanese_label(self) -> None:
        by_number = decorate_dialogue(LINE, 300, 300, 2)
        by_name = decorate_dialogue(LINE, 300, 300, "fad")
        by_label = decorate_dialogue(
            LINE, 300, 300, "通常フェードイン／フェードアウト"
        )
        self.assertEqual(by_number, by_name)
        self.assertEqual(by_name, by_label)

    def test_cut_is_unchanged(self) -> None:
        self.assertEqual(
            decorate_dialogue(LINE, 500, 500, Effect.CUT),
            [LINE],
        )


class ContextTests(unittest.TestCase):
    def test_context_is_required_for_coordinate_effects(self) -> None:
        expected = {
            Effect.SLIDE,
            Effect.WIPE,
            Effect.KARAOKE,
            Effect.SCANLINE,
            Effect.GLITCH,
            Effect.DISSOLVE,
        }
        self.assertEqual(CONTEXT_REQUIRED_EFFECTS, expected)
        for effect in expected:
            with self.subTest(effect=effect):
                with self.assertRaisesRegex(
                    EffectParameterError, "requires an explicit EffectContext"
                ):
                    decorate_dialogue(LINE, 400, 400, effect)

    def test_non_coordinate_effect_does_not_require_context(self) -> None:
        self.assertEqual(
            len(decorate_dialogue(LINE, 400, 400, Effect.ZOOM)), 1
        )

    def test_invalid_context_geometry_is_rejected(self) -> None:
        with self.assertRaises(EffectParameterError):
            EffectContext(
                play_res_x=1280,
                play_res_y=720,
                text_box=Rect(0, 0, 1400, 600),
            )


class DirectionTests(unittest.TestCase):
    def test_separate_start_and_end_directions_are_rejected(self) -> None:
        for key in ("start_direction", "end_direction", "in_direction"):
            with self.subTest(key=key):
                with self.assertRaisesRegex(
                    EffectParameterError, "separate start/end directions"
                ):
                    decorate_dialogue(
                        LINE,
                        400,
                        400,
                        Effect.SLIDE,
                        params={key: "left_to_right"},
                        context=CONTEXT,
                    )

    def test_slide_uses_one_direction_for_entry_and_exit(self) -> None:
        output = decorate_dialogue(
            LINE,
            500,
            500,
            Effect.SLIDE,
            params={"direction": Direction.LEFT_TO_RIGHT},
            context=CONTEXT,
        )
        self.assertEqual(len(output), 3)
        self.assertIn(r"\move(-240,540,960,540,0,500)", output[0])
        self.assertIn(r"\move(960,540,2160,540,0,500)", output[-1])

    def test_invalid_direction_for_effect_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            EffectParameterError, "direction must be one of"
        ):
            decorate_dialogue(
                LINE,
                500,
                500,
                Effect.ROTATE,
                params={"direction": "top_to_bottom"},
            )


class ValidationTests(unittest.TestCase):
    def test_durations_must_fit_event(self) -> None:
        with self.assertRaisesRegex(
            EffectParameterError, "must not exceed"
        ):
            decorate_dialogue(LINE, 3000, 3000, Effect.FAD)

    def test_durations_must_be_integer_and_nonnegative(self) -> None:
        with self.assertRaises(EffectParameterError):
            decorate_dialogue(LINE, -1, 0, Effect.FAD)
        with self.assertRaises(EffectParameterError):
            decorate_dialogue(LINE, 1.5, 0, Effect.FAD)  # type: ignore[arg-type]

    def test_dynamic_input_tags_are_rejected_by_default(self) -> None:
        line = LINE.replace("字幕テキスト", r"{\fad(200,200)}字幕テキスト")
        with self.assertRaisesRegex(EffectError, "dynamic tag"):
            decorate_dialogue(line, 300, 300, Effect.ZOOM)

    def test_static_input_tags_are_preserved(self) -> None:
        line = LINE.replace("字幕テキスト", r"{\b1\c&HFFFFFF&}字幕テキスト")
        output = decorate_dialogue(line, 300, 300, Effect.ZOOM)[0]
        self.assertIn(r"\b1\c&HFFFFFF&", output)
        self.assertEqual(output.count("{"), 1)
        self.assertLess(output.index(r"\b1"), output.index(r"\fscx0"))

    def test_unknown_effect_parameter_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            EffectParameterError, "unsupported parameter"
        ):
            decorate_dialogue(
                LINE,
                300,
                300,
                Effect.BLUR,
                params={"radius": 10, "bogus": 1},
            )


class MultiEventTests(unittest.TestCase):
    def test_typewriter_is_character_stepped_in_and_out(self) -> None:
        output = decorate_dialogue(
            LINE,
            600,
            600,
            Effect.TYPEWRITER,
            params={"direction": "left_to_right"},
        )
        self.assertEqual(len(output), 13)
        self.assertTrue(parse_dialogue(output[0]).text.endswith("字"))
        self.assertTrue(parse_dialogue(output[5]).text.endswith("字幕テキスト"))
        self.assertTrue(parse_dialogue(output[-1]).text.endswith("ト"))

    def test_typewriter_rejects_inline_override_blocks(self) -> None:
        line = LINE.replace(
            "字幕テキスト", r"{\b1}字幕{\i1}テキスト"
        )
        with self.assertRaisesRegex(EffectError, "inline override"):
            decorate_dialogue(line, 600, 600, Effect.TYPEWRITER)

    def test_glow_has_glow_and_foreground_layers(self) -> None:
        output = decorate_dialogue(LINE, 500, 500, Effect.GLOW)
        self.assertEqual(len(output), 2)
        self.assertEqual(parse_dialogue(output[0]).layer, 2)
        self.assertEqual(parse_dialogue(output[1]).layer, 3)

    def test_seeded_effects_are_deterministic(self) -> None:
        for effect, params in (
            (Effect.GLITCH, {"seed": 42}),
            (Effect.DISSOLVE, {"seed": 42}),
            (Effect.FLICKER, {"seed": 42}),
        ):
            with self.subTest(effect=effect):
                kwargs = (
                    {"context": CONTEXT}
                    if effect in CONTEXT_REQUIRED_EFFECTS
                    else {}
                )
                first = decorate_dialogue(
                    LINE, 500, 500, effect, params=params, **kwargs
                )
                second = decorate_dialogue(
                    LINE, 500, 500, effect, params=params, **kwargs
                )
                self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
