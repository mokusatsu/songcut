"""High-level public API."""

from __future__ import annotations

import math
import os
import shutil
import tempfile
from pathlib import Path

from .aac import AacRounding, apply_aac_global_gain, quantize_aac_gain
from .exceptions import MeasurementError, VerificationError
from .measure import measure_true_peak, verify_decoded_gain
from .models import GainResult, MediaInfo
from .opus import R128Policy, patch_ogg_opus_gain, quantize_q78_db
from .probe import detect_media


def _validate_db(value: float, name: str) -> float:
    converted = float(value)
    if not math.isfinite(converted):
        raise ValueError(f"{name} must be finite")
    return converted


def _prepare_temp_output(input_path: Path, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(
        prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent
    )
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        shutil.copy2(input_path, temp_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return temp_path


def _commit_temp(temp_path: Path, output_path: Path) -> None:
    # Flush the completed file before the atomic replace. The input may equal
    # the output; os.replace still makes that case safe because work happened
    # on a sibling temporary copy.
    with temp_path.open("rb+") as stream:
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp_path, output_path)


def _apply_gain_to_temp(
    temp_path: Path,
    media: MediaInfo,
    requested_gain_db: float,
    *,
    opus_safe_not_above: bool,
    r128_policy: R128Policy,
    aac_rounding: AacRounding,
    mp3rgain_bin: str | None,
    aac_write_undo: bool,
    aac_check_reversible: bool,
) -> tuple[float, str, dict[str, object], list[str]]:
    warnings: list[str] = []
    if media.codec == "opus":
        raw_delta, applied = quantize_q78_db(
            requested_gain_db, safe_not_above=opus_safe_not_above
        )
        source_copy = temp_path.with_name(temp_path.name + ".source")
        os.replace(temp_path, source_copy)
        try:
            report = patch_ogg_opus_gain(
                source_copy,
                temp_path,
                gain_q78_delta=raw_delta,
                r128_policy=r128_policy,
            )
        finally:
            source_copy.unlink(missing_ok=True)
        details = {
            "q78_delta": raw_delta,
            "streams_patched": report.streams_patched,
            "old_output_gains_db": list(report.old_output_gains_db),
            "new_output_gains_db": list(report.new_output_gains_db),
            "r128_tags_found": report.r128_tags_found,
            "r128_tags_neutralized": report.r128_tags_neutralized,
            "pages_rechecksummed": report.pages_rechecksummed,
        }
        if r128_policy == "keep" and report.r128_tags_found:
            warnings.append(
                "R128 gain tags were retained; R128-aware players may add them "
                "to the OpusHead Output Gain."
            )
        return applied, "python-opushead", details, warnings

    steps, applied = quantize_aac_gain(requested_gain_db, rounding=aac_rounding)
    backend_details = apply_aac_global_gain(
        temp_path,
        steps=steps,
        mp3rgain_bin=mp3rgain_bin,
        write_undo=aac_write_undo,
        check_reversible=aac_check_reversible,
    )
    quantization_error = applied - requested_gain_db
    if abs(quantization_error) > 1e-9:
        warnings.append(
            "AAC global_gain is quantized in approximately 1.50515 dB steps; "
            f"requested {requested_gain_db:+.6f} dB, applied {applied:+.6f} dB."
        )
    return applied, "mp3rgain-global_gain", backend_details, warnings


def adjust_gain(
    input_path: str | Path,
    output_path: str | Path,
    *,
    gain_db: float,
    verify: bool = True,
    gain_verification_min_psnr_db: float = 90.0,
    ffmpeg_bin: str = "ffmpeg",
    ffprobe_bin: str = "ffprobe",
    mp3rgain_bin: str | None = None,
    aac_rounding: AacRounding = "nearest",
    aac_write_undo: bool = True,
    aac_check_reversible: bool = True,
    r128_policy: R128Policy = "neutralize",
) -> GainResult:
    """Apply a specified gain without measuring the input first.

    The input True Peak is not measured. With the default ``verify=True``, both
    files are decoded only to prove that the output is a uniform application of
    the quantized gain; the output True Peak is also reported. The compressed
    audio is never re-encoded. For AAC, an independent forward/inverse ``mdat``
    check is enabled by default as well.
    """

    source = Path(input_path).resolve()
    destination = Path(output_path).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    requested = _validate_db(gain_db, "gain_db")
    psnr_threshold = _validate_db(
        gain_verification_min_psnr_db, "gain_verification_min_psnr_db"
    )
    if psnr_threshold <= 0:
        raise ValueError("gain_verification_min_psnr_db must be positive")
    media = detect_media(source, ffprobe_bin=ffprobe_bin)
    temp = _prepare_temp_output(source, destination)
    try:
        applied, backend, details, warnings = _apply_gain_to_temp(
            temp,
            media,
            requested,
            opus_safe_not_above=False,
            r128_policy=r128_policy,
            aac_rounding=aac_rounding,
            mp3rgain_bin=mp3rgain_bin,
            aac_write_undo=aac_write_undo,
            aac_check_reversible=aac_check_reversible,
        )
        if verify:
            psnr_values = verify_decoded_gain(
                source,
                temp,
                expected_gain_db=applied,
                ffmpeg_bin=ffmpeg_bin,
                minimum_psnr_db=psnr_threshold,
            )
            details["decoded_gain_psnr_db"] = list(psnr_values)
            details["decoded_gain_minimum_psnr_db"] = psnr_threshold
            verified = measure_true_peak(temp, ffmpeg_bin=ffmpeg_bin)
        else:
            verified = None
            warnings.append(
                "Decoded uniform-gain verification was disabled; an AAC backend "
                "that skipped an unsupported frame might not be detected."
                if media.codec == "aac"
                else "Decoded uniform-gain verification was disabled."
            )
        _commit_temp(temp, destination)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return GainResult(
        input_path=source,
        output_path=destination,
        codec=media.codec,
        container=media.container,
        mode="specified",
        requested_gain_db=requested,
        applied_gain_db=applied,
        measured_true_peak_dbtp=None,
        predicted_true_peak_dbtp=None,
        verified_true_peak_dbtp=verified,
        target_true_peak_dbtp=None,
        backend=backend,
        reencoded=False,
        quantization_error_db=applied - requested,
        details=details,
        warnings=tuple(warnings),
    )


def normalize_true_peak(
    input_path: str | Path,
    output_path: str | Path,
    *,
    target_true_peak_dbtp: float = -1.0,
    verify: bool = True,
    verification_tolerance_db: float = 0.08,
    gain_verification_min_psnr_db: float = 90.0,
    ffmpeg_bin: str = "ffmpeg",
    ffprobe_bin: str = "ffprobe",
    mp3rgain_bin: str | None = None,
    aac_write_undo: bool = True,
    aac_check_reversible: bool = True,
    r128_policy: R128Policy = "neutralize",
) -> GainResult:
    """Normalize decoded true peak to a target without re-encoding.

    Opus is quantized downward to 1/256 dB. AAC is quantized downward to an
    integer ``global_gain`` step, ensuring the predicted peak does not exceed
    the requested ceiling.
    """

    source = Path(input_path).resolve()
    destination = Path(output_path).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    target = _validate_db(target_true_peak_dbtp, "target_true_peak_dbtp")
    if target > 0.0:
        raise ValueError("target_true_peak_dbtp must be <= 0 dBTP")
    tolerance = _validate_db(verification_tolerance_db, "verification_tolerance_db")
    if tolerance < 0:
        raise ValueError("verification_tolerance_db must be non-negative")
    psnr_threshold = _validate_db(
        gain_verification_min_psnr_db, "gain_verification_min_psnr_db"
    )
    if psnr_threshold <= 0:
        raise ValueError("gain_verification_min_psnr_db must be positive")

    media = detect_media(source, ffprobe_bin=ffprobe_bin)
    measured = measure_true_peak(source, ffmpeg_bin=ffmpeg_bin)
    if measured == -math.inf:
        raise MeasurementError("Cannot peak-normalize a silent input")
    requested = target - measured

    temp = _prepare_temp_output(source, destination)
    try:
        applied, backend, details, warnings = _apply_gain_to_temp(
            temp,
            media,
            requested,
            opus_safe_not_above=True,
            r128_policy=r128_policy,
            aac_rounding="not_above",
            mp3rgain_bin=mp3rgain_bin,
            aac_write_undo=aac_write_undo,
            aac_check_reversible=aac_check_reversible,
        )
        predicted = measured + applied
        if verify:
            psnr_values = verify_decoded_gain(
                source,
                temp,
                expected_gain_db=applied,
                ffmpeg_bin=ffmpeg_bin,
                minimum_psnr_db=psnr_threshold,
            )
            details["decoded_gain_psnr_db"] = list(psnr_values)
            details["decoded_gain_minimum_psnr_db"] = psnr_threshold
            verified = measure_true_peak(temp, ffmpeg_bin=ffmpeg_bin)
        else:
            verified = None
        if verified is not None and verified > target + tolerance:
            raise VerificationError(
                f"Verified true peak {verified:.3f} dBTP exceeds target "
                f"{target:.3f} dBTP by more than {tolerance:.3f} dB"
            )
        if not verify:
            warnings.append(
                (
                    "Decoded uniform-gain and post-write True Peak verification "
                    "were disabled; an AAC backend that skipped an unsupported "
                    "frame might not be detected, and only the "
                    "measured-plus-quantized prediction is available."
                )
                if media.codec == "aac"
                else (
                    "Decoded uniform-gain and post-write True Peak verification "
                    "were disabled; only the measured-plus-quantized prediction "
                    "is available."
                )
            )
        _commit_temp(temp, destination)
    except Exception:
        temp.unlink(missing_ok=True)
        raise

    return GainResult(
        input_path=source,
        output_path=destination,
        codec=media.codec,
        container=media.container,
        mode="auto",
        requested_gain_db=requested,
        applied_gain_db=applied,
        measured_true_peak_dbtp=measured,
        predicted_true_peak_dbtp=predicted,
        verified_true_peak_dbtp=verified,
        target_true_peak_dbtp=target,
        backend=backend,
        reencoded=False,
        quantization_error_db=applied - requested,
        details=details,
        warnings=tuple(warnings),
    )
