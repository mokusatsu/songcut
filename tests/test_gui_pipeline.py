import json
from pathlib import Path
import unittest
from unittest import mock

import numpy as np

from songcut.ffmpeg_tools import FfmpegPaths
from songcut.boundary_refiner import BoundaryRefinementResult
from songcut.gui_pipeline import (
    WAVEFORM_MAX_POINTS,
    WAVEFORM_MIN_POINTS,
    WAVEFORM_SAMPLE_RATE,
    analyze_for_gui,
    waveform_bucket_count,
    waveform_peaks,
)
from songcut.hardware import BackendInfo
from songcut.timestamps import Segment


class GuiPipelineTests(unittest.TestCase):
    def test_explicit_guide_range_with_metadata_leaves_waveform_to_independent_job(self) -> None:
        source = Path("source.mp4")
        samples = np.array([[0.0], [0.25], [-0.5], [0.75]], dtype=np.float32)

        with (
            mock.patch(
                "songcut.gui_pipeline.find_ffmpeg",
                return_value=FfmpegPaths(Path("ffmpeg.exe"), Path("ffprobe.exe")),
            ),
            mock.patch("songcut.gui_pipeline.select_backend", return_value=BackendInfo("numpy-dsp", "auto", "CPU")),
            mock.patch("songcut.gui_pipeline.probe_duration", return_value=6.0),
            mock.patch(
                "songcut.gui_pipeline.metadata_segments",
                return_value=[Segment(0.0, 4.0, confidence=0.98, source="video-metadata")],
            ),
            mock.patch("songcut.gui_pipeline.read_pcm_s16le", return_value=b"pcm") as read_pcm,
            mock.patch("songcut.gui_pipeline.pcm_bytes_to_float_stereo", return_value=samples) as pcm_to_float,
            mock.patch("songcut.gui_pipeline.compute_features") as compute_features,
            mock.patch("songcut.gui_pipeline.refine_segments") as refine_segments,
        ):
            result = analyze_for_gui(source, guide_text="0:00 Smoke Song 0:02")

        self.assertEqual(result["timestamp_source"], "video-metadata+guide")
        self.assertEqual(result["schema_version"], 3)
        self.assertEqual(result["segments"][0]["source"], "guide-range")
        self.assertEqual(result["waveform"], [])
        read_pcm.assert_not_called()
        pcm_to_float.assert_not_called()
        compute_features.assert_not_called()
        refine_segments.assert_not_called()

    def test_acoustic_analysis_runs_boundary_refinement_and_persists_diagnostics(self) -> None:
        source = Path("source.mp4")
        samples = np.zeros((32000, 2), dtype=np.float32)
        coarse = Segment(1.0, 5.0, confidence=0.8, source="acoustic-dsp")
        refined = Segment(0.5, 6.0, confidence=0.8, source="acoustic-dsp")
        side = {
            "success": True,
            "reason": "refined",
        }
        diagnostic = {"start": side, "end": side, "coarse_start": 1.0, "coarse_end": 5.0}
        summary = {"version": "rms-otsu-boundary-v1", "settings": {}, "applied_segments": 1, "refined_boundaries": 2}
        features = mock.Mock()
        features.times = features.smoothed_score = features.rms = np.array([], dtype=np.float32)
        with (
            mock.patch("songcut.gui_pipeline.find_ffmpeg", return_value=FfmpegPaths(Path("ffmpeg.exe"), Path("ffprobe.exe"))),
            mock.patch("songcut.gui_pipeline.select_backend", return_value=BackendInfo("numpy-dsp", "auto", "CPU")),
            mock.patch("songcut.gui_pipeline.probe_duration", return_value=8.0),
            mock.patch("songcut.gui_pipeline.metadata_segments", return_value=[]),
            mock.patch("songcut.gui_pipeline.read_pcm_s16le", return_value=b"pcm"),
            mock.patch("songcut.gui_pipeline.pcm_bytes_to_float_stereo", return_value=samples),
            mock.patch("songcut.gui_pipeline.compute_features", return_value=features),
            mock.patch("songcut.gui_pipeline.segments_from_features", return_value=[coarse]),
            mock.patch(
                "songcut.gui_pipeline.refine_segments",
                return_value=BoundaryRefinementResult([refined], [diagnostic], summary),
            ) as refine_segments,
        ):
            result = analyze_for_gui(source, timestamp_source="acoustic")
        refine_segments.assert_called_once()
        self.assertEqual(result["raw_segments"][0]["start"], 0.5)
        self.assertTrue(result["raw_segments"][0]["boundary_refined"])
        self.assertEqual(result["boundary_refinement"], summary)

    def test_unmatched_guide_timestamp_completes_analysis_with_provisional_segment(self) -> None:
        source = Path("source.mp4")
        samples = np.array([[0.0], [0.25], [-0.5], [0.75]], dtype=np.float32)

        with (
            mock.patch(
                "songcut.gui_pipeline.find_ffmpeg",
                return_value=FfmpegPaths(Path("ffmpeg.exe"), Path("ffprobe.exe")),
            ),
            mock.patch("songcut.gui_pipeline.select_backend", return_value=BackendInfo("numpy-dsp", "auto", "CPU")),
            mock.patch("songcut.gui_pipeline.probe_duration", return_value=2500.0),
            mock.patch(
                "songcut.gui_pipeline.metadata_segments",
                return_value=[Segment(2340.0, 2440.0, confidence=0.98, source="video-metadata")],
            ),
            mock.patch("songcut.gui_pipeline.read_pcm_s16le", return_value=b"pcm"),
            mock.patch("songcut.gui_pipeline.pcm_bytes_to_float_stereo", return_value=samples),
            mock.patch("songcut.gui_pipeline.compute_features") as compute_features,
        ):
            result = analyze_for_gui(source, guide_text="0:37:20 MC\n0:38:58 Next song\n")

        self.assertEqual(result["timestamp_source"], "video-metadata+guide")
        self.assertEqual(result["segments"][0]["start"], 2240.0)
        self.assertEqual(result["segments"][0]["end"], 2338.0)
        self.assertEqual(result["segments"][0]["source"], "guide-timestamp-fallback")
        self.assertIn("provisional", result["segments"][0]["flags"])
        compute_features.assert_not_called()

    def test_waveform_bucket_count_is_duration_normalized_and_bounded(self) -> None:
        enough_frames = 1_000_000

        self.assertEqual(waveform_bucket_count(600.0, enough_frames), WAVEFORM_MIN_POINTS)
        self.assertEqual(waveform_bucket_count(2400.0, enough_frames), WAVEFORM_MIN_POINTS)
        self.assertEqual(waveform_bucket_count(3600.0, enough_frames), 3600)
        self.assertEqual(waveform_bucket_count(3600.1, enough_frames), 3601)
        self.assertEqual(waveform_bucket_count(3 * 3600.0, enough_frames), 10800)
        self.assertEqual(waveform_bucket_count(6 * 3600.0, enough_frames), WAVEFORM_MAX_POINTS)
        self.assertEqual(waveform_bucket_count(24 * 3600.0, enough_frames), WAVEFORM_MAX_POINTS)
        self.assertEqual(waveform_bucket_count(3600.0, 1200), 1200)
        self.assertEqual(waveform_bucket_count(0.0, enough_frames), 0)
        self.assertEqual(waveform_bucket_count(3600.0, 0), 0)

    def test_waveform_peaks_partition_every_frame_evenly(self) -> None:
        samples = np.linspace(-1.0, 1.0, WAVEFORM_MIN_POINTS + 5, dtype=np.float32)

        points = waveform_peaks(samples, duration=600.0)
        counts = [int(point["sample_count"]) for point in points]

        self.assertEqual(len(points), WAVEFORM_MIN_POINTS)
        self.assertEqual(sum(counts), len(samples))
        self.assertLessEqual(max(counts) - min(counts), 1)
        self.assertEqual(counts[-1], 2)
        self.assertTrue(all(float(left["t"]) < float(right["t"]) for left, right in zip(points, points[1:])))
        self.assertGreaterEqual(float(points[0]["t"]), 0.0)
        self.assertLessEqual(float(points[-1]["t"]), 600.0)

    def test_waveform_peaks_keep_min_max_rms_and_bucket_centers(self) -> None:
        samples = np.array([[1.0, -1.0], [0.5, 0.5], [-0.25, -0.75], [0.0, 1.0]], dtype=np.float32)

        points = waveform_peaks(samples, duration=8.0)

        self.assertEqual(
            points,
            [
                {"t": 1.0, "min": 0.0, "max": 0.0, "rms": 0.0, "sample_count": 1},
                {"t": 3.0, "min": 0.5, "max": 0.5, "rms": 0.5, "sample_count": 1},
                {"t": 5.0, "min": -0.5, "max": -0.5, "rms": 0.5, "sample_count": 1},
                {"t": 7.0, "min": 0.5, "max": 0.5, "rms": 0.5, "sample_count": 1},
            ],
        )

    def test_waveform_peaks_reject_empty_or_non_positive_duration(self) -> None:
        self.assertEqual(waveform_peaks(np.array([], dtype=np.float32), duration=10.0), [])
        self.assertEqual(waveform_peaks(np.ones(10, dtype=np.float32), duration=0.0), [])

    def test_capped_waveform_json_stays_within_target_size(self) -> None:
        samples = np.zeros(WAVEFORM_MAX_POINTS, dtype=np.float32)

        points = waveform_peaks(samples, duration=24 * 3600.0)
        encoded = json.dumps(points, separators=(",", ":")).encode("utf-8")

        self.assertEqual(len(points), WAVEFORM_MAX_POINTS)
        self.assertLessEqual(len(encoded), int(2.5 * 1024 * 1024))


if __name__ == "__main__":
    unittest.main()
