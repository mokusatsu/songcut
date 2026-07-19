from types import SimpleNamespace
from unittest import mock
from pathlib import Path
import tempfile
import time
import unittest

from songcut.api import (
    FFMPEG_DOWNLOAD_URL,
    AnalyzeRequest,
    ExportItem,
    ExportRequest,
    JobRecord,
    _analysis_job,
    _export_job,
    _jobs,
    _jobs_lock,
    ffmpeg_check,
    health,
)


class ApiJobTests(unittest.TestCase):
    def setUp(self) -> None:
        with _jobs_lock:
            _jobs.clear()

    def test_analysis_starts_transcription_job_without_waiting_for_it(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["analysis-001"] = JobRecord(
                id="analysis-001",
                kind="analysis",
                status="queued",
                created_at=now,
                updated_at=now,
            )

        payload = {
            "schema_version": 3,
            "segments": [{"id": "guide-001", "start": 10.0, "end": 20.0}],
            "export_candidates": [],
            "waveform": [],
        }

        with (
            mock.patch("songcut.api.require_file", return_value="source.mp4"),
            mock.patch("songcut.api.analyze_for_gui", return_value=payload),
            mock.patch("songcut.api.start_job", return_value=SimpleNamespace(id="transcription-001")) as start_job,
            mock.patch("songcut.api.transcribe_segments") as transcribe_segments,
        ):
            _analysis_job("analysis-001", AnalyzeRequest(path="source.mp4", transcribe=True))

        with _jobs_lock:
            completed = _jobs["analysis-001"]

        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result["transcription_job_id"], "transcription-001")
        self.assertEqual(completed.result["segments"][0]["id"], "guide-001")
        start_job.assert_called_once()
        transcribe_segments.assert_not_called()

    def test_health_does_not_fail_when_ffmpeg_is_missing(self) -> None:
        with mock.patch("songcut.api.find_ffmpeg", side_effect=FileNotFoundError("missing ffmpeg")):
            payload = health()

        self.assertTrue(payload["ok"])
        self.assertIsNone(payload["ffmpeg"])
        self.assertIsNone(payload["ffprobe"])
        self.assertIn("missing ffmpeg", payload["ffmpeg_error"])

    def test_ffmpeg_check_reports_paths(self) -> None:
        ffmpeg_paths = SimpleNamespace(ffmpeg=Path("tools/ffmpeg.exe"), ffprobe=Path("tools/ffprobe.exe"))

        with mock.patch("songcut.api.find_ffmpeg", return_value=ffmpeg_paths), mock.patch("songcut.api.subprocess.run") as run:
            payload = ffmpeg_check()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["ffmpeg"], str(Path("tools/ffmpeg.exe")))
        self.assertEqual(payload["ffprobe"], str(Path("tools/ffprobe.exe")))
        self.assertEqual(payload["download_url"], FFMPEG_DOWNLOAD_URL)
        self.assertEqual(run.call_count, 2)

    def test_ffmpeg_check_reports_download_url_when_missing(self) -> None:
        with mock.patch("songcut.api.find_ffmpeg", side_effect=FileNotFoundError("missing ffprobe")):
            payload = ffmpeg_check()

        self.assertFalse(payload["ok"])
        self.assertIsNone(payload["ffmpeg"])
        self.assertIsNone(payload["ffprobe"])
        self.assertIn("missing ffprobe", payload["error"])
        self.assertEqual(payload["download_url"], FFMPEG_DOWNLOAD_URL)

    def test_ffmpeg_check_reports_launch_failure(self) -> None:
        ffmpeg_paths = SimpleNamespace(ffmpeg=Path("tools/ffmpeg.exe"), ffprobe=Path("tools/ffprobe.exe"))

        with (
            mock.patch("songcut.api.find_ffmpeg", return_value=ffmpeg_paths),
            mock.patch("songcut.api.subprocess.run", side_effect=[None, RuntimeError("cannot launch")]),
        ):
            payload = ffmpeg_check()

        self.assertFalse(payload["ok"])
        self.assertIn("ffprobe could not be started", payload["error"])
        self.assertEqual(payload["download_url"], FFMPEG_DOWNLOAD_URL)

    def test_export_job_uses_smart_renderer(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["export-001"] = JobRecord(
                id="export-001",
                kind="export",
                status="queued",
                created_at=now,
                updated_at=now,
            )

        request = ExportRequest(
            source_path="source.mp4",
            output_dir="out",
            items=[ExportItem(id="guide-001", filename_stem="01_Song", start=10.0, end=20.0)],
        )
        ffmpeg_paths = SimpleNamespace(ffmpeg="ffmpeg.exe", ffprobe="ffprobe.exe")

        with (
            mock.patch("songcut.api.require_file", return_value="source.mp4"),
            mock.patch("songcut.api.Path.mkdir"),
            mock.patch("songcut.api.find_ffmpeg", return_value=ffmpeg_paths),
            mock.patch("songcut.api.export_smart_clip", return_value={"target": "out/01_Song.mp4"}) as export_smart_clip,
        ):
            _export_job("export-001", request)

        export_smart_clip.assert_called_once_with(
            "ffmpeg.exe",
            "ffprobe.exe",
            "source.mp4",
            mock.ANY,
            start=10.0,
            end=20.0,
        )
        with _jobs_lock:
            completed = _jobs["export-001"]
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result["exported"][0]["target"], "out/01_Song.mp4")

    def test_export_job_writes_timestamp_comment_text(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["export-001"] = JobRecord(
                id="export-001",
                kind="export",
                status="queued",
                created_at=now,
                updated_at=now,
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            request = ExportRequest(
                source_path="source.mp4",
                output_dir=temp_dir,
                items=[ExportItem(id="guide-001", filename_stem="01_Song", start=10.0, end=20.0)],
                timestamp_comment_text="0:10 - 0:20 Song\n",
            )
            ffmpeg_paths = SimpleNamespace(ffmpeg="ffmpeg.exe", ffprobe="ffprobe.exe")

            with (
                mock.patch("songcut.api.require_file", return_value="source.mp4"),
                mock.patch("songcut.api.find_ffmpeg", return_value=ffmpeg_paths),
                mock.patch("songcut.api.export_smart_clip", return_value={"target": "out/01_Song.mp4"}),
            ):
                _export_job("export-001", request)

            target = Path(temp_dir) / "ts_comments.txt"
            self.assertEqual(target.read_text(encoding="utf-8"), "0:10 - 0:20 Song\n")

        with _jobs_lock:
            completed = _jobs["export-001"]
        self.assertEqual(completed.status, "completed")
        self.assertTrue(completed.result["timestamp_comment_path"].endswith("ts_comments.txt"))


if __name__ == "__main__":
    unittest.main()
