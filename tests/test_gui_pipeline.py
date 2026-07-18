from pathlib import Path
import unittest
from unittest import mock

import numpy as np

from songcut.ffmpeg_tools import FfmpegPaths
from songcut.gui_pipeline import WAVEFORM_SAMPLE_RATE, analyze_for_gui
from songcut.hardware import BackendInfo
from songcut.timestamps import Segment


class GuiPipelineTests(unittest.TestCase):
    def test_explicit_guide_range_with_metadata_still_builds_waveform(self) -> None:
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
        ):
            result = analyze_for_gui(source, guide_text="0:00 Smoke Song 0:02")

        self.assertEqual(result["timestamp_source"], "video-metadata+guide")
        self.assertEqual(result["segments"][0]["source"], "guide-range")
        self.assertEqual(len(result["waveform"]), len(samples))
        read_pcm.assert_called_once_with(
            Path("ffmpeg.exe"),
            source,
            sample_rate=WAVEFORM_SAMPLE_RATE,
            channels=1,
        )
        pcm_to_float.assert_called_once_with(b"pcm", channels=1)
        compute_features.assert_not_called()


if __name__ == "__main__":
    unittest.main()
