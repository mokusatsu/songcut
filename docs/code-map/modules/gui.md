# コード解析地図：gui

<!-- code-map:generated:start -->
## 概要

Electron メインプロセスと React レンダラーで構成されるデスクトップ編集 UI。Cut/Sub の編集操作、Python API との連携、プロジェクト保存・復旧を扱う。

## 指標

- Files: 124
- Symbols: 981
- Incoming／Outgoing: 58／28
- Cohesion: 0.96
- Node kinds: Class 3、File 124、Function 780、Test 74

## 代表パス

- `gui/src/i18n.ts`
- `gui/src/App.tsx`
- `gui/src/components/AppDialogs.tsx`
- `gui/src/types.ts`
- `gui/src/components/SettingsDialog.tsx`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `initializeMainI18n` | Function | `gui/electron/i18n.ts:163` |
| `normalizeUiLanguage` | Function | `gui/electron/locale.ts:11` |
| `normalizeUiLanguagePreference` | Function | `gui/electron/locale.ts:16` |
| `loadLocalePreference` | Function | `gui/electron/locale.ts:21` |
| `preferencesPath` | Function | `gui/electron/locale.ts:43` |
| `if` | Function | `gui/electron/main.ts:40` |
| `if` | Function | `gui/electron/main.ts:47` |
| `createWindow` | Function | `gui/electron/main.ts:153` |
| `if` | Function | `gui/electron/main.ts:176` |
| `if` | Function | `gui/electron/main.ts:185` |
| `if` | Function | `gui/electron/main.ts:327` |
| `setApplicationMenu` | Function | `gui/electron/main.ts:352` |
| `applicationMenuTemplate` | Function | `gui/electron/main.ts:356` |
| `send` | Function | `gui/electron/main.ts:364` |
| `sendMenuCommand` | Function | `gui/electron/main.ts:614` |
| `clampMenuZoom` | Function | `gui/electron/main.ts:618` |
| `normalizeInferenceDevice` | Function | `gui/electron/main.ts:622` |
| `normalizeWhisperModel` | Function | `gui/electron/main.ts:628` |
| `normalizeWaveformDisplayMode` | Function | `gui/electron/main.ts:634` |
| `normalizeMenuBoolean` | Function | `gui/electron/main.ts:640` |
| `showAboutSongcut` | Function | `gui/electron/main.ts:645` |
| `formatBuildTime` | Function | `gui/electron/main.ts:654` |
| `resolveApiBaseUrl` | Function | `gui/electron/main.ts:662` |
| `if` | Function | `gui/electron/main.ts:664` |
| `startPythonApi` | Function | `gui/electron/main.ts:671` |
| `stopPythonApi` | Function | `gui/electron/main.ts:695` |
| `if` | Function | `gui/electron/main.ts:696` |
| `findFreePort` | Function | `gui/electron/main.ts:702` |
| `waitForHealth` | Function | `gui/electron/main.ts:714` |
| `while` | Function | `gui/electron/main.ts:716` |
| `listener` | Function | `gui/electron/preload.cts:9` |
| `listener` | Function | `gui/electron/preload.cts:14` |
| `sidecarPathForVideo` | Function | `gui/electron/project-schema.ts:332` |
| `isProjectOperationKindForMode` | Function | `gui/electron/project-schema.ts:337` |
| `parseProjectText` | Function | `gui/electron/project-schema.ts:342` |
| `assertProjectDocument` | Function | `gui/electron/project-schema.ts:354` |
| `if` | Function | `gui/electron/project-schema.ts:357` |
| `if` | Function | `gui/electron/project-schema.ts:358` |
| `if` | Function | `gui/electron/project-schema.ts:367` |
| `if` | Function | `gui/electron/project-schema.ts:387` |
| `if` | Function | `gui/electron/project-schema.ts:392` |
| `if` | Function | `gui/electron/project-schema.ts:409` |
| `normalizeProjectDocument` | Function | `gui/electron/project-schema.ts:460` |
| `validateModeInvariants` | Function | `gui/electron/project-schema.ts:471` |
| `if` | Function | `gui/electron/project-schema.ts:474` |
| `if` | Function | `gui/electron/project-schema.ts:476` |
| `if` | Function | `gui/electron/project-schema.ts:483` |
| `if` | Function | `gui/electron/project-schema.ts:486` |
| `if` | Function | `gui/electron/project-schema.ts:489` |
| `if` | Function | `gui/electron/project-schema.ts:492` |
| `assertRecoverySnapshot` | Function | `gui/electron/project-schema.ts:498` |
| `validateSegments` | Function | `gui/electron/project-schema.ts:507` |
| `if` | Function | `gui/electron/project-schema.ts:525` |
| `if` | Function | `gui/electron/project-schema.ts:528` |
| `if` | Function | `gui/electron/project-schema.ts:530` |
| `if` | Function | `gui/electron/project-schema.ts:534` |
| `if` | Function | `gui/electron/project-schema.ts:537` |
| `if` | Function | `gui/electron/project-schema.ts:540` |
| `validateSubtitleState` | Function | `gui/electron/project-schema.ts:556` |
| `if` | Function | `gui/electron/project-schema.ts:584` |
| `if` | Function | `gui/electron/project-schema.ts:591` |
| `if` | Function | `gui/electron/project-schema.ts:594` |
| `if` | Function | `gui/electron/project-schema.ts:598` |
| `if` | Function | `gui/electron/project-schema.ts:610` |
| `if` | Function | `gui/electron/project-schema.ts:624` |
| `validateSubtitleEffect` | Function | `gui/electron/project-schema.ts:634` |
| `if` | Function | `gui/electron/project-schema.ts:647` |
| `validateSubtitleStyle` | Function | `gui/electron/project-schema.ts:655` |
| `validateTranscript` | Function | `gui/electron/project-schema.ts:673` |
| `if` | Function | `gui/electron/project-schema.ts:681` |
| `validateBoundaryRefinementSummary` | Function | `gui/electron/project-schema.ts:696` |
| `validateBoundarySegmentDiagnostic` | Function | `gui/electron/project-schema.ts:709` |
| `for` | Function | `gui/electron/project-schema.ts:712` |
| `validateBoundarySideDiagnostic` | Function | `gui/electron/project-schema.ts:719` |
| `for` | Function | `gui/electron/project-schema.ts:722` |
| `for` | Function | `gui/electron/project-schema.ts:725` |
| `for` | Function | `gui/electron/project-schema.ts:728` |
| `whisperSettings` | Function | `gui/electron/project-schema.ts:739` |
| `validateOperation` | Function | `gui/electron/project-schema.ts:763` |
| `if` | Function | `gui/electron/project-schema.ts:775` |

## ファイル一覧

- `gui/electron/i18n.ts`
- `gui/electron/locale.test.ts`
- `gui/electron/locale.ts`
- `gui/electron/main.ts`
- `gui/electron/preload.cts`
- `gui/electron/project-schema.ts`
- `gui/electron/project-store.test.ts`
- `gui/electron/project-store.ts`
- `gui/electron/system-fonts.ts`
- `gui/electron/waveform-codec.test.ts`
- `gui/electron/waveform-codec.ts`
- `gui/src/App.tsx`
- `gui/src/components/AppDialogs.tsx`
- `gui/src/components/CutModePanel.tsx`
- `gui/src/components/CutSegmentTimingDialog.tsx`
- `gui/src/components/EditorTransportControls.tsx`
- `gui/src/components/HelpTooltip.tsx`
- `gui/src/components/JobProgressDialog.test.ts`
- `gui/src/components/JobProgressDialog.tsx`
- `gui/src/components/ModeToolbar.tsx`
- `gui/src/components/SegmentTimingDialog.test.tsx`
- `gui/src/components/SegmentTimingDialog.tsx`
- `gui/src/components/SettingsDialog.test.ts`
- `gui/src/components/SettingsDialog.tsx`
- `gui/src/components/SubModePanel.test.ts`
- `gui/src/components/SubTimelineEditor.tsx`
- `gui/src/components/SubtitleAlignmentIcon.test.tsx`
- `gui/src/components/SubtitleAlignmentIcon.tsx`
- `gui/src/components/TimelineSurface.test.ts`
- `gui/src/components/TimelineSurface.tsx`
- `gui/src/components/TimelineWaveform.tsx`
- `gui/src/components/WhisperLanguageCombobox.test.ts`
- `gui/src/components/WhisperLanguageCombobox.tsx`
- `gui/src/components/WhisperSettingsPanel.tsx`
- `gui/src/components/ui/button.tsx`
- `gui/src/components/ui/checkbox.tsx`
- `gui/src/components/ui/dialog.tsx`
- `gui/src/components/ui/editor-focus.test.ts`
- `gui/src/components/ui/editor-focus.tsx`
- `gui/src/components/ui/input.tsx`
- `gui/src/components/ui/radix-select.tsx`
- `gui/src/components/ui/scroll-area.tsx`
- `gui/src/components/ui/select.tsx`
- `gui/src/components/ui/tabs.tsx`
- `gui/src/components/ui/textarea.tsx`
- `gui/src/components/ui/toggle.tsx`
- `gui/src/i18n.test.ts`
- `gui/src/i18n.ts`
- `gui/src/lib/api.ts`
- `gui/src/lib/appComposition.test.ts`
- `gui/src/lib/boundaries.test.ts`
- `gui/src/lib/boundaries.ts`
- `gui/src/lib/boundaryRefinement.test.ts`
- `gui/src/lib/boundaryRefinement.ts`
- `gui/src/lib/commonizationContracts.test.ts`
- `gui/src/lib/editorCommands.test.ts`
- `gui/src/lib/editorCommands.ts`
- `gui/src/lib/exportNaming.test.ts`
- `gui/src/lib/exportNaming.ts`
- `gui/src/lib/jsdocContracts.test.ts`
- `gui/src/lib/modeController.test.ts`
- `gui/src/lib/modeController.ts`
- `gui/src/lib/modeSession.test.ts`
- `gui/src/lib/modeSession.ts`
- `gui/src/lib/modeViewModel.test.ts`
- `gui/src/lib/modeViewModel.ts`
- `gui/src/lib/modes.ts`
- `gui/src/lib/project.test.ts`
- `gui/src/lib/project.ts`
- `gui/src/lib/projectAdapters.test.ts`
- `gui/src/lib/projectAdapters.ts`
- `gui/src/lib/projectBase.ts`
- `gui/src/lib/scratchProxy.test.ts`
- `gui/src/lib/scratchProxy.ts`
- `gui/src/lib/segmentManagement.test.ts`
- `gui/src/lib/segmentManagement.ts`
- `gui/src/lib/segmentTiming.test.ts`
- `gui/src/lib/segmentTiming.ts`
- `gui/src/lib/settingsScopes.test.ts`
- `gui/src/lib/settingsScopes.ts`
- `gui/src/lib/shortcuts.test.ts`
- `gui/src/lib/shortcuts.ts`
- `gui/src/lib/subtitleEffectCatalog.tsx`
- `gui/src/lib/subtitleEffects.test.ts`
- `gui/src/lib/subtitleEffects.ts`
- `gui/src/lib/subtitleStylePresets.test.ts`
- `gui/src/lib/subtitleStylePresets.ts`
- `gui/src/lib/subtitles.test.ts`
- `gui/src/lib/subtitles.ts`
- `gui/src/lib/time.ts`
- `gui/src/lib/timeRange.test.ts`
- `gui/src/lib/timeRange.ts`
- `gui/src/lib/timestampComments.test.ts`
- `gui/src/lib/timestampComments.ts`
- `gui/src/lib/timestampExport.test.ts`
- `gui/src/lib/timestampExport.ts`
- `gui/src/lib/useBoundaryDrag.test.ts`
- `gui/src/lib/useBoundaryDrag.ts`
- `gui/src/lib/useCutOperations.test.ts`
- `gui/src/lib/useCutOperations.ts`
- `gui/src/lib/useModeOperations.ts`
- `gui/src/lib/useModelPreparation.test.ts`
- `gui/src/lib/useModelPreparation.ts`
- `gui/src/lib/useOperationRunner.test.ts`
- `gui/src/lib/useOperationRunner.ts`
- `gui/src/lib/useProgressiveWaveform.ts`
- `gui/src/lib/useProjectPersistence.test.ts`
- `gui/src/lib/useProjectPersistence.ts`
- `gui/src/lib/useSubOperations.test.ts`
- `gui/src/lib/useSubOperations.ts`
- `gui/src/lib/useTaskRegistry.test.ts`
- `gui/src/lib/useTaskRegistry.ts`
- `gui/src/lib/useTimelineViewport.test.ts`
- `gui/src/lib/useTimelineViewport.ts`
- `gui/src/lib/utils.ts`
- `gui/src/lib/waveform.test.ts`
- `gui/src/lib/waveform.ts`
- `gui/src/lib/waveformPreferences.test.ts`
- `gui/src/lib/waveformPreferences.ts`
- `gui/src/main.tsx`
- `gui/src/types.ts`
- `gui/src/vite-env.d.ts`
- `gui/vite.config.ts`
- `packaging/e2e_dist_smoke.js`
<!-- code-map:generated:end -->
