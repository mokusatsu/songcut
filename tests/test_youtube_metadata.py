import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from songcut.youtube_metadata import count_youtube_timecodes, load_timestamp_comment_candidates


class YoutubeMetadataTests(unittest.TestCase):
    def test_description_and_top_comment_are_selected(self) -> None:
        candidates, warning = self._load(
            {
                "uploader": "Uploader",
                "description": "0:00 Start\n1:00 Song",
                "comments": [
                    {"id": "second", "author": "B", "text": "0:10 One\n0:20 Two", "like_count": 50},
                    {"id": "first", "author": "A", "text": "0:10 One\n0:20 Two\n0:30 Three", "like_count": 1},
                ],
            }
        )

        self.assertIsNone(warning)
        self.assertEqual([item["source"] for item in candidates], ["description", "comment"])
        self.assertEqual(candidates[0]["author"], "Uploader")
        self.assertEqual(candidates[0]["timestamp_count"], 2)
        self.assertIsNone(candidates[0]["like_count"])
        self.assertEqual(candidates[1]["id"], "first")

    def test_top_two_comments_are_selected_without_description_candidate(self) -> None:
        candidates, warning = self._load(
            {
                "description": "0:00 only one",
                "comments": [
                    {"id": "source-order", "text": "0:01 A\n0:02 B", "like_count": 5},
                    {"id": "more-liked", "text": "0:03 C\n0:04 D", "like_count": 8},
                    {"id": "most", "text": "0:05 E\n0:06 F\n0:07 G", "like_count": 0},
                    {"id": "later-tie", "text": "0:08 H\n0:09 I", "like_count": 5},
                ],
            }
        )

        self.assertIsNone(warning)
        self.assertEqual([item["id"] for item in candidates], ["most", "more-liked"])

    def test_comment_ties_keep_json_order(self) -> None:
        candidates, warning = self._load(
            {
                "comments": [
                    {"id": "first", "text": "0:01 A\n0:02 B", "like_count": 5},
                    {"id": "second", "text": "0:03 C\n0:04 D", "like_count": 5},
                    {"id": "third", "text": "0:05 E\n0:06 F", "like_count": 5},
                ]
            }
        )

        self.assertIsNone(warning)
        self.assertEqual([item["id"] for item in candidates], ["first", "second"])

    def test_description_can_be_the_only_candidate(self) -> None:
        candidates, warning = self._load({"uploader": "投稿者", "description": "0:00 開始\n2:00 曲"})

        self.assertIsNone(warning)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["source"], "description")
        self.assertEqual(candidates[0]["author"], "投稿者")

    def test_repeated_timecodes_are_counted_and_original_text_is_preserved(self) -> None:
        text = "New viewer: 57:33\n新規です: 57:33"
        candidates, warning = self._load({"comments": [{"text": text}]})

        self.assertIsNone(warning)
        self.assertEqual(count_youtube_timecodes(text), 2)
        self.assertEqual(candidates[0]["timestamp_count"], 2)
        self.assertEqual(candidates[0]["text"], text)
        self.assertEqual(candidates[0]["id"], "comment-1")

    def test_missing_and_invalid_fields_are_ignored(self) -> None:
        candidates, warning = self._load(
            {
                "description": None,
                "comments": [None, "text", {}, {"text": 123}, {"text": "0:01 one timestamp"}],
            }
        )

        self.assertEqual(candidates, [])
        self.assertIsNone(warning)

    def test_missing_info_json_is_not_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            candidates, warning = load_timestamp_comment_candidates(Path(temp_dir) / "video.webm")

        self.assertEqual(candidates, [])
        self.assertIsNone(warning)

    def test_utf8_bom_is_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "video.webm"
            info_path = source.with_suffix(".info.json")
            payload = json.dumps({"description": "0:00 開始\n1:00 曲"}, ensure_ascii=False).encode("utf-8")
            info_path.write_bytes(b"\xef\xbb\xbf" + payload)

            candidates, warning = load_timestamp_comment_candidates(source)

        self.assertIsNone(warning)
        self.assertEqual(candidates[0]["text"], "0:00 開始\n1:00 曲")

    def test_broken_json_returns_a_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "video.webm"
            source.with_suffix(".info.json").write_text("{broken", encoding="utf-8")

            candidates, warning = load_timestamp_comment_candidates(source)

        self.assertEqual(candidates, [])
        self.assertIn("Could not read video.info.json", warning or "")

    def test_read_error_returns_a_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "video.webm"
            source.with_suffix(".info.json").write_text("{}", encoding="utf-8")
            with mock.patch("songcut.youtube_metadata.Path.read_text", side_effect=OSError("access denied")):
                candidates, warning = load_timestamp_comment_candidates(source)

        self.assertEqual(candidates, [])
        self.assertIn("access denied", warning or "")

    def test_non_object_json_returns_a_warning(self) -> None:
        candidates, warning = self._load(["not", "an", "object"])

        self.assertEqual(candidates, [])
        self.assertIn("expected a JSON object", warning or "")

    def _load(self, payload: object) -> tuple[list[dict[str, object]], str | None]:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "video.webm"
            source.with_suffix(".info.json").write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
            return load_timestamp_comment_candidates(source)


if __name__ == "__main__":
    unittest.main()
