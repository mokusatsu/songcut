import math

from lossless_audio_gain.aac import AAC_GAIN_STEP_DB, quantize_aac_gain
from lossless_audio_gain.opus import quantize_q78_db


def test_opus_q78_nearest():
    raw, represented = quantize_q78_db(1.0)
    assert raw == 256
    assert represented == 1.0


def test_opus_q78_safe_never_exceeds_request():
    raw, represented = quantize_q78_db(-0.1, safe_not_above=True)
    assert raw == -26
    assert represented <= -0.1


def test_aac_exact_step():
    assert math.isclose(AAC_GAIN_STEP_DB, 1.505149978319906, rel_tol=1e-12)


def test_aac_safe_rounding():
    steps, applied = quantize_aac_gain(1.0, rounding="not_above")
    assert steps == 0
    assert applied <= 1.0
    steps, applied = quantize_aac_gain(-0.1, rounding="not_above")
    assert steps == -1
    assert applied <= -0.1


def test_aac_nearest_rounding():
    steps, applied = quantize_aac_gain(1.0, rounding="nearest")
    assert steps == 1
    assert applied == AAC_GAIN_STEP_DB


def test_aac_rejects_gain_beyond_field_span():
    from lossless_audio_gain.exceptions import GainRangeError

    try:
        quantize_aac_gain(1000.0)
    except GainRangeError:
        pass
    else:
        raise AssertionError("unrepresentable AAC gain was accepted")
