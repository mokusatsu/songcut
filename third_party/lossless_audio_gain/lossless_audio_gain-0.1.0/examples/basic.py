from lossless_audio_gain import adjust_gain, normalize_true_peak

# Automatic mode: measure decoded True Peak, edit the header/bitstream without
# re-encoding, verify uniform decoded gain, then re-measure the output peak.
auto_result = normalize_true_peak(
    "input.opus",
    "output.opus",
    target_true_peak_dbtp=-1.0,
)
print(auto_result.to_dict())

# Specified mode: no input loudness/peak measurement. The default verify=True
# checks only uniform decoded gain and reports the output True Peak.
manual_result = adjust_gain(
    "input.m4a",
    "output.m4a",
    gain_db=-3.0,
    aac_rounding="nearest",
    verify=True,
)
print(manual_result.to_dict())
