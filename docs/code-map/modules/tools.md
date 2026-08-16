# コード解析地図：tools

<!-- code-map:generated:start -->
## 概要

`tools`を中心とする依存クラスタ。代表シンボル: BenchmarkDatasetProfile, BenchmarkDataError, MonoLabel, duration

## 指標

- Files: 2
- Symbols: 102
- Incoming／Outgoing: 2／12
- Cohesion: 0.09
- Node kinds: Class 9、File 2、Function 86、Method 5

## 代表パス

- `tools/benchmark_kiritan_display_elements.py`
- `tools/probe_omniasr_ctc_targets.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `BenchmarkDatasetProfile` | Class | `tools/benchmark_kiritan_display_elements.py:38` |
| `BenchmarkDataError` | Class | `tools/benchmark_kiritan_display_elements.py:95` |
| `MonoLabel` | Class | `tools/benchmark_kiritan_display_elements.py:100` |
| `MonoLabel.duration` | Method | `tools/benchmark_kiritan_display_elements.py:108` |
| `LyricMora` | Class | `tools/benchmark_kiritan_display_elements.py:115` |
| `GroundTruthDisplayElement` | Class | `tools/benchmark_kiritan_display_elements.py:126` |
| `GroundTruthDisplayElement.duration` | Method | `tools/benchmark_kiritan_display_elements.py:137` |
| `GroundTruthDisplayElement.is_blank` | Method | `tools/benchmark_kiritan_display_elements.py:143` |
| `GroundTruthLine` | Class | `tools/benchmark_kiritan_display_elements.py:150` |
| `GroundTruthLine.internal_boundaries` | Method | `tools/benchmark_kiritan_display_elements.py:160` |
| `KiritanSongGroundTruth` | Class | `tools/benchmark_kiritan_display_elements.py:167` |
| `KiritanSongGroundTruth.lyrics_text` | Method | `tools/benchmark_kiritan_display_elements.py:178` |
| `BenchmarkDataset` | Class | `tools/benchmark_kiritan_display_elements.py:185` |
| `_local_name` | Function | `tools/benchmark_kiritan_display_elements.py:197` |
| `_katakana_to_hiragana` | Function | `tools/benchmark_kiritan_display_elements.py:201` |
| `_is_lyric_token` | Function | `tools/benchmark_kiritan_display_elements.py:210` |
| `_normalized_lyric_text` | Function | `tools/benchmark_kiritan_display_elements.py:227` |
| `read_musicxml_lyrics` | Function | `tools/benchmark_kiritan_display_elements.py:234` |
| `read_japanese_table` | Function | `tools/benchmark_kiritan_display_elements.py:270` |
| `read_mono_label` | Function | `tools/benchmark_kiritan_display_elements.py:311` |
| `_is_combining` | Function | `tools/benchmark_kiritan_display_elements.py:356` |
| `_is_non_pronouncing` | Function | `tools/benchmark_kiritan_display_elements.py:366` |
| `_group_lyric_graphemes` | Function | `tools/benchmark_kiritan_display_elements.py:375` |
| `expand_japanese_lyrics` | Function | `tools/benchmark_kiritan_display_elements.py:420` |
| `_spoken_labels` | Function | `tools/benchmark_kiritan_display_elements.py:451` |
| `_pause_by_spoken_cursor` | Function | `tools/benchmark_kiritan_display_elements.py:455` |
| `_line_elements` | Function | `tools/benchmark_kiritan_display_elements.py:466` |
| `split_ground_truth_lines` | Function | `tools/benchmark_kiritan_display_elements.py:506` |
| `_dataset_name` | Function | `tools/benchmark_kiritan_display_elements.py:600` |
| `_profile` | Function | `tools/benchmark_kiritan_display_elements.py:623` |
| `_normalize_song_id` | Function | `tools/benchmark_kiritan_display_elements.py:627` |
| `_song_sort_key` | Function | `tools/benchmark_kiritan_display_elements.py:636` |
| `_dataset_inputs` | Function | `tools/benchmark_kiritan_display_elements.py:640` |
| `_audio_path` | Function | `tools/benchmark_kiritan_display_elements.py:671` |
| `_pronunciation_table_path` | Function | `tools/benchmark_kiritan_display_elements.py:680` |
| `discover_dataset_song_ids` | Function | `tools/benchmark_kiritan_display_elements.py:692` |
| `load_dataset_song` | Function | `tools/benchmark_kiritan_display_elements.py:711` |
| `build_dataset` | Function | `tools/benchmark_kiritan_display_elements.py:745` |
| `discover_kiritan_song_ids` | Function | `tools/benchmark_kiritan_display_elements.py:809` |
| `load_kiritan_song` | Function | `tools/benchmark_kiritan_display_elements.py:819` |
| `build_kiritan_dataset` | Function | `tools/benchmark_kiritan_display_elements.py:830` |
| `_percentile` | Function | `tools/benchmark_kiritan_display_elements.py:848` |
| `_prediction_songs` | Function | `tools/benchmark_kiritan_display_elements.py:863` |
| `read_prediction_report` | Function | `tools/benchmark_kiritan_display_elements.py:888` |
| `_line_prediction_elements` | Function | `tools/benchmark_kiritan_display_elements.py:904` |
| `_prediction_lines` | Function | `tools/benchmark_kiritan_display_elements.py:911` |
| `_numeric` | Function | `tools/benchmark_kiritan_display_elements.py:926` |
| `_line_violations` | Function | `tools/benchmark_kiritan_display_elements.py:934` |
| `evaluate_prediction_report` | Function | `tools/benchmark_kiritan_display_elements.py:965` |
| `ground_truth_payload` | Function | `tools/benchmark_kiritan_display_elements.py:1072` |
| `make_benchmark_summary` | Function | `tools/benchmark_kiritan_display_elements.py:1102` |
| `_load_mms_runtime` | Function | `tools/benchmark_kiritan_display_elements.py:1137` |
| `_decode_mms_window` | Function | `tools/benchmark_kiritan_display_elements.py:1160` |
| `generate_mms_prediction_report` | Function | `tools/benchmark_kiritan_display_elements.py:1170` |
| `_build_parser` | Function | `tools/benchmark_kiritan_display_elements.py:1318` |
| `main` | Function | `tools/benchmark_kiritan_display_elements.py:1340` |
| `OmniAsrProbeError` | Class | `tools/probe_omniasr_ctc_targets.py:45` |
| `frame_seconds_for_window` | Function | `tools/probe_omniasr_ctc_targets.py:49` |
| `frame_timing_for_window` | Function | `tools/probe_omniasr_ctc_targets.py:68` |
| `_item_value` | Function | `tools/probe_omniasr_ctc_targets.py:87` |
| `_element_text` | Function | `tools/probe_omniasr_ctc_targets.py:95` |
| `_explicit_target_text` | Function | `tools/probe_omniasr_ctc_targets.py:100` |
| `_unsupported_target_characters` | Function | `tools/probe_omniasr_ctc_targets.py:108` |
| `_tokenize` | Function | `tools/probe_omniasr_ctc_targets.py:137` |
| `_decode_token_ids` | Function | `tools/probe_omniasr_ctc_targets.py:141` |
| `build_target_diagnostics` | Function | `tools/probe_omniasr_ctc_targets.py:148` |
| `build_target_with_anchor` | Function | `tools/probe_omniasr_ctc_targets.py:269` |
| `_collapse_ctc_ids` | Function | `tools/probe_omniasr_ctc_targets.py:335` |
| `_edit_distance` | Function | `tools/probe_omniasr_ctc_targets.py:348` |
| `load_token_vocabulary` | Function | `tools/probe_omniasr_ctc_targets.py:364` |
| `load_sentencepiece_tokenizer` | Function | `tools/probe_omniasr_ctc_targets.py:387` |
| `ctc_greedy_decode` | Function | `tools/probe_omniasr_ctc_targets.py:417` |
| `_log_softmax` | Function | `tools/probe_omniasr_ctc_targets.py:447` |
| `_metric_summary` | Function | `tools/probe_omniasr_ctc_targets.py:452` |
| `evaluate_onset_first_boundaries` | Function | `tools/probe_omniasr_ctc_targets.py:472` |
| `_evaluate_onsets` | Function | `tools/probe_omniasr_ctc_targets.py:514` |
| `ctc_forced_alignment` | Function | `tools/probe_omniasr_ctc_targets.py:543` |
| `ctc_forced_alignment.frame_time` | Function | `tools/probe_omniasr_ctc_targets.py:603` |
| `ctc_forced_alignment.frame_end_time` | Function | `tools/probe_omniasr_ctc_targets.py:608` |
| `_read_audio_16khz` | Function | `tools/probe_omniasr_ctc_targets.py:789` |

## ファイル一覧

- `tools/benchmark_kiritan_display_elements.py`
- `tools/probe_omniasr_ctc_targets.py`
<!-- code-map:generated:end -->
