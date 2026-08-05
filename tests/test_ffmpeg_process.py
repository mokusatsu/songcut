from __future__ import annotations

import io
import subprocess as stdlib_subprocess
from types import SimpleNamespace
from unittest import mock

import pytest

from songcut.ffmpeg_process import FfmpegProcessError, run_ffmpeg_stream, run_ffmpeg_sync


class FakeProcess:
    def __init__(self, lines: list[bytes | str], returncode: int = 0) -> None:
        self.stdout = io.BytesIO(b"".join(line if isinstance(line, bytes) else line.encode() for line in lines))
        self._returncode = returncode

    def wait(self) -> int:
        return self._returncode


def fake_process_module(*, process: FakeProcess | None = None) -> SimpleNamespace:
    process = process or FakeProcess([])
    return SimpleNamespace(
        CREATE_NO_WINDOW=0x08000000,
        DEVNULL=-3,
        PIPE=-1,
        STDOUT=-2,
        CalledProcessError=stdlib_subprocess.CalledProcessError,
        Popen=mock.Mock(return_value=process),
    )


def test_sync_runner_uses_no_window_and_replacement_decoding() -> None:
    process_module = fake_process_module()
    process_module.run = mock.Mock(return_value=SimpleNamespace(stdout="ok", stderr=""))

    result = run_ffmpeg_sync(["ffmpeg", "入力.mp4"], process_module=process_module)

    assert result.stdout == "ok"
    kwargs = process_module.run.call_args.kwargs
    assert kwargs["creationflags"] == process_module.CREATE_NO_WINDOW
    assert kwargs["encoding"] == "utf-8"
    assert kwargs["errors"] == "replace"
    assert kwargs["capture_output"] is True


def test_sync_runner_attaches_bounded_decoded_failure_tail() -> None:
    process_module = fake_process_module()
    process_module.run = mock.Mock(
        side_effect=stdlib_subprocess.CalledProcessError(
            7,
            ["ffmpeg"],
            output="stdout\n",
            stderr=b"bad \xff\nlast\n",
        )
    )

    with pytest.raises(stdlib_subprocess.CalledProcessError) as raised:
        run_ffmpeg_sync(["ffmpeg"], process_module=process_module)

    assert raised.value.returncode == 7
    assert raised.value.ffmpeg_output_tail == ("stdout", "bad �", "last")


def test_stream_runner_forwards_progress_lines_and_replaces_invalid_utf8() -> None:
    process_module = fake_process_module(
        process=FakeProcess([b"out_time_us=1000000\n", b"invalid \xff\n"], returncode=0)
    )
    lines: list[str] = []

    result = run_ffmpeg_stream(["ffmpeg", "-progress", "pipe:1"], on_line=lines.append, process_module=process_module)

    assert result.returncode == 0
    assert lines == ["out_time_us=1000000", "invalid �"]
    assert result.output_tail == tuple(lines)
    kwargs = process_module.Popen.call_args.kwargs
    assert kwargs["creationflags"] == process_module.CREATE_NO_WINDOW
    assert kwargs["stderr"] == process_module.STDOUT


def test_stream_runner_reports_nonzero_exit_with_tail() -> None:
    process_module = fake_process_module(process=FakeProcess(["line 1\n", "line 2\n"], returncode=3))

    with pytest.raises(FfmpegProcessError) as raised:
        run_ffmpeg_stream(["ffmpeg", "broken.mp4"], process_module=process_module)

    error = raised.value
    assert error.returncode == 3
    assert error.output_tail == ("line 1", "line 2")
    assert "exit code 3" in str(error)
    assert "line 2" in str(error)


def test_stream_runner_keeps_only_requested_tail_lines() -> None:
    process_module = fake_process_module(process=FakeProcess([f"line {i}\n" for i in range(5)]))

    result = run_ffmpeg_stream(["ffmpeg"], process_module=process_module, tail_lines=2)

    assert result.output_tail == ("line 3", "line 4")
