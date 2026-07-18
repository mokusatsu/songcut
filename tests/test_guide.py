import unittest

from songcut.guide import build_guided_exports, parse_guide_text, safe_filename_stem
from songcut.gui_pipeline import build_gui_segments_and_exports


class GuideTests(unittest.TestCase):
    def test_parse_minute_second_and_hour_minute_second_tags(self) -> None:
        entries = parse_guide_text("80:45 Song A\n1:20:45 Song B\n")

        self.assertEqual(entries[0].timestamps, [4845.0])
        self.assertEqual(entries[0].title, "Song A")
        self.assertEqual(entries[1].timestamps, [4845.0])
        self.assertEqual(entries[1].title, "Song B")

    def test_multiple_timestamps_on_one_line_are_explicit_range(self) -> None:
        entries = parse_guide_text("0:10:00 Song C 0:13:30\n")
        exports = build_guided_exports(entries, [], max_distance_seconds=90)

        self.assertEqual(len(exports), 1)
        self.assertEqual(exports[0].start, 600.0)
        self.assertEqual(exports[0].end, 810.0)
        self.assertEqual(exports[0].match_source, "guide-range")
        self.assertEqual(exports[0].filename_stem, "01_Song C")

    def test_numbered_multiline_guide_uses_first_content_line_as_title(self) -> None:
        entries = parse_guide_text(
            "１. 9:47~16:10\n"
            "├ きみも悪い人でよかった / ピノキオピー 💠\n"
            "└ (Kimi mo Waruihito de Yokatta / Pinocchio P)\n"
        )

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].timestamps, [587.0, 970.0])
        self.assertEqual(entries[0].title, "きみも悪い人でよかった / ピノキオピー 💠")

    def test_numbered_multiline_guide_skips_blank_and_supplement_lines(self) -> None:
        entries = parse_guide_text("2. 17:53~21:27\n\n└ リスキーゲーム / WhiteFlame 💠\n")

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].title, "リスキーゲーム / WhiteFlame 💠")

    def test_single_timestamp_starts_at_guide_tag_and_uses_nearby_segment_end(self) -> None:
        entries = parse_guide_text("0:09:59 Song / Artist\n")
        exports = build_guided_exports(
            entries,
            [{"start": 587.0, "end": 970.0}],
            max_distance_seconds=90,
        )

        self.assertEqual(exports[0].start, 599.0)
        self.assertEqual(exports[0].end, 970.0)
        self.assertEqual(exports[0].match_source, "guide-nearby-segment")
        self.assertEqual(exports[0].filename_stem, "01_Song - Artist")

    def test_single_timestamp_before_nearby_segment_still_starts_at_guide_tag(self) -> None:
        entries = parse_guide_text("0:00:30 Opening\n")
        exports = build_guided_exports(
            entries,
            [{"start": 97.5, "end": 181.5}],
            max_distance_seconds=90,
        )

        self.assertEqual(exports[0].start, 30.0)
        self.assertEqual(exports[0].end, 181.5)
        self.assertEqual(exports[0].distance_seconds, 67.5)

    def test_safe_filename_stem_removes_windows_reserved_characters(self) -> None:
        self.assertEqual(safe_filename_stem('A/B:C*D?"E'), "A - BCDE")

    def test_gui_segments_are_replaced_by_guided_segments_when_guide_is_present(self) -> None:
        detected = [
            {
                "id": "seg-001",
                "start": 587.0,
                "end": 970.0,
                "start_timecode": "9:47",
                "end_timecode": "16:10",
                "duration": 383.0,
            }
        ]

        segments, exports, guide_applied = build_gui_segments_and_exports("0:09:59 Song / Artist\n", detected)

        self.assertTrue(guide_applied)
        self.assertEqual(segments[0]["id"], "guide-001")
        self.assertEqual(segments[0]["start"], 599.0)
        self.assertEqual(segments[0]["end"], 970.0)
        self.assertEqual(segments[0]["title"], "Song / Artist")
        self.assertEqual(exports[0]["filename_stem"], "01_Song - Artist")
        self.assertEqual(exports[0]["start"], segments[0]["start"])
        self.assertEqual(exports[0]["end"], segments[0]["end"])

    def test_gui_segments_use_multiline_guide_titles_for_exports(self) -> None:
        detected = [
            {
                "id": "seg-001",
                "start": 0.0,
                "end": 5.0,
                "start_timecode": "0:00",
                "end_timecode": "0:05",
                "duration": 5.0,
            }
        ]

        segments, exports, guide_applied = build_gui_segments_and_exports(
            "1. 0:00~0:04\n├ Smoke Song\n└ (Smoke)\n",
            detected,
        )

        self.assertTrue(guide_applied)
        self.assertEqual(segments[0]["id"], "guide-001")
        self.assertEqual(segments[0]["title"], "Smoke Song")
        self.assertEqual(segments[0]["start"], 0.0)
        self.assertEqual(segments[0]["end"], 4.0)
        self.assertEqual(exports[0]["title"], "Smoke Song")
        self.assertEqual(exports[0]["filename_stem"], "01_Smoke Song")
        self.assertEqual(exports[0]["start"], segments[0]["start"])
        self.assertEqual(exports[0]["end"], segments[0]["end"])


if __name__ == "__main__":
    unittest.main()
