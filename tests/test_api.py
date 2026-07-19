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
    ProbeRequest,
    ScratchProxyRequest,
    _analysis_job,
    _export_job,
    _job_cancel_events,
    _jobs,
    _jobs_lock,
    _scratch_proxy_job,
    cancel_scratch_proxy_job,
    ffmpeg_check,
    health,
    probe,
)


class ApiJobTests(unittest.TestCase):
    def setUp(self) -> None:
        with _jobs_lock:
            _jobs.clear()
            _job_cancel_events.clear()

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

    def test_probe_includes_timestamp_comment_candidates_and_warning(self) -> None:
        source = Path("video.webm")
        candidates = [
            {
                "source": "description",
                "id": "description",
                "author": "Uploader",
                "text": "0:00 Start\n1:00 Song",
                "timestamp_count": 2,
                "like_count": None,
            }
        ]
        with (
            mock.patch("songcut.api.require_file", return_value=source),
            mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffprobe=Path("ffprobe.exe"))),
            mock.patch("songcut.api.probe_video", return_value={"duration": 10.0}) as probe_video,
            mock.patch(
                "songcut.api.load_timestamp_comment_candidates",
                return_value=(candidates, "metadata warning"),
            ),
        ):
            payload = probe(ProbeRequest(path=str(source)))

        probe_video.assert_called_once_with(Path("ffprobe.exe"), source)
        self.assertEqual(payload["timestamp_comment_candidates"], candidates)
        self.assertEqual(payload["info_json_warning"], "metadata warning")

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

    def test_scratch_proxy_job_completes_with_manager_result(self) -> None:
        now = time.time()
        cancel_event = mock.Mock()
        cancel_event.is_set.return_value = False
        with _jobs_lock:
            _jobs["proxy-001"] = JobRecord(
                id="proxy-001",
                kind="scratch-proxy",
                status="queued",
                created_at=now,
                updated_at=now,
            )
            _job_cancel_events["proxy-001"] = cancel_event
        result = {
            "proxy_id": "result-001",
            "source_path": "source.webm",
            "proxy_path": "proxy.m4a",
            "codec": "aac",
            "profile": "LC",
            "sample_rate": 48000,
            "channels": 1,
            "bit_rate": 64000,
            "encoder": "aac_mf",
            "duration": 10.0,
        }
        ffmpeg_paths = SimpleNamespace(ffmpeg=Path("ffmpeg"), ffprobe=Path("ffprobe"))
        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.webm")),
            mock.patch("songcut.api.find_ffmpeg", return_value=ffmpeg_paths),
            mock.patch("songcut.api.probe_video", return_value={"duration": 10.0}),
            mock.patch("songcut.api._scratch_proxy_manager.create", return_value=result) as create,
        ):
            _scratch_proxy_job("proxy-001", ScratchProxyRequest(path="source.webm"), cancel_event)

        create.assert_called_once()
        with _jobs_lock:
            completed = _jobs["proxy-001"]
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result["proxy_id"], "result-001")
        self.assertNotIn("proxy-001", _job_cancel_events)

    def test_cancel_scratch_proxy_job_marks_job_cancelled(self) -> None:
        now = time.time()
        cancel_event = mock.Mock()
        with _jobs_lock:
            _jobs["proxy-001"] = JobRecord(
                id="proxy-001",
                kind="scratch-proxy",
                status="running",
                created_at=now,
                updated_at=now,
            )
            _job_cancel_events["proxy-001"] = cancel_event
        with mock.patch("songcut.api._scratch_proxy_manager.cancel") as cancel:
            result = cancel_scratch_proxy_job("proxy-001")
        cancel_event.set.assert_called_once()
        cancel.assert_called_once_with("proxy-001")
        self.assertEqual(result.status, "cancelled")

    def test_scratch_proxy_job_releases_result_when_cancelled_during_encode(self) -> None:
        now = time.time()
        cancel_event = mock.Mock()
        cancel_event.is_set.side_effect = [False, True]
        with _jobs_lock:
            _jobs["proxy-001"] = JobRecord(
                id="proxy-001",
                kind="scratch-proxy",
                status="queued",
                created_at=now,
                updated_at=now,
            )
            _job_cancel_events["proxy-001"] = cancel_event
        result = {"proxy_id": "result-001"}
        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.webm")),
            mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffmpeg=Path("ffmpeg"), ffprobe=Path("ffprobe"))),
            mock.patch("songcut.api.probe_video", return_value={"duration": 10.0}),
            mock.patch("songcut.api._scratch_proxy_manager.create", return_value=result),
            mock.patch("songcut.api._scratch_proxy_manager.release") as release,
        ):
            _scratch_proxy_job("proxy-001", ScratchProxyRequest(path="source.webm"), cancel_event)

        release.assert_called_once_with("result-001")
        with _jobs_lock:
            cancelled = _jobs["proxy-001"]
        self.assertEqual(cancelled.status, "cancelled")


if __name__ == "__main__":
    unittest.main()
