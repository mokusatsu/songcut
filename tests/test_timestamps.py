from pathlib import Path
import unittest

from songcut.timestamps import parse_timestamp_text, parse_timecode, read_timestamp_file


class TimestampTests(unittest.TestCase):
    def test_parse_timecode(self) -> None:
        self.assertEqual(parse_timecode("9:47"), 587)
        self.assertEqual(parse_timecode("80:45"), 4845)
        self.assertEqual(parse_timecode("1:20:45"), 4845)

    def test_parse_ranges(self) -> None:
        segments = parse_timestamp_text("1. 9:47~16:10\n2. 1:20:45~1:25:05")
        self.assertEqual(len(segments), 2)
        self.assertEqual((segments[0].start, segments[0].end), (587, 970))
        self.assertEqual((segments[1].start, segments[1].end), (4845, 5105))

    def test_parse_minute_second_ranges_beyond_one_hour(self) -> None:
        segments = parse_timestamp_text("80:45~85:05")
        self.assertEqual(len(segments), 1)
        self.assertEqual((segments[0].start, segments[0].end), (4845, 5105))

    def test_read_testdata_truth_if_present(self) -> None:
        files = list(Path("testdata").glob("*.txt"))
        if not files:
            self.skipTest("testdata is not present")
        segments = read_timestamp_file(files[0])
        self.assertGreaterEqual(len(segments), 10)


if __name__ == "__main__":
    unittest.main()
