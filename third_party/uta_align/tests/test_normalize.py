from uta_align.lyrics import parse_lyrics_text
from uta_align.normalize import display_normalize, is_credit_hallucination, match_normalize


def test_japanese_normalization_preserves_long_mark_and_alphanumerics() -> None:
    assert display_normalize("  ＡＢＣ　スーパー！ ") == "ABC スーパー!"
    assert match_normalize("ＡＢＣ、スーパー！") == "abcスーパー"


def test_punctuation_and_blank_line_blocks() -> None:
    lines = parse_lyrics_text("ねえ、行こう。\n\n空へ！\n")
    assert [line.text for line in lines] == ["ねえ、行こう。", "空へ！"]
    assert [line.block for line in lines] == [0, 1]
    assert lines[0].normalized == "ねえ行こう"


def test_credit_hallucination_patterns() -> None:
    assert is_credit_hallucination("作詞: 誰か")
    assert is_credit_hallucination("ご視聴ありがとうございました")
    assert not is_credit_hallucination("あなたと歌う")



def test_lyric_display_text_preserves_trimmed_original_codepoints() -> None:
    lines = parse_lyrics_text(
        "\ufeff  ＡＢＣ　…  \n\n　㈱  内部\t 空白！　\n"
    )
    assert [line.text for line in lines] == [
        "ＡＢＣ　…",
        "㈱  内部\t 空白！",
    ]
    assert [line.block for line in lines] == [0, 1]
    assert lines[0].normalized == "abc"
    assert lines[1].normalized == "株内部空白"
