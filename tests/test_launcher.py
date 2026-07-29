from __future__ import annotations

import importlib.util
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
