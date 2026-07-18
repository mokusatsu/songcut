from pathlib import Path
from unittest import mock
import tempfile
import unittest

from songcut.ffmpeg_tools import find_ffmpeg


class FfmpegToolTests(unittest.TestCase):
    def test_find_ffmpeg_under_third_party(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "third_party" / "ffmpeg" / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "ffmpeg.exe").write_text("", encoding="utf-8")
            (bin_dir / "ffprobe.exe").write_text("", encoding="utf-8")

            paths = find_ffmpeg(root)
            self.assertEqual(paths.ffmpeg, bin_dir / "ffmpeg.exe")
            self.assertEqual(paths.ffprobe, bin_dir / "ffprobe.exe")

    def test_missing_ffmpeg_reports_diagnostic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict("os.environ", {}, clear=True), mock.patch("songcut.ffmpeg_tools.shutil.which", return_value=None):
                with self.assertRaises(FileNotFoundError) as caught:
                    find_ffmpeg(Path(tmp))
        self.assertIn("third_party/ffmpeg/bin", str(caught.exception))


if __name__ == "__main__":
    unittest.main()

