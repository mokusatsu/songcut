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
    def test_spawn_external_process_temporarily_clears_frozen_dll_directory(self) -> None:
        launcher = _load_launcher_module()
        process = mock.Mock()
        events: list[tuple[str, object]] = []

        def set_dll_directory(path: str | None) -> None:
            events.append(("dll", path))

        def popen(args: list[str], **kwargs: object):
            events.append(("spawn", (args, kwargs)))
            return process

        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(sys, "frozen", True, create=True),
            mock.patch.object(sys, "_MEIPASS", r"C:\bundle\runtime", create=True),
            mock.patch.object(launcher, "_set_windows_dll_directory", side_effect=set_dll_directory),
            mock.patch.object(launcher.subprocess, "Popen", side_effect=popen),
        ):
            result = launcher.spawn_external_process(["electron.exe"], cwd=r"C:\bundle")

        self.assertIs(result, process)
        self.assertEqual(
            events,
            [
                ("dll", None),
                ("spawn", (["electron.exe"], {"cwd": "C:\\bundle"})),
                ("dll", r"C:\bundle\runtime"),
            ],
        )

    def test_spawn_external_process_restores_dll_directory_when_spawn_fails(self) -> None:
        launcher = _load_launcher_module()
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(sys, "frozen", True, create=True),
            mock.patch.object(sys, "_MEIPASS", r"C:\bundle\runtime", create=True),
            mock.patch.object(launcher, "_set_windows_dll_directory") as set_dll_directory,
            mock.patch.object(launcher.subprocess, "Popen", side_effect=OSError("spawn failed")),
        ):
            with self.assertRaisesRegex(OSError, "spawn failed"):
                launcher.spawn_external_process(["electron.exe"])

        self.assertEqual(
            set_dll_directory.call_args_list,
            [mock.call(None), mock.call(r"C:\bundle\runtime")],
        )

    def test_spawn_external_process_leaves_dll_directory_alone_when_not_frozen(self) -> None:
        launcher = _load_launcher_module()
        process = mock.Mock()
        with (
            mock.patch.object(sys, "platform", "win32"),
            mock.patch.object(sys, "frozen", False, create=True),
            mock.patch.object(launcher, "_set_windows_dll_directory") as set_dll_directory,
            mock.patch.object(launcher.subprocess, "Popen", return_value=process) as popen,
        ):
            result = launcher.spawn_external_process(["electron.exe"])

        self.assertIs(result, process)
        set_dll_directory.assert_not_called()
        popen.assert_called_once_with(["electron.exe"])

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


if __name__ == "__main__":
    unittest.main()
