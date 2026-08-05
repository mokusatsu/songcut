from __future__ import annotations

import ast
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def call_count(source: str, *, owner: str, method: str) -> int:
    tree = ast.parse(source)
    return sum(
        1
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == method
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == owner
    )


def test_whisper_callers_share_session_factory_without_merging_domain_offsets() -> None:
    callers = {
        "songcut/transcription.py": "segment",
        "songcut/lyrics_alignment.py": "active interval",
        "songcut/uta_alignment.py": "request",
    }
    for path, unit in callers.items():
        source = read_source(path)
        assert "from .whisper_execution import WhisperExecutionSession" in source, path
        assert call_count(source, owner="WhisperExecutionSession", method="from_openvino") == 1, path
        assert "WhisperPipeline(" not in source, path
        assert "session.generate(" in source or "self._session.generate(" in source, path
        # Keep the caller's input unit explicit; the shared session must not own
        # Cut segments, Sub active intervals, or Uta requests.
        assert unit in source, path

    transcription = read_source("songcut/transcription.py")
    lyrics = read_source("songcut/lyrics_alignment.py")
    uta = read_source("songcut/uta_alignment.py")
    assert "start + chunk.start" in transcription
    assert "interval_start + chunk.start" in lyrics
    assert "interval_offset + chunk.start" in uta
    assert "text_attribute=\"word\"" in uta


def test_ffmpeg_callers_use_common_process_runner_but_keep_command_progress_and_validation() -> None:
    smart = read_source("songcut/smart_export.py")
    subtitle = read_source("songcut/subtitle_export.py")
    assert "from .ffmpeg_process import CREATE_NO_WINDOW, run_ffmpeg_sync" in smart
    assert "from .ffmpeg_process import run_ffmpeg_stream, run_ffmpeg_sync" in subtitle
    assert "run_ffmpeg_sync(" in smart
    assert "run_ffmpeg_sync(" in subtitle
    assert "run_ffmpeg_stream(" in subtitle
    assert "progress_start" in subtitle and "progress_end" in subtitle
    assert "probe_duration" in subtitle and "target.exists()" in subtitle
    for source in (smart, subtitle):
        assert not re.search(r"subprocess\.(?:run|Popen)\s*\(", source)


def test_common_primitives_are_the_only_whisper_pipeline_and_ffmpeg_process_owners() -> None:
    whisper_sources = {
        path: read_source(path)
        for path in (
            "songcut/transcription.py",
            "songcut/lyrics_alignment.py",
            "songcut/uta_alignment.py",
            "songcut/whisper_execution.py",
        )
    }
    assert "WhisperPipeline(" in whisper_sources["songcut/whisper_execution.py"]
    for path, source in whisper_sources.items():
        if path != "songcut/whisper_execution.py":
            assert "WhisperPipeline(" not in source, path

    ffmpeg_helper = read_source("songcut/ffmpeg_process.py")
    assert "def run_ffmpeg_sync(" in ffmpeg_helper
    assert "def run_ffmpeg_stream(" in ffmpeg_helper
    for path in ("songcut/smart_export.py", "songcut/subtitle_export.py"):
        source = read_source(path)
        assert "from .ffmpeg_process import" in source, path
        assert "subprocess.Popen(" not in source, path
        assert "subprocess.run(" not in source, path
