from pathlib import Path
from unittest import mock
import tempfile
import unittest

from songcut.ffmpeg_tools import CREATE_NO_WINDOW, ffprobe_json, find_ffmpeg


class FfmpegToolTests(unittest.TestCase):
    def test_find_ffmpeg_recursively_under_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "tools" / "video" / "ffmpeg" / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "ffmpeg.exe").write_text("", encoding="utf-8")
            (bin_dir / "ffprobe.exe").write_text("", encoding="utf-8")

            with mock.patch("songcut.ffmpeg_tools.shutil.which", return_value=None):
                paths = find_ffmpeg(root)
            self.assertEqual(paths.ffmpeg, bin_dir / "ffmpeg.exe")
            self.assertEqual(paths.ffprobe, bin_dir / "ffprobe.exe")

    def test_find_ffmpeg_falls_back_to_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ffmpeg = str(Path(tmp) / "path-ffmpeg" / "ffmpeg.exe")
            ffprobe = str(Path(tmp) / "path-ffprobe" / "ffprobe.exe")
            with mock.patch("songcut.ffmpeg_tools.shutil.which", side_effect=[ffmpeg, ffprobe]):
                paths = find_ffmpeg(Path(tmp) / "empty-root")

        self.assertEqual(paths.ffmpeg, Path(ffmpeg))
        self.assertEqual(paths.ffprobe, Path(ffprobe))

    def test_find_ffmpeg_requires_pair_in_same_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "only-ffmpeg").mkdir()
            (root / "only-ffprobe").mkdir()
            (root / "only-ffmpeg" / "ffmpeg.exe").write_text("", encoding="utf-8")
            (root / "only-ffprobe" / "ffprobe.exe").write_text("", encoding="utf-8")
            with mock.patch("songcut.ffmpeg_tools.shutil.which", return_value=None):
                with self.assertRaises(FileNotFoundError):
                    find_ffmpeg(root)

    def test_missing_ffmpeg_reports_diagnostic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("songcut.ffmpeg_tools.shutil.which", return_value=None):
                with self.assertRaises(FileNotFoundError) as caught:
                    find_ffmpeg(Path(tmp))
        message = str(caught.exception)
        self.assertIn(str(Path(tmp)), message)
        self.assertIn("PATH", message)

    def test_ffprobe_runs_without_console_window(self) -> None:
        completed = mock.Mock()
        completed.stdout = "{}"
        with mock.patch("songcut.ffmpeg_tools.subprocess.run", return_value=completed) as run:
            ffprobe_json(Path("ffprobe.exe"), Path("source.mp4"), ["-show_format"])

        self.assertEqual(run.call_args.kwargs["creationflags"], CREATE_NO_WINDOW)


if __name__ == "__main__":
    unittest.main()
