from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
from pydantic import ValidationError

from songcut import api
from songcut.lyrics_artifact_cache import SOURCE_FINGERPRINT_ALGORITHM, fingerprint_source
from songcut.lyrics_elements import (
    DisplayAlignmentDiagnostics,
    DisplayAlignmentResult,
    DisplayElement,
)


def request_for(source: Path, *, line_id: str = "line-1", text: str = "あ") -> api.LyricsLineAnalysisRequest:
    fingerprint = fingerprint_source(source)
    return api.LyricsLineAnalysisRequest(
        source_path=str(source),
        source_fingerprint={"algorithm": SOURCE_FINGERPRINT_ALGORITHM, "value": fingerprint},
        line={
            "id": line_id,
            "text": text,
            "start": 1.0,
            "end": 2.0,
            "confidence": 0.9,
            "alignment_source": "whisper-chunk",
            "line_revision": 3,
            "display_element_revision": 4,
            "needs_reanalysis": True,
        },
        expected_line_revision=3,
        expected_display_element_revision=4,
        project_epoch=7,
        reanalysis_epoch=8,
    )


def generated_result(text: str = "あ") -> DisplayAlignmentResult:
    return DisplayAlignmentResult(
        elements=(
            DisplayElement(
                index=0,
                stable_id="generated",
                text=text,
                start=1.0,
                end=2.0,
                confidence=0.9,
                source="mms-ctc",
                source_start=0,
                source_end=len(text),
                pronunciation="a",
                token_start=0,
                token_end=1,
                origin_key="line-1:0",
                parent_revision=5,
            ),
        ),
        diagnostics=DisplayAlignmentDiagnostics(coverage=1.0, confidence=0.9, accepted=True),
        source="mms-ctc",
        parent_revision=5,
    )


@pytest.fixture(autouse=True)
def clear_line_jobs() -> None:
    with api._jobs_lock:
        api._jobs.clear()
        api._job_cancel_events.clear()
        api._line_job_futures.clear()
        api._active_line_jobs.clear()
    yield
    with api._jobs_lock:
        for event in api._job_cancel_events.values():
            event.set()
        api._jobs.clear()
        api._job_cancel_events.clear()
        api._line_job_futures.clear()
        api._active_line_jobs.clear()


def register_line_job(job_id: str, cancel_event: threading.Event) -> None:
    now = time.time()
    with api._jobs_lock:
        api._jobs[job_id] = api.JobRecord(
            id=job_id,
            kind="lyrics-line-reanalysis",
            status="queued",
            created_at=now,
            updated_at=now,
        )
        api._job_cancel_events[job_id] = cancel_event


def test_request_rejects_revision_mismatch() -> None:
    with pytest.raises(ValidationError, match="expected line revision"):
        api.LyricsLineAnalysisRequest(
            source_path="source.wav",
            source_fingerprint={
                "algorithm": SOURCE_FINGERPRINT_ALGORITHM,
                "value": "a" * 64,
            },
            line={
                "id": "line",
                "text": "あ",
                "start": 0,
                "end": 1,
                "line_revision": 2,
                "display_element_revision": 1,
            },
            expected_line_revision=1,
            expected_display_element_revision=1,
            project_epoch=0,
            reanalysis_epoch=0,
        )


@pytest.mark.parametrize("cache_hit", [True, False])
def test_line_worker_uses_cache_or_regenerates_vocals_without_whisper(
    tmp_path: Path,
    cache_hit: bool,
) -> None:
    source = tmp_path / "source.wav"
    source.write_bytes(b"source-audio")
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"vocals")
    artifact = SimpleNamespace(vocals_path=vocals)

    class FakeCache:
        committed = cache_hit
        put_calls = 0

        def get(self, _key):
            return artifact if self.committed else None

        def put(self, _key, _vocals, **_kwargs):
            self.put_calls += 1
            self.committed = True
            return artifact

        def prune(self):
            return []

    cache = FakeCache()
    request = request_for(source)
    cancel_event = threading.Event()
    register_line_job("line-job", cancel_event)
    separated = SimpleNamespace(vocals=vocals, device_used="CPU")
    with (
        mock.patch("songcut.api._get_lyrics_artifact_cache", return_value=cache),
        mock.patch("songcut.api._lyrics_artifact_payload", return_value={"cache_key": "cache"}),
        mock.patch("songcut.api.separate_vocals", return_value=separated) as separate,
        mock.patch(
            "songcut.api.align_single_standard_display_line",
            return_value=(generated_result(), "CPU"),
        ),
        mock.patch("songcut.api.transcribe_whisper_chunks") as whisper,
    ):
        api._lyrics_line_analysis_job(
            "line-job",
            request,
            request.source_fingerprint.value,
            cancel_event,
        )

    completed = api.get_job("line-job")
    assert completed.status == "completed"
    assert completed.result["cache_hit"] is cache_hit
    assert completed.result["line"]["display_element_revision"] == 5
    assert completed.result["line"]["needs_reanalysis"] is False
    assert cache.put_calls == (0 if cache_hit else 1)
    assert separate.call_count == (0 if cache_hit else 1)
    whisper.assert_not_called()


def test_cancel_after_uninterruptible_mms_does_not_publish_result(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    source.write_bytes(b"source-audio")
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"vocals")
    artifact = SimpleNamespace(vocals_path=vocals)
    cache = SimpleNamespace(get=lambda _key: artifact)
    request = request_for(source)
    cancel_event = threading.Event()
    register_line_job("line-job", cancel_event)

    def finish_then_cancel(*_args, **_kwargs):
        cancel_event.set()
        return generated_result(), "CPU"

    with (
        mock.patch("songcut.api._get_lyrics_artifact_cache", return_value=cache),
        mock.patch("songcut.api.align_single_standard_display_line", side_effect=finish_then_cancel),
    ):
        api._lyrics_line_analysis_job(
            "line-job",
            request,
            request.source_fingerprint.value,
            cancel_event,
        )
    assert api.get_job("line-job").status == "cancelled"
    assert api.get_job("line-job").result is None
    api.fail_job("line-job", RuntimeError("late failure"))
    assert api.get_job("line-job").status == "cancelled"


def test_cancel_endpoint_is_idempotent_and_uses_cancelling_for_running_job() -> None:
    cancel_event = threading.Event()
    now = time.time()
    future = mock.Mock()
    future.cancel.return_value = False
    with api._jobs_lock:
        api._jobs["line-job"] = api.JobRecord(
            id="line-job",
            kind="lyrics-line-reanalysis",
            status="running",
            created_at=now,
            updated_at=now,
            scope="source:line",
        )
        api._job_cancel_events["line-job"] = cancel_event
        api._line_job_futures["line-job"] = future
        api._active_line_jobs["source:line"] = "line-job"
    first = api.cancel_lyrics_line_analysis_job("line-job")
    second = api.cancel_lyrics_line_analysis_job("line-job")
    assert first.status == "cancelling"
    assert second.status == "cancelling"
    assert cancel_event.is_set()
    api._finish_cancelled_line_job("line-job")
    assert api.cancel_lyrics_line_analysis_job("line-job").status == "cancelled"


def test_same_line_replacement_cancels_only_the_previous_scope(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    source.write_bytes(b"source-audio")
    release = threading.Event()
    running = threading.Event()

    def fake_worker(job_id, request, _fingerprint, cancel_event):
        api.update_job_unless_cancelled(job_id, cancel_event, status="running", progress=0.1)
        if request.line.id == "blocker":
            running.set()
            release.wait(timeout=5)
        if cancel_event.is_set():
            api._finish_cancelled_line_job(job_id)
        else:
            api.update_job_unless_cancelled(job_id, cancel_event, status="completed", progress=1.0)

    executor = ThreadPoolExecutor(max_workers=1)
    with (
        mock.patch.object(api, "_line_job_executor", executor),
        mock.patch("songcut.api._lyrics_line_analysis_job", side_effect=fake_worker),
    ):
        blocker = api.create_lyrics_line_analysis_job(request_for(source, line_id="blocker"))
        assert running.wait(timeout=2)
        previous = api.create_lyrics_line_analysis_job(request_for(source, line_id="same"))
        other = api.create_lyrics_line_analysis_job(request_for(source, line_id="other"))
        latest = api.create_lyrics_line_analysis_job(request_for(source, line_id="same", text="い"))
        assert api.get_job(previous.id).status == "cancelled"
        assert api.get_job(other.id).status == "queued"
        assert api.get_job(latest.id).status == "queued"
        assert api.get_job(blocker.id).status == "running"
        release.set()
        executor.shutdown(wait=True)

    assert api.get_job(other.id).status == "completed"
    assert api.get_job(latest.id).status == "completed"
    assert api.get_job(previous.id).status == "cancelled"
