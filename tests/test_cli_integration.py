from pathlib import Path
from contextlib import redirect_stdout
import io
import json
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from songcut.cli import main
from songcut.io import read_segments_json


class CliIntegrationTests(unittest.TestCase):
    def test_metadata_analyze_on_fixture_if_present(self) -> None:
        videos = list(Path("testdata").glob("*.mp4"))
        truth_files = list(Path("testdata").glob("*.txt"))
        if not videos or not truth_files:
            self.skipTest("testdata fixture is not present")

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            with redirect_stdout(io.StringIO()):
                analyze_code = main(["analyze", str(videos[0]), "--out", str(out_dir)])
            self.assertEqual(analyze_code, 0)

            payload = read_segments_json(out_dir / "segments.json")
            self.assertEqual(payload["timestamp_source"], "video-metadata")
            self.assertGreaterEqual(len(payload["segments"]), 10)

    def test_analyze_can_write_review_html(self) -> None:
        videos = list(Path("testdata").glob("*.mp4"))
        if not videos:
            self.skipTest("testdata fixture is not present")

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            with redirect_stdout(io.StringIO()):
                analyze_code = main(["analyze", str(videos[0]), "--out", str(out_dir), "--review"])
            self.assertEqual(analyze_code, 0)

            review_html = out_dir / "review.html"
            self.assertTrue(review_html.exists())
            self.assertIn('value="0:09:47"', review_html.read_text(encoding="utf-8"))

    def test_analyze_accepts_guide_and_reviews_guided_segments(self) -> None:
        videos = list(Path("testdata").glob("*.mp4"))
        if not videos:
            self.skipTest("testdata fixture is not present")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            guide = root / "guide.txt"
            guide.write_text("0:09:59 Song / Artist\n", encoding="utf-8")
            out_dir = root / "out"

            with redirect_stdout(io.StringIO()) as stdout:
                analyze_code = main(
                    [
                        "analyze",
                        str(videos[0]),
                        "--out",
                        str(out_dir),
                        "--guide",
                        str(guide),
                        "--review",
                    ]
                )
            self.assertEqual(analyze_code, 0)
            output = json.loads(stdout.getvalue())

            guided_segments_json = out_dir / "guided_segments.json"
            review_html = out_dir / "review.html"
            self.assertEqual(output["guided_segments_json"], str(guided_segments_json))
            self.assertTrue(guided_segments_json.exists())
            self.assertTrue(review_html.exists())

            guided_payload = read_segments_json(guided_segments_json)
            self.assertEqual(guided_payload["segments"][0]["start"], 599.0)
            self.assertEqual(guided_payload["segments"][0]["title"], "Song / Artist")
            review_text = review_html.read_text(encoding="utf-8")
            self.assertIn('value="0:09:59"', review_text)
            self.assertIn('value="Song / Artist"', review_text)

    def test_export_can_use_guide_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            segments_json = root / "segments.json"
            segments_json.write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "seg-001",
                                "start": 587.0,
                                "end": 970.0,
                                "start_timecode": "9:47",
                                "end_timecode": "16:10",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            guide = root / "guide.txt"
            guide.write_text("0:09:59 Song / Artist\n0:20:00 Explicit 0:21:00\n", encoding="utf-8")
            source = root / "source.mp4"
            source.write_text("", encoding="utf-8")
            out_dir = root / "clips"

            exported_calls = []

            def fake_export_smart_clip(_ffmpeg, _ffprobe, _source, target, *, start, end):
                exported_calls.append((target.name, start, end))
                return {"target": str(target)}

            with mock.patch("songcut.cli.find_ffmpeg") as find_ffmpeg, mock.patch(
                "songcut.cli.export_smart_clip", side_effect=fake_export_smart_clip
            ), redirect_stdout(io.StringIO()):
                find_ffmpeg.return_value.ffmpeg = root / "ffmpeg.exe"
                find_ffmpeg.return_value.ffprobe = root / "ffprobe.exe"
                code = main(
                    [
                        "export",
                        str(segments_json),
                        "--source",
                        str(source),
                        "--out",
                        str(out_dir),
                        "--guide",
                        str(guide),
                    ]
                )

        self.assertEqual(code, 0)
        self.assertEqual(exported_calls[0], ("01_Song - Artist.mp4", 599.0, 970.0))
        self.assertEqual(exported_calls[1], ("02_Explicit.mp4", 1200.0, 1260.0))

    def test_export_uses_filename_stem_from_guided_segments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            segments_json = root / "guided_segments.json"
            segments_json.write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "guide-001",
                                "title": "Song / Artist",
                                "filename_stem": "01_Song - Artist",
                                "start": 599.0,
                                "end": 970.0,
                                "start_timecode": "9:59",
                                "end_timecode": "16:10",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            source = root / "source.mp4"
            source.write_text("", encoding="utf-8")
            out_dir = root / "clips"
            exported_calls = []

            def fake_export_smart_clip(_ffmpeg, _ffprobe, _source, target, *, start, end):
                exported_calls.append((target.name, start, end))
                return {"target": str(target)}

            with mock.patch("songcut.cli.find_ffmpeg") as find_ffmpeg, mock.patch(
                "songcut.cli.export_smart_clip", side_effect=fake_export_smart_clip
            ), redirect_stdout(io.StringIO()):
                find_ffmpeg.return_value.ffmpeg = root / "ffmpeg.exe"
                find_ffmpeg.return_value.ffprobe = root / "ffprobe.exe"
                code = main(
                    [
                        "export",
                        str(segments_json),
                        "--source",
                        str(source),
                        "--out",
                        str(out_dir),
                    ]
                )

        self.assertEqual(code, 0)
        self.assertEqual(exported_calls[0], ("01_Song - Artist.mp4", 599.0, 970.0))

    def test_export_accurate_mode_uses_legacy_export_clip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            segments_json = root / "segments.json"
            segments_json.write_text(
                json.dumps(
                    {
                        "segments": [
                            {
                                "id": "seg-001",
                                "start": 10.0,
                                "end": 20.0,
                                "start_timecode": "0:10",
                                "end_timecode": "0:20",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            source = root / "source.mp4"
            source.write_text("", encoding="utf-8")
            out_dir = root / "clips"
            exported_calls = []

            def fake_export_clip(_ffmpeg, _source, target, *, start, end, mode):
                exported_calls.append((target.name, start, end, mode))

            with (
                mock.patch("songcut.cli.find_ffmpeg") as find_ffmpeg,
                mock.patch("songcut.cli.export_clip", side_effect=fake_export_clip),
                mock.patch("songcut.cli.export_smart_clip") as export_smart_clip,
                redirect_stdout(io.StringIO()),
            ):
                find_ffmpeg.return_value.ffmpeg = root / "ffmpeg.exe"
                find_ffmpeg.return_value.ffprobe = root / "ffprobe.exe"
                code = main(
                    [
                        "export",
                        str(segments_json),
                        "--source",
                        str(source),
                        "--out",
                        str(out_dir),
                        "--mode",
                        "accurate",
                    ]
                )

        self.assertEqual(code, 0)
        export_smart_clip.assert_not_called()
        self.assertEqual(exported_calls[0], ("seg-001_0-10_0-20.mp4", 10.0, 20.0, "accurate"))

    def test_wrapper_runs_from_another_directory(self) -> None:
        wrapper = Path("songcut_cli.py").resolve()
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(wrapper), "devices"],
                cwd=tmp,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

        payload = json.loads(result.stdout)
        self.assertIn("ffmpeg", payload)
        self.assertIn("backend", payload)


if __name__ == "__main__":
    unittest.main()
