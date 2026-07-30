from __future__ import annotations

import argparse
import socket
import tempfile
import threading
import time
import traceback
import uuid
import win_safesubprocess as subprocess
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal

from .ffmpeg_tools import CREATE_NO_WINDOW, find_ffmpeg, probe_duration
from .boundary_refiner import BoundaryRefinerConfig
from .guide import make_unique_stem, safe_filename_stem
from .gui_pipeline import analyze_for_gui, probe_video
from .lyrics_alignment import align_lyrics_to_chunks, parse_lyrics, transcribe_whisper_chunks
from .mms_alignment import (
    MMS_MODEL,
    ensure_mms_onnx_model,
    mms_onnx_model_status,
    refine_standard_alignment_with_mms,
    resolve_mms_onnx_model_dir,
)
from .uta_alignment import align_lyrics_with_uta
from .rhythm_alignment import (
    adjust_lines_to_rhythm,
    build_extended_rhythm_grid,
    confidence_statistics,
    detect_beat_times,
)
from .scratch_proxy import ScratchProxyCancelled, ScratchProxyManager
from .source_separation import (
    DEMUCS_MODEL,
    demucs_model_status,
    ensure_demucs_model,
    resolve_demucs_model_dir,
    separate_vocals,
)
from .smart_export import estimate_smart_render, export_smart_clip, plan_smart_render
from .subtitle_export import (
    SubtitleEffect,
    SubtitleLane,
    SubtitleSegment,
    export_subtitle_bundle,
    render_subtitle_png_base64,
    subtitle_style_from_mapping,
)
from .transcription import (
    DEFAULT_WHISPER_MODEL_KEY,
    WHISPER_MODEL_ID,
    WHISPER_OPENVINO_REPO_ID,
    directory_size,
    ensure_whisper_model,
    normalize_whisper_language,
    require_whisper_model,
    resolve_whisper_model_dir,
    select_whisper_runtime,
    transcribe_segments,
    whisper_language_options,
    whisper_model_statuses,
)
from .youtube_metadata import load_timestamp_comment_candidates
from .waveform import (
    WAVEFORM_CHANNELS,
    WAVEFORM_GENERATOR,
    WAVEFORM_SAMPLE_RATE,
    WaveformCancelled,
    WaveformGenerator,
)

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field, model_validator
except Exception as exc:  # pragma: no cover - optional GUI dependency
    raise RuntimeError("Install songcut[gui] to run the REST API.") from exc


class ProbeRequest(BaseModel):
    path: str


class BoundaryRefinementRequest(BaseModel):
    enabled: bool = True
    search_radius_seconds: float = Field(default=30.0, ge=5.0, le=120.0)
    rms_window_ms: int = Field(default=80, ge=50, le=100, multiple_of=10)
    occupancy_window_seconds: float = Field(default=2.0, ge=0.5, le=10.0)
    high_occupancy: float = Field(default=0.80, ge=0.5, le=1.0)
    low_occupancy: float = Field(default=0.35, ge=0.0, le=0.5)
    start_persistence_seconds: float = Field(default=2.0, ge=0.5, le=10.0)
    end_persistence_seconds: float = Field(default=3.0, ge=0.5, le=15.0)
    contrast_window_seconds: float = Field(default=5.0, ge=1.0, le=15.0)
    pre_roll_seconds: float = Field(default=0.5, ge=0.3, le=1.0)
    post_roll_seconds: float = Field(default=1.0, ge=0.3, le=1.0)

    @model_validator(mode="after")
    def validate_hysteresis(self) -> "BoundaryRefinementRequest":
        if self.low_occupancy >= self.high_occupancy:
            raise ValueError("low_occupancy must be lower than high_occupancy")
        return self

    def to_config(self) -> BoundaryRefinerConfig:
        config = BoundaryRefinerConfig(**self.model_dump())
        config.validate()
        return config


class AnalyzeRequest(BaseModel):
    path: str
    guide_text: str = ""
    timestamp_source: str = "auto"
    device: str = "auto"
    transcribe: bool = True
    whisper_model: str = DEFAULT_WHISPER_MODEL_KEY
    whisper_device: str = "auto"
    whisper_language: str | None = "<|ja|>"
    boundary_refinement: BoundaryRefinementRequest = Field(default_factory=BoundaryRefinementRequest)


class WhisperDownloadRequest(BaseModel):
    model: str = DEFAULT_WHISPER_MODEL_KEY


class DemucsDownloadRequest(BaseModel):
    pass


class MmsDownloadRequest(BaseModel):
    pass


class TranscriptionSegmentRequest(BaseModel):
    id: str
    start: float
    end: float


class TranscriptionRequest(BaseModel):
    source_path: str
    segments: list[TranscriptionSegmentRequest] = Field(default_factory=list)
    model: str = DEFAULT_WHISPER_MODEL_KEY
    language: str | None = "ja"
    device: str = "auto"
    initial_prompt: str | None = None


class ExportItem(BaseModel):
    id: str
    filename_stem: str
    start: float
    end: float
    checked: bool = True


class ExportRequest(BaseModel):
    source_path: str
    output_dir: str
    items: list[ExportItem] = Field(default_factory=list)
    timestamp_comment_text: str = ""
    create_source_folder: bool = False


class ExportPlanRequest(BaseModel):
    source_path: str
    items: list[ExportItem] = Field(default_factory=list)


class ScratchProxyRequest(BaseModel):
    path: str


class WaveformRequest(BaseModel):
    path: str


class LyricsAnalysisRequest(BaseModel):
    source_path: str
    lyrics_text: str = Field(min_length=1)
    model: str = DEFAULT_WHISPER_MODEL_KEY
    language: str | None = "ja"
    device: str = "auto"
    algorithm: Literal["songcut-standard", "uta-align"] = "songcut-standard"


class SubtitleStyleRequest(BaseModel):
    font_name: str = "Yu Gothic UI"
    font_size: float = Field(default=48.0, gt=0, le=400)
    primary_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    background_color: str = "#00000080"
    bold: bool = False
    italic: bool = False
    outline: float = Field(default=2.0, ge=0, le=30)
    shadow: float = Field(default=0.0, ge=0, le=30)
    alignment: int = Field(default=2, ge=1, le=9)
    margin_l: int = Field(default=60, ge=0, le=4000)
    margin_r: int = Field(default=60, ge=0, le=4000)
    margin_v: int = Field(default=54, ge=0, le=4000)


class SubtitleSegmentRequest(BaseModel):
    id: str
    text: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> "SubtitleSegmentRequest":
        if self.end <= self.start:
            raise ValueError("subtitle segment end must be after start")
        return self


class SubtitleEffectRequest(BaseModel):
    name: str = "cut"
    start_duration_ms: int = Field(default=300, ge=0, le=60000)
    end_duration_ms: int = Field(default=300, ge=0, le=60000)
    params: dict[str, str | int | float] = Field(default_factory=dict)


class SubtitleLaneRequest(BaseModel):
    id: str
    name: str = ""
    style: SubtitleStyleRequest = Field(default_factory=SubtitleStyleRequest)
    effect: SubtitleEffectRequest = Field(default_factory=SubtitleEffectRequest)
    segments: list[SubtitleSegmentRequest] = Field(default_factory=list)


class SubtitleExportRequest(BaseModel):
    source_path: str
    output_dir: str
    play_res_x: int = Field(gt=0)
    play_res_y: int = Field(gt=0)
    lanes: list[SubtitleLaneRequest] = Field(min_length=1, max_length=3)


class SubtitleRenderItemRequest(BaseModel):
    segment_id: str
    signature: str = Field(min_length=1, max_length=4096)
    text: str
    style: SubtitleStyleRequest = Field(default_factory=SubtitleStyleRequest)


class SubtitleRenderRequest(BaseModel):
    play_res_x: int = Field(gt=0, le=7680)
    play_res_y: int = Field(gt=0, le=4320)
    items: list[SubtitleRenderItemRequest] = Field(min_length=1, max_length=1000)


class JobRecord(BaseModel):
    id: str
    kind: str
    status: str
    progress: float = 0.0
    message: str = ""
    message_code: str | None = None
    message_args: dict[str, str | int | float] | None = None
    result: Any = None
    error: str | None = None
    created_at: float
    updated_at: float


app = FastAPI(title="songcut API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, JobRecord] = {}
_jobs_lock = threading.Lock()
_job_cancel_events: dict[str, threading.Event] = {}
_scratch_proxy_manager = ScratchProxyManager()
_waveform_generator = WaveformGenerator()
_waveform_points: dict[str, list[dict[str, float | int]]] = {}
_waveform_finished_at: dict[str, float] = {}
WAVEFORM_JOB_TTL_SECONDS = 10 * 60
FFMPEG_DOWNLOAD_URL = "https://www.ffmpeg.org/download.html"


@app.get("/health")
def health() -> dict[str, Any]:
    ffmpeg = _ffmpeg_check_payload()
    payload: dict[str, Any] = {"ok": True}
    if ffmpeg["ok"]:
        payload["ffmpeg"] = ffmpeg["ffmpeg"]
        payload["ffprobe"] = ffmpeg["ffprobe"]
    else:
        payload["ffmpeg"] = None
        payload["ffprobe"] = None
        payload["ffmpeg_error"] = ffmpeg["error"]
    return payload


@app.get("/ffmpeg/check")
def ffmpeg_check() -> dict[str, Any]:
    return _ffmpeg_check_payload()


@app.get("/devices")
def devices() -> dict[str, Any]:
    singing = {}
    whisper = {}
    for requested in ("auto", "npu", "gpu", "cpu"):
        try:
            whisper[requested] = asdict(select_whisper_runtime(requested))
        except Exception as exc:
            whisper[requested] = {"error": str(exc)}
    return {"whisper": whisper, "singing": singing}


@app.get("/models/whisper")
def whisper_model_status() -> dict[str, Any]:
    runtime = select_whisper_runtime("auto")
    models = whisper_model_statuses()
    default_model = next(item for item in models if item["key"] == DEFAULT_WHISPER_MODEL_KEY)
    return {
        "default_model": DEFAULT_WHISPER_MODEL_KEY,
        "models": models,
        "languages": whisper_language_options(),
        "devices": devices()["whisper"],
        # Compatibility fields retained for the one-model API.
        "model_id": WHISPER_MODEL_ID,
        "openvino_repo_id": WHISPER_OPENVINO_REPO_ID,
        "model_dir": default_model["model_dir"],
        "ready": default_model["ready"],
        "runtime": asdict(runtime),
    }


@app.post("/models/whisper/download")
def download_whisper_model(request: WhisperDownloadRequest | None = None) -> JobRecord:
    model_key = (request or WhisperDownloadRequest()).model.strip().lower()
    try:
        require_whisper_model(model_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return start_job("download-whisper", lambda job_id: _download_whisper_job(job_id, model_key))


@app.get("/models/demucs")
def get_demucs_model_status() -> dict[str, Any]:
    return demucs_model_status()


@app.post("/models/demucs/download")
def download_demucs_model(_request: DemucsDownloadRequest | None = None) -> JobRecord:
    return start_job("download-demucs", _download_demucs_job)


@app.get("/models/mms")
def get_mms_model_status() -> dict[str, Any]:
    return mms_onnx_model_status()


@app.post("/models/mms/download")
def download_mms_model(_request: MmsDownloadRequest | None = None) -> JobRecord:
    return start_job("download-mms", _download_mms_job)


@app.post("/videos/probe")
def probe(request: ProbeRequest) -> dict[str, Any]:
    source = require_file(request.path)
    ffmpeg = find_ffmpeg()
    payload = probe_video(ffmpeg.ffprobe, source)
    payload["smart_render_estimate"] = asdict(
        estimate_smart_render(
            str(payload.get("format_name") or ""),
            str(payload.get("video", {}).get("codec") or ""),
            source,
        )
    )
    candidates, warning = load_timestamp_comment_candidates(source)
    payload["timestamp_comment_candidates"] = candidates
    payload["info_json_warning"] = warning
    return payload


@app.post("/analysis/jobs")
def create_analysis_job(request: AnalyzeRequest) -> JobRecord:
    return start_job("analysis", lambda job_id: _analysis_job(job_id, request))


@app.post("/waveform/jobs")
def create_waveform_job(request: WaveformRequest) -> JobRecord:
    require_file(request.path)
    _prune_waveform_jobs()
    cancel_event = threading.Event()
    record = start_job(
        "waveform",
        lambda job_id: _waveform_job(job_id, request, cancel_event),
        cancel_event=cancel_event,
    )
    with _jobs_lock:
        _waveform_points.setdefault(record.id, [])
    return record


@app.get("/waveform/jobs/{job_id}/updates")
def waveform_job_updates(job_id: str, cursor: int = 0, limit: int = 2048) -> dict[str, Any]:
    if cursor < 0:
        raise HTTPException(status_code=400, detail="cursor must be non-negative")
    limit = max(1, min(4096, limit))
    with _jobs_lock:
        job = _jobs.get(job_id)
        points = _waveform_points.get(job_id)
        if not job or job.kind != "waveform" or points is None:
            raise HTTPException(status_code=404, detail="waveform job not found")
        if cursor > len(points):
            raise HTTPException(status_code=409, detail="waveform cursor is ahead of available data")
        end = min(len(points), cursor + limit)
        update_points = list(points[cursor:end])
        result = job.result if job.status == "completed" else None
        return {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "message_code": job.message_code,
            "message_args": job.message_args,
            "error": job.error,
            "cursor": end,
            "points": update_points,
            "has_more": end < len(points),
            "metadata": result,
        }


@app.delete("/waveform/jobs/{job_id}")
def cancel_or_release_waveform_job(job_id: str) -> JobRecord:
    with _jobs_lock:
        job = _jobs.get(job_id)
        cancel_event = _job_cancel_events.get(job_id)
    if not job or job.kind != "waveform":
        raise HTTPException(status_code=404, detail="waveform job not found")
    if job.status in {"completed", "failed", "cancelled"}:
        result = job
        _release_waveform_job(job_id)
        return result
    if cancel_event is not None:
        cancel_event.set()
    _waveform_generator.cancel(job_id)
    update_job(job_id, status="cancelled", progress=1.0, message="Waveform generation cancelled.")
    with _jobs_lock:
        _waveform_finished_at[job_id] = time.time()
    return get_job(job_id)


@app.post("/transcription/jobs")
def create_transcription_job(request: TranscriptionRequest) -> JobRecord:
    source = require_file(request.source_path)
    model_key = request.model.strip().lower()
    try:
        require_whisper_model(model_key)
        language_code, _language_token = normalize_whisper_language(request.language)
        select_whisper_runtime(request.device)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if resolve_whisper_model_dir(model_key) is None:
        raise HTTPException(
            status_code=409,
            detail={"code": "WHISPER_MODEL_NOT_READY", "model": model_key},
        )
    segments = [segment.model_dump() for segment in request.segments]
    if not segments:
        raise HTTPException(status_code=400, detail="At least one transcription segment is required.")
    for segment in segments:
        if segment["start"] < 0 or segment["end"] <= segment["start"]:
            raise HTTPException(status_code=400, detail=f"Invalid transcription segment: {segment['id']}")
    return start_job(
        "transcription",
        lambda job_id: _transcription_job(
            job_id,
            source,
            segments,
            model_key=model_key,
            requested_device=request.device,
            language=language_code,
            initial_prompt=request.initial_prompt,
        ),
    )


@app.post("/export/jobs")
def create_export_job(request: ExportRequest) -> JobRecord:
    return start_job("export", lambda job_id: _export_job(job_id, request))


@app.post("/lyrics-analysis/jobs")
def create_lyrics_analysis_job(request: LyricsAnalysisRequest) -> JobRecord:
    return start_job("lyrics-analysis", lambda job_id: _lyrics_analysis_job(job_id, request))


@app.post("/subtitle-export/jobs")
def create_subtitle_export_job(request: SubtitleExportRequest) -> JobRecord:
    return start_job("subtitle-export", lambda job_id: _subtitle_export_job(job_id, request))


@app.post("/subtitle-render/jobs")
def create_subtitle_render_job(request: SubtitleRenderRequest) -> JobRecord:
    return start_job("subtitle-render", lambda job_id: _subtitle_render_job(job_id, request))


@app.post("/export/plan")
def create_export_plan(request: ExportPlanRequest) -> dict[str, Any]:
    source = require_file(request.source_path)
    ffmpeg = find_ffmpeg()
    items: list[dict[str, Any]] = []
    for item in request.items:
        if not item.checked:
            continue
        plan = plan_smart_render(ffmpeg.ffprobe, source, start=item.start, end=item.end)
        copied_seconds = sum(span.end - span.start for span in plan.spans if span.mode == "copy")
        items.append(
            {
                "id": item.id,
                "smart_render": plan.fallback_reason is None,
                "output_suffix": plan.output_suffix,
                "video_codec": plan.video_codec,
                "container_family": plan.container_family,
                "copied_seconds": copied_seconds,
                "encoded_seconds": max(0.0, item.end - item.start - copied_seconds),
                "fallback_reason": plan.fallback_reason,
            }
        )
    return {"items": items}


@app.post("/scratch-proxy/jobs")
def create_scratch_proxy_job(request: ScratchProxyRequest) -> JobRecord:
    require_file(request.path)
    cancel_event = threading.Event()
    return start_job(
        "scratch-proxy",
        lambda job_id: _scratch_proxy_job(job_id, request, cancel_event),
        cancel_event=cancel_event,
    )


@app.delete("/scratch-proxy/jobs/{job_id}")
def cancel_scratch_proxy_job(job_id: str) -> JobRecord:
    with _jobs_lock:
        job = _jobs.get(job_id)
        cancel_event = _job_cancel_events.get(job_id)
    if not job or job.kind != "scratch-proxy":
        raise HTTPException(status_code=404, detail="scratch proxy job not found")
    if job.status in {"completed", "failed", "cancelled"}:
        return job
    if cancel_event is not None:
        cancel_event.set()
    _scratch_proxy_manager.cancel(job_id)
    update_job(job_id, status="cancelled", progress=1.0, message="Scratch proxy generation cancelled.")
    return get_job(job_id)


@app.delete("/scratch-proxies/{proxy_id}")
def release_scratch_proxy(proxy_id: str) -> dict[str, bool]:
    return {"released": _scratch_proxy_manager.release(proxy_id)}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> JobRecord:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


def start_job(kind: str, target, *, cancel_event: threading.Event | None = None) -> JobRecord:
    job_id = str(uuid.uuid4())
    now = time.time()
    record = JobRecord(id=job_id, kind=kind, status="queued", created_at=now, updated_at=now)
    with _jobs_lock:
        _jobs[job_id] = record
        if cancel_event is not None:
            _job_cancel_events[job_id] = cancel_event
    thread = threading.Thread(target=target, args=(job_id,), daemon=True)
    thread.start()
    return record


def update_job(job_id: str, **changes: Any) -> None:
    _add_message_metadata(changes)
    with _jobs_lock:
        current = _jobs[job_id]
        data = current.model_dump()
        data.update(changes)
        data["updated_at"] = time.time()
        _jobs[job_id] = JobRecord(**data)


def update_job_unless_cancelled(job_id: str, cancel_event: threading.Event, **changes: Any) -> bool:
    _add_message_metadata(changes)
    with _jobs_lock:
        current = _jobs[job_id]
        if cancel_event.is_set() or current.status == "cancelled":
            return False
        data = current.model_dump()
        data.update(changes)
        data["updated_at"] = time.time()
        _jobs[job_id] = JobRecord(**data)
        return True


_MESSAGE_CODES = {
    "Analyzing singing segments.": "analysisRunning",
    "Singing analysis complete.": "analysisSingingComplete",
    "Analysis complete.": "analysisComplete",
    "Preparing waveform.": "waveformPreparing",
    "Waveform ready.": "waveformReady",
    "Waveform generation cancelled.": "waveformCancelled",
    "Preparing Whisper transcription.": "transcriptionPreparing",
    "Transcription complete.": "transcriptionComplete",
    "Export complete.": "exportComplete",
    "Preparing AAC scratch proxy.": "proxyPreparing",
    "Scratch proxy ready.": "proxyReady",
    "Scratch proxy generation cancelled.": "proxyCancelled",
    "Creating AAC scratch proxy.": "proxyCreating",
    "Separating vocals with Demucs.": "lyricsSeparatingVocals",
    "Transcribing isolated vocals.": "lyricsTranscribingVocals",
    "Aligning lyrics with Uta-Align.": "lyricsAligning",
    "Aligning lyrics.": "lyricsAligning",
    "Detecting rhythm grid.": "lyricsDetectingRhythm",
    "Lyrics analysis complete.": "lyricsComplete",
    "Downloading OpenVINO Demucs.": "demucsDownloading",
    "OpenVINO Demucs model ready.": "demucsReady",
    "Downloading MMS forced aligner.": "mmsDownloading",
    "MMS forced aligner ready.": "mmsReady",
    "Refining lyric onset with MMS.": "lyricsRefiningOnset",
}


def _add_message_metadata(changes: dict[str, Any]) -> None:
    if "message" not in changes or "message_code" in changes:
        return
    message = str(changes["message"])
    changes["message_code"] = _MESSAGE_CODES.get(message)
    changes["message_args"] = None
    dynamic_prefixes = (
        ("Downloading Whisper ", "whisperDownloading", "model"),
        ("Whisper ", "whisperReady", "model"),
        ("Exporting ", "exportingItem", "id"),
    )
    for prefix, code, argument in dynamic_prefixes:
        if message.startswith(prefix) and message.endswith("."):
            value = message[len(prefix):-1]
            if code == "whisperReady" and not value.endswith(" model ready"):
                continue
            if code == "whisperReady":
                value = value.removesuffix(" model ready")
            changes["message_code"] = code
            changes["message_args"] = {argument: value}
            return
    if message.startswith("Transcribed ") and message.endswith(" segments."):
        counts = message[len("Transcribed "):-len(" segments.")].split("/", 1)
        if len(counts) == 2 and all(value.isdigit() for value in counts):
            changes["message_code"] = "transcriptionProgress"
            changes["message_args"] = {"current": int(counts[0]), "total": int(counts[1])}


def fail_job(job_id: str, exc: Exception) -> None:
    update_job(job_id, status="failed", progress=1.0, error=f"{exc}\n{traceback.format_exc()}")


def _ffmpeg_check_payload() -> dict[str, Any]:
    try:
        ffmpeg = find_ffmpeg()
        _check_executable_runs("ffmpeg", ffmpeg.ffmpeg)
        _check_executable_runs("ffprobe", ffmpeg.ffprobe)
    except Exception as exc:
        return {
            "ok": False,
            "ffmpeg": None,
            "ffprobe": None,
            "error": str(exc),
            "download_url": FFMPEG_DOWNLOAD_URL,
        }
    return {
        "ok": True,
        "ffmpeg": str(ffmpeg.ffmpeg),
        "ffprobe": str(ffmpeg.ffprobe),
        "download_url": FFMPEG_DOWNLOAD_URL,
    }


def _check_executable_runs(label: str, executable: Path) -> None:
    try:
        subprocess.run(
            [str(executable), "-version"],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=CREATE_NO_WINDOW,
        )
    except Exception as exc:
        raise RuntimeError(f"{label} could not be started: {executable} ({exc})") from exc


def _download_whisper_job(job_id: str, model_key: str = DEFAULT_WHISPER_MODEL_KEY) -> None:
    try:
        spec = require_whisper_model(model_key)
        update_job(job_id, status="running", progress=0.0, message=f"Downloading Whisper {spec.display_name}.")
        progress_lock = threading.Lock()
        last_reported_progress = 0.0
        last_reported_at = 0.0

        def on_download_progress(downloaded_bytes: int, total_bytes: int) -> None:
            nonlocal last_reported_progress, last_reported_at
            if total_bytes <= 0:
                return
            now = time.monotonic()
            next_progress = min(1.0, downloaded_bytes / total_bytes)
            with progress_lock:
                if (
                    next_progress < last_reported_progress + 0.002
                    and now < last_reported_at + 0.25
                    and downloaded_bytes < total_bytes
                ):
                    return
                last_reported_progress = max(last_reported_progress, next_progress)
                last_reported_at = now
                update_job(
                    job_id,
                    status="running",
                    progress=last_reported_progress,
                    message=f"Downloading Whisper {spec.display_name}.",
                    result={
                        "model": model_key,
                        "downloaded_bytes": downloaded_bytes,
                        "total_bytes": total_bytes,
                    },
                )

        model_dir = ensure_whisper_model(
            model_key=model_key,
            progress_callback=on_download_progress,
        )
        resolved = resolve_whisper_model_dir(model_key)
        source = resolved[1] if resolved is not None else "downloaded"
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message=f"Whisper {spec.display_name} model ready.",
            result={
                "model": model_key,
                "model_dir": str(model_dir),
                "source": source,
                "installed_bytes": directory_size(model_dir),
            },
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _download_demucs_job(job_id: str) -> None:
    try:
        update_job(
            job_id,
            status="running",
            progress=0.0,
            message="Downloading OpenVINO Demucs.",
        )
        progress_lock = threading.Lock()
        last_reported_progress = 0.0
        last_reported_at = 0.0

        def on_download_progress(downloaded_bytes: int, total_bytes: int) -> None:
            nonlocal last_reported_progress, last_reported_at
            if total_bytes <= 0:
                return
            now = time.monotonic()
            next_progress = min(1.0, downloaded_bytes / total_bytes)
            with progress_lock:
                if (
                    next_progress < last_reported_progress + 0.002
                    and now < last_reported_at + 0.25
                    and downloaded_bytes < total_bytes
                ):
                    return
                last_reported_progress = max(last_reported_progress, next_progress)
                last_reported_at = now
                update_job(
                    job_id,
                    status="running",
                    progress=last_reported_progress,
                    message="Downloading OpenVINO Demucs.",
                    result={
                        "model": DEMUCS_MODEL,
                        "downloaded_bytes": downloaded_bytes,
                        "total_bytes": total_bytes,
                    },
                )

        model_dir = ensure_demucs_model(progress_callback=on_download_progress)
        resolved = resolve_demucs_model_dir()
        source = resolved[1] if resolved is not None else "downloaded"
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="OpenVINO Demucs model ready.",
            result={
                "model": DEMUCS_MODEL,
                "model_dir": str(model_dir),
                "source": source,
                "installed_bytes": directory_size(model_dir),
            },
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _download_mms_job(job_id: str) -> None:
    try:
        message = "Downloading MMS forced aligner."
        update_job(job_id, status="running", progress=0.0, message=message)
        progress_lock = threading.Lock()
        last_reported_progress = 0.0
        last_reported_at = 0.0

        def on_download_progress(downloaded_bytes: int, total_bytes: int) -> None:
            nonlocal last_reported_progress, last_reported_at
            if total_bytes <= 0:
                return
            now = time.monotonic()
            next_progress = min(1.0, downloaded_bytes / total_bytes)
            with progress_lock:
                if (
                    next_progress < last_reported_progress + 0.002
                    and now < last_reported_at + 0.25
                    and downloaded_bytes < total_bytes
                ):
                    return
                last_reported_progress = max(last_reported_progress, next_progress)
                last_reported_at = now
                update_job(
                    job_id,
                    status="running",
                    progress=last_reported_progress,
                    message=message,
                    result={
                        "model": MMS_MODEL,
                        "downloaded_bytes": downloaded_bytes,
                        "total_bytes": total_bytes,
                    },
                )

        model_path = ensure_mms_onnx_model(progress_callback=on_download_progress)
        resolved = resolve_mms_onnx_model_dir()
        model_dir, source = (
            resolved if resolved is not None else (model_path.parent.parent, "downloaded")
        )
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="MMS forced aligner ready.",
            result={
                "model": MMS_MODEL,
                "model_dir": str(model_dir),
                "source": source,
                "installed_bytes": directory_size(model_dir),
            },
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _analysis_job(job_id: str, request: AnalyzeRequest) -> None:
    try:
        update_job(job_id, status="running", progress=0.05, message="Analyzing singing segments.")
        source = require_file(request.path)
        payload = analyze_for_gui(
            source,
            guide_text=request.guide_text,
            timestamp_source=request.timestamp_source,
            device=request.device,
            boundary_refinement=request.boundary_refinement.to_config(),
        )
        update_job(job_id, progress=0.72, message="Singing analysis complete.")
        if request.transcribe and payload["segments"]:
            transcription_job = start_job(
                "transcription",
                lambda transcription_job_id: _transcription_job(
                    transcription_job_id,
                    source,
                    [dict(segment) for segment in payload["segments"]],
                    model_key=request.whisper_model,
                    requested_device=request.whisper_device,
                    language=request.whisper_language,
                    initial_prompt=request.guide_text.strip() or None,
                ),
            )
            payload["transcription_job_id"] = transcription_job.id
        update_job(job_id, status="completed", progress=1.0, message="Analysis complete.", result=payload)
    except Exception as exc:
        fail_job(job_id, exc)


def _waveform_job(job_id: str, request: WaveformRequest, cancel_event: threading.Event) -> None:
    try:
        with _jobs_lock:
            _waveform_points.setdefault(job_id, [])
        update_job(job_id, status="running", progress=0.0, message="Preparing waveform.")
        source = require_file(request.path)
        ffmpeg_paths = find_ffmpeg()
        duration = probe_duration(ffmpeg_paths.ffprobe, source)

        def on_points(points: list[dict[str, float | int]]) -> None:
            with _jobs_lock:
                current = _jobs.get(job_id)
                target = _waveform_points.get(job_id)
                if current is None or target is None or current.status == "cancelled" or cancel_event.is_set():
                    return
                target.extend(points)

        def on_progress(progress: float, message: str) -> None:
            update_job_unless_cancelled(job_id, cancel_event, progress=progress, message=message)

        points = _waveform_generator.generate(
            job_id,
            ffmpeg_paths.ffmpeg,
            source,
            duration=duration,
            cancel_event=cancel_event,
            on_points=on_points,
            on_progress=on_progress,
        )
        if not update_job_unless_cancelled(
            job_id,
            cancel_event,
            status="completed",
            progress=1.0,
            message="Waveform ready.",
            result={
                "source_path": str(source),
                "duration": round(duration, 3),
                "sample_rate": WAVEFORM_SAMPLE_RATE,
                "channels": WAVEFORM_CHANNELS,
                "generator": WAVEFORM_GENERATOR,
                "point_count": len(points),
            },
        ):
            return
    except WaveformCancelled:
        update_job(job_id, status="cancelled", progress=1.0, message="Waveform generation cancelled.")
    except Exception as exc:
        if cancel_event.is_set():
            update_job(job_id, status="cancelled", progress=1.0, message="Waveform generation cancelled.")
        else:
            fail_job(job_id, exc)
    finally:
        with _jobs_lock:
            _job_cancel_events.pop(job_id, None)
            _waveform_finished_at[job_id] = time.time()


def _transcription_job(
    job_id: str,
    source: Path,
    segments: list[dict[str, Any]],
    *,
    requested_device: str,
    language: str | None,
    initial_prompt: str | None,
    model_key: str = DEFAULT_WHISPER_MODEL_KEY,
) -> None:
    try:
        update_job(job_id, status="running", progress=0.01, message="Preparing Whisper transcription.", result={"transcripts": []})
        ffmpeg_paths = find_ffmpeg()
        transcripts: list[dict[str, Any]] = []

        def on_segment(index: int, total: int, transcript) -> None:
            transcripts.append(asdict(transcript))
            update_job(
                job_id,
                status="running",
                progress=index / max(1, total),
                message=f"Transcribed {index}/{total} segments.",
                result={"transcripts": transcripts},
            )

        transcribe_segments(
            ffmpeg_paths,
            source,
            segments,
            model_key=model_key,
            requested_device=requested_device,
            language=language,
            initial_prompt=initial_prompt,
            on_segment=on_segment,
        )
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="Transcription complete.",
            result={
                "transcripts": transcripts,
                "settings": {
                    "model": model_key,
                    "language": normalize_whisper_language(language)[0],
                    "device": requested_device,
                },
            },
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _export_job(job_id: str, request: ExportRequest) -> None:
    try:
        source = require_file(request.source_path)
        output_dir = Path(request.output_dir)
        if request.create_source_folder:
            output_dir /= safe_filename_stem(source.stem, fallback="video")
        output_dir.mkdir(parents=True, exist_ok=True)
        ffmpeg = find_ffmpeg()
        selected = [item for item in request.items if item.checked]
        exported = []
        used_filename_stems: set[str] = set()
        timestamp_comment_path: str | None = None
        if request.timestamp_comment_text.strip():
            target_text = request.timestamp_comment_text.rstrip() + "\n"
            timestamp_path = output_dir / "ts_comments.txt"
            timestamp_path.write_text(target_text, encoding="utf-8")
            timestamp_comment_path = str(timestamp_path)
        for index, item in enumerate(selected, start=1):
            update_job(
                job_id,
                status="running",
                progress=(index - 1) / max(1, len(selected)),
                message=f"Exporting {item.id}.",
            )
            filename_stem = make_unique_stem(
                safe_filename_stem(item.filename_stem, fallback=item.id),
                used_filename_stems,
            )
            target = output_dir / f"{filename_stem}.mp4"
            export_result = export_smart_clip(
                ffmpeg.ffmpeg,
                ffmpeg.ffprobe,
                source,
                target,
                start=item.start,
                end=item.end,
            )
            export_result["id"] = item.id
            exported.append(export_result)
        result: dict[str, Any] = {"exported": exported, "output_dir": str(output_dir)}
        if timestamp_comment_path:
            result["timestamp_comment_path"] = timestamp_comment_path
        update_job(job_id, status="completed", progress=1.0, message="Export complete.", result=result)
    except Exception as exc:
        fail_job(job_id, exc)


def _lyrics_analysis_job(job_id: str, request: LyricsAnalysisRequest) -> None:
    started = time.perf_counter()
    try:
        source = require_file(request.source_path)
        document = parse_lyrics(request.lyrics_text)
        update_job(job_id, status="running", progress=0.03, message="Separating vocals with OpenVINO Demucs.")
        with tempfile.TemporaryDirectory(prefix="songcut-demucs-") as temporary_directory:
            separated = separate_vocals(
                source,
                Path(temporary_directory),
                progress_callback=lambda progress: update_job(
                    job_id,
                    status="running",
                    progress=0.03 + 0.37 * progress,
                    message="Separating vocals with OpenVINO Demucs.",
                ),
            )
            update_job(
                job_id,
                status="running",
                progress=0.42,
                message=(
                    "Aligning lyrics with Uta-Align."
                    if request.algorithm == "uta-align"
                    else "Transcribing isolated vocals."
                ),
            )
            uta_diagnostics: dict[str, Any] | None = None
            mms_diagnostics: dict[str, Any] | None = None
            if request.algorithm == "uta-align":
                uta_output = align_lyrics_with_uta(
                    source,
                    separated.vocals,
                    document,
                    model_key=request.model,
                    device=request.device,
                    language=request.language or "auto",
                    progress_callback=lambda request_count: update_job(
                        job_id,
                        status="running",
                        progress=min(0.69, 0.42 + 0.02 * request_count),
                        message="Aligning lyrics with Uta-Align.",
                    ),
                )
                whisper_text = uta_output.whisper_text
                duration = uta_output.duration
                device_used = uta_output.device_used
                alignment = uta_output
                uta_diagnostics = uta_output.diagnostics
            else:
                chunks, whisper_text, duration, device_used = transcribe_whisper_chunks(
                    separated.vocals,
                    model_key=request.model,
                    device=request.device,
                    language=request.language or "auto",
                )
                update_job(job_id, status="running", progress=0.70, message="Aligning lyrics.")
                alignment = align_lyrics_to_chunks(document, chunks, media_duration=duration)
                update_job(
                    job_id,
                    status="running",
                    progress=0.72,
                    message="Refining lyric onset with MMS.",
                )
                alignment, mms_output = refine_standard_alignment_with_mms(
                    separated.vocals,
                    document,
                    alignment,
                    language=request.language or "auto",
                    progress_callback=lambda progress: update_job(
                        job_id,
                        status="running",
                        progress=0.72 + 0.06 * progress,
                        message="Refining lyric onset with MMS.",
                    ),
                )
                mms_diagnostics = asdict(mms_output)
        beat_warning: str | None = None
        tempo_bpm = 0.0
        beat_times: list[float] = []
        rhythm_grid = []
        adjusted_lines = alignment.lines
        try:
            update_job(job_id, status="running", progress=0.80, message="Detecting rhythm grid.")
            tempo_bpm, beat_times, _ = detect_beat_times(source)
            if len(beat_times) < 2:
                raise RuntimeError("No stable beat sequence was detected.")
            adjusted_lines = adjust_lines_to_rhythm(
                alignment.lines,
                beat_times,
                tempo_bpm=tempo_bpm,
            ).lines
            rhythm_grid = build_extended_rhythm_grid(beat_times, media_duration=duration)
        except Exception as exc:
            beat_warning = str(exc)
        stats = confidence_statistics(adjusted_lines)
        low_indexes = set(stats.low_outlier_indexes)
        result = {
            "title": alignment.title,
            "duration": duration,
            "device_used": device_used,
            "algorithm": request.algorithm,
            "lyrics_audio_source": "demucs-vocals",
            "demucs_model": separated.model,
            "whisper_text": whisper_text,
            "tempo_bpm": round(float(tempo_bpm), 3),
            "beat_times": beat_times,
            "rhythm_grid": [asdict(point) for point in rhythm_grid],
            "beat_warning": beat_warning,
            "confidence_statistics": asdict(stats),
            "lines": [
                {**asdict(line), "low_confidence_outlier": line.index in low_indexes}
                for line in adjusted_lines
            ],
            "elapsed_seconds": round(time.perf_counter() - started, 3),
        }
        if uta_diagnostics is not None:
            result["uta_align_diagnostics"] = uta_diagnostics
        if mms_diagnostics is not None:
            result["mms_diagnostics"] = mms_diagnostics
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="Lyrics analysis complete.",
            result=result,
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _subtitle_export_job(job_id: str, request: SubtitleExportRequest) -> None:
    try:
        source = require_file(request.source_path)
        lanes = [
            SubtitleLane(
                id=lane.id,
                name=lane.name,
                style=subtitle_style_from_mapping(lane.style.model_dump()),
                effect=SubtitleEffect(
                    name=lane.effect.name,
                    start_duration_ms=lane.effect.start_duration_ms,
                    end_duration_ms=lane.effect.end_duration_ms,
                    params=lane.effect.params,
                ),
                segments=[
                    SubtitleSegment(
                        id=segment.id,
                        text=segment.text,
                        start=segment.start,
                        end=segment.end,
                    )
                    for segment in lane.segments
                ],
            )
            for lane in request.lanes
        ]

        def on_progress(progress: float, message: str) -> None:
            update_job(
                job_id,
                status="running",
                progress=max(0.01, min(0.99, progress)),
                message=message,
            )

        result = export_subtitle_bundle(
            source,
            Path(request.output_dir),
            lanes,
            play_res_x=request.play_res_x,
            play_res_y=request.play_res_y,
            on_progress=on_progress,
        )
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="Subtitle export complete.",
            result=result,
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _subtitle_render_job(job_id: str, request: SubtitleRenderRequest) -> None:
    try:
        rendered: list[dict[str, object]] = []
        total = len(request.items)
        ffmpeg_paths = find_ffmpeg()
        for index, item in enumerate(request.items):
            update_job(
                job_id,
                status="running",
                progress=max(0.01, index / total),
                message=f"Rendering subtitle image {index + 1}/{total}.",
            )
            png_base64 = render_subtitle_png_base64(
                item.text,
                subtitle_style_from_mapping(item.style.model_dump()),
                play_res_x=request.play_res_x,
                play_res_y=request.play_res_y,
                ffmpeg_paths=ffmpeg_paths,
                verify_ass_filter=index == 0,
            )
            rendered.append(
                {
                    "segment_id": item.segment_id,
                    "signature": item.signature,
                    "png_base64": png_base64,
                    "width": request.play_res_x,
                    "height": request.play_res_y,
                }
            )
        update_job(
            job_id,
            status="completed",
            progress=1.0,
            message="Subtitle images rendered.",
            result={"items": rendered},
        )
    except Exception as exc:
        fail_job(job_id, exc)


def _scratch_proxy_job(job_id: str, request: ScratchProxyRequest, cancel_event: threading.Event) -> None:
    try:
        if not update_job_unless_cancelled(
            job_id,
            cancel_event,
            status="running",
            progress=0.01,
            message="Preparing AAC scratch proxy.",
        ):
            raise ScratchProxyCancelled("scratch proxy generation cancelled")
        source = require_file(request.path)
        ffmpeg = find_ffmpeg()
        duration = probe_video(ffmpeg.ffprobe, source)["duration"]

        def on_progress(progress: float, message: str) -> None:
            update_job_unless_cancelled(
                job_id,
                cancel_event,
                status="running",
                progress=max(0.01, progress),
                message=message,
            )

        result = _scratch_proxy_manager.create(
            job_id,
            ffmpeg,
            source,
            source_duration=float(duration),
            cancel_event=cancel_event,
            on_progress=on_progress,
        )
        if not update_job_unless_cancelled(
            job_id,
            cancel_event,
            status="completed",
            progress=1.0,
            message="AAC scratch proxy ready.",
            result=result,
        ):
            _scratch_proxy_manager.release(str(result["proxy_id"]))
            raise ScratchProxyCancelled("scratch proxy generation cancelled")
    except ScratchProxyCancelled:
        update_job(job_id, status="cancelled", progress=1.0, message="Scratch proxy generation cancelled.")
    except Exception as exc:
        if cancel_event.is_set():
            update_job(job_id, status="cancelled", progress=1.0, message="Scratch proxy generation cancelled.")
        else:
            fail_job(job_id, exc)
    finally:
        with _jobs_lock:
            _job_cancel_events.pop(job_id, None)


def require_file(path: str) -> Path:
    source = Path(path)
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=400, detail=f"file not found: {path}")
    return source


def _release_waveform_job(job_id: str) -> None:
    with _jobs_lock:
        _jobs.pop(job_id, None)
        _job_cancel_events.pop(job_id, None)
        _waveform_points.pop(job_id, None)
        _waveform_finished_at.pop(job_id, None)


def _prune_waveform_jobs() -> None:
    cutoff = time.time() - WAVEFORM_JOB_TTL_SECONDS
    with _jobs_lock:
        expired = [job_id for job_id, finished_at in _waveform_finished_at.items() if finished_at < cutoff]
    for job_id in expired:
        _release_waveform_job(job_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="songcut-api")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


if __name__ == "__main__":
    raise SystemExit(main())
