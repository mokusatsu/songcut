# コード解析地図：tests

<!-- code-map:generated:start -->
## 概要

Python バックエンド、Electron/React の状態・操作・永続化、および統合契約を検証する Python と TypeScript のテスト群。

## 指標

- Files: 20
- Symbols: 255
- Incoming／Outgoing: 53／59
- Cohesion: 0.02
- Node kinds: File 20、Function 23、Test 212

## 代表パス

- `tests/test_api.py`
- `gui/src/lib/waveformSessionCache.ts`
- `tests/test_smart_export.py`
- `tests/test_mms_alignment.py`
- `tests/test_subtitle_export.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `put` | Function | `gui/src/lib/waveformSessionCache.ts:75` |
| `get` | Function | `gui/src/lib/waveformSessionCache.ts:92` |
| `invalidate` | Function | `gui/src/lib/waveformSessionCache.ts:118` |
| `clear` | Function | `gui/src/lib/waveformSessionCache.ts:123` |
| `size` | Function | `gui/src/lib/waveformSessionCache.ts:127` |
| `waveformDurationsMatch` | Function | `gui/src/lib/waveformSessionCache.ts:134` |
| `if` | Function | `gui/src/lib/waveformSessionCache.ts:176` |
| `normalizeFingerprint` | Function | `gui/src/lib/waveformSessionCache.ts:186` |
| `isValidMetadata` | Function | `gui/src/lib/waveformSessionCache.ts:191` |
| `for` | Function | `gui/src/lib/waveformSessionCache.ts:206` |
| `clonePoints` | Function | `gui/src/lib/waveformSessionCache.ts:225` |
| `distribution_root` | Function | `packaging/songcut_launcher_entry.py:22` |
| `configure_logging` | Function | `packaging/songcut_launcher_entry.py:28` |
| `configure_standard_streams` | Function | `packaging/songcut_launcher_entry.py:41` |
| `configure_environment` | Function | `packaging/songcut_launcher_entry.py:52` |
| `wait_for_health` | Function | `packaging/songcut_launcher_entry.py:68` |
| `show_startup_error` | Function | `packaging/songcut_launcher_entry.py:84` |
| `run` | Function | `packaging/songcut_launcher_entry.py:100` |
| `main` | Function | `packaging/songcut_launcher_entry.py:151` |
| `_value` | Function | `songcut/ass_effects23/cli.py:13` |
| `_param` | Function | `songcut/ass_effects23/cli.py:20` |
| `_parser` | Function | `songcut/ass_effects23/cli.py:29` |
| `main` | Function | `songcut/ass_effects23/cli.py:79` |
| `ApiJobTests` | Test | `tests/test_api.py:59` |
| `ApiJobTests.setUp` | Test | `tests/test_api.py:60` |
| `ApiJobTests.test_boundary_refinement_request_rejects_invalid_hysteresis` | Test | `tests/test_api.py:67` |
| `ApiJobTests.test_subtitle_render_job_returns_cache_identity_with_png` | Test | `tests/test_api.py:71` |
| `ApiJobTests.test_subtitle_export_request_preserves_segment_style_and_effect_overrides` | Test | `tests/test_api.py:120` |
| `ApiJobTests.test_subtitle_export_request_preserves_segment_style_and_effect_overrides.fake_export` | Test | `tests/test_api.py:159` |
| `ApiJobTests.test_analysis_starts_transcription_job_without_waiting_for_it` | Test | `tests/test_api.py:198` |
| `ApiJobTests.test_lyrics_analysis_returns_rhythm_grid_and_confidence_outliers` | Test | `tests/test_api.py:233` |
| `ApiJobTests.test_uta_align_receives_original_media_and_demucs_vocals` | Test | `tests/test_api.py:319` |
| `ApiJobTests.test_job_messages_keep_english_and_add_localization_metadata` | Test | `tests/test_api.py:388` |
| `ApiJobTests.test_waveform_updates_return_only_points_after_the_cursor` | Test | `tests/test_api.py:414` |
| `ApiJobTests.test_unmatched_guide_timestamp_does_not_fail_analysis_job` | Test | `tests/test_api.py:436` |
| `ApiJobTests.test_invalid_whisper_model_is_rejected_before_starting_download` | Test | `tests/test_api.py:469` |
| `ApiJobTests.test_empty_whisper_download_body_uses_application_default` | Test | `tests/test_api.py:476` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress` | Test | `tests/test_api.py:487` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:500` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress.fake_ensure_whisper_model` | Test | `tests/test_api.py:504` |
| `ApiJobTests.test_demucs_download_endpoint_starts_dedicated_job` | Test | `tests/test_api.py:531` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress` | Test | `tests/test_api.py:538` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:551` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress.fake_ensure_demucs_model` | Test | `tests/test_api.py:555` |
| `ApiJobTests.test_mms_download_endpoint_starts_dedicated_job` | Test | `tests/test_api.py:582` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress` | Test | `tests/test_api.py:589` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:602` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress.fake_ensure_mms_model` | Test | `tests/test_api.py:606` |
| `ApiJobTests.test_transcription_job_requires_installed_selected_model` | Test | `tests/test_api.py:633` |
| `ApiJobTests.test_transcription_job_normalizes_legacy_language_and_passes_settings` | Test | `tests/test_api.py:651` |
| `ApiJobTests.test_health_does_not_fail_when_ffmpeg_is_missing` | Test | `tests/test_api.py:681` |
| `ApiJobTests.test_ffmpeg_check_reports_paths` | Test | `tests/test_api.py:690` |
| `ApiJobTests.test_ffmpeg_check_reports_download_url_when_missing` | Test | `tests/test_api.py:702` |
| `ApiJobTests.test_ffmpeg_check_reports_launch_failure` | Test | `tests/test_api.py:712` |
| `ApiJobTests.test_probe_includes_timestamp_comment_candidates_and_warning` | Test | `tests/test_api.py:725` |
| `ApiJobTests.test_export_job_uses_smart_renderer` | Test | `tests/test_api.py:766` |
| `ApiJobTests.test_export_job_reports_titles_and_selected_item_counts` | Test | `tests/test_api.py:806` |
| `ApiJobTests.test_export_plan_reports_smart_and_full_reencode_items` | Test | `tests/test_api.py:862` |
| `ApiJobTests.test_export_job_can_create_a_source_named_folder` | Test | `tests/test_api.py:899` |
| `ApiJobTests.test_export_job_sanitizes_and_deduplicates_filename_stems` | Test | `tests/test_api.py:931` |
| `ApiJobTests.test_export_job_writes_timestamp_comment_text` | Test | `tests/test_api.py:963` |
| `ApiJobTests.test_scratch_proxy_job_completes_with_manager_result` | Test | `tests/test_api.py:998` |
| `ApiJobTests.test_cancel_scratch_proxy_job_marks_job_cancelled` | Test | `tests/test_api.py:1039` |
| `ApiJobTests.test_scratch_proxy_job_releases_result_when_cancelled_during_encode` | Test | `tests/test_api.py:1057` |
| `ParseTests` | Test | `tests/test_ass_effects23_core.py:32` |
| `ParseTests.test_parse_and_format_round_trip` | Test | `tests/test_ass_effects23_core.py:33` |
| `ParseTests.test_commas_belong_to_text_after_ninth_separator` | Test | `tests/test_ass_effects23_core.py:41` |
| `ParseTests.test_rejects_non_dialogue_and_multiple_lines` | Test | `tests/test_ass_effects23_core.py:48` |
| `AllEffectsTests` | Test | `tests/test_ass_effects23_core.py:55` |
| `AllEffectsTests.test_all_23_effects_generate_valid_dialogue_lines` | Test | `tests/test_ass_effects23_core.py:56` |
| `AllEffectsTests.test_effect_can_be_number_name_or_japanese_label` | Test | `tests/test_ass_effects23_core.py:75` |
| `AllEffectsTests.test_cut_is_unchanged` | Test | `tests/test_ass_effects23_core.py:84` |
| `ContextTests` | Test | `tests/test_ass_effects23_core.py:91` |
| `ContextTests.test_context_is_required_for_coordinate_effects` | Test | `tests/test_ass_effects23_core.py:92` |
| `ContextTests.test_non_coordinate_effect_does_not_require_context` | Test | `tests/test_ass_effects23_core.py:109` |
| `ContextTests.test_invalid_context_geometry_is_rejected` | Test | `tests/test_ass_effects23_core.py:114` |
| `DirectionTests` | Test | `tests/test_ass_effects23_core.py:123` |
| `DirectionTests.test_separate_start_and_end_directions_are_rejected` | Test | `tests/test_ass_effects23_core.py:124` |
| `DirectionTests.test_slide_uses_one_direction_for_entry_and_exit` | Test | `tests/test_ass_effects23_core.py:139` |
| `DirectionTests.test_invalid_direction_for_effect_is_rejected` | Test | `tests/test_ass_effects23_core.py:152` |

## ファイル一覧

- `gui/src/lib/waveformSessionCache.ts`
- `packaging/songcut_api_entry.py`
- `packaging/songcut_launcher_entry.py`
- `songcut/ass_effects23/cli.py`
- `tests/__init__.py`
- `tests/test_api.py`
- `tests/test_ass_effects23_core.py`
- `tests/test_commonization_contract.py`
- `tests/test_gui_pipeline.py`
- `tests/test_guide.py`
- `tests/test_launcher.py`
- `tests/test_mms_alignment.py`
- `tests/test_review.py`
- `tests/test_scratch_proxy.py`
- `tests/test_smart_export.py`
- `tests/test_source_separation.py`
- `tests/test_subtitle_export.py`
- `tests/test_uta_alignment.py`
- `tests/test_waveform.py`
- `tests/test_youtube_metadata.py`
<!-- code-map:generated:end -->
