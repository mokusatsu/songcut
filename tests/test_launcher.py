from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


def _load_launcher_module():
    module_path = Path(__file__).resolve().parents[1] / "packaging" / "songcut_launcher_entry.py"
    spec = importlib.util.spec_from_file_location("songcut_launcher_entry_for_test", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load launcher module: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LauncherTests(unittest.TestCase):
    def test_consumes_and_removes_a_valid_software_decoder_restart_request(self) -> None:
        launcher = _load_launcher_module()
        with tempfile.TemporaryDirectory() as temporary_directory:
            request_path = Path(temporary_directory) / "restart.json"
            expected_args = ["--user-data-dir=C:\\temp\\songcut", "--songcut-software-decoder"]
            request_path.write_text(json.dumps({"args": expected_args}), encoding="utf-8")

            self.assertEqual(launcher.consume_software_decoder_restart_args(request_path), expected_args)
            self.assertFalse(request_path.exists())

    def test_rejects_and_removes_an_invalid_software_decoder_restart_request(self) -> None:
        launcher = _load_launcher_module()
        with tempfile.TemporaryDirectory() as temporary_directory:
            request_path = Path(temporary_directory) / "restart.json"
            request_path.write_text('{"args":["--songcut-software-decoder",7]}', encoding="utf-8")

            self.assertIsNone(launcher.consume_software_decoder_restart_args(request_path))
            self.assertFalse(request_path.exists())

    def test_redacts_one_shot_resume_paths_from_launcher_logs(self) -> None:
        launcher = _load_launcher_module()
        args = [
            "songcut-electron.exe",
            "--remote-debugging-port=9239",
            "--songcut-software-decoder-resume=eyJ2aWRlb1BhdGgiOiJDOlxcVmlkZW9cXGNsaXAubWt2In0",
        ]

        self.assertEqual(
            launcher.redact_electron_args_for_logging(args),
            [
                "songcut-electron.exe",
                "--remote-debugging-port=9239",
                "--songcut-software-decoder-resume=<redacted>",
            ],
        )

    def test_configure_standard_streams_replaces_none_with_log_stream(self) -> None:
        launcher = _load_launcher_module()
        with tempfile.TemporaryDirectory() as temporary_directory:
            log_path = Path(temporary_directory) / "launcher.log"
            with mock.patch.object(sys, "stdout", None), mock.patch.object(sys, "stderr", None):
                launcher.configure_standard_streams(log_path)
                self.assertIsNotNone(sys.stdout)
                self.assertIs(sys.stdout, sys.stderr)
                sys.stdout.write("model download progress\n")
                sys.stdout.flush()
                sys.stdout.close()

            self.assertIn("model download progress", log_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
