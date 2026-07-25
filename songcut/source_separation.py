from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


DEMUCS_MODEL = "htdemucs"


@dataclass(frozen=True)
class SeparatedAudio:
    vocals: Path
    no_vocals: Path
    model: str


def separate_vocals(
    source: Path,
    output_dir: Path,
    *,
    model: str = DEMUCS_MODEL,
    device: str = "cpu",
    progress_callback: Callable[[float], None] | None = None,
) -> SeparatedAudio:
    """Separate an audio/video source into vocals and the sum of all other stems."""
    try:
        from demucs import api as demucs_api
    except ImportError as exc:
        raise RuntimeError(
            "Demucs is required to isolate vocals before lyrics analysis. "
            "Install the songcut GUI dependencies."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    vocals_path = output_dir / "vocals.wav"
    no_vocals_path = output_dir / "no_vocals.wav"

    callback_state = {"completed": 0, "estimated": 1}
    separator_holder: dict[str, object] = {}

    def on_progress(event: dict) -> None:
        if progress_callback is None:
            return
        audio_length = float(event.get("audio_length") or 0.0)
        models = max(1, int(event.get("models") or 1))
        separator_instance = separator_holder.get("separator")
        segment_seconds = getattr(separator_instance, "_segment", None)
        if segment_seconds is None:
            separator_model = getattr(separator_instance, "_model", None)
            segment_seconds = getattr(separator_model, "segment", None)
        samplerate = float(getattr(separator_instance, "samplerate", 0.0) or 0.0)
        overlap = float(getattr(separator_instance, "_overlap", 0.25))
        if audio_length > 0.0 and segment_seconds and samplerate > 0.0:
            stride = max(1.0, (1.0 - overlap) * float(segment_seconds) * samplerate)
            callback_state["estimated"] = max(
                1,
                math.ceil(audio_length / stride) * models,
            )
        if event.get("state") == "end":
            callback_state["completed"] += 1
            progress_callback(
                min(0.99, callback_state["completed"] / callback_state["estimated"])
            )

    separator = demucs_api.Separator(
        model=model,
        device=device,
        shifts=1,
        jobs=0,
        progress=False,
        callback=on_progress if progress_callback is not None else None,
    )
    separator_holder["separator"] = separator
    _origin, stems = separator.separate_audio_file(source)
    vocals = stems.get("vocals")
    if vocals is None:
        raise RuntimeError(f"Demucs model '{model}' did not produce a vocals stem.")

    other_stems = [stem for name, stem in stems.items() if name != "vocals"]
    if not other_stems:
        raise RuntimeError(f"Demucs model '{model}' did not produce non-vocal stems.")
    no_vocals = other_stems[0].clone()
    for stem in other_stems[1:]:
        no_vocals.add_(stem)

    demucs_api.save_audio(vocals, vocals_path, separator.samplerate, bits_per_sample=16)
    demucs_api.save_audio(no_vocals, no_vocals_path, separator.samplerate, bits_per_sample=16)
    for output in (vocals_path, no_vocals_path):
        if not output.is_file() or output.stat().st_size <= 0:
            raise RuntimeError(f"Demucs did not create the expected separated audio: {output}")
    if progress_callback is not None:
        progress_callback(1.0)
    return SeparatedAudio(vocals=vocals_path, no_vocals=no_vocals_path, model=model)
