from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from songcut.smart_export import (
    CREATE_NO_WINDOW,
    SmartRenderPlan,
    SmartRenderSpan,
    SourceMediaInfo,
    estimate_reencode_bitrate,
    estimate_smart_render,
    export_smart_clip,
    plan_smart_render,
    probe_keyframes,
)


class SmartExportTests(unittest.TestCase):
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
        self.assertTrue(any("h264_mp4toannexb" in command for command in commands))
        self.assertTrue(any(["-f", "mpegts"] == command[index : index + 2] for command in commands for index in range(len(command) - 1)))
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


if __name__ == "__main__":
    unittest.main()
