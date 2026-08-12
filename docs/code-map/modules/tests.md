# コード解析地図：tests

<!-- code-map:generated:start -->
## 概要

Python バックエンド、Electron/React の状態・操作・永続化、および統合契約を検証する Python と TypeScript のテスト群。

## 指標

- Files: 22
- Symbols: 253
- Incoming／Outgoing: 60／59
- Cohesion: 0.02
- Node kinds: Class 12、File 22、Function 19、Test 200

## 代表パス

- `gui/src/lib/waveformSessionCache.ts`
- `tests/test_api.py`
- `tests/test_smart_export.py`
- `tests/test_subtitle_export.py`
- `tests/test_mms_alignment.py`

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
| `SCUT_FONT_STATUS` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:31` |
| `SCUT_FONT_ERROR_CATEGORY` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:42` |
| `SCUT_FONT_NAME_KIND` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:53` |
| `SCUT_FONT_CREATE_REQUEST` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:68` |
| `SCUT_FONT_ENUM_REQUEST` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:75` |
| `SCUT_FONT_CANDIDATE_RECORD` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:82` |
| `SCUT_FONT_NAME_RECORD` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:97` |
| `SCUT_FONT_FACE_REQUEST` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:108` |
| `SCUT_FONT_FACE_RECORD` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:119` |
| `SCUT_FONT_FILE_RECORD` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:138` |
| `SCUT_FONT_GLYPH_RECORD` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:150` |
| `SCUT_FONT_ERROR` | Class | `native/windows_font_resolver/include/scut_windows_font_resolver.h:159` |
| `Check` | Test | `native/windows_font_resolver/tests/scut_windows_font_resolver_tests.cpp:11` |
| `main` | Test | `native/windows_font_resolver/tests/scut_windows_font_resolver_tests.cpp:21` |
| `distribution_root` | Function | `packaging/songcut_launcher_entry.py:22` |
| `configure_logging` | Function | `packaging/songcut_launcher_entry.py:28` |
| `configure_standard_streams` | Function | `packaging/songcut_launcher_entry.py:41` |
| `configure_environment` | Function | `packaging/songcut_launcher_entry.py:52` |
| `wait_for_health` | Function | `packaging/songcut_launcher_entry.py:68` |
| `show_startup_error` | Function | `packaging/songcut_launcher_entry.py:84` |
| `run` | Function | `packaging/songcut_launcher_entry.py:100` |
| `main` | Function | `packaging/songcut_launcher_entry.py:151` |
| `ApiJobTests` | Test | `tests/test_api.py:63` |
| `ApiJobTests.setUp` | Test | `tests/test_api.py:64` |
| `ApiJobTests.test_boundary_refinement_request_rejects_invalid_hysteresis` | Test | `tests/test_api.py:71` |
| `ApiJobTests.test_subtitle_effect_catalog_returns_fresh_v3_payload` | Test | `tests/test_api.py:75` |
| `ApiJobTests.test_subtitle_effect_request_normalizes_v3_parameters_and_rejects_unknown` | Test | `tests/test_api.py:82` |
| `ApiJobTests.test_subtitle_effect_estimate_only_enforces_an_explicit_budget` | Test | `tests/test_api.py:89` |
| `ApiJobTests.test_subtitle_render_job_returns_cache_identity_with_png` | Test | `tests/test_api.py:105` |
| `ApiJobTests.test_subtitle_export_request_preserves_segment_style_and_effect_overrides` | Test | `tests/test_api.py:154` |
| `ApiJobTests.test_subtitle_export_request_preserves_segment_style_and_effect_overrides.fake_export` | Test | `tests/test_api.py:193` |
| `ApiJobTests.test_analysis_starts_transcription_job_without_waiting_for_it` | Test | `tests/test_api.py:233` |
| `ApiJobTests.test_lyrics_analysis_returns_rhythm_grid_and_confidence_outliers` | Test | `tests/test_api.py:268` |
| `ApiJobTests.test_uta_align_receives_original_media_and_demucs_vocals` | Test | `tests/test_api.py:354` |
| `ApiJobTests.test_job_messages_keep_english_and_add_localization_metadata` | Test | `tests/test_api.py:423` |
| `ApiJobTests.test_waveform_updates_return_only_points_after_the_cursor` | Test | `tests/test_api.py:449` |
| `ApiJobTests.test_unmatched_guide_timestamp_does_not_fail_analysis_job` | Test | `tests/test_api.py:471` |
| `ApiJobTests.test_invalid_whisper_model_is_rejected_before_starting_download` | Test | `tests/test_api.py:504` |
| `ApiJobTests.test_empty_whisper_download_body_uses_application_default` | Test | `tests/test_api.py:511` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress` | Test | `tests/test_api.py:522` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:535` |
| `ApiJobTests.test_whisper_download_job_reports_byte_progress.fake_ensure_whisper_model` | Test | `tests/test_api.py:539` |
| `ApiJobTests.test_demucs_download_endpoint_starts_dedicated_job` | Test | `tests/test_api.py:566` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress` | Test | `tests/test_api.py:573` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:586` |
| `ApiJobTests.test_demucs_download_job_reports_byte_progress.fake_ensure_demucs_model` | Test | `tests/test_api.py:590` |
| `ApiJobTests.test_mms_download_endpoint_starts_dedicated_job` | Test | `tests/test_api.py:617` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress` | Test | `tests/test_api.py:624` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress.capture_update` | Test | `tests/test_api.py:637` |
| `ApiJobTests.test_mms_download_job_reports_byte_progress.fake_ensure_mms_model` | Test | `tests/test_api.py:641` |
| `ApiJobTests.test_transcription_job_requires_installed_selected_model` | Test | `tests/test_api.py:668` |
| `ApiJobTests.test_transcription_job_normalizes_legacy_language_and_passes_settings` | Test | `tests/test_api.py:686` |
| `ApiJobTests.test_health_does_not_fail_when_ffmpeg_is_missing` | Test | `tests/test_api.py:716` |
| `ApiJobTests.test_ffmpeg_check_reports_paths` | Test | `tests/test_api.py:725` |
| `ApiJobTests.test_ffmpeg_check_reports_download_url_when_missing` | Test | `tests/test_api.py:737` |
| `ApiJobTests.test_ffmpeg_check_reports_launch_failure` | Test | `tests/test_api.py:747` |
| `ApiJobTests.test_probe_includes_timestamp_comment_candidates_and_warning` | Test | `tests/test_api.py:760` |
| `ApiJobTests.test_export_job_uses_smart_renderer` | Test | `tests/test_api.py:801` |
| `ApiJobTests.test_export_job_reports_titles_and_selected_item_counts` | Test | `tests/test_api.py:841` |
| `ApiJobTests.test_export_plan_reports_smart_and_full_reencode_items` | Test | `tests/test_api.py:897` |
| `ApiJobTests.test_export_job_can_create_a_source_named_folder` | Test | `tests/test_api.py:934` |
| `ApiJobTests.test_export_job_sanitizes_and_deduplicates_filename_stems` | Test | `tests/test_api.py:966` |
| `ApiJobTests.test_export_job_writes_timestamp_comment_text` | Test | `tests/test_api.py:998` |
| `ApiJobTests.test_scratch_proxy_job_completes_with_manager_result` | Test | `tests/test_api.py:1033` |
| `ApiJobTests.test_cancel_scratch_proxy_job_marks_job_cancelled` | Test | `tests/test_api.py:1074` |
| `ApiJobTests.test_scratch_proxy_job_releases_result_when_cancelled_during_encode` | Test | `tests/test_api.py:1092` |
| `test_all_v3_effects_generate_single_and_multiline_ass_at_every_alignment` | Test | `tests/test_ass_lyric_effects_v3_integration.py:18` |
| `read_source` | Test | `tests/test_commonization_contract.py:11` |
| `call_count` | Test | `tests/test_commonization_contract.py:15` |

## ファイル一覧

- `gui/src/lib/waveformSessionCache.ts`
- `native/windows_font_resolver/include/scut_windows_font_resolver.h`
- `native/windows_font_resolver/tests/scut_windows_font_resolver_tests.cpp`
- `packaging/songcut_api_entry.py`
- `packaging/songcut_launcher_entry.py`
- `tests/__init__.py`
- `tests/test_api.py`
- `tests/test_ass_lyric_effects_v3_integration.py`
- `tests/test_commonization_contract.py`
- `tests/test_gui_pipeline.py`
- `tests/test_guide.py`
- `tests/test_launcher.py`
- `tests/test_mms_alignment.py`
- `tests/test_review.py`
- `tests/test_scratch_proxy.py`
- `tests/test_smart_export.py`
- `tests/test_source_separation.py`
- `tests/test_subtitle_effect_catalog.py`
- `tests/test_subtitle_export.py`
- `tests/test_uta_alignment.py`
- `tests/test_waveform.py`
- `tests/test_youtube_metadata.py`
<!-- code-map:generated:end -->
