# コード解析地図：tests

<!-- code-map:generated:start -->
## 概要

Python バックエンド、Electron/React の状態・操作・永続化、および統合契約を検証する Python と TypeScript のテスト群。

## 指標

- Files: 14
- Symbols: 189
- Incoming／Outgoing: 1／34
- Cohesion: 0.13
- Node kinds: Class 7、File 14、Function 36、Method 5、Test 127

## 代表パス

- `tests/test_subtitle_export.py`
- `tools/benchmark_kiritan_display_elements.py`
- `tests/test_smart_export.py`
- `tests/test_kiritan_display_benchmark.py`
- `tests/test_lyrics_artifact_cache.py`

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
| `_write_fixture_song` | Test | `tests/test_kiritan_display_benchmark.py:29` |
| `test_musicxml_and_table_are_read_in_document_order` | Test | `tests/test_kiritan_display_benchmark.py:45` |
| `test_expand_joins_small_kana_sokuon_and_long_mark_without_extra_token` | Test | `tests/test_kiritan_display_benchmark.py:63` |
| `test_short_pause_becomes_blank_and_hard_pause_splits` | Test | `tests/test_kiritan_display_benchmark.py:72` |
| `test_soft_pause_waits_five_seconds_and_twelve_second_cap_uses_boundary` | Test | `tests/test_kiritan_display_benchmark.py:90` |
| `test_discovery_excludes_08_and_29_and_builds_ground_truth` | Test | `tests/test_kiritan_display_benchmark.py:115` |
| `test_missing_label_is_reported_as_skip` | Test | `tests/test_kiritan_display_benchmark.py:130` |
| `test_metrics_report_exact_partition_and_violation` | Test | `tests/test_kiritan_display_benchmark.py:145` |
| `test_metrics_match_boundaries_by_time_and_report_count_differences` | Test | `tests/test_kiritan_display_benchmark.py:169` |
| `test_cli_writes_attribution_and_summary` | Test | `tests/test_kiritan_display_benchmark.py:205` |
| `test_read_mono_label_rejects_invalid_interval` | Test | `tests/test_kiritan_display_benchmark.py:226` |
| `test_generate_prediction_reuses_runner_once_and_uses_local_window` | Test | `tests/test_kiritan_display_benchmark.py:233` |
| `test_generate_prediction_reuses_runner_once_and_uses_local_window.FakeRunner` | Test | `tests/test_kiritan_display_benchmark.py:264` |
| `test_generate_prediction_reuses_runner_once_and_uses_local_window.FakeRunner.emissions` | Test | `tests/test_kiritan_display_benchmark.py:265` |
| `test_generate_prediction_reuses_runner_once_and_uses_local_window.fake_runtime` | Test | `tests/test_kiritan_display_benchmark.py:272` |
| `test_generate_prediction_reuses_runner_once_and_uses_local_window.fake_decode` | Test | `tests/test_kiritan_display_benchmark.py:276` |
| `_load_launcher_module` | Test | `tests/test_launcher.py:12` |
| `LauncherTests` | Test | `tests/test_launcher.py:22` |
| `LauncherTests.test_spawn_external_process_temporarily_clears_frozen_dll_directory` | Test | `tests/test_launcher.py:23` |
| `LauncherTests.test_spawn_external_process_temporarily_clears_frozen_dll_directory.set_dll_directory` | Test | `tests/test_launcher.py:28` |
| `LauncherTests.test_spawn_external_process_temporarily_clears_frozen_dll_directory.popen` | Test | `tests/test_launcher.py:31` |
| `LauncherTests.test_spawn_external_process_restores_dll_directory_when_spawn_fails` | Test | `tests/test_launcher.py:54` |
| `LauncherTests.test_spawn_external_process_leaves_dll_directory_alone_when_not_frozen` | Test | `tests/test_launcher.py:71` |
| `LauncherTests.test_configure_standard_streams_replaces_none_with_log_stream` | Test | `tests/test_launcher.py:86` |
| `LauncherTests.test_consumes_and_removes_a_valid_software_decoder_restart_request` | Test | `tests/test_launcher.py:100` |
| `LauncherTests.test_rejects_and_removes_an_invalid_software_decoder_restart_request` | Test | `tests/test_launcher.py:110` |
| `LauncherTests.test_redacts_one_shot_resume_paths_from_launcher_logs` | Test | `tests/test_launcher.py:119` |
| `_key` | Test | `tests/test_lyrics_artifact_cache.py:20` |
| `_electron_fingerprint` | Test | `tests/test_lyrics_artifact_cache.py:30` |
| `test_fingerprint_matches_electron_head_tail_contract` | Test | `tests/test_lyrics_artifact_cache.py:42` |
| `test_default_root_honours_override_and_localappdata` | Test | `tests/test_lyrics_artifact_cache.py:51` |
| `test_cache_hit_miss_and_manifest_validation` | Test | `tests/test_lyrics_artifact_cache.py:60` |
| `test_put_rejects_fingerprint_mismatch_and_logits_metadata` | Test | `tests/test_lyrics_artifact_cache.py:89` |
| `test_ttl_expiry_is_a_miss_and_removes_only_entry` | Test | `tests/test_lyrics_artifact_cache.py:105` |
| `test_get_touches_last_used_and_lru_prune` | Test | `tests/test_lyrics_artifact_cache.py:121` |
| `test_cache_key_changes_for_all_identity_components_and_has_no_path_traversal` | Test | `tests/test_lyrics_artifact_cache.py:154` |
| `test_concurrent_same_key_put_is_safe` | Test | `tests/test_lyrics_artifact_cache.py:170` |
| `SmartExportTests` | Test | `tests/test_smart_export.py:25` |
| `SmartExportTests.setUp` | Test | `tests/test_smart_export.py:26` |
| `SmartExportTests.test_estimate_smart_render_uses_only_container_and_video_codec` | Test | `tests/test_smart_export.py:48` |
| `SmartExportTests.test_estimate_reencode_bitrate_prefers_video_stream_rate` | Test | `tests/test_smart_export.py:58` |
| `SmartExportTests.test_estimate_reencode_bitrate_uses_format_minus_audio_when_stream_rate_missing` | Test | `tests/test_smart_export.py:73` |
| `SmartExportTests.test_plan_h264_splits_partial_gops` | Test | `tests/test_smart_export.py:88` |
| `SmartExportTests.test_probe_keyframes_filters_non_key_frames` | Test | `tests/test_smart_export.py:118` |
| `SmartExportTests.test_snap_video_range_uses_nearest_frame_pts_boundaries` | Test | `tests/test_smart_export.py:133` |

## ファイル一覧

- `gui/src/lib/waveformSessionCache.test.ts`
- `packaging/e2e_all_subtitle_effects.py`
- `tests/__init__.py`
- `tests/test_ass_lyric_effects_v3_integration.py`
- `tests/test_commonization_contract.py`
- `tests/test_guide.py`
- `tests/test_kiritan_display_benchmark.py`
- `tests/test_launcher.py`
- `tests/test_lyrics_artifact_cache.py`
- `tests/test_smart_export.py`
- `tests/test_subtitle_effect_catalog.py`
- `tests/test_subtitle_export.py`
- `tests/test_youtube_metadata.py`
- `tools/benchmark_kiritan_display_elements.py`
<!-- code-map:generated:end -->
