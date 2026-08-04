from __future__ import annotations

import math
import os
import shutil
import threading
import win_safesubprocess as subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .ffmpeg_tools import CREATE_NO_WINDOW, find_ffmpeg


DEMUCS_MODEL = "htdemucs-v4-openvino"
DEMUCS_REPO_ID = "Intel/demucs-openvino"
DEMUCS_REPO_SUBDIR = "htdemucs_v4"
DEMUCS_DIRECTORY_NAME = "demucs-htdemucs-v4"
DEMUCS_REQUIRED_FILES = (
    f"{DEMUCS_REPO_SUBDIR}/htdemucs_fwd.xml",
    f"{DEMUCS_REPO_SUBDIR}/htdemucs_fwd.bin",
)
DEMUCS_SAMPLE_RATE = 44_100
DEMUCS_SEGMENT_SAMPLES = DEMUCS_SAMPLE_RATE * 39 // 5
DEMUCS_HOP_LENGTH = 1_024
DEMUCS_N_FFT = 4_096
DEMUCS_OVERLAP = 0.25


@dataclass(frozen=True)
class SeparatedAudio:
    vocals: Path
    no_vocals: Path
    model: str
    device_used: str = "CPU"


def _default_model_root() -> Path:
    configured = os.environ.get("SONGCUT_MODEL_DIR")
    if configured:
        return Path(configured)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "songcut" / "models"
    return Path.home() / ".songcut" / "models"


def _bundled_model_root() -> Path | None:
    configured = os.environ.get("SONGCUT_BUNDLED_MODEL_DIR")
    return Path(configured) if configured else None


def _huggingface_cache_dir() -> Path:
    configured = os.environ.get("HF_HOME")
    root = Path(configured) if configured else _default_model_root().parent / "hf-home"
    return root / "hub"


def writable_demucs_model_dir() -> Path:
    return _default_model_root() / "openvino" / DEMUCS_DIRECTORY_NAME


def bundled_demucs_model_dir() -> Path | None:
    root = _bundled_model_root()
    return root / "openvino" / DEMUCS_DIRECTORY_NAME if root is not None else None


def demucs_model_ready(model_dir: Path) -> bool:
    try:
        return all(
            (model_dir / relative_path).is_file()
            and (model_dir / relative_path).stat().st_size > 0
            for relative_path in DEMUCS_REQUIRED_FILES
        )
    except OSError:
        return False


def resolve_demucs_model_dir() -> tuple[Path, str] | None:
    writable = writable_demucs_model_dir()
    if demucs_model_ready(writable):
        return writable, "downloaded"
    bundled = bundled_demucs_model_dir()
    if bundled is not None and demucs_model_ready(bundled):
        return bundled, "bundled"
    return None


def demucs_model_status() -> dict[str, str | bool | int | None]:
    resolved = resolve_demucs_model_dir()
    model_dir, source = (
        resolved if resolved is not None else (writable_demucs_model_dir(), None)
    )
    installed_bytes: int | None = None
    if resolved is not None:
        try:
            installed_bytes = sum(
                item.stat().st_size for item in model_dir.rglob("*") if item.is_file()
            )
        except OSError:
            installed_bytes = None
    return {
        "model": DEMUCS_MODEL,
        "repo_id": DEMUCS_REPO_ID,
        "ready": resolved is not None,
        "source": source,
        "model_dir": str(model_dir),
        "installed_bytes": installed_bytes,
    }


def _download_progress_tqdm(progress_callback: Callable[[int, int], None] | None):
    from huggingface_hub.utils import tqdm as huggingface_tqdm

    callback_lock = threading.RLock()

    class SongcutDownloadTqdm(huggingface_tqdm):
        def __init__(self, *args, **kwargs) -> None:
            self._songcut_progress_name = kwargs.get("name")
            kwargs["disable"] = True
            super().__init__(*args, **kwargs)

        def _notify(self) -> None:
            if (
                progress_callback is not None
                and self._songcut_progress_name == "huggingface_hub.snapshot_download"
            ):
                with callback_lock:
                    progress_callback(int(self.n or 0), int(self.total or 0))

        def update(self, n: int | float | None = 1):
            with callback_lock:
                self.n = float(self.n or 0) + float(n or 0)
                self._notify()
            return True

        def refresh(self, *args, **kwargs):
            self._notify()
            return True

    return SongcutDownloadTqdm


def download_preconverted_demucs(
    target: Path,
    *,
    progress_callback: Callable[[int, int], None] | None = None,
) -> None:
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError(
            "huggingface-hub is required to download the OpenVINO Demucs model."
        ) from exc

    allow_patterns = [f"{DEMUCS_REPO_SUBDIR}/*.xml", f"{DEMUCS_REPO_SUBDIR}/*.bin"]
    dry_run_files = snapshot_download(
        repo_id=DEMUCS_REPO_ID,
        local_dir=target,
        cache_dir=_huggingface_cache_dir(),
        allow_patterns=allow_patterns,
        tqdm_class=_download_progress_tqdm(None),
        dry_run=True,
    )
    total_bytes = sum(int(file.file_size) for file in dry_run_files)
    if progress_callback is not None:
        progress_callback(0, total_bytes)

    def report(downloaded_bytes: int, _dynamic_total: int) -> None:
        if progress_callback is not None:
            progress_callback(min(downloaded_bytes, total_bytes), total_bytes)

    snapshot_download(
        repo_id=DEMUCS_REPO_ID,
        local_dir=target,
        cache_dir=_huggingface_cache_dir(),
        allow_patterns=allow_patterns,
        tqdm_class=_download_progress_tqdm(report),
    )
    if progress_callback is not None:
        progress_callback(total_bytes, total_bytes)
    if not demucs_model_ready(target):
        raise RuntimeError(
            f"Downloaded {DEMUCS_REPO_ID}, but the OpenVINO HTDemucs IR is incomplete."
        )


def ensure_demucs_model(
    model_dir: Path | None = None,
    *,
    progress_callback: Callable[[int, int], None] | None = None,
) -> Path:
    if model_dir is None:
        resolved = resolve_demucs_model_dir()
        if resolved is not None:
            return resolved[0]
    target = model_dir or writable_demucs_model_dir()
    if demucs_model_ready(target):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_target = target.with_name(f"{target.name}.downloading")
    if temporary_target.exists():
        shutil.rmtree(temporary_target)
    download_preconverted_demucs(temporary_target, progress_callback=progress_callback)
    if target.exists():
        shutil.rmtree(target)
    temporary_target.rename(target)
    return target


def _decode_source(source: Path) -> np.ndarray:
    ffmpeg = find_ffmpeg().ffmpeg
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "2",
        "-ar",
        str(DEMUCS_SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
    ]
    result = subprocess.run(
        command,
        check=True,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW,
    )
    interleaved = np.frombuffer(result.stdout, dtype="<f4")
    if interleaved.size < 2:
        raise RuntimeError("The source did not contain decodable audio.")
    return np.ascontiguousarray(interleaved[: interleaved.size // 2 * 2].reshape(-1, 2).T)


def _torch_compatible_stft(mix: np.ndarray) -> np.ndarray:
    """Reproduce HTDemucs' normalized torch.stft input without importing Torch."""
    import librosa

    length = mix.shape[-1]
    frames = math.ceil(length / DEMUCS_HOP_LENGTH)
    extra = frames * DEMUCS_HOP_LENGTH - length
    pad = DEMUCS_HOP_LENGTH * 3 // 2
    padded = np.pad(mix, ((0, 0), (pad, pad + extra)), mode="reflect")
    spectra = [
        librosa.stft(
            channel,
            n_fft=DEMUCS_N_FFT,
            hop_length=DEMUCS_HOP_LENGTH,
            win_length=DEMUCS_N_FFT,
            window="hann",
            center=True,
            pad_mode="reflect",
        )
        / math.sqrt(DEMUCS_N_FFT)
        for channel in padded
    ]
    spectrum = np.stack(spectra, axis=0)[:, :-1, 2 : 2 + frames]
    real_imag = np.stack((spectrum.real, spectrum.imag), axis=1)
    return np.ascontiguousarray(real_imag.reshape(1, 4, 2_048, frames), dtype=np.float32)


def _torch_compatible_istft(spectrum: np.ndarray, length: int) -> np.ndarray:
    """Invert `_torch_compatible_stft` for [stem, channel, frequency, frame]."""
    import librosa

    pad = DEMUCS_HOP_LENGTH * 3 // 2
    padded_length = DEMUCS_HOP_LENGTH * math.ceil(length / DEMUCS_HOP_LENGTH) + 2 * pad
    spectrum = np.pad(spectrum, ((0, 0), (0, 0), (0, 1), (2, 2)))
    output = np.empty((spectrum.shape[0], spectrum.shape[1], length), dtype=np.float32)
    for stem_index in range(spectrum.shape[0]):
        for channel_index in range(spectrum.shape[1]):
            waveform = librosa.istft(
                spectrum[stem_index, channel_index] * math.sqrt(DEMUCS_N_FFT),
                hop_length=DEMUCS_HOP_LENGTH,
                win_length=DEMUCS_N_FFT,
                window="hann",
                center=True,
                length=padded_length,
            )
            output[stem_index, channel_index] = waveform[pad : pad + length]
    return output


def _run_model_chunk(compiled_model, mix: np.ndarray) -> np.ndarray:
    frequency_input = _torch_compatible_stft(mix)
    frequency_mean = frequency_input.mean(dtype=np.float32)
    frequency_std = frequency_input.std(ddof=1, dtype=np.float32)
    frequency_input = (frequency_input - frequency_mean) / (1e-5 + frequency_std)

    time_mean = mix.mean(dtype=np.float32)
    time_std = mix.std(ddof=1, dtype=np.float32)
    time_input = np.ascontiguousarray(
        ((mix - time_mean) / (1e-5 + time_std))[np.newaxis],
        dtype=np.float32,
    )
    outputs = compiled_model({"x": frequency_input, "xt": time_input})
    frequency_output = np.asarray(outputs[compiled_model.output("x_out")], dtype=np.float32)
    time_output = np.asarray(outputs[compiled_model.output("xt_out")], dtype=np.float32)

    frequency_output = frequency_output.reshape(1, 4, 4, 2_048, 336)
    frequency_output = frequency_output * frequency_std + frequency_mean
    pairs = frequency_output.reshape(1, 4, 2, 2, 2_048, 336)[0]
    complex_spectrum = pairs[:, :, 0] + 1j * pairs[:, :, 1]
    frequency_waveform = _torch_compatible_istft(complex_spectrum, DEMUCS_SEGMENT_SAMPLES)

    time_waveform = time_output.reshape(1, 4, 2, DEMUCS_SEGMENT_SAMPLES)[0]
    time_waveform = time_waveform * time_std + time_mean
    return np.ascontiguousarray(frequency_waveform + time_waveform, dtype=np.float32)


def _centered_chunk(mix: np.ndarray, offset: int, length: int) -> tuple[np.ndarray, int]:
    available = max(0, min(length, mix.shape[-1] - offset))
    delta = DEMUCS_SEGMENT_SAMPLES - available
    start = offset - delta // 2
    end = start + DEMUCS_SEGMENT_SAMPLES
    correct_start = max(0, start)
    correct_end = min(mix.shape[-1], end)
    padded = np.pad(
        mix[:, correct_start:correct_end],
        ((0, 0), (correct_start - start, end - correct_end)),
    )
    return np.ascontiguousarray(padded, dtype=np.float32), available


def _separate_normalized_mix(
    compiled_model,
    mix: np.ndarray,
    progress_callback: Callable[[float], None] | None,
) -> tuple[np.ndarray, np.ndarray]:
    length = mix.shape[-1]
    stride = int((1.0 - DEMUCS_OVERLAP) * DEMUCS_SEGMENT_SAMPLES)
    offsets = list(range(0, length, stride))
    ramp_up = np.arange(1, DEMUCS_SEGMENT_SAMPLES // 2 + 1, dtype=np.float32)
    ramp_down = np.arange(
        DEMUCS_SEGMENT_SAMPLES - DEMUCS_SEGMENT_SAMPLES // 2,
        0,
        -1,
        dtype=np.float32,
    )
    weight = np.concatenate((ramp_up, ramp_down))
    weight /= weight.max()

    vocals = np.zeros((2, length), dtype=np.float32)
    no_vocals = np.zeros((2, length), dtype=np.float32)
    sum_weight = np.zeros(length, dtype=np.float32)
    for index, offset in enumerate(offsets):
        chunk, chunk_length = _centered_chunk(mix, offset, DEMUCS_SEGMENT_SAMPLES)
        stems = _run_model_chunk(compiled_model, chunk)
        delta = DEMUCS_SEGMENT_SAMPLES - chunk_length
        trim_start = delta // 2
        trimmed = stems[:, :, trim_start : trim_start + chunk_length]
        weighted = weight[:chunk_length]
        target = slice(offset, offset + chunk_length)
        vocals[:, target] += trimmed[3] * weighted
        no_vocals[:, target] += trimmed[:3].sum(axis=0) * weighted
        sum_weight[target] += weighted
        if progress_callback is not None:
            progress_callback((index + 1) / len(offsets))
    denominator = np.maximum(sum_weight, np.finfo(np.float32).eps)
    return vocals / denominator, no_vocals / denominator


def separate_vocals(
    source: Path,
    output_dir: Path,
    *,
    model: str = DEMUCS_MODEL,
    device: str = "auto",
    model_dir: Path | None = None,
    progress_callback: Callable[[float], None] | None = None,
) -> SeparatedAudio:
    """Separate vocals with Intel's HTDemucs v4 OpenVINO IR, without PyTorch."""
    if model != DEMUCS_MODEL:
        raise ValueError(f"OpenVINO Demucs model must be '{DEMUCS_MODEL}'.")
    try:
        import openvino as ov
        import soundfile as sf
    except ImportError as exc:
        raise RuntimeError(
            "OpenVINO and soundfile are required to isolate vocals before lyrics analysis."
        ) from exc

    def download_progress(downloaded: int, total: int) -> None:
        if progress_callback is not None and total > 0:
            progress_callback(0.10 * min(1.0, downloaded / total))

    resolved_model_dir = ensure_demucs_model(
        model_dir,
        progress_callback=download_progress,
    )
    model_path = resolved_model_dir / DEMUCS_REPO_SUBDIR / "htdemucs_fwd.xml"
    core = ov.Core()
    normalized_device = device.strip().upper() or "AUTO"
    if normalized_device not in {"AUTO", "NPU", "GPU", "CPU"}:
        raise ValueError("Demucs device must be one of: auto, npu, gpu, cpu")
    reported_devices = getattr(core, "available_devices", ("CPU",))
    if not isinstance(reported_devices, (list, tuple, set, frozenset)):
        reported_devices = ("CPU",)
    available_devices = {str(item).upper() for item in reported_devices}
    candidates = ("GPU", "NPU", "CPU") if normalized_device == "AUTO" else (normalized_device,)
    compiled_model = None
    device_errors: list[str] = []
    device_used = "CPU"
    for candidate in candidates:
        if candidate != "CPU" and candidate not in available_devices:
            device_errors.append(f"{candidate} is not available")
            continue
        try:
            compiled_model = core.compile_model(model_path, candidate)
            device_used = candidate
            break
        except Exception as exc:
            device_errors.append(f"{candidate}: {exc}")
            if normalized_device != "AUTO":
                raise RuntimeError(f"Demucs could not be compiled for {candidate}: {exc}") from exc
    if compiled_model is None:
        raise RuntimeError(f"Demucs has no usable OpenVINO device ({'; '.join(device_errors)}).")

    mix = _decode_source(source)
    reference = mix.mean(axis=0, dtype=np.float32)
    reference_mean = reference.mean(dtype=np.float32)
    reference_std = reference.std(ddof=1, dtype=np.float32)
    if not np.isfinite(reference_std) or reference_std <= np.finfo(np.float32).eps:
        raise RuntimeError("The source audio is silent and cannot be separated.")
    normalized_mix = np.ascontiguousarray(
        (mix - reference_mean) / reference_std,
        dtype=np.float32,
    )

    def inference_progress(value: float) -> None:
        if progress_callback is not None:
            progress_callback(0.10 + 0.90 * value)

    max_shift = DEMUCS_SAMPLE_RATE // 2
    shift_offset = max_shift // 2
    padded_mix = np.pad(normalized_mix, ((0, 0), (max_shift, max_shift)))
    shifted_mix = np.ascontiguousarray(
        padded_mix[:, shift_offset : shift_offset + mix.shape[-1] + max_shift - shift_offset],
        dtype=np.float32,
    )
    shifted_vocals, shifted_no_vocals = _separate_normalized_mix(
        compiled_model,
        shifted_mix,
        inference_progress,
    )
    crop_start = max_shift - shift_offset
    vocals = shifted_vocals[:, crop_start : crop_start + mix.shape[-1]]
    no_vocals = shifted_no_vocals[:, crop_start : crop_start + mix.shape[-1]]
    vocals = vocals * reference_std + reference_mean
    no_vocals = no_vocals * reference_std + reference_mean * 3

    output_dir.mkdir(parents=True, exist_ok=True)
    vocals_path = output_dir / "vocals.wav"
    no_vocals_path = output_dir / "no_vocals.wav"
    sf.write(vocals_path, vocals.T, DEMUCS_SAMPLE_RATE, subtype="PCM_16")
    sf.write(no_vocals_path, no_vocals.T, DEMUCS_SAMPLE_RATE, subtype="PCM_16")
    for output in (vocals_path, no_vocals_path):
        if not output.is_file() or output.stat().st_size <= 0:
            raise RuntimeError(
                f"OpenVINO Demucs did not create the expected separated audio: {output}"
            )
    if progress_callback is not None:
        progress_callback(1.0)
    return SeparatedAudio(
        vocals=vocals_path,
        no_vocals=no_vocals_path,
        model=model,
        device_used=device_used,
    )
