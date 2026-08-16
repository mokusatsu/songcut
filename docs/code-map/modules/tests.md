# コード解析地図：tests

<!-- code-map:generated:start -->
## 概要

Python バックエンド、Electron/React の状態・操作・永続化、および統合契約を検証する Python と TypeScript のテスト群。

## 指標

- Files: 19
- Symbols: 279
- Incoming／Outgoing: 42／39
- Cohesion: 0.02
- Node kinds: Class 16、File 19、Function 12、Method 10、Test 222

## 代表パス

- `songcut/windows_font_native.py`
- `tests/test_subtitle_export.py`
- `tests/test_smart_export.py`
- `tests/test_mms_alignment.py`
- `tests/test_kiritan_display_benchmark.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `samplePoints` | Test | `gui/src/lib/waveformSessionCache.test.ts:99` |
| `_arguments` | Function | `packaging/e2e_all_subtitle_effects.py:30` |
| `_effect_defaults` | Function | `packaging/e2e_all_subtitle_effects.py:42` |
| `_build_lane` | Function | `packaging/e2e_all_subtitle_effects.py:53` |
| `_create_black_source` | Function | `packaging/e2e_all_subtitle_effects.py:112` |
| `main` | Function | `packaging/e2e_all_subtitle_effects.py:149` |
| `main.report` | Function | `packaging/e2e_all_subtitle_effects.py:185` |
| `NativeFontCollectorError` | Class | `songcut/windows_font_native.py:31` |
| `NativeFontCollectorError.__init__` | Method | `songcut/windows_font_native.py:34` |
| `_CreateRequest` | Class | `songcut/windows_font_native.py:48` |
| `_EnumRequest` | Class | `songcut/windows_font_native.py:57` |
| `_CandidateRecord` | Class | `songcut/windows_font_native.py:61` |
| `_NameRecord` | Class | `songcut/windows_font_native.py:78` |
| `_FaceRequest` | Class | `songcut/windows_font_native.py:91` |
| `_FaceRecord` | Class | `songcut/windows_font_native.py:104` |
| `_FileRecord` | Class | `songcut/windows_font_native.py:125` |
| `_GlyphRecord` | Class | `songcut/windows_font_native.py:139` |
| `_ErrorRecord` | Class | `songcut/windows_font_native.py:150` |
| `NativeFontName` | Class | `songcut/windows_font_native.py:162` |
| `NativeFontCandidate` | Class | `songcut/windows_font_native.py:169` |
| `NativeFontFile` | Class | `songcut/windows_font_native.py:182` |
| `NativeFontGlyph` | Class | `songcut/windows_font_native.py:191` |
| `NativeFontFace` | Class | `songcut/windows_font_native.py:199` |
| `_versioned` | Function | `songcut/windows_font_native.py:214` |
| `_decode_utf16` | Function | `songcut/windows_font_native.py:221` |
| `_dll_paths` | Function | `songcut/windows_font_native.py:232` |
| `resolve_native_dll_path` | Function | `songcut/windows_font_native.py:247` |
| `NativeFontCollector` | Class | `songcut/windows_font_native.py:266` |
| `NativeFontCollector.__init__` | Method | `songcut/windows_font_native.py:269` |
| `NativeFontCollector.dll_path` | Method | `songcut/windows_font_native.py:289` |
| `NativeFontCollector._configure_abi` | Method | `songcut/windows_font_native.py:292` |
| `NativeFontCollector.close` | Method | `songcut/windows_font_native.py:339` |
| `NativeFontCollector.__del__` | Method | `songcut/windows_font_native.py:345` |
| `NativeFontCollector._raise_status` | Method | `songcut/windows_font_native.py:351` |
| `NativeFontCollector.refresh` | Method | `songcut/windows_font_native.py:387` |
| `NativeFontCollector.enumerate` | Method | `songcut/windows_font_native.py:395` |
| `NativeFontCollector.inspect_face` | Method | `songcut/windows_font_native.py:473` |
| `get_native_font_collector` | Function | `songcut/windows_font_native.py:572` |
| `reset_native_font_collector` | Function | `songcut/windows_font_native.py:580` |
| `test_all_v3_effects_generate_single_and_multiline_ass_at_every_alignment` | Test | `tests/test_ass_lyric_effects_v3_integration.py:18` |
| `read_source` | Test | `tests/test_commonization_contract.py:11` |
| `call_count` | Test | `tests/test_commonization_contract.py:15` |
| `test_whisper_callers_share_session_factory_without_merging_domain_offsets` | Test | `tests/test_commonization_contract.py:28` |
| `test_ffmpeg_callers_use_common_process_runner_but_keep_command_progress_and_validation` | Test | `tests/test_commonization_contract.py:53` |
| `test_common_primitives_are_the_only_whisper_pipeline_and_ffmpeg_process_owners` | Test | `tests/test_commonization_contract.py:67` |
| `GuideTests` | Test | `tests/test_guide.py:7` |
| `GuideTests.test_parse_minute_second_and_hour_minute_second_tags` | Test | `tests/test_guide.py:8` |
| `GuideTests.test_multiple_timestamps_on_one_line_are_explicit_range` | Test | `tests/test_guide.py:16` |
| `GuideTests.test_single_timestamp_keeps_matched_raw_segment_id` | Test | `tests/test_guide.py:27` |
| `GuideTests.test_numbered_multiline_guide_uses_first_content_line_as_title` | Test | `tests/test_guide.py:35` |
| `GuideTests.test_numbered_multiline_guide_skips_blank_and_supplement_lines` | Test | `tests/test_guide.py:46` |
| `GuideTests.test_single_timestamp_starts_at_guide_tag_and_uses_nearby_segment_end` | Test | `tests/test_guide.py:52` |
| `GuideTests.test_single_timestamp_before_nearby_segment_still_starts_at_guide_tag` | Test | `tests/test_guide.py:65` |
| `GuideTests.test_single_timestamp_end_is_capped_at_next_guide_timestamp` | Test | `tests/test_guide.py:77` |
| `GuideTests.test_single_timestamp_end_at_next_guide_timestamp_is_not_shortened` | Test | `tests/test_guide.py:91` |
| `GuideTests.test_explicit_range_is_not_capped_at_next_guide_timestamp` | Test | `tests/test_guide.py:105` |
| `GuideTests.test_non_increasing_next_guide_timestamp_does_not_create_invalid_range` | Test | `tests/test_guide.py:117` |
| `GuideTests.test_unmatched_timestamp_uses_earlier_next_guide_timestamp` | Test | `tests/test_guide.py:127` |
| `GuideTests.test_unmatched_timestamp_uses_earlier_detected_segment_start` | Test | `tests/test_guide.py:140` |
| `GuideTests.test_unmatched_timestamp_uses_only_available_end_candidate` | Test | `tests/test_guide.py:152` |
| `GuideTests.test_unmatched_timestamp_uses_video_end_when_no_other_candidate_exists` | Test | `tests/test_guide.py:165` |
| `GuideTests.test_invalid_fallback_range_is_skipped_without_raising` | Test | `tests/test_guide.py:174` |
| `GuideTests.test_fallback_segments_are_sorted_positive_and_keep_guide_metadata` | Test | `tests/test_guide.py:183` |
| `GuideTests.test_safe_filename_stem_removes_windows_reserved_characters` | Test | `tests/test_guide.py:203` |
| `GuideTests.test_gui_segments_are_replaced_by_guided_segments_when_guide_is_present` | Test | `tests/test_guide.py:207` |
| `GuideTests.test_gui_segments_use_multiline_guide_titles_for_exports` | Test | `tests/test_guide.py:230` |
| `GuideTests.test_gui_segments_and_exports_share_next_guide_timestamp_cap` | Test | `tests/test_guide.py:257` |
| `_write_fixture_song` | Test | `tests/test_kiritan_display_benchmark.py:31` |
| `test_musicxml_and_table_are_read_in_document_order` | Test | `tests/test_kiritan_display_benchmark.py:47` |
| `test_expand_joins_small_kana_sokuon_and_long_mark_without_extra_token` | Test | `tests/test_kiritan_display_benchmark.py:65` |
| `test_short_pause_becomes_blank_and_hard_pause_splits` | Test | `tests/test_kiritan_display_benchmark.py:74` |
| `test_soft_pause_waits_five_seconds_and_twelve_second_cap_uses_boundary` | Test | `tests/test_kiritan_display_benchmark.py:92` |
| `test_discovery_excludes_08_and_29_and_builds_ground_truth` | Test | `tests/test_kiritan_display_benchmark.py:117` |
| `test_missing_label_is_reported_as_skip` | Test | `tests/test_kiritan_display_benchmark.py:132` |
| `test_no7_profile_normalizes_100ns_katakana_and_uses_wav_pt` | Test | `tests/test_kiritan_display_benchmark.py:147` |
| `test_ofuton_profile_discovers_nested_musicxml_and_audio` | Test | `tests/test_kiritan_display_benchmark.py:178` |
| `test_itako_profile_ignores_control_and_metadata_lyrics` | Test | `tests/test_kiritan_display_benchmark.py:203` |
| `test_metrics_report_exact_partition_and_violation` | Test | `tests/test_kiritan_display_benchmark.py:236` |
| `test_metrics_match_boundaries_by_time_and_report_count_differences` | Test | `tests/test_kiritan_display_benchmark.py:260` |
| `test_cli_writes_attribution_and_summary` | Test | `tests/test_kiritan_display_benchmark.py:296` |

## ファイル一覧

- `gui/src/lib/waveformSessionCache.test.ts`
- `packaging/e2e_all_subtitle_effects.py`
- `songcut/windows_font_native.py`
- `tests/__init__.py`
- `tests/test_ass_lyric_effects_v3_integration.py`
- `tests/test_commonization_contract.py`
- `tests/test_guide.py`
- `tests/test_kiritan_display_benchmark.py`
- `tests/test_launcher.py`
- `tests/test_lyrics_artifact_cache.py`
- `tests/test_lyrics_elements.py`
- `tests/test_mms_alignment.py`
- `tests/test_omniasr_alignment.py`
- `tests/test_smart_export.py`
- `tests/test_source_separation.py`
- `tests/test_subtitle_effect_catalog.py`
- `tests/test_subtitle_export.py`
- `tests/test_windows_font_resolver.py`
- `tests/test_youtube_metadata.py`
<!-- code-map:generated:end -->
