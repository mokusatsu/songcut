# コード解析地図：gui

<!-- code-map:generated:start -->
## 概要

Electron メインプロセスと React レンダラーで構成されるデスクトップ編集 UI。Cut/Sub の編集操作、共有タイムラインのスクラブ・端部自動スクロール、再生範囲制御、Sub動画上の字幕・表示素プレビューと統合字幕ファイル書出し、Python API との連携、プロジェクト保存・復旧を扱う。

## 指標

- Files: 170
- Symbols: 1320
- Incoming／Outgoing: 64／22
- Cohesion: 0.98
- Node kinds: Class 19、File 170、Function 1011、Method 10、Test 110

## 代表パス

- `gui/src/i18n.ts`
- `gui/src/App.tsx`
- `gui/src/lib/subtitles.ts`
- `gui/src/types.ts`
- `gui/electron/project-schema.ts`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `initializeMainI18n` | Function | `gui/electron/i18n.ts:163` |
| `withPreferencesDirectory` | Test | `gui/electron/locale.test.ts:17` |
| `normalizeUiLanguage` | Function | `gui/electron/locale.ts:15` |
| `normalizeUiLanguagePreference` | Function | `gui/electron/locale.ts:20` |
| `loadLocalePreference` | Function | `gui/electron/locale.ts:25` |
| `loadLastDialogDirectory` | Function | `gui/electron/locale.ts:30` |
| `saveLastDialogDirectory` | Function | `gui/electron/locale.ts:45` |
| `loadPreferences` | Function | `gui/electron/locale.ts:51` |
| `updatePreferences` | Function | `gui/electron/locale.ts:60` |
| `savePreferences` | Function | `gui/electron/locale.ts:68` |
| `preferencesPath` | Function | `gui/electron/locale.ts:76` |
| `if` | Function | `gui/electron/main.ts:47` |
| `if` | Function | `gui/electron/main.ts:66` |
| `if` | Function | `gui/electron/main.ts:74` |
| `createWindow` | Function | `gui/electron/main.ts:180` |
| `if` | Function | `gui/electron/main.ts:228` |
| `if` | Function | `gui/electron/main.ts:237` |
| `if` | Function | `gui/electron/main.ts:284` |
| `showOpenDialogWithHistory` | Function | `gui/electron/main.ts:307` |
| `if` | Function | `gui/electron/main.ts:313` |
| `if` | Function | `gui/electron/main.ts:424` |
| `setApplicationMenu` | Function | `gui/electron/main.ts:449` |
| `applicationMenuTemplate` | Function | `gui/electron/main.ts:453` |
| `send` | Function | `gui/electron/main.ts:461` |
| `sendMenuCommand` | Function | `gui/electron/main.ts:711` |
| `clampMenuZoom` | Function | `gui/electron/main.ts:715` |
| `normalizeInferenceDevice` | Function | `gui/electron/main.ts:719` |
| `normalizeWhisperModel` | Function | `gui/electron/main.ts:725` |
| `normalizeWaveformDisplayMode` | Function | `gui/electron/main.ts:731` |
| `normalizeMenuBoolean` | Function | `gui/electron/main.ts:737` |
| `showAboutSongcut` | Function | `gui/electron/main.ts:742` |
| `formatBuildTime` | Function | `gui/electron/main.ts:751` |
| `resolveApiBaseUrl` | Function | `gui/electron/main.ts:759` |
| `if` | Function | `gui/electron/main.ts:761` |
| `startPythonApi` | Function | `gui/electron/main.ts:768` |
| `stopPythonApi` | Function | `gui/electron/main.ts:792` |
| `if` | Function | `gui/electron/main.ts:793` |
| `findFreePort` | Function | `gui/electron/main.ts:799` |
| `waitForHealth` | Function | `gui/electron/main.ts:811` |
| `while` | Function | `gui/electron/main.ts:813` |
| `listener` | Function | `gui/electron/preload.cts:18` |
| `listener` | Function | `gui/electron/preload.cts:23` |
| `sidecarPathForVideo` | Function | `gui/electron/project-schema.ts:401` |
| `isProjectOperationKindForMode` | Function | `gui/electron/project-schema.ts:406` |
| `parseProjectText` | Function | `gui/electron/project-schema.ts:411` |
| `assertProjectDocument` | Function | `gui/electron/project-schema.ts:423` |
| `if` | Function | `gui/electron/project-schema.ts:426` |
| `if` | Function | `gui/electron/project-schema.ts:427` |
| `if` | Function | `gui/electron/project-schema.ts:436` |
| `if` | Function | `gui/electron/project-schema.ts:456` |
| `if` | Function | `gui/electron/project-schema.ts:461` |
| `if` | Function | `gui/electron/project-schema.ts:478` |
| `normalizeProjectDocument` | Function | `gui/electron/project-schema.ts:529` |
| `validateModeInvariants` | Function | `gui/electron/project-schema.ts:540` |
| `if` | Function | `gui/electron/project-schema.ts:543` |
| `if` | Function | `gui/electron/project-schema.ts:545` |
| `if` | Function | `gui/electron/project-schema.ts:552` |
| `if` | Function | `gui/electron/project-schema.ts:555` |
| `if` | Function | `gui/electron/project-schema.ts:558` |
| `if` | Function | `gui/electron/project-schema.ts:561` |
| `assertRecoverySnapshot` | Function | `gui/electron/project-schema.ts:567` |
| `validateSegments` | Function | `gui/electron/project-schema.ts:576` |
| `if` | Function | `gui/electron/project-schema.ts:594` |
| `if` | Function | `gui/electron/project-schema.ts:597` |
| `if` | Function | `gui/electron/project-schema.ts:599` |
| `if` | Function | `gui/electron/project-schema.ts:603` |
| `if` | Function | `gui/electron/project-schema.ts:606` |
| `if` | Function | `gui/electron/project-schema.ts:609` |
| `validateSubtitleState` | Function | `gui/electron/project-schema.ts:625` |
| `if` | Function | `gui/electron/project-schema.ts:654` |
| `if` | Function | `gui/electron/project-schema.ts:661` |
| `if` | Function | `gui/electron/project-schema.ts:664` |
| `if` | Function | `gui/electron/project-schema.ts:668` |
| `if` | Function | `gui/electron/project-schema.ts:677` |
| `if` | Function | `gui/electron/project-schema.ts:680` |
| `if` | Function | `gui/electron/project-schema.ts:683` |
| `if` | Function | `gui/electron/project-schema.ts:688` |
| `if` | Function | `gui/electron/project-schema.ts:691` |
| `if` | Function | `gui/electron/project-schema.ts:695` |
| `if` | Function | `gui/electron/project-schema.ts:707` |

## ファイル一覧

- `gui/electron/i18n.ts`
- `gui/electron/locale.test.ts`
- `gui/electron/locale.ts`
- `gui/electron/main.ts`
- `gui/electron/preload.cts`
- `gui/electron/project-schema.ts`
- `gui/electron/project-store.test.ts`
- `gui/electron/project-store.ts`
- `gui/electron/software-decoder.test.ts`
- `gui/electron/software-decoder.ts`
- `gui/electron/system-fonts.ts`
- `gui/electron/waveform-codec.test.ts`
- `gui/electron/waveform-codec.ts`
- `gui/src/App.tsx`
- `gui/src/components/AppDialogs.tsx`
- `gui/src/components/CutAnalyzeGuideDialog.test.ts`
- `gui/src/components/CutAnalyzeGuideDialog.tsx`
- `gui/src/components/CutModePanel.tsx`
- `gui/src/components/DisplayElementInspector.test.tsx`
- `gui/src/components/DisplayElementInspector.tsx`
- `gui/src/components/DisplayElementZoomDialog.test.tsx`
- `gui/src/components/DisplayElementZoomDialog.tsx`
- `gui/src/components/EditorTransportControls.tsx`
- `gui/src/components/HelpTooltip.tsx`
- `gui/src/components/JobProgressDialog.test.ts`
- `gui/src/components/JobProgressDialog.tsx`
- `gui/src/components/ModeToolbar.test.tsx`
- `gui/src/components/ModeToolbar.tsx`
- `gui/src/components/ProjectInformation.tsx`
- `gui/src/components/SegmentInspector.test.tsx`
- `gui/src/components/SegmentInspector.tsx`
- `gui/src/components/SettingsDialog.test.ts`
- `gui/src/components/SettingsDialog.tsx`
- `gui/src/components/SubModePanel.test.ts`
- `gui/src/components/SubModePanel.tsx`
- `gui/src/components/SubSegmentStyleInspector.test.tsx`
- `gui/src/components/SubSegmentStyleInspector.tsx`
- `gui/src/components/SubTimelineEditor.test.ts`
- `gui/src/components/SubTimelineEditor.tsx`
- `gui/src/components/SubTimelineMoveInspector.test.tsx`
- `gui/src/components/SubTimelineMoveInspector.tsx`
- `gui/src/components/SubVideoPreview.test.tsx`
- `gui/src/components/SubVideoPreview.tsx`
- `gui/src/components/SubtitleAlignmentIcon.test.tsx`
- `gui/src/components/SubtitleAlignmentIcon.tsx`
- `gui/src/components/SubtitleFileExportDialog.test.tsx`
- `gui/src/components/SubtitleFileExportDialog.tsx`
- `gui/src/components/SubtitleStyleEditor.test.tsx`
- `gui/src/components/TaskStatusPanel.test.tsx`
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
- `gui/src/lib/api.test.ts`
- `gui/src/lib/api.ts`
- `gui/src/lib/appComposition.test.ts`
- `gui/src/lib/boundaries.test.ts`
- `gui/src/lib/boundaries.ts`
- `gui/src/lib/boundaryRefinement.test.ts`
- `gui/src/lib/boundaryRefinement.ts`
- `gui/src/lib/commonizationContracts.test.ts`
- `gui/src/lib/displayElementZoomPlayback.test.ts`
- `gui/src/lib/displayElementZoomPlayback.ts`
- `gui/src/lib/displayElementZoomSession.test.ts`
- `gui/src/lib/displayElementZoomSession.ts`
- `gui/src/lib/displayElements.test.ts`
- `gui/src/lib/displayElements.ts`
- `gui/src/lib/editorCommands.test.ts`
- `gui/src/lib/editorCommands.ts`
- `gui/src/lib/exportNaming.test.ts`
- `gui/src/lib/exportNaming.ts`
- `gui/src/lib/jsdocContracts.test.ts`
- `gui/src/lib/lineReanalysisCoordinator.test.ts`
- `gui/src/lib/lineReanalysisCoordinator.ts`
- `gui/src/lib/mediaDecodeRecovery.test.ts`
- `gui/src/lib/mediaDecodeRecovery.ts`
- `gui/src/lib/mediaDiagnostics.test.ts`
- `gui/src/lib/mediaDiagnostics.ts`
- `gui/src/lib/mediaPlaybackCoordinator.test.ts`
- `gui/src/lib/mediaPlaybackCoordinator.ts`
- `gui/src/lib/modeController.test.ts`
- `gui/src/lib/modeController.ts`
- `gui/src/lib/modeSession.test.ts`
- `gui/src/lib/modeSession.ts`
- `gui/src/lib/modeViewModel.test.ts`
- `gui/src/lib/modeViewModel.ts`
- `gui/src/lib/modes.ts`
- `gui/src/lib/playbackRange.test.ts`
- `gui/src/lib/playbackRange.ts`
- `gui/src/lib/project.test.ts`
- `gui/src/lib/project.ts`
- `gui/src/lib/projectAdapters.test.ts`
- `gui/src/lib/projectAdapters.ts`
- `gui/src/lib/projectBase.ts`
- `gui/src/lib/scratchProxy.test.ts`
- `gui/src/lib/scratchProxy.ts`
- `gui/src/lib/segmentManagement.test.ts`
- `gui/src/lib/segmentManagement.ts`
- `gui/src/lib/segmentSelection.test.ts`
- `gui/src/lib/segmentSelection.ts`
- `gui/src/lib/segmentTiming.test.ts`
- `gui/src/lib/segmentTiming.ts`
- `gui/src/lib/segmentTimingPolicy.test.ts`
- `gui/src/lib/settingsScopes.test.ts`
- `gui/src/lib/settingsScopes.ts`
- `gui/src/lib/shortcuts.test.ts`
- `gui/src/lib/shortcuts.ts`
- `gui/src/lib/subtitleEffectCatalog.tsx`
- `gui/src/lib/subtitleEffects.test.ts`
- `gui/src/lib/subtitleEffects.ts`
- `gui/src/lib/subtitleFileExport.ts`
- `gui/src/lib/subtitleLaneOperations.test.ts`
- `gui/src/lib/subtitleLaneOperations.ts`
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
- `gui/src/lib/waveformSessionCache.ts`
- `gui/src/main.tsx`
- `gui/src/types.ts`
- `gui/src/vite-env.d.ts`
- `gui/vite.config.ts`
- `native/windows_font_resolver/include/scut_windows_font_resolver.h`
- `packaging/e2e_dist_smoke.js`
<!-- code-map:generated:end -->
