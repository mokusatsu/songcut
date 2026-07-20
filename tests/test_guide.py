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

    def test_single_timestamp_end_is_capped_at_next_guide_timestamp(self) -> None:
        entries = parse_guide_text("0:00:10 Song A\n0:00:20 Song B\n")
        exports = build_guided_exports(
            entries,
            [{"start": 5.0, "end": 40.0}],
            max_distance_seconds=90,
        )

        self.assertEqual(exports[0].start, 10.0)
        self.assertEqual(exports[0].end, 20.0)
        self.assertEqual(exports[0].match_source, "guide-nearby-segment")
        self.assertEqual(exports[1].start, 20.0)
        self.assertEqual(exports[1].end, 40.0)

    def test_single_timestamp_end_at_next_guide_timestamp_is_not_shortened(self) -> None:
        entries = parse_guide_text("0:00:10 Song A\n0:00:20 Song B\n")
        exports = build_guided_exports(
            entries,
            [
                {"start": 5.0, "end": 20.0},
                {"start": 20.0, "end": 40.0},
            ],
            max_distance_seconds=90,
        )

        self.assertEqual(exports[0].end, 20.0)
        self.assertEqual(exports[1].end, 40.0)

    def test_explicit_range_is_not_capped_at_next_guide_timestamp(self) -> None:
        entries = parse_guide_text("0:00:10 Song A 0:00:30\n0:00:20 Song B\n")
        exports = build_guided_exports(
            entries,
            [{"start": 20.0, "end": 40.0}],
            max_distance_seconds=90,
        )

        self.assertEqual(exports[0].start, 10.0)
        self.assertEqual(exports[0].end, 30.0)
        self.assertEqual(exports[0].match_source, "guide-range")

    def test_non_increasing_next_guide_timestamp_does_not_create_invalid_range(self) -> None:
        entries = parse_guide_text("0:00:20 Song A\n0:00:10 Song B\n")
        exports = build_guided_exports(
            entries,
            [{"start": 5.0, "end": 40.0}],
            max_distance_seconds=90,
        )

        self.assertEqual([(item.start, item.end) for item in exports], [(10.0, 20.0), (20.0, 40.0)])

    def test_unmatched_timestamp_uses_earlier_next_guide_timestamp(self) -> None:
        entries = parse_guide_text("0:37:20 MC\n0:38:58 Next song\n")
        exports = build_guided_exports(
            entries,
            [{"start": 2340.0, "end": 2440.0}],
            max_distance_seconds=90,
            media_duration=2500.0,
        )

        fallback = next(item for item in exports if item.title == "MC")
        self.assertEqual((fallback.start, fallback.end), (2240.0, 2338.0))
        self.assertEqual(fallback.match_source, "guide-timestamp-fallback")

    def test_unmatched_timestamp_uses_earlier_detected_segment_start(self) -> None:
        entries = parse_guide_text("0:37:20 MC\n0:40:00 Next song\n")
        exports = build_guided_exports(
            entries,
            [{"start": 2340.0, "end": 2440.0}],
            max_distance_seconds=90,
            media_duration=2500.0,
        )

        fallback = next(item for item in exports if item.title == "MC")
        self.assertEqual((fallback.start, fallback.end), (2240.0, 2340.0))

    def test_unmatched_timestamp_uses_only_available_end_candidate(self) -> None:
        next_guide_only = build_guided_exports(
            parse_guide_text("0:00:10 MC\n0:00:20 Next\n"),
            [],
        )
        detected_only = build_guided_exports(
            parse_guide_text("0:00:10 MC\n"),
            [{"start": 120.0, "end": 150.0}],
        )

        self.assertEqual([(item.start, item.end) for item in next_guide_only], [(10.0, 20.0)])
        self.assertEqual([(item.start, item.end) for item in detected_only], [(10.0, 120.0)])

    def test_unmatched_timestamp_uses_video_end_when_no_other_candidate_exists(self) -> None:
        exports = build_guided_exports(
            parse_guide_text("0:00:10 MC\n"),
            [],
            media_duration=100.0,
        )

        self.assertEqual([(item.start, item.end) for item in exports], [(10.0, 100.0)])

    def test_invalid_fallback_range_is_skipped_without_raising(self) -> None:
        exports = build_guided_exports(
            parse_guide_text("0:01:40 At video end\n"),
            [],
            media_duration=100.0,
        )

        self.assertEqual(exports, [])

    def test_fallback_segments_are_sorted_positive_and_keep_guide_metadata(self) -> None:
        segments, exports, guide_applied = build_gui_segments_and_exports(
            "0:00:40 Late\n0:00:10 Early / Artist\n",
            [],
            media_duration=60.0,
        )

        self.assertTrue(guide_applied)
        self.assertEqual([(item["start"], item["end"]) for item in segments], [(10.0, 40.0), (40.0, 60.0)])
        self.assertTrue(all(float(item["end"]) > float(item["start"]) for item in segments))
        early = segments[0]
        self.assertEqual(early["title"], "Early / Artist")
        self.assertEqual(early["filename_stem"], "02_Early - Artist")
        self.assertEqual(early["guide_line_number"], 2)
        self.assertEqual(early["guide_line"], "0:00:10 Early / Artist")
        self.assertEqual(early["source"], "guide-timestamp-fallback")
        self.assertEqual(early["match_source"], "guide-timestamp-fallback")
        self.assertEqual(early["flags"], ["guide", "provisional", "no-detected-singing"])
        self.assertEqual(exports[0]["match_source"], "guide-timestamp-fallback")

    def test_safe_filename_stem_removes_windows_reserved_characters(self) -> None:
        self.assertEqual(safe_filename_stem('A/B:C*D?"E'), "A - BCDE")
        self.assertEqual(safe_filename_stem("CON.txt", fallback="clip-001"), "clip-001")

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

    def test_gui_segments_and_exports_share_next_guide_timestamp_cap(self) -> None:
        detected = [
            {
                "id": "seg-001",
                "start": 5.0,
                "end": 40.0,
                "start_timecode": "0:05",
                "end_timecode": "0:40",
                "duration": 35.0,
            }
        ]

        segments, exports, guide_applied = build_gui_segments_and_exports(
            "0:00:10 Song A\n0:00:20 Song B\n",
            detected,
        )

        self.assertTrue(guide_applied)
        self.assertEqual(segments[0]["end"], 20.0)
        self.assertEqual(exports[0]["end"], 20.0)
        self.assertEqual(segments[1]["end"], 40.0)
        self.assertEqual(exports[1]["end"], 40.0)


if __name__ == "__main__":
    unittest.main()
