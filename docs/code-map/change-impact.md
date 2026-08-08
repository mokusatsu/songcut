<!-- code-map:generated:start -->
## 解析基点

- 動作モード: `update`
- VCS: `git`
- Base: `4849785976caf1d1cd268bb6f37d0c073a24ee59`
- Head: `4849785976caf1d1cd268bb6f37d0c073a24ee59`
- Dirty: `yes`

## 変更ファイル

- `gui/electron/project-schema.ts`
- `gui/electron/project-store.test.ts`
- `gui/src/components/SegmentTimingDialog.test.tsx`
- `gui/src/components/SegmentTimingDialog.tsx`
- `gui/src/components/SubModePanel.tsx`
- `gui/src/components/SubTimelineEditor.tsx`
- `gui/src/components/SubtitleAlignmentIcon.test.tsx`
- `gui/src/components/SubtitleAlignmentIcon.tsx`
- `gui/src/i18n.ts`
- `gui/src/lib/api.ts`
- `gui/src/lib/subtitles.test.ts`
- `gui/src/lib/subtitles.ts`
- `gui/src/lib/useSubOperations.ts`
- `gui/src/lib/useTimelineViewport.ts`
- `packaging/e2e_sub_mode.js`
- `songcut/api.py`
- `songcut/subtitle_export.py`
- `tests/test_api.py`
- `tests/test_subtitle_export.py`

## 影響半径

| 距離 | 状態 | ファイル |
|---:|---|---|
| 0 | 現在 | `gui/electron/project-schema.ts` |
| 0 | 現在 | `gui/electron/project-store.test.ts` |
| 0 | 現在 | `gui/src/components/SegmentTimingDialog.test.tsx` |
| 0 | 現在 | `gui/src/components/SegmentTimingDialog.tsx` |
| 0 | 現在 | `gui/src/components/SubModePanel.tsx` |
| 0 | 現在 | `gui/src/components/SubTimelineEditor.tsx` |
| 0 | 現在 | `gui/src/components/SubtitleAlignmentIcon.test.tsx` |
| 0 | 現在 | `gui/src/components/SubtitleAlignmentIcon.tsx` |
| 0 | 現在 | `gui/src/i18n.ts` |
| 0 | 現在 | `gui/src/lib/api.ts` |
| 0 | 現在 | `gui/src/lib/subtitles.test.ts` |
| 0 | 現在 | `gui/src/lib/subtitles.ts` |
| 0 | 現在 | `gui/src/lib/useSubOperations.ts` |
| 0 | 現在 | `gui/src/lib/useTimelineViewport.ts` |
| 0 | 現在 | `packaging/e2e_sub_mode.js` |
| 0 | 現在 | `songcut/api.py` |
| 0 | 現在 | `songcut/subtitle_export.py` |
| 0 | 現在 | `tests/test_api.py` |
| 0 | 現在 | `tests/test_subtitle_export.py` |
| 1 | 現在 | `gui/electron/main.ts` |
| 1 | 現在 | `gui/electron/project-store.ts` |
| 1 | 現在 | `gui/src/App.tsx` |
| 1 | 現在 | `gui/src/components/AppDialogs.tsx` |
| 1 | 現在 | `gui/src/components/BoundaryRefinementDialog.tsx` |
| 1 | 現在 | `gui/src/components/CutModePanel.tsx` |
| 1 | 現在 | `gui/src/components/CutSegmentTimingDialog.tsx` |
| 1 | 現在 | `gui/src/components/EditorTransportControls.tsx` |
| 1 | 現在 | `gui/src/components/ModeToolbar.tsx` |
| 1 | 現在 | `gui/src/components/SettingsDialog.tsx` |
| 1 | 現在 | `gui/src/components/TimelineSurface.tsx` |
| 1 | 現在 | `gui/src/components/TimelineWaveform.tsx` |
| 1 | 現在 | `gui/src/components/WhisperLanguageCombobox.tsx` |
| 1 | 現在 | `gui/src/components/WhisperSettingsPanel.tsx` |
| 1 | 現在 | `gui/src/components/ui/dialog.tsx` |
| 1 | 現在 | `gui/src/i18n.test.ts` |
| 1 | 現在 | `gui/src/lib/boundaries.test.ts` |
| 1 | 現在 | `gui/src/lib/commonizationContracts.test.ts` |
| 1 | 現在 | `gui/src/lib/project.test.ts` |
| 1 | 現在 | `gui/src/lib/project.ts` |
| 1 | 現在 | `gui/src/lib/projectAdapters.test.ts` |
| 1 | 現在 | `gui/src/lib/projectAdapters.ts` |
| 1 | 現在 | `gui/src/lib/projectBase.ts` |
| 1 | 現在 | `gui/src/lib/segmentTiming.ts` |
| 1 | 現在 | `gui/src/lib/settingsScopes.ts` |
| 1 | 現在 | `gui/src/lib/subtitleStylePresets.test.ts` |
| 1 | 現在 | `gui/src/lib/subtitleStylePresets.ts` |
| 1 | 現在 | `gui/src/lib/useBoundaryDrag.test.ts` |
| 1 | 現在 | `gui/src/lib/useCutOperations.ts` |
| 1 | 現在 | `gui/src/lib/useModelPreparation.ts` |
| 1 | 現在 | `gui/src/lib/useProgressiveWaveform.ts` |
| 1 | 現在 | `gui/src/lib/useSubOperations.test.ts` |
| 1 | 現在 | `gui/src/lib/useTimelineViewport.test.ts` |
| 1 | 現在 | `gui/src/main.tsx` |
| 1 | 現在 | `packaging/evaluate_subtitle_frame.py` |
| 1 | 現在 | `packaging/songcut_api_entry.py` |
| 1 | 現在 | `packaging/songcut_launcher_entry.py` |
| 1 | 現在 | `songcut/boundary_refiner.py` |
| 1 | 現在 | `songcut/rhythm_alignment.py` |
| 1 | 現在 | `songcut/transcription.py` |
| 1 | 現在 | `songcut/waveform.py` |
| 1 | 現在 | `tests/test_boundary_refiner.py` |
| 1 | 現在 | `tests/test_cli_integration.py` |
| 1 | 現在 | `tests/test_ffmpeg_tools.py` |
| 1 | 現在 | `tests/test_gui_pipeline.py` |
| 1 | 現在 | `tests/test_hardware.py` |
| 1 | 現在 | `tests/test_lyrics_alignment.py` |
| 1 | 現在 | `tests/test_scratch_proxy.py` |
| 1 | 現在 | `tests/test_smart_export.py` |
| 1 | 現在 | `tests/test_source_separation.py` |
| 1 | 現在 | `tests/test_transcription.py` |
| 1 | 現在 | `tests/test_uta_alignment.py` |
| 1 | 現在 | `tests/test_waveform.py` |
| 1 | 現在 | `tests/test_youtube_metadata.py` |
| 1 | 現在 | `third_party/uta_align/src/uta_align/alignment.py` |
| 1 | 現在 | `third_party/uta_align/src/uta_align/audio.py` |
| 1 | 現在 | `third_party/uta_align/src/uta_align/fallback.py` |
| 1 | 現在 | `third_party/uta_align/src/uta_align/lattice.py` |
| 2 | 現在 | `gui/electron/locale.test.ts` |
| 2 | 現在 | `gui/src/components/HelpTooltip.tsx` |
| 2 | 現在 | `gui/src/components/JobProgressDialog.tsx` |
| 2 | 現在 | `gui/src/components/SettingsDialog.test.ts` |
| 2 | 現在 | `gui/src/components/TimelineSurface.test.ts` |
| 2 | 現在 | `gui/src/components/WhisperLanguageCombobox.test.ts` |
| 2 | 現在 | `gui/src/lib/editorCommands.ts` |
| 2 | 現在 | `gui/src/lib/modeController.test.ts` |
| 2 | 現在 | `gui/src/lib/modeSession.test.ts` |
| 2 | 現在 | `gui/src/lib/modeViewModel.test.ts` |
| 2 | 現在 | `gui/src/lib/modeViewModel.ts` |
| 2 | 現在 | `gui/src/lib/segmentTiming.test.ts` |
| 2 | 現在 | `gui/src/lib/settingsScopes.test.ts` |
| 2 | 現在 | `gui/src/lib/useBoundaryDrag.ts` |
| 2 | 現在 | `gui/src/lib/useCutOperations.test.ts` |
| 2 | 現在 | `gui/src/lib/useModelPreparation.test.ts` |
| 2 | 現在 | `gui/src/lib/useOperationRunner.test.ts` |
| 2 | 現在 | `gui/src/lib/useOperationRunner.ts` |
| 2 | 現在 | `gui/src/lib/useProjectPersistence.test.ts` |
| 2 | 現在 | `gui/src/lib/useProjectPersistence.ts` |
| 2 | 現在 | `gui/src/lib/waveform.test.ts` |
| 2 | 現在 | `gui/src/lib/waveform.ts` |
| 2 | 現在 | `gui/src/lib/waveformPreferences.test.ts` |
| 2 | 現在 | `gui/src/lib/waveformPreferences.ts` |
| 2 | 現在 | `gui/src/vite-env.d.ts` |
| 2 | 現在 | `packaging/e2e_dist_smoke.js` |
| 2 | 現在 | `songcut/cli.py` |
| 2 | 現在 | `songcut/ffmpeg_tools.py` |
| 2 | 現在 | `songcut/gui_pipeline.py` |
| 2 | 現在 | `songcut/guide.py` |
| 2 | 現在 | `songcut/lyrics_alignment.py` |
| 2 | 現在 | `songcut/mms_alignment.py` |
| 2 | 現在 | `songcut/scratch_proxy.py` |
| 2 | 現在 | `songcut/timestamps.py` |
| 2 | 現在 | `songcut/uta_alignment.py` |
| 2 | 現在 | `tests/test_ass_effects23_core.py` |
| 2 | 現在 | `tests/test_ffmpeg_process.py` |
| 2 | 現在 | `tests/test_launcher.py` |
| 2 | 現在 | `tests/test_mms_alignment.py` |
| 2 | 現在 | `third_party/uta_align/src/uta_align/__init__.py` |
| 2 | 現在 | `third_party/uta_align/src/uta_align/cli.py` |
| 2 | 現在 | `third_party/uta_align/src/uta_align/pipeline.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_alignment.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_candidate_consensus.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_context_prompts.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_fallback_components.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_global_lattice.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_repetition_assignment.py` |
| 2 | 現在 | `third_party/uta_align/tests/test_safety_regressions.py` |

## リスク

| ファイル | 状態 | Score | Level | 依存先 | Entry point | 未テストsymbol |
|---|---|---:|---|---:|---:|---:|
| `gui/electron/project-schema.ts` | 変更 | 100.0 | critical | 107 | 0 | 54 |
| `gui/electron/project-store.test.ts` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `gui/src/components/SegmentTimingDialog.test.tsx` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `gui/src/components/SegmentTimingDialog.tsx` | 変更 | 100.0 | critical | 107 | 7 | 13 |
| `gui/src/components/SubModePanel.tsx` | 変更 | 100.0 | critical | 107 | 4 | 18 |
| `gui/src/components/SubTimelineEditor.tsx` | 変更 | 100.0 | critical | 107 | 3 | 8 |
| `gui/src/components/SubtitleAlignmentIcon.test.tsx` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `gui/src/components/SubtitleAlignmentIcon.tsx` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `gui/src/i18n.ts` | 変更 | 100.0 | critical | 107 | 1 | 3 |
| `gui/src/lib/api.ts` | 変更 | 100.0 | critical | 107 | 12 | 18 |
| `gui/src/lib/subtitles.test.ts` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `gui/src/lib/subtitles.ts` | 変更 | 100.0 | critical | 107 | 0 | 19 |
| `gui/src/lib/useSubOperations.ts` | 変更 | 100.0 | critical | 107 | 9 | 15 |
| `gui/src/lib/useTimelineViewport.ts` | 変更 | 100.0 | critical | 107 | 5 | 14 |
| `packaging/e2e_sub_mode.js` | 変更 | 100.0 | critical | 107 | 4 | 18 |
| `songcut/api.py` | 変更 | 100.0 | critical | 107 | 25 | 46 |
| `songcut/subtitle_export.py` | 変更 | 100.0 | critical | 107 | 0 | 19 |
| `tests/test_api.py` | 変更 | 100.0 | critical | 107 | 0 | 0 |
| `tests/test_subtitle_export.py` | 変更 | 100.0 | critical | 107 | 0 | 0 |

## 影響component・flow・test

- Components: `gui`、`packaging`、`songcut`、`tests`、`third_party-uta_align`
- Flows: `flow_87f310366eafeed8`、`flow_acbaab781455b14f`、`flow_4d28b202844b5aa9`、`flow_2b99029c15ce92cc`、`flow_0da193a90ef9fbb2`、`flow_3e50ab519c941b42`、`flow_ed7fa71733f22ef7`、`flow_9cb8fa5a5e44dcfc`、`flow_79222e1d6e0b5911`、`flow_44bdc595373a0c96`、`flow_071f16f84c039ff4`、`flow_8e401bcdf1521ba9`、`flow_ee02df1afd6d9353`、`flow_5225c9736f1f57ae`、`flow_fa47ffcf8a16cc06`、`flow_eb35f7b7e4b96eed`、`flow_a2bdac49a6b968c7`、`flow_a4ed8a0280c4223b`
- Tests: `gui/electron/locale.test.ts`、`gui/electron/project-store.test.ts`、`gui/src/components/SegmentTimingDialog.test.tsx`、`gui/src/components/SettingsDialog.test.ts`、`gui/src/components/SubtitleAlignmentIcon.test.tsx`、`gui/src/components/TimelineSurface.test.ts`、`gui/src/components/WhisperLanguageCombobox.test.ts`、`gui/src/i18n.test.ts`、`gui/src/lib/boundaries.test.ts`、`gui/src/lib/commonizationContracts.test.ts`、`gui/src/lib/modeController.test.ts`、`gui/src/lib/modeSession.test.ts`、`gui/src/lib/modeViewModel.test.ts`、`gui/src/lib/project.test.ts`、`gui/src/lib/projectAdapters.test.ts`、`gui/src/lib/segmentTiming.test.ts`、`gui/src/lib/settingsScopes.test.ts`、`gui/src/lib/subtitleStylePresets.test.ts`、`gui/src/lib/subtitles.test.ts`、`gui/src/lib/useBoundaryDrag.test.ts`、`gui/src/lib/useCutOperations.test.ts`、`gui/src/lib/useModelPreparation.test.ts`、`gui/src/lib/useOperationRunner.test.ts`、`gui/src/lib/useProjectPersistence.test.ts`、`gui/src/lib/useSubOperations.test.ts`、`gui/src/lib/useTimelineViewport.test.ts`、`gui/src/lib/waveform.test.ts`、`gui/src/lib/waveformPreferences.test.ts`、`tests/test_api.py`、`tests/test_ass_effects23_core.py`、`tests/test_boundary_refiner.py`、`tests/test_cli_integration.py`、`tests/test_ffmpeg_process.py`、`tests/test_ffmpeg_tools.py`、`tests/test_gui_pipeline.py`、`tests/test_hardware.py`、`tests/test_launcher.py`、`tests/test_lyrics_alignment.py`、`tests/test_mms_alignment.py`、`tests/test_scratch_proxy.py`、`tests/test_smart_export.py`、`tests/test_source_separation.py`、`tests/test_subtitle_export.py`、`tests/test_transcription.py`、`tests/test_uta_alignment.py`、`tests/test_waveform.py`、`tests/test_youtube_metadata.py`、`third_party/uta_align/tests/test_alignment.py`、`third_party/uta_align/tests/test_candidate_consensus.py`、`third_party/uta_align/tests/test_context_prompts.py`、`third_party/uta_align/tests/test_fallback_components.py`、`third_party/uta_align/tests/test_global_lattice.py`、`third_party/uta_align/tests/test_repetition_assignment.py`、`third_party/uta_align/tests/test_safety_regressions.py`
<!-- code-map:generated:end -->
