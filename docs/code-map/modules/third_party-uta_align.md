# コード解析地図：third_party-uta_align

<!-- code-map:generated:start -->
## 概要

歌詞と音声認識候補からアンカーと整列結果を構築し、候補合意、反復処理、フォールバック、整列検証を行う同梱 uta_align エンジン。

## 指標

- Files: 25
- Symbols: 373
- Incoming／Outgoing: 4／16
- Cohesion: 0.86
- Node kinds: Class 20、File 25、Function 145、Method 20、Test 163

## 代表パス

- `third_party/uta_align/src/uta_align/pipeline.py`
- `third_party/uta_align/src/uta_align/lyrics.py`
- `third_party/uta_align/tests/test_candidate_consensus.py`
- `third_party/uta_align/src/uta_align/fallback.py`
- `third_party/uta_align/src/uta_align/alignment.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `AlignmentError` | Class | `third_party/uta_align/src/uta_align/alignment.py:16` |
| `AlignmentError.__init__` | Method | `third_party/uta_align/src/uta_align/alignment.py:19` |
| `AlignmentError.add_diagnostics` | Method | `third_party/uta_align/src/uta_align/alignment.py:30` |
| `edit_similarity` | Function | `third_party/uta_align/src/uta_align/alignment.py:36` |
| `clean_observations` | Function | `third_party/uta_align/src/uta_align/alignment.py:56` |
| `clean_observations.rejection` | Function | `third_party/uta_align/src/uta_align/alignment.py:60` |
| `_overlap_fraction` | Function | `third_party/uta_align/src/uta_align/alignment.py:211` |
| `interval_intersects` | Function | `third_party/uta_align/src/uta_align/alignment.py:217` |
| `build_candidates` | Function | `third_party/uta_align/src/uta_align/alignment.py:229` |
| `_weighted_median` | Function | `third_party/uta_align/src/uta_align/alignment.py:414` |
| `_candidate_independence_groups` | Function | `third_party/uta_align/src/uta_align/alignment.py:425` |
| `_candidate_source_families` | Function | `third_party/uta_align/src/uta_align/alignment.py:435` |
| `_trusted_source_family` | Function | `third_party/uta_align/src/uta_align/alignment.py:444` |
| `_candidate_has_unprompted_or_trusted_source` | Function | `third_party/uta_align/src/uta_align/alignment.py:453` |
| `_consensus_candidate` | Function | `third_party/uta_align/src/uta_align/alignment.py:463` |
| `build_candidate_consensus` | Function | `third_party/uta_align/src/uta_align/alignment.py:876` |
| `_State` | Class | `third_party/uta_align/src/uta_align/alignment.py:966` |
| `_candidate_summary` | Function | `third_party/uta_align/src/uta_align/alignment.py:973` |
| `_candidate_slots` | Function | `third_party/uta_align/src/uta_align/alignment.py:995` |
| `_slot_index` | Function | `third_party/uta_align/src/uta_align/alignment.py:1037` |
| `_unique_anchor_bounds` | Function | `third_party/uta_align/src/uta_align/alignment.py:1050` |
| `_ordered_repetition_resolves` | Function | `third_party/uta_align/src/uta_align/alignment.py:1070` |
| `_repetition_position_cost` | Function | `third_party/uta_align/src/uta_align/alignment.py:1145` |
| `select_anchors` | Function | `third_party/uta_align/src/uta_align/alignment.py:1201` |
| `recognition_gaps` | Function | `third_party/uta_align/src/uta_align/alignment.py:1387` |
| `_contains_gap` | Function | `third_party/uta_align/src/uta_align/alignment.py:1408` |
| `_weights` | Function | `third_party/uta_align/src/uta_align/alignment.py:1417` |
| `_allocate` | Function | `third_party/uta_align/src/uta_align/alignment.py:1421` |
| `materialize_lines` | Function | `third_party/uta_align/src/uta_align/alignment.py:1473` |
| `validate_alignment` | Function | `third_party/uta_align/src/uta_align/alignment.py:1646` |
| `AudioFeatures` | Class | `third_party/uta_align/src/uta_align/audio.py:17` |
| `AudioFeatures.activity_components` | Method | `third_party/uta_align/src/uta_align/audio.py:26` |
| `AudioFeatures.confirmed_silences` | Method | `third_party/uta_align/src/uta_align/audio.py:80` |
| `AudioFeatures.minimum_envelope_time` | Method | `third_party/uta_align/src/uta_align/audio.py:105` |
| `_decode_wave` | Function | `third_party/uta_align/src/uta_align/audio.py:124` |
| `_decode_ffmpeg` | Function | `third_party/uta_align/src/uta_align/audio.py:144` |
| `load_audio_features` | Function | `third_party/uta_align/src/uta_align/audio.py:173` |
| `refine_boundary` | Function | `third_party/uta_align/src/uta_align/audio.py:211` |
| `_request_identifier` | Function | `third_party/uta_align/src/uta_align/backends.py:15` |
| `_boundary_support` | Function | `third_party/uta_align/src/uta_align/backends.py:22` |
| `Backend` | Class | `third_party/uta_align/src/uta_align/backends.py:38` |
| `Backend.transcribe` | Method | `third_party/uta_align/src/uta_align/backends.py:39` |
| `_ScriptedRecord` | Class | `third_party/uta_align/src/uta_align/backends.py:48` |
| `JsonBackend` | Class | `third_party/uta_align/src/uta_align/backends.py:53` |
| `JsonBackend.__init__` | Method | `third_party/uta_align/src/uta_align/backends.py:60` |
| `JsonBackend.transcribe` | Method | `third_party/uta_align/src/uta_align/backends.py:90` |
| `FakeBackend` | Class | `third_party/uta_align/src/uta_align/backends.py:126` |
| `FakeBackend.__init__` | Method | `third_party/uta_align/src/uta_align/backends.py:129` |
| `FakeBackend.transcribe` | Method | `third_party/uta_align/src/uta_align/backends.py:138` |
| `FasterWhisperBackend` | Class | `third_party/uta_align/src/uta_align/backends.py:175` |
| `FasterWhisperBackend.__init__` | Method | `third_party/uta_align/src/uta_align/backends.py:178` |
| `FasterWhisperBackend._get_model` | Method | `third_party/uta_align/src/uta_align/backends.py:182` |
| `FasterWhisperBackend.transcribe` | Method | `third_party/uta_align/src/uta_align/backends.py:200` |
| `_parser` | Function | `third_party/uta_align/src/uta_align/cli.py:16` |
| `main` | Function | `third_party/uta_align/src/uta_align/cli.py:52` |
| `AlignConfig` | Class | `third_party/uta_align/src/uta_align/config.py:12` |
| `AlignConfig.from_json` | Method | `third_party/uta_align/src/uta_align/config.py:74` |
| `AlignConfig.merged` | Method | `third_party/uta_align/src/uta_align/config.py:86` |
| `AlignConfig.validate` | Method | `third_party/uta_align/src/uta_align/config.py:92` |
| `FallbackOutcome` | Class | `third_party/uta_align/src/uta_align/fallback.py:14` |
| `_StageFourRunChunk` | Class | `third_party/uta_align/src/uta_align/fallback.py:21` |
| `_safe_intervals` | Function | `third_party/uta_align/src/uta_align/fallback.py:34` |
| `_candidate_line` | Function | `third_party/uta_align/src/uta_align/fallback.py:60` |
| `_stage_two` | Function | `third_party/uta_align/src/uta_align/fallback.py:89` |
| `_safe_component_index` | Function | `third_party/uta_align/src/uta_align/fallback.py:153` |
| `_freeze_valid_anchors` | Function | `third_party/uta_align/src/uta_align/fallback.py:167` |
| `_is_semantically_conflicted_hint` | Function | `third_party/uta_align/src/uta_align/fallback.py:302` |
| `_is_strong_ambiguity_demotion_reason` | Function | `third_party/uta_align/src/uta_align/fallback.py:311` |
| `_is_high_quality_provisional_hint` | Function | `third_party/uta_align/src/uta_align/fallback.py:318` |
| `_maximum_monotonic_hint_chain` | Function | `third_party/uta_align/src/uta_align/fallback.py:341` |
| `_bounded_provisional_center` | Function | `third_party/uta_align/src/uta_align/fallback.py:387` |
| `_apply_direct_hint_geometry` | Function | `third_party/uta_align/src/uta_align/fallback.py:398` |
| `_safe_capacity_center` | Function | `third_party/uta_align/src/uta_align/fallback.py:441` |
| `_spread_run_centers` | Function | `third_party/uta_align/src/uta_align/fallback.py:468` |
| `_desired_centers` | Function | `third_party/uta_align/src/uta_align/fallback.py:497` |
| `_bounded_spans` | Function | `third_party/uta_align/src/uta_align/fallback.py:751` |
| `_place_unanchored_run` | Function | `third_party/uta_align/src/uta_align/fallback.py:766` |
| `_stage_three` | Function | `third_party/uta_align/src/uta_align/fallback.py:906` |
| `_bounded_weighted_durations` | Function | `third_party/uta_align/src/uta_align/fallback.py:1091` |
| `_component_line_counts` | Function | `third_party/uta_align/src/uta_align/fallback.py:1120` |

## ファイル一覧

- `third_party/uta_align/src/uta_align/__init__.py`
- `third_party/uta_align/src/uta_align/__main__.py`
- `third_party/uta_align/src/uta_align/alignment.py`
- `third_party/uta_align/src/uta_align/audio.py`
- `third_party/uta_align/src/uta_align/backends.py`
- `third_party/uta_align/src/uta_align/cli.py`
- `third_party/uta_align/src/uta_align/config.py`
- `third_party/uta_align/src/uta_align/fallback.py`
- `third_party/uta_align/src/uta_align/lattice.py`
- `third_party/uta_align/src/uta_align/lyrics.py`
- `third_party/uta_align/src/uta_align/models.py`
- `third_party/uta_align/src/uta_align/normalize.py`
- `third_party/uta_align/src/uta_align/output.py`
- `third_party/uta_align/src/uta_align/pipeline.py`
- `third_party/uta_align/tests/conftest.py`
- `third_party/uta_align/tests/test_alignment.py`
- `third_party/uta_align/tests/test_candidate_consensus.py`
- `third_party/uta_align/tests/test_context_prompts.py`
- `third_party/uta_align/tests/test_fallback_components.py`
- `third_party/uta_align/tests/test_global_lattice.py`
- `third_party/uta_align/tests/test_normalize.py`
- `third_party/uta_align/tests/test_output_cli.py`
- `third_party/uta_align/tests/test_repetition_assignment.py`
- `third_party/uta_align/tests/test_safety_regressions.py`
- `third_party/uta_align/tools/verify_distribution.py`
<!-- code-map:generated:end -->
