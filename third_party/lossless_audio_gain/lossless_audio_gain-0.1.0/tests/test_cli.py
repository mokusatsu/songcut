from lossless_audio_gain.cli import build_parser


def test_gain_verification_is_enabled_by_default():
    parser = build_parser()
    args = parser.parse_args(["gain", "in.opus", "out.opus", "--gain", "-3"])
    assert args.verify is True


def test_gain_verification_can_be_disabled():
    parser = build_parser()
    args = parser.parse_args(
        ["gain", "in.opus", "out.opus", "--gain", "-3", "--no-verify"]
    )
    assert args.verify is False
