import unittest

from songcut.evaluate import evaluate_segments
from songcut.timestamps import Segment


class EvaluationTests(unittest.TestCase):
    def test_perfect_match(self) -> None:
        truth = [Segment(10, 20), Segment(40, 60)]
        result = evaluate_segments(truth, truth)
        self.assertEqual(result.precision, 1.0)
        self.assertEqual(result.recall, 1.0)
        self.assertEqual(result.f1, 1.0)
        self.assertEqual(result.median_boundary_error_seconds, 0.0)

    def test_partial_match(self) -> None:
        result = evaluate_segments([Segment(10, 30)], [Segment(20, 40)])
        self.assertAlmostEqual(result.precision, 0.5)
        self.assertAlmostEqual(result.recall, 0.5)
        self.assertAlmostEqual(result.f1, 0.5)


if __name__ == "__main__":
    unittest.main()

