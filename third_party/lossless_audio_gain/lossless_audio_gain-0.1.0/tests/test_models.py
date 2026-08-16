from pathlib import Path

from lossless_audio_gain.models import GainResult


def test_gain_result_to_dict_is_strict_json_safe():
    result = GainResult(
        input_path=Path("in.opus"),
        output_path=Path("out.opus"),
        codec="opus",
        container="ogg",
        mode="specified",
        requested_gain_db=0.0,
        applied_gain_db=0.0,
        measured_true_peak_dbtp=None,
        predicted_true_peak_dbtp=None,
        verified_true_peak_dbtp=float("-inf"),
        target_true_peak_dbtp=None,
        backend="test",
    )
    payload = result.to_dict()
    assert payload["input_path"] == "in.opus"
    assert payload["verified_true_peak_dbtp"] == "-inf"
