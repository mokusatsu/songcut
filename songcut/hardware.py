from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class BackendInfo:
    backend: str
    device_requested: str
    device_used: str
    available_devices: list[str] = field(default_factory=list)
    fallbacks: list[str] = field(default_factory=list)
    note: str = ""


def detect_openvino_devices() -> tuple[list[str], str | None]:
    try:
        from openvino import Core  # type: ignore
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return [], f"OpenVINO unavailable: {exc.__class__.__name__}"

    try:
        devices = list(Core().available_devices)
        return devices, None
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return [], f"OpenVINO device query failed: {exc.__class__.__name__}"


def select_backend(requested: str) -> BackendInfo:
    requested = requested.lower()
    if requested not in {"auto", "npu", "gpu", "cpu"}:
        raise ValueError("--device must be one of: auto, npu, gpu, cpu")

    devices, warning = detect_openvino_devices()
    upper_devices = {device.upper() for device in devices}
    fallbacks: list[str] = []

    if requested == "npu":
        if "NPU" not in upper_devices:
            detail = warning or f"available OpenVINO devices: {devices or 'none'}"
            raise RuntimeError(f"NPU was requested but is not available ({detail}).")
        return BackendInfo("openvino-ready", requested, "NPU", devices, note="NPU available for fixed-shape models.")

    if requested == "gpu":
        if "GPU" not in upper_devices:
            detail = warning or f"available OpenVINO devices: {devices or 'none'}"
            raise RuntimeError(f"GPU was requested but is not available ({detail}).")
        return BackendInfo("openvino-ready", requested, "GPU", devices, note="GPU available for compatible models.")

    if requested == "cpu":
        return BackendInfo("numpy-dsp", requested, "CPU", devices, note="CPU-only DSP baseline selected.")

    for candidate in ("NPU", "GPU"):
        if candidate in upper_devices:
            fallbacks.append(
                f"{candidate} detected, but no OpenVINO singing model is configured; using CPU DSP baseline."
            )
            break
    if warning:
        fallbacks.append(warning)
    return BackendInfo("numpy-dsp", requested, "CPU", devices, fallbacks, "Auto selected the dependency-light DSP baseline.")

