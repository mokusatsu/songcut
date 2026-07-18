from unittest import mock
import unittest

from songcut.hardware import select_backend


class HardwareTests(unittest.TestCase):
    def test_auto_records_accelerator_fallback(self) -> None:
        with mock.patch("songcut.hardware.detect_openvino_devices", return_value=(["NPU", "GPU", "CPU"], None)):
            backend = select_backend("auto")
        self.assertEqual(backend.device_used, "CPU")
        self.assertEqual(backend.backend, "numpy-dsp")
        self.assertIn("NPU", backend.available_devices)
        self.assertTrue(backend.fallbacks)

    def test_strict_npu_requires_npu(self) -> None:
        with mock.patch("songcut.hardware.detect_openvino_devices", return_value=(["CPU"], None)):
            with self.assertRaises(RuntimeError):
                select_backend("npu")

    def test_strict_npu_accepts_npu(self) -> None:
        with mock.patch("songcut.hardware.detect_openvino_devices", return_value=(["NPU", "CPU"], None)):
            backend = select_backend("npu")
        self.assertEqual(backend.device_used, "NPU")
        self.assertEqual(backend.backend, "openvino-ready")


if __name__ == "__main__":
    unittest.main()

