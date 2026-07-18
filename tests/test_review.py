import json
from pathlib import Path
import tempfile
import unittest

from songcut.review import format_hms, write_review_html


class ReviewTests(unittest.TestCase):
    def test_format_hms(self) -> None:
        self.assertEqual(format_hms(587), "0:09:47")
        self.assertEqual(format_hms(4845), "1:20:45")

    def test_review_html_uses_hms_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            segments_json = root / "segments.json"
            segments_json.write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "seg-001",
                                "title": "Song / Artist",
                                "start": 587,
                                "end": 970,
                                "confidence": 0.98,
                                "source": "video-metadata",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            target = root / "review.html"

            write_review_html(segments_json, root / "video.mp4", target)
            html = target.read_text(encoding="utf-8")

        self.assertIn('value="0:09:47"', html)
        self.assertIn('value="0:16:10"', html)
        self.assertIn('value="Song / Artist"', html)
        self.assertIn('data-seek="587.0"', html)
        self.assertIn("function parseTimecode", html)


if __name__ == "__main__":
    unittest.main()
