from lossless_audio_gain.measure import parse_loudnorm_json


def test_parse_loudnorm_json_uses_last_report():
    stderr = '''
noise
{
  "input_i" : "-20.0",
  "input_tp" : "-3.0"
}
more noise
{
  "input_i" : "-19.0",
  "input_tp" : "-1.25"
}
'''
    report = parse_loudnorm_json(stderr)
    assert report["input_tp"] == "-1.25"
