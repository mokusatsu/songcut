from types import SimpleNamespace
from unittest import mock
from pathlib import Path
import tempfile
import time
import unittest

from songcut.api import (
    FFMPEG_DOWNLOAD_URL,
    AnalyzeRequest,
    BoundaryRefinementRequest,
    DemucsDownloadRequest,
    ExportItem,
    ExportPlanRequest,
    ExportRequest,
    JobRecord,
    LyricsAnalysisRequest,
    MmsDownloadRequest,
    ProbeRequest,
    ScratchProxyRequest,
    SubtitleRenderRequest,
    TranscriptionRequest,
    TranscriptionSegmentRequest,
    WhisperDownloadRequest,
    _analysis_job,
    _download_demucs_job,
    _download_mms_job,
    _download_whisper_job,
    _export_job,
    _lyrics_analysis_job,
    _job_cancel_events,
    _jobs,
    _jobs_lock,
    _waveform_finished_at,
    _waveform_points,
    _scratch_proxy_job,
    _subtitle_render_job,
    cancel_scratch_proxy_job,
    create_transcription_job,
    create_export_plan,
    download_demucs_model,
    download_mms_model,
    download_whisper_model,
    ffmpeg_check,
    health,
    probe,
    update_job,
    waveform_job_updates,
)
from pydantic import ValidationError
from fastapi import HTTPException
from songcut.gui_pipeline import build_gui_segments_and_exports
from songcut.lyrics_alignment import AlignedLyricsLine
from songcut.mms_alignment import MmsRefinementDiagnostics


class ApiJobTests(unittest.TestCase):
    def setUp(self) -> None:
        with _jobs_lock:
            _jobs.clear()
            _job_cancel_events.clear()
            _waveform_points.clear()
            _waveform_finished_at.clear()

    def test_boundary_refinement_request_rejects_invalid_hysteresis(self) -> None:
        with self.assertRaises(ValidationError):
            BoundaryRefinementRequest(low_occupancy=0.5, high_occupancy=0.5)

    def test_subtitle_render_job_returns_cache_identity_with_png(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["subtitle-render-001"] = JobRecord(
                id="subtitle-render-001",
                kind="subtitle-render",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        request = SubtitleRenderRequest.model_validate(
            {
                "play_res_x": 1920,
                "play_res_y": 1080,
                "items": [
                    {
                        "segment_id": "lyrics-001",
                        "signature": "static-signature",
                        "text": "歌詞",
                        "style": {},
                    }
                ],
            }
        )

        with (
            mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffmpeg="ffmpeg")),
            mock.patch(
                "songcut.api.render_subtitle_png_base64",
                return_value="iVBORw0KGgo=",
            ) as render,
        ):
            _subtitle_render_job("subtitle-render-001", request)

        with _jobs_lock:
            completed = _jobs["subtitle-render-001"]
        self.assertEqual(completed.status, "completed")
        self.assertEqual(
            completed.result["items"][0],
            {
                "segment_id": "lyrics-001",
                "signature": "static-signature",
                "png_base64": "iVBORw0KGgo=",
                "width": 1920,
                "height": 1080,
            },
        )
        render.assert_called_once()

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

    def test_lyrics_analysis_returns_rhythm_grid_and_confidence_outliers(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["lyrics-001"] = JobRecord(
                id="lyrics-001",
                kind="lyrics-analysis",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        confidences = [0.1, 1.0, 1.0, 1.0, 1.0]
        lines = [
            AlignedLyricsLine(
                index=index,
                text=f"line {index}",
                start=float(index),
                end=float(index) + 0.5,
                confidence=confidence,
                source="whisper-chunk",
                matched_characters=1,
                exact_characters=1,
                total_characters=1,
            )
            for index, confidence in enumerate(confidences, start=1)
        ]
        alignment = SimpleNamespace(title="title", lines=lines)
        separated = SimpleNamespace(
            vocals=Path("temporary/vocals.wav"),
            no_vocals=Path("temporary/no_vocals.wav"),
            model="htdemucs",
        )

        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.mp4")),
            mock.patch("songcut.api.separate_vocals", return_value=separated) as separate,
            mock.patch(
                "songcut.api.transcribe_whisper_chunks",
                return_value=([], "recognized", 10.0, "CPU"),
            ) as transcribe,
            mock.patch("songcut.api.align_lyrics_to_chunks", return_value=alignment),
            mock.patch(
                "songcut.api.refine_standard_alignment_with_mms",
                return_value=(
                    alignment,
                    MmsRefinementDiagnostics(
                        applied_line_indexes=[1],
                        candidate_line_count=5,
                        first_reliable_whisper_line=1,
                        path_score=-0.5,
                        star_ratio=0.4,
                        variant="q4",
                    ),
                ),
            ) as refine_mms,
            mock.patch(
                "songcut.api.detect_beat_times",
                return_value=(120.0, [0.0, 0.5, 1.0], 10.0),
            ) as detect_beats,
        ):
            _lyrics_analysis_job(
                "lyrics-001",
                LyricsAnalysisRequest(source_path="source.mp4", lyrics_text="title\n\nline"),
            )

        completed = _jobs["lyrics-001"]
        self.assertEqual(completed.status, "completed")
        self.assertTrue(completed.result["rhythm_grid"])
        self.assertEqual(completed.result["algorithm"], "songcut-standard")
        self.assertEqual(completed.result["lyrics_audio_source"], "demucs-vocals")
        separate.assert_called_once()
        transcribe.assert_called_once()
        self.assertEqual(transcribe.call_args.args[0], separated.vocals)
        refine_mms.assert_called_once()
        self.assertEqual(refine_mms.call_args.args[0], separated.vocals)
        self.assertEqual(completed.result["mms_diagnostics"]["applied_line_indexes"], [1])
        detect_beats.assert_called_once_with(Path("source.mp4"))
        self.assertEqual(completed.result["confidence_statistics"]["low_outlier_indexes"], [1])
        self.assertTrue(completed.result["lines"][0]["low_confidence_outlier"])

    def test_uta_align_receives_original_media_and_demucs_vocals(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["lyrics-uta-001"] = JobRecord(
                id="lyrics-uta-001",
                kind="lyrics-analysis",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        lines = [
            AlignedLyricsLine(
                index=1,
                text="line",
                start=1.0,
                end=2.0,
                confidence=0.9,
                source="uta-align",
                matched_characters=4,
                exact_characters=4,
                total_characters=4,
            )
        ]
        separated = SimpleNamespace(
            vocals=Path("temporary/vocals.wav"),
            no_vocals=Path("temporary/no_vocals.wav"),
            model="htdemucs",
        )
        uta_output = SimpleNamespace(
            title="title",
            lines=lines,
            whisper_text="recognized",
            duration=10.0,
            device_used="CPU",
            diagnostics={"used_vocal_stem_for_stt": True},
        )

        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.mp4")),
            mock.patch("songcut.api.separate_vocals", return_value=separated),
            mock.patch("songcut.api.align_lyrics_with_uta", return_value=uta_output) as uta_align,
            mock.patch("songcut.api.transcribe_whisper_chunks") as transcribe,
            mock.patch("songcut.api.align_lyrics_to_chunks") as standard_align,
            mock.patch(
                "songcut.api.detect_beat_times",
                return_value=(120.0, [0.0, 0.5, 1.0], 10.0),
            ),
        ):
            _lyrics_analysis_job(
                "lyrics-uta-001",
                LyricsAnalysisRequest(
                    source_path="source.mp4",
                    lyrics_text="title\n\nline",
                    algorithm="uta-align",
                ),
            )

        completed = _jobs["lyrics-uta-001"]
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result["algorithm"], "uta-align")
        self.assertTrue(
            completed.result["uta_align_diagnostics"]["used_vocal_stem_for_stt"]
        )
        uta_align.assert_called_once()
        self.assertEqual(uta_align.call_args.args[0], Path("source.mp4"))
        self.assertEqual(uta_align.call_args.args[1], separated.vocals)
        transcribe.assert_not_called()
        standard_align.assert_not_called()

    def test_job_messages_keep_english_and_add_localization_metadata(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["job-001"] = JobRecord(
                id="job-001",
                kind="transcription",
                status="running",
                created_at=now,
                updated_at=now,
            )

        update_job("job-001", message="Transcribed 2/5 segments.")

        with _jobs_lock:
            updated = _jobs["job-001"]
        self.assertEqual(updated.message, "Transcribed 2/5 segments.")
        self.assertEqual(updated.message_code, "transcriptionProgress")
        self.assertEqual(updated.message_args, {"current": 2, "total": 5})

        update_job("job-001", message="Separating vocals with Demucs.")

        with _jobs_lock:
            updated = _jobs["job-001"]
        self.assertEqual(updated.message_code, "lyricsSeparatingVocals")
        self.assertIsNone(updated.message_args)

    def test_waveform_updates_return_only_points_after_the_cursor(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["waveform-001"] = JobRecord(
                id="waveform-001",
                kind="waveform",
                status="running",
                progress=0.5,
                message="Generating waveform.",
                created_at=now,
                updated_at=now,
            )
            _waveform_points["waveform-001"] = [
                {"t": index + 0.5, "min": -0.1, "max": 0.1, "rms": 0.05, "sample_count": 4000}
                for index in range(5)
            ]

        update = waveform_job_updates("waveform-001", cursor=2, limit=2)
        self.assertEqual(update["cursor"], 4)
        self.assertEqual([point["t"] for point in update["points"]], [2.5, 3.5])
        self.assertTrue(update["has_more"])

    def test_unmatched_guide_timestamp_does_not_fail_analysis_job(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["analysis-fallback"] = JobRecord(
                id="analysis-fallback",
                kind="analysis",
                status="queued",
                created_at=now,
                updated_at=now,
            )

        segments, candidates, _guide_applied = build_gui_segments_and_exports(
            "0:00:10 MC\n",
            [],
            media_duration=60.0,
        )
        payload = {
            "schema_version": 3,
            "segments": segments,
            "export_candidates": candidates,
            "waveform": [],
        }
        with (
            mock.patch("songcut.api.require_file", return_value="source.mp4"),
            mock.patch("songcut.api.analyze_for_gui", return_value=payload),
        ):
            _analysis_job("analysis-fallback", AnalyzeRequest(path="source.mp4", transcribe=False))

        with _jobs_lock:
            completed = _jobs["analysis-fallback"]
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result["segments"][0]["source"], "guide-timestamp-fallback")

    def test_invalid_whisper_model_is_rejected_before_starting_download(self) -> None:
        with mock.patch("songcut.api.start_job") as start_job:
            with self.assertRaises(HTTPException) as raised:
                download_whisper_model(WhisperDownloadRequest(model="large"))
        self.assertEqual(raised.exception.status_code, 400)
        start_job.assert_not_called()

    def test_empty_whisper_download_body_uses_application_default(self) -> None:
        self.assertEqual(
            WhisperDownloadRequest().model,
            "whisper-large-v3-turbo-int8-ov",
        )
        sentinel = SimpleNamespace(id="download-001")
        with mock.patch("songcut.api.start_job", return_value=sentinel) as start_job:
            result = download_whisper_model(None)
        self.assertIs(result, sentinel)
        self.assertEqual(start_job.call_args.args[0], "download-whisper")

    def test_whisper_download_job_reports_byte_progress(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["download-001"] = JobRecord(
                id="download-001",
                kind="download-whisper",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        updates: list[dict[str, object]] = []
        original_update_job = update_job

        def capture_update(job_id: str, **changes: object) -> bool:
            updates.append(dict(changes))
            return original_update_job(job_id, **changes)

        def fake_ensure_whisper_model(**kwargs: object) -> Path:
            progress_callback = kwargs["progress_callback"]
            progress_callback(50, 100)
            progress_callback(100, 100)
            return Path("model")

        with (
            mock.patch("songcut.api.update_job", side_effect=capture_update),
            mock.patch("songcut.api.ensure_whisper_model", side_effect=fake_ensure_whisper_model),
            mock.patch("songcut.api.resolve_whisper_model_dir", return_value=(Path("model"), "downloaded")),
            mock.patch("songcut.api.directory_size", return_value=100),
        ):
            _download_whisper_job("download-001", "small")

        progress_updates = [
            update
            for update in updates
            if isinstance(update.get("result"), dict)
            and "downloaded_bytes" in update["result"]
        ]
        self.assertTrue(progress_updates)
        self.assertEqual(progress_updates[0]["progress"], 0.5)
        self.assertEqual(progress_updates[-1]["result"]["downloaded_bytes"], 100)
        self.assertEqual(progress_updates[-1]["result"]["total_bytes"], 100)
        self.assertEqual(progress_updates[-1]["progress"], 1.0)
        self.assertEqual(_jobs["download-001"].status, "completed")

    def test_demucs_download_endpoint_starts_dedicated_job(self) -> None:
        sentinel = SimpleNamespace(id="demucs-download-001")
        with mock.patch("songcut.api.start_job", return_value=sentinel) as start_job:
            result = download_demucs_model(DemucsDownloadRequest())
        self.assertIs(result, sentinel)
        self.assertEqual(start_job.call_args.args[0], "download-demucs")

    def test_demucs_download_job_reports_byte_progress(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["demucs-download-001"] = JobRecord(
                id="demucs-download-001",
                kind="download-demucs",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        updates: list[dict[str, object]] = []
        original_update_job = update_job

        def capture_update(job_id: str, **changes: object) -> bool:
            updates.append(dict(changes))
            return original_update_job(job_id, **changes)

        def fake_ensure_demucs_model(**kwargs: object) -> Path:
            progress_callback = kwargs["progress_callback"]
            progress_callback(25, 100)
            progress_callback(100, 100)
            return Path("demucs-model")

        with (
            mock.patch("songcut.api.update_job", side_effect=capture_update),
            mock.patch("songcut.api.ensure_demucs_model", side_effect=fake_ensure_demucs_model),
            mock.patch(
                "songcut.api.resolve_demucs_model_dir",
                return_value=(Path("demucs-model"), "downloaded"),
            ),
            mock.patch("songcut.api.directory_size", return_value=100),
        ):
            _download_demucs_job("demucs-download-001")

        progress_updates = [
            update
            for update in updates
            if isinstance(update.get("result"), dict)
            and "downloaded_bytes" in update["result"]
        ]
        self.assertEqual(progress_updates[0]["progress"], 0.25)
        self.assertEqual(progress_updates[-1]["progress"], 1.0)
        self.assertEqual(_jobs["demucs-download-001"].status, "completed")

    def test_mms_download_endpoint_starts_dedicated_job(self) -> None:
        sentinel = SimpleNamespace(id="mms-download-001")
        with mock.patch("songcut.api.start_job", return_value=sentinel) as start_job:
            result = download_mms_model(MmsDownloadRequest())
        self.assertIs(result, sentinel)
        self.assertEqual(start_job.call_args.args[0], "download-mms")

    def test_mms_download_job_reports_byte_progress(self) -> None:
        now = time.time()
        with _jobs_lock:
            _jobs["mms-download-001"] = JobRecord(
                id="mms-download-001",
                kind="download-mms",
                status="queued",
                created_at=now,
                updated_at=now,
            )
        updates: list[dict[str, object]] = []
        original_update_job = update_job

        def capture_update(job_id: str, **changes: object) -> bool:
            updates.append(dict(changes))
            return original_update_job(job_id, **changes)

        def fake_ensure_mms_model(**kwargs: object) -> Path:
            progress_callback = kwargs["progress_callback"]
            progress_callback(40, 100)
            progress_callback(100, 100)
            return Path("mms-model") / "onnx" / "model_q4.onnx"

        with (
            mock.patch("songcut.api.update_job", side_effect=capture_update),
            mock.patch("songcut.api.ensure_mms_onnx_model", side_effect=fake_ensure_mms_model),
            mock.patch(
                "songcut.api.resolve_mms_onnx_model_dir",
                return_value=(Path("mms-model"), "downloaded"),
            ),
            mock.patch("songcut.api.directory_size", return_value=100),
        ):
            _download_mms_job("mms-download-001")

        progress_updates = [
            update
            for update in updates
            if isinstance(update.get("result"), dict)
            and "downloaded_bytes" in update["result"]
        ]
        self.assertEqual(progress_updates[0]["progress"], 0.4)
        self.assertEqual(progress_updates[-1]["progress"], 1.0)
        self.assertEqual(_jobs["mms-download-001"].status, "completed")

    def test_transcription_job_requires_installed_selected_model(self) -> None:
        request = TranscriptionRequest(
            source_path="source.mp4",
            segments=[TranscriptionSegmentRequest(id="seg-001", start=1.0, end=2.0)],
            model="tiny",
        )
        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.mp4")),
            mock.patch("songcut.api.select_whisper_runtime"),
            mock.patch("songcut.api.resolve_whisper_model_dir", return_value=None),
            mock.patch("songcut.api.start_job") as start_job,
        ):
            with self.assertRaises(HTTPException) as raised:
                create_transcription_job(request)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail, {"code": "WHISPER_MODEL_NOT_READY", "model": "tiny"})
        start_job.assert_not_called()

    def test_transcription_job_normalizes_legacy_language_and_passes_settings(self) -> None:
        request = TranscriptionRequest(
            source_path="source.mp4",
            segments=[TranscriptionSegmentRequest(id="seg-001", start=1.0, end=2.0)],
            model="base",
            language="<|ja|>",
            device="gpu",
            initial_prompt="guide",
        )
        sentinel = SimpleNamespace(id="transcription-001")
        with (
            mock.patch("songcut.api.require_file", return_value=Path("source.mp4")),
            mock.patch("songcut.api.select_whisper_runtime"),
            mock.patch("songcut.api.resolve_whisper_model_dir", return_value=(Path("model"), "downloaded")),
            mock.patch("songcut.api.start_job", return_value=sentinel) as start_job,
            mock.patch("songcut.api._transcription_job") as transcription_job,
        ):
            result = create_transcription_job(request)
            start_job.call_args.args[1]("transcription-001")
        self.assertIs(result, sentinel)
        transcription_job.assert_called_once_with(
            "transcription-001",
            Path("source.mp4"),
            [{"id": "seg-001", "start": 1.0, "end": 2.0}],
            model_key="base",
            requested_device="gpu",
            language="ja",
            initial_prompt="guide",
        )

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
            mock.patch(
                "songcut.api.probe_video",
                return_value={"duration": 10.0, "format_name": "matroska,webm", "video": {"codec": "vp9"}},
            ) as probe_video,
            mock.patch(
                "songcut.api.load_timestamp_comment_candidates",
                return_value=(candidates, "metadata warning"),
            ),
        ):
            payload = probe(ProbeRequest(path=str(source)))

        probe_video.assert_called_once_with(Path("ffprobe.exe"), source)
        self.assertEqual(payload["timestamp_comment_candidates"], candidates)
        self.assertEqual(payload["info_json_warning"], "metadata warning")
        self.assertEqual(
            payload["smart_render_estimate"],
            {
                "smart_render": True,
                "source_container": "webm",
                "container_family": "webm",
                "output_suffix": ".webm",
                "video_codec": "vp9",
                "fallback_reason": None,
            },
        )

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
        self.assertEqual(completed.result["exported"][0]["id"], "guide-001")
        self.assertEqual(completed.result["exported"][0]["target"], "out/01_Song.mp4")

    def test_export_plan_reports_smart_and_full_reencode_items(self) -> None:
        source = Path("source.mp4")
        smart_plan = SimpleNamespace(
            fallback_reason=None,
            output_suffix=".mp4",
            video_codec="h264",
            container_family="mp4",
            spans=[SimpleNamespace(mode="encode", start=10.0, end=12.0), SimpleNamespace(mode="copy", start=12.0, end=18.0)],
        )
        fallback_plan = SimpleNamespace(
            fallback_reason="no keyframe-aligned GOP exists entirely inside the requested range",
            output_suffix=".mp4",
            video_codec="h264",
            container_family="mp4",
            spans=[SimpleNamespace(mode="encode", start=20.0, end=21.0)],
        )
        request = ExportPlanRequest(
            source_path=str(source),
            items=[
                ExportItem(id="smart", filename_stem="Smart", start=10.0, end=20.0),
                ExportItem(id="fallback", filename_stem="Fallback", start=20.0, end=21.0),
            ],
        )

        with (
            mock.patch("songcut.api.require_file", return_value=source),
            mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffprobe=Path("ffprobe.exe"))),
            mock.patch("songcut.api.plan_smart_render", side_effect=[smart_plan, fallback_plan]),
        ):
            payload = create_export_plan(request)

        self.assertEqual(payload["items"][0]["smart_render"], True)
        self.assertEqual(payload["items"][0]["copied_seconds"], 6.0)
        self.assertEqual(payload["items"][0]["encoded_seconds"], 4.0)
        self.assertEqual(payload["items"][1]["smart_render"], False)
        self.assertEqual(payload["items"][1]["fallback_reason"], fallback_plan.fallback_reason)

    def test_export_job_can_create_a_source_named_folder(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            parent = Path(temp_dir)
            source = parent / "My Video.mp4"
            source.write_bytes(b"video")
            request = ExportRequest(
                source_path=str(source),
                output_dir=str(parent / "exports"),
                create_source_folder=True,
                items=[ExportItem(id="guide-001", filename_stem="01_Song", start=10.0, end=20.0)],
            )
            now = time.time()
            with _jobs_lock:
                _jobs["export-folder"] = JobRecord(
                    id="export-folder",
                    kind="export",
                    status="queued",
                    created_at=now,
                    updated_at=now,
                )
            with (
                mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffmpeg="ffmpeg", ffprobe="ffprobe")),
                mock.patch("songcut.api.export_smart_clip", return_value={"ok": True}) as export_smart_clip,
            ):
                _export_job("export-folder", request)

            target = parent / "exports" / "My Video" / "01_Song.mp4"
            self.assertTrue(target.parent.is_dir())
            self.assertEqual(export_smart_clip.call_args.args[3], target)
            with _jobs_lock:
                self.assertEqual(_jobs["export-folder"].result["output_dir"], str(target.parent))

    def test_export_job_sanitizes_and_deduplicates_filename_stems(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.mp4"
            source.write_bytes(b"video")
            request = ExportRequest(
                source_path=str(source),
                output_dir=str(Path(temp_dir) / "exports"),
                items=[
                    ExportItem(id="one", filename_stem="../Same", start=0.0, end=1.0),
                    ExportItem(id="two", filename_stem="../Same", start=1.0, end=2.0),
                ],
            )
            now = time.time()
            with _jobs_lock:
                _jobs["export-safe-names"] = JobRecord(
                    id="export-safe-names",
                    kind="export",
                    status="queued",
                    created_at=now,
                    updated_at=now,
                )
            with (
                mock.patch("songcut.api.find_ffmpeg", return_value=SimpleNamespace(ffmpeg="ffmpeg", ffprobe="ffprobe")),
                mock.patch("songcut.api.export_smart_clip", return_value={"ok": True}) as export_smart_clip,
            ):
                _export_job("export-safe-names", request)

            targets = [call.args[3] for call in export_smart_clip.call_args_list]
            output_dir = Path(temp_dir) / "exports"
            self.assertEqual(targets, [output_dir / "- Same.mp4", output_dir / "- Same (2).mp4"])
            self.assertTrue(all(target.parent == output_dir for target in targets))

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
