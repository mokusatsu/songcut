from __future__ import annotations

import json
from pathlib import Path

from uta_align.cli import main
from uta_align.models import AlignedLine, AlignmentResult
from uta_align.output import write_json, write_lrc, write_srt


def sample_result() -> AlignmentResult:
    return AlignmentResult(
        lines=[
            AlignedLine(0, 0, "歌う", 1.234, 2.345, 0.9, ["fake"], {"anchored": True})
        ],
        duration=3.0,
        diagnostics={"ok": True},
    )


def test_output_formats(tmp_path: Path) -> None:
    result = sample_result()
    json_path = tmp_path / "out.json"
    srt_path = tmp_path / "out.srt"
    lrc_path = tmp_path / "out.lrc"
    write_json(result, json_path)
    write_srt(result, srt_path)
    write_lrc(result, lrc_path)
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert payload["lines"][0]["confidence"] == 0.9
    assert "00:00:01,234 --> 00:00:02,345" in srt_path.read_text(encoding="utf-8")
    assert lrc_path.read_text(encoding="utf-8") == "[00:01.23]歌う\n"


def test_json_backend_cli_outputs_all_formats(tmp_path: Path, wav_factory) -> None:
    audio = wav_factory(duration=6)
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("朝の歌\n夜の歌\n", encoding="utf-8")
    transcript = tmp_path / "recognized.json"
    transcript.write_text(
        json.dumps(
            {
                "observations": [
                    {"start": 1, "end": 2, "text": "朝の歌"},
                    {"start": 3, "end": 4, "text": "夜の歌"},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    json_out = tmp_path / "aligned.json"
    srt_out = tmp_path / "aligned.srt"
    lrc_out = tmp_path / "aligned.lrc"
    status = main(
        [
            str(audio),
            str(lyrics),
            "--backend",
            "json",
            "--transcript-json",
            str(transcript),
            "--output",
            str(json_out),
            "--srt",
            str(srt_out),
            "--lrc",
            str(lrc_out),
            "--boundary-search-seconds",
            "0",
        ]
    )
    assert status == 0
    assert [line["text"] for line in json.loads(json_out.read_text(encoding="utf-8"))["lines"]] == [
        "朝の歌",
        "夜の歌",
    ]
    assert srt_out.exists() and lrc_out.exists()



def test_cli_writes_all_formats_for_no_anchor_fallback(
    tmp_path: Path,
    wav_factory,
) -> None:
    audio = wav_factory(duration=5, active=[])
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("未認識一\n未認識二\n", encoding="utf-8")
    transcript = tmp_path / "recognized.json"
    transcript.write_text('{"observations": []}\n', encoding="utf-8")
    json_out = tmp_path / "fallback.json"
    srt_out = tmp_path / "fallback.srt"
    lrc_out = tmp_path / "fallback.lrc"
    status = main([
        str(audio),
        str(lyrics),
        "--backend", "json",
        "--transcript-json", str(transcript),
        "--output", str(json_out),
        "--srt", str(srt_out),
        "--lrc", str(lrc_out),
    ])
    assert status == 0
    payload = json.loads(json_out.read_text(encoding="utf-8"))
    assert payload["diagnostics"]["fallback"]["stage"] == 4
    assert [line["text"] for line in payload["lines"]] == ["未認識一", "未認識二"]
    assert "-->" in srt_out.read_text(encoding="utf-8")
    assert "未認識二" in lrc_out.read_text(encoding="utf-8")


def test_cli_preserves_original_lyric_text_in_every_format(
    tmp_path: Path,
    wav_factory,
) -> None:
    audio = wav_factory(duration=4)
    lyrics = tmp_path / "lyrics.txt"
    expected = "ＡＢＣ　…  内部\t空白！"
    lyrics.write_text("\ufeff  " + expected + "  \n", encoding="utf-8")
    transcript = tmp_path / "recognized.json"
    transcript.write_text(
        json.dumps({"observations": [{"start": 1, "end": 2, "text": "ABC...内部 空白!"}]}),
        encoding="utf-8",
    )
    json_out = tmp_path / "preserved.json"
    srt_out = tmp_path / "preserved.srt"
    lrc_out = tmp_path / "preserved.lrc"
    status = main([
        str(audio), str(lyrics),
        "--backend", "json",
        "--transcript-json", str(transcript),
        "--output", str(json_out),
        "--srt", str(srt_out),
        "--lrc", str(lrc_out),
        "--boundary-search-seconds", "0",
    ])
    assert status == 0
    assert json.loads(json_out.read_text(encoding="utf-8"))["lines"][0]["text"] == expected
    assert expected in srt_out.read_text(encoding="utf-8")
    assert expected in lrc_out.read_text(encoding="utf-8")
