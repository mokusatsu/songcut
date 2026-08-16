import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from songcut.smart_export import (
    CREATE_NO_WINDOW,
    SmartRenderPlan,
    SmartRenderSpan,
    SourceMediaInfo,
    VideoFramePoint,
    estimate_reencode_bitrate,
    estimate_smart_render,
    export_smart_clip,
    plan_smart_render,
    probe_keyframes,
    snap_video_range_to_frames,
    _audio_artifact_suffix,
    _audio_codec_family,
    _gain_result_to_dict,
    _measure_final_true_peak,
    _normalize_audio_artifact,
    _resolve_mp3rgain,
    _true_peak_report,
    _validate_export,
)


class SmartExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.snap_patcher = mock.patch(
            "songcut.smart_export.snap_video_range_to_frames",
            side_effect=lambda _ffprobe, _source, *, start, end: (start, end),
        )
        self.span_validation_patcher = mock.patch("songcut.smart_export._validate_video_span")
        self.keyframe_packet_patcher = mock.patch(
            "songcut.smart_export._probe_keyframe_packet",
            side_effect=lambda _ffprobe, _source, pts: VideoFramePoint(
                pts=pts,
                dts=max(0.0, pts - 0.02),
                duration=1 / 60,
                keyframe=True,
            ),
        )
        self.snap_patcher.start()
        self.span_validation_patcher.start()
        self.keyframe_packet_patcher.start()
        self.addCleanup(self.snap_patcher.stop)
        self.addCleanup(self.span_validation_patcher.stop)
        self.addCleanup(self.keyframe_packet_patcher.stop)

    def test_estimate_smart_render_uses_only_container_and_video_codec(self) -> None:
        supported = estimate_smart_render("matroska,webm", "vp9", Path("source.webm"))
        unsupported = estimate_smart_render("mov,mp4", "hevc", Path("source.mp4"))

        self.assertTrue(supported.smart_render)
        self.assertEqual(supported.container_family, "webm")
        self.assertEqual(supported.output_suffix, ".webm")
        self.assertFalse(unsupported.smart_render)
        self.assertIn("codec=hevc", unsupported.fallback_reason)

    def test_estimate_reencode_bitrate_prefers_video_stream_rate(self) -> None:
        with mock.patch(
            "songcut.smart_export.ffprobe_json",
            return_value={
                "streams": [
                    {"codec_type": "video", "codec_name": "h264", "bit_rate": "1000000"},
                    {"codec_type": "audio", "codec_name": "aac", "bit_rate": "128000"},
                ],
                "format": {"format_name": "mov,mp4", "duration": "10.0", "bit_rate": "1128000"},
            },
        ):
            bitrate = estimate_reencode_bitrate(Path("ffprobe"), Path("source.mp4"))

        self.assertEqual(bitrate, 1_500_000)

    def test_estimate_reencode_bitrate_uses_format_minus_audio_when_stream_rate_missing(self) -> None:
        with mock.patch(
            "songcut.smart_export.ffprobe_json",
            return_value={
                "streams": [
                    {"codec_type": "video", "codec_name": "h264"},
                    {"codec_type": "audio", "codec_name": "aac", "bit_rate": "128000"},
                ],
                "format": {"format_name": "mov,mp4", "duration": "10.0", "bit_rate": "1128000"},
            },
        ):
            bitrate = estimate_reencode_bitrate(Path("ffprobe"), Path("source.mp4"))

        self.assertEqual(bitrate, 1_500_000)

    def test_plan_h264_splits_partial_gops(self) -> None:
        info = SourceMediaInfo(
            format_name="mov,mp4,m4a,3gp,3g2,mj2",
            duration=100.0,
            size=None,
            video_codec="h264",
            video_bitrate=1_000_000,
            audio_codec="aac",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[8.0, 12.0, 14.0, 18.0, 22.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.mov"), start=10.0, end=20.0)

        self.assertEqual(plan.output_suffix, ".mp4")
        self.assertEqual(plan.container_family, "mp4")
        self.assertEqual(plan.video_encoder, "libx264")
        self.assertEqual(plan.reencode_bitrate, 1_500_000)
        self.assertEqual(plan.copy_start, 12.0)
        self.assertEqual(plan.copy_end, 18.0)
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 10.0, 12.0), ("copy", 12.0, 18.0), ("encode", 18.0, 20.0)],
        )

    def test_probe_keyframes_filters_non_key_frames(self) -> None:
        with mock.patch(
            "songcut.smart_export.ffprobe_json",
            return_value={
                "frames": [
                    {"best_effort_timestamp_time": "1.000000", "key_frame": 0},
                    {"best_effort_timestamp_time": "2.000000", "key_frame": 1},
                    {"best_effort_timestamp_time": "3.000000", "key_frame": "1"},
                ]
            },
        ):
            keyframes = probe_keyframes(Path("ffprobe"), Path("source.webm"), start=0.0, end=4.0)

        self.assertEqual(keyframes, [2.0, 3.0])

    def test_snap_video_range_uses_nearest_frame_pts_boundaries(self) -> None:
        start_frames = [
            VideoFramePoint(pts=10.000, dts=9.983, duration=0.017, keyframe=False),
            VideoFramePoint(pts=10.017, dts=10.000, duration=0.016, keyframe=False),
        ]
        end_frames = [
            VideoFramePoint(pts=19.983, dts=19.966, duration=0.017, keyframe=False),
            VideoFramePoint(pts=20.000, dts=19.983, duration=0.017, keyframe=True),
        ]
        with mock.patch(
            "songcut.smart_export.probe_video_frames",
            side_effect=[start_frames, end_frames],
        ):
            snapped = snap_video_range_to_frames(
                Path("ffprobe"),
                Path("source.mkv"),
                start=10.012,
                end=19.995,
            )

        self.assertEqual(snapped, (10.017, 20.000))

    def test_plan_vp9_webm_uses_webm_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="matroska,webm",
            duration=100.0,
            size=None,
            video_codec="vp9",
            video_bitrate=800_000,
            audio_codec="opus",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.webm"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".webm")
        self.assertEqual(plan.container_family, "webm")
        self.assertEqual(plan.video_encoder, "libvpx-vp9")
        self.assertEqual(plan.audio_encoder, "libopus")
        self.assertEqual(plan.reencode_bitrate, 1_200_000)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_plan_av1_webm_uses_av1_smart_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="matroska,webm",
            duration=100.0,
            size=None,
            video_codec="av1",
            video_bitrate=900_000,
            audio_codec="opus",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.webm"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".webm")
        self.assertEqual(plan.video_encoder, "libsvtav1")
        self.assertEqual(plan.audio_encoder, "libopus")
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_plan_av1_mp4_uses_av1_smart_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="mov,mp4,m4a,3gp,3g2,mj2",
            duration=100.0,
            size=None,
            video_codec="av1",
            video_bitrate=900_000,
            audio_codec="aac",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.mp4"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".mp4")
        self.assertEqual(plan.container_family, "mp4")
        self.assertEqual(plan.video_encoder, "libsvtav1")
        self.assertEqual(plan.audio_encoder, "aac")
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_plan_h264_mkv_uses_matroska_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="matroska,webm",
            duration=100.0,
            size=None,
            video_codec="h264",
            video_bitrate=1_000_000,
            audio_codec="aac",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.mkv"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".mkv")
        self.assertEqual(plan.container_family, "mkv")
        self.assertEqual(plan.video_encoder, "libx264")
        self.assertEqual(plan.audio_encoder, "aac")
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_plan_vp9_mkv_uses_matroska_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="matroska",
            duration=100.0,
            size=None,
            video_codec="vp9",
            video_bitrate=800_000,
            audio_codec="opus",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.mkv"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".mkv")
        self.assertEqual(plan.container_family, "mkv")
        self.assertEqual(plan.video_encoder, "libvpx-vp9")
        self.assertEqual(plan.audio_encoder, "libopus")
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_plan_av1_mkv_uses_matroska_profile(self) -> None:
        info = SourceMediaInfo(
            format_name="matroska",
            duration=100.0,
            size=None,
            video_codec="av1",
            video_bitrate=900_000,
            audio_codec="opus",
            audio_bitrate=128_000,
            has_audio=True,
        )

        with (
            mock.patch("songcut.smart_export.probe_source_media", return_value=info),
            mock.patch("songcut.smart_export.probe_keyframes", return_value=[0.0, 2.0, 4.0, 6.0]),
        ):
            plan = plan_smart_render(Path("ffprobe"), Path("source.mkv"), start=1.0, end=5.0)

        self.assertEqual(plan.output_suffix, ".mkv")
        self.assertEqual(plan.container_family, "mkv")
        self.assertEqual(plan.video_encoder, "libsvtav1")
        self.assertEqual(plan.audio_encoder, "libopus")
        self.assertIsNone(plan.fallback_reason)
        self.assertEqual(
            [(span.mode, span.start, span.end) for span in plan.spans],
            [("encode", 1.0, 2.0), ("copy", 2.0, 4.0), ("encode", 4.0, 5.0)],
        )

    def test_export_smart_clip_runs_encode_copy_concat_audio_and_mux_commands(self) -> None:
        plan = SmartRenderPlan(
            start=10.0,
            end=20.0,
            output_suffix=".mp4",
            container_family="mp4",
            video_codec="h264",
            video_encoder="libx264",
            audio_encoder="aac",
            audio_bitrate="192k",
            source_video_bitrate=1_000_000,
            reencode_bitrate=1_500_000,
            has_audio=True,
            copy_start=12.0,
            copy_end=18.0,
            keyframes=[8.0, 12.0, 14.0, 18.0, 22.0],
            spans=[
                SmartRenderSpan("encode", 10.0, 12.0),
                SmartRenderSpan("copy", 12.0, 18.0),
                SmartRenderSpan("encode", 18.0, 20.0),
            ],
            fallback_reason=None,
        )

        with tempfile.TemporaryDirectory() as tmp_name:
            target = Path(tmp_name) / "clip.mp4"
            with (
                mock.patch("songcut.smart_export.plan_smart_render", return_value=plan),
                mock.patch("songcut.smart_export.subprocess.run") as run,
                mock.patch("songcut.smart_export._validate_export"),
            ):
                result = export_smart_clip(Path("ffmpeg"), Path("ffprobe"), Path("source.mp4"), target, start=10.0, end=20.0)

        commands = [call.args[0] for call in run.call_args_list]
        self.assertTrue(all(call.kwargs.get("creationflags") == CREATE_NO_WINDOW for call in run.call_args_list))
        self.assertEqual(result["target"], str(target))
        self.assertEqual(len(commands), 6)
        self.assertTrue(any(["-c:v", "libx264"] == command[index : index + 2] for command in commands for index in range(len(command) - 1)))
        self.assertTrue(any("1500000" in command for command in commands))
        self.assertTrue(any("h264_mp4toannexb" in command for command in commands))
        self.assertTrue(any(["-f", "concat"] == command[index : index + 2] for command in commands for index in range(len(command) - 1)))
        self.assertEqual(commands[-1][-1], str(target))

    def test_export_smart_clip_changes_target_suffix_for_av1_webm(self) -> None:
        plan = SmartRenderPlan(
            start=1.0,
            end=5.0,
            output_suffix=".webm",
            container_family="webm",
            video_codec="av1",
            video_encoder="libsvtav1",
            audio_encoder="libopus",
            audio_bitrate="160k",
            source_video_bitrate=900_000,
            reencode_bitrate=1_350_000,
            has_audio=True,
            copy_start=2.0,
            copy_end=4.0,
            keyframes=[0.0, 2.0, 4.0, 6.0],
            spans=[
                SmartRenderSpan("encode", 1.0, 2.0),
                SmartRenderSpan("copy", 2.0, 4.0),
                SmartRenderSpan("encode", 4.0, 5.0),
            ],
            fallback_reason=None,
        )

        with tempfile.TemporaryDirectory() as tmp_name:
            requested_target = Path(tmp_name) / "clip.mp4"
            expected_target = Path(tmp_name) / "clip.webm"
            with (
                mock.patch("songcut.smart_export.plan_smart_render", return_value=plan),
                mock.patch("songcut.smart_export.subprocess.run") as run,
                mock.patch("songcut.smart_export._validate_export"),
            ):
                result = export_smart_clip(
                    Path("ffmpeg"),
                    Path("ffprobe"),
                    Path("source.webm"),
                    requested_target,
                    start=1.0,
                    end=5.0,
                )

        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(result["target"], str(expected_target))
        self.assertTrue(any("libsvtav1" in command for command in commands))
        self.assertTrue(any("libopus" in command for command in commands))
        self.assertNotIn("-shortest", commands[-1])
        self.assertEqual(commands[-1][-1], str(expected_target))

    def test_export_smart_clip_changes_target_suffix_for_mkv(self) -> None:
        plan = SmartRenderPlan(
            start=1.0,
            end=5.0,
            output_suffix=".mkv",
            container_family="mkv",
            video_codec="h264",
            video_encoder="libx264",
            audio_encoder="aac",
            audio_bitrate="192k",
            source_video_bitrate=900_000,
            reencode_bitrate=1_350_000,
            has_audio=True,
            copy_start=2.0,
            copy_end=4.0,
            keyframes=[0.0, 2.0, 4.0, 6.0],
            spans=[
                SmartRenderSpan("encode", 1.0, 2.0),
                SmartRenderSpan("copy", 2.0, 4.0),
                SmartRenderSpan("encode", 4.0, 5.0),
            ],
            fallback_reason=None,
        )

        with tempfile.TemporaryDirectory() as tmp_name:
            requested_target = Path(tmp_name) / "clip.mp4"
            expected_target = Path(tmp_name) / "clip.mkv"
            with (
                mock.patch("songcut.smart_export.plan_smart_render", return_value=plan),
                mock.patch("songcut.smart_export.subprocess.run") as run,
                mock.patch("songcut.smart_export._validate_export"),
            ):
                result = export_smart_clip(
                    Path("ffmpeg"),
                    Path("ffprobe"),
                    Path("source.mkv"),
                    requested_target,
                    start=1.0,
                    end=5.0,
                )

        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(result["target"], str(expected_target))
        self.assertFalse(any("h264_mp4toannexb" in command for command in commands))
        self.assertFalse(any(["-f", "mpegts"] == command[index : index + 2] for command in commands for index in range(len(command) - 1)))
        copy_command = next(command for command in commands if ["-c:v", "copy"] in [command[index : index + 2] for index in range(len(command) - 1)] and "-f" not in command)
        self.assertLess(copy_command.index("-i"), copy_command.index("-ss"))
        self.assertEqual(commands[-1][-1], str(expected_target))

    def test_export_smart_clip_falls_back_when_smart_pipeline_fails(self) -> None:
        plan = SmartRenderPlan(
            start=10.0,
            end=20.0,
            output_suffix=".mp4",
            container_family="mp4",
            video_codec="h264",
            video_encoder="libx264",
            audio_encoder="aac",
            audio_bitrate="192k",
            source_video_bitrate=1_000_000,
            reencode_bitrate=1_500_000,
            has_audio=False,
            copy_start=12.0,
            copy_end=18.0,
            keyframes=[12.0, 18.0],
            spans=[SmartRenderSpan("copy", 12.0, 18.0)],
            fallback_reason=None,
        )

        with tempfile.TemporaryDirectory() as tmp_name:
            target = Path(tmp_name) / "clip.mp4"
            with (
                mock.patch("songcut.smart_export.plan_smart_render", return_value=plan),
                mock.patch("songcut.smart_export.subprocess.run") as run,
                mock.patch("songcut.smart_export._validate_export"),
            ):
                run.side_effect = [subprocess.CalledProcessError(1, "ffmpeg"), None]
                result = export_smart_clip(Path("ffmpeg"), Path("ffprobe"), Path("source.mp4"), target, start=10.0, end=20.0)

        result_plan = result["smart_render_plan"]
        self.assertIn("smart render failed", result_plan["fallback_reason"])
        self.assertEqual([(span["mode"], span["start"], span["end"]) for span in result_plan["spans"]], [("encode", 10.0, 20.0)])

    def test_validate_export_rejects_output_without_video_stream(self) -> None:
        plan = SmartRenderPlan(
            start=1.0,
            end=3.0,
            output_suffix=".mp4",
            container_family="mp4",
            video_codec="h264",
            video_encoder="libx264",
            audio_encoder="aac",
            audio_bitrate="192k",
            source_video_bitrate=1_000_000,
            reencode_bitrate=1_500_000,
            has_audio=False,
            copy_start=None,
            copy_end=None,
            keyframes=[],
            spans=[SmartRenderSpan("encode", 1.0, 3.0)],
            fallback_reason="test",
        )
        with mock.patch(
            "songcut.smart_export.ffprobe_json",
            return_value={"format": {"duration": "2.0"}, "streams": []},
        ):
            with self.assertRaisesRegex(RuntimeError, "no video stream"):
                _validate_export(Path("ffprobe"), Path("clip.mp4"), plan)


class TruePeakCorrectionTests(unittest.TestCase):
    def _plan(self, **overrides) -> SmartRenderPlan:
        defaults = dict(
            start=1.0,
            end=5.0,
            output_suffix=".mp4",
            container_family="mp4",
            video_codec="h264",
            video_encoder="libx264",
            audio_encoder="aac",
            audio_bitrate="192k",
            source_video_bitrate=1_000_000,
            reencode_bitrate=1_500_000,
            has_audio=True,
            copy_start=None,
            copy_end=None,
            keyframes=[],
            spans=[SmartRenderSpan("encode", 1.0, 5.0)],
            fallback_reason=None,
        )
        defaults.update(overrides)
        return SmartRenderPlan(**defaults)

    def test_audio_codec_family_and_suffix(self) -> None:
        self.assertEqual(_audio_codec_family(self._plan(audio_encoder="libopus")), "opus")
        self.assertEqual(_audio_codec_family(self._plan(audio_encoder="aac")), "aac")
        self.assertEqual(_audio_artifact_suffix(self._plan(audio_encoder="libopus")), ".opus")
        self.assertEqual(_audio_artifact_suffix(self._plan(audio_encoder="aac")), ".m4a")

    def test_resolve_mp3rgain_only_for_aac(self) -> None:
        with mock.patch("songcut.smart_export.find_mp3rgain", return_value=Path("third_party/mp3rgain/mp3rgain.exe")) as find:
            self.assertEqual(_resolve_mp3rgain(self._plan(audio_encoder="aac")), Path("third_party/mp3rgain/mp3rgain.exe"))
            self.assertIsNone(_resolve_mp3rgain(self._plan(audio_encoder="libopus")))
            self.assertIsNone(_resolve_mp3rgain(self._plan(has_audio=False)))
        find.assert_called_once()

    def test_normalize_audio_artifact_returns_to_dict_on_success(self) -> None:
        plan = self._plan()
        fake_result = mock.Mock()
        fake_result.to_dict.return_value = {"applied_gain_db": -3.0}
        with mock.patch("lossless_audio_gain.normalize_true_peak", return_value=fake_result) as normalize:
            report = _normalize_audio_artifact(Path("ffmpeg"), Path("ffprobe"), Path("mp3rgain"), Path("a.m4a"), plan, -1.5)

        self.assertEqual(report, {"applied_gain_db": -3.0})
        normalize.assert_called_once()
        call_kwargs = normalize.call_args.kwargs
        self.assertEqual(call_kwargs["target_true_peak_dbtp"], -1.5)
        self.assertTrue(call_kwargs["verify"])
        self.assertEqual(call_kwargs["mp3rgain_bin"], str(Path("mp3rgain")))
        self.assertFalse(call_kwargs["aac_write_undo"])
        self.assertTrue(call_kwargs["aac_check_reversible"])
        self.assertEqual(call_kwargs["r128_policy"], "neutralize")

    def test_normalize_audio_artifact_falls_back_on_import_error(self) -> None:
        plan = self._plan()
        with mock.patch.dict("sys.modules", {"lossless_audio_gain": None}):
            report = _normalize_audio_artifact(Path("ffmpeg"), Path("ffprobe"), Path("mp3rgain"), Path("a.m4a"), plan, -1.0)
        self.assertIsNone(report)

    def test_normalize_audio_artifact_falls_back_on_backend_error(self) -> None:
        plan = self._plan()
        with mock.patch(
            "lossless_audio_gain.normalize_true_peak",
            side_effect=RuntimeError("mp3rgain missing"),
        ):
            report = _normalize_audio_artifact(Path("ffmpeg"), Path("ffprobe"), Path("mp3rgain"), Path("a.m4a"), plan, -1.0)
        self.assertIsNone(report)

    def test_measure_final_true_peak_returns_float(self) -> None:
        plan = self._plan()
        with mock.patch("lossless_audio_gain.measure_true_peak", return_value="-1.03"):
            peak = _measure_final_true_peak(Path("ffmpeg"), Path("clip.mp4"), plan)
        self.assertEqual(peak, -1.03)

    def test_true_peak_report_empty_when_both_none(self) -> None:
        self.assertIsNone(_true_peak_report(None, None))

    def test_true_peak_report_preserves_both_values(self) -> None:
        report = _true_peak_report({"applied_gain_db": -3.0}, -1.03)
        self.assertEqual(report["gain"], {"applied_gain_db": -3.0})
        self.assertEqual(report["final_true_peak_dbtp"], -1.03)

    def test_gain_result_to_dict_normalizes_tuple(self) -> None:
        result = mock.Mock()
        result.codec = "aac"
        result.warnings = ("warn1", "warn2")
        result.details = {"modified_gain_fields": 3}
        data = _gain_result_to_dict(result)
        self.assertEqual(data["codec"], "aac")
        self.assertEqual(data["warnings"], ["warn1", "warn2"])
        self.assertEqual(data["details"], {"modified_gain_fields": 3})


class SmartExportFfmpegIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg and ffprobe are required")
    def test_h264_mkv_smart_render_preserves_frame_count_without_ts_fallback(self) -> None:
        ffmpeg = Path(shutil.which("ffmpeg") or "ffmpeg")
        ffprobe = Path(shutil.which("ffprobe") or "ffprobe")
        with tempfile.TemporaryDirectory() as tmp_name:
            tmp = Path(tmp_name)
            source = tmp / "source.mkv"
            target = tmp / "clip.mkv"
            subprocess.run(
                [
                    str(ffmpeg),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=320x180:rate=60:duration=6",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:sample_rate=48000:duration=6",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-g",
                    "60",
                    "-keyint_min",
                    "60",
                    "-sc_threshold",
                    "0",
                    "-bf",
                    "1",
                    "-c:a",
                    "aac",
                    source,
                ],
                check=True,
                capture_output=True,
                creationflags=CREATE_NO_WINDOW,
            )

            result = export_smart_clip(
                ffmpeg,
                ffprobe,
                source,
                target,
                start=0.35,
                end=5.65,
            )
            probe = subprocess.run(
                [
                    str(ffprobe),
                    "-v",
                    "error",
                    "-count_frames",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=nb_read_frames",
                    "-of",
                    "json",
                    target,
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                creationflags=CREATE_NO_WINDOW,
            )

        self.assertIsNone(result["smart_render_plan"]["fallback_reason"])
        self.assertEqual(result["smart_render_plan"]["container_family"], "mkv")
        self.assertEqual(result["smart_render_plan"]["expected_video_frames"], 318)
        self.assertEqual(json.loads(probe.stdout)["streams"][0]["nb_read_frames"], "318")


if __name__ == "__main__":
    unittest.main()
