# コード解析地図：songcut

<!-- code-map:generated:start -->
## 概要

FastAPI と CLI を入口に、動画・音声の解析、文字起こし、境界調整、波形生成、クリップ・字幕書き出しを提供する Python バックエンド。

## 指標

- Files: 51
- Symbols: 810
- Incoming／Outgoing: 72／77
- Cohesion: 0.72
- Node kinds: Class 116、File 51、Function 422、Method 70、Test 151

## 代表パス

- `songcut/api.py`
- `gui/src/components/SubModePanel.tsx`
- `songcut/transcription.py`
- `songcut/subtitle_export.py`
- `songcut/ffmpeg_tools.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `time` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `nullableTime` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:72` |
| `db` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:73` |
| `SubModePanel` | Function | `gui/src/components/SubModePanel.tsx:123` |
| `analyzeLyrics` | Function | `gui/src/components/SubModePanel.tsx:220` |
| `openLyricsDialog` | Function | `gui/src/components/SubModePanel.tsx:228` |
| `exportSubtitles` | Function | `gui/src/components/SubModePanel.tsx:241` |
| `addLane` | Function | `gui/src/components/SubModePanel.tsx:246` |
| `removeLane` | Function | `gui/src/components/SubModePanel.tsx:259` |
| `updateLane` | Function | `gui/src/components/SubModePanel.tsx:276` |
| `update` | Function | `gui/src/components/SubModePanel.tsx:480` |
| `patch` | Function | `gui/src/components/SubModePanel.tsx:580` |
| `patchEffect` | Function | `gui/src/components/SubModePanel.tsx:584` |
| `patchEffectParam` | Function | `gui/src/components/SubModePanel.tsx:588` |
| `saveStylePreset` | Function | `gui/src/components/SubModePanel.tsx:592` |
| `applyStylePreset` | Function | `gui/src/components/SubModePanel.tsx:610` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:617` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:772` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:790` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:801` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:817` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:829` |
| `colorPickerValue` | Function | `gui/src/components/SubModePanel.tsx:934` |
| `colorPickerResult` | Function | `gui/src/components/SubModePanel.tsx:941` |
| `effectLabel` | Function | `gui/src/components/SubModePanel.tsx:949` |
| `effectDescription` | Function | `gui/src/components/SubModePanel.tsx:954` |
| `parameterLabel` | Function | `gui/src/components/SubModePanel.tsx:959` |
| `choiceValueForUi` | Function | `gui/src/components/SubModePanel.tsx:964` |
| `readChoiceValue` | Function | `gui/src/components/SubModePanel.tsx:969` |
| `choiceLabel` | Function | `gui/src/components/SubModePanel.tsx:976` |
| `clampCatalogNumber` | Function | `gui/src/components/SubModePanel.tsx:983` |
| `groupEffectDefinitions` | Function | `gui/src/components/SubModePanel.tsx:992` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:994` |
| `findSubtitleEffectError` | Function | `gui/src/components/SubModePanel.tsx:1021` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:1022` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:1028` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:1043` |
| `hasSubtitleSegments` | Function | `gui/src/components/SubModePanel.tsx:1050` |
| `samplePoints` | Test | `gui/src/lib/waveformSessionCache.test.ts:99` |
| `ComApartmentScope` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:38` |
| `NameInfo` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:63` |
| `CandidateInfo` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:69` |
| `CandidateRef` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:81` |
| `FileInfo` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:86` |
| `GlyphInfo` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:94` |
| `FaceInfo` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:101` |
| `BlobBuilder` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:114` |
| `Resolver` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:229` |
| `ErrorState` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:231` |
| `Resolver` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:239` |
| `CallGuard` | Class | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:425` |
| `CallGuard.CallGuard` | Method | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:427` |
| `BuildCandidateInfo` | Function | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:437` |
| `ResolvePath` | Function | `native/windows_font_resolver/src/scut_windows_font_resolver.cpp:516` |
| `_arguments` | Function | `packaging/e2e_all_subtitle_effects.py:30` |
| `_effect_defaults` | Function | `packaging/e2e_all_subtitle_effects.py:42` |
| `_build_lane` | Function | `packaging/e2e_all_subtitle_effects.py:53` |
| `_create_black_source` | Function | `packaging/e2e_all_subtitle_effects.py:112` |
| `main` | Function | `packaging/e2e_all_subtitle_effects.py:149` |
| `main.report` | Function | `packaging/e2e_all_subtitle_effects.py:185` |
| `log` | Function | `packaging/e2e_sub_mode.js:25` |
| `assertPass` | Function | `packaging/e2e_sub_mode.js:31` |
| `sleep` | Function | `packaging/e2e_sub_mode.js:35` |
| `withTimeout` | Function | `packaging/e2e_sub_mode.js:39` |
| `captureOptionalScreenshot` | Function | `packaging/e2e_sub_mode.js:48` |
| `getPage` | Function | `packaging/e2e_sub_mode.js:65` |
| `connect` | Function | `packaging/e2e_sub_mode.js:77` |
| `if` | Function | `packaging/e2e_sub_mode.js:83` |
| `close` | Function | `packaging/e2e_sub_mode.js:105` |
| `evaluate` | Function | `packaging/e2e_sub_mode.js:112` |
| `waitFor` | Function | `packaging/e2e_sub_mode.js:122` |
| `while` | Function | `packaging/e2e_sub_mode.js:125` |
| `waitForJson` | Function | `packaging/e2e_sub_mode.js:133` |
| `while` | Function | `packaging/e2e_sub_mode.js:136` |
| `clickButton` | Function | `packaging/e2e_sub_mode.js:148` |
| `cleanup` | Function | `packaging/e2e_sub_mode.js:160` |
| `if` | Function | `packaging/e2e_sub_mode.js:248` |
| `if` | Function | `packaging/e2e_sub_mode.js:744` |
| `parse_args` | Function | `packaging/set_windows_exe_icon.py:10` |
| `main` | Function | `packaging/set_windows_exe_icon.py:19` |

## ファイル一覧

- `gui/src/components/BoundaryRefinementDialog.tsx`
- `gui/src/components/SubModePanel.tsx`
- `gui/src/lib/waveformSessionCache.test.ts`
- `native/windows_font_resolver/src/scut_windows_font_resolver.cpp`
- `packaging/e2e_all_subtitle_effects.py`
- `packaging/e2e_sub_mode.js`
- `packaging/set_windows_exe_icon.py`
- `songcut/__init__.py`
- `songcut/api.py`
- `songcut/boundary_refiner.py`
- `songcut/cli.py`
- `songcut/evaluate.py`
- `songcut/features.py`
- `songcut/ffmpeg_process.py`
- `songcut/ffmpeg_tools.py`
- `songcut/gui_pipeline.py`
- `songcut/guide.py`
- `songcut/hardware.py`
- `songcut/io.py`
- `songcut/lyrics_alignment.py`
- `songcut/metadata.py`
- `songcut/mms_alignment.py`
- `songcut/review.py`
- `songcut/rhythm_alignment.py`
- `songcut/scratch_proxy.py`
- `songcut/segmenter.py`
- `songcut/smart_export.py`
- `songcut/source_separation.py`
- `songcut/subtitle_effect_catalog.py`
- `songcut/subtitle_export.py`
- `songcut/timestamps.py`
- `songcut/transcription.py`
- `songcut/uta_alignment.py`
- `songcut/waveform.py`
- `songcut/whisper_execution.py`
- `songcut/windows_font_native.py`
- `songcut/windows_font_resolver.py`
- `songcut/youtube_metadata.py`
- `songcut_cli.py`
- `tests/test_boundary_refiner.py`
- `tests/test_cli_integration.py`
- `tests/test_evaluate.py`
- `tests/test_ffmpeg_process.py`
- `tests/test_ffmpeg_tools.py`
- `tests/test_hardware.py`
- `tests/test_lyrics_alignment.py`
- `tests/test_timestamps.py`
- `tests/test_transcription.py`
- `tests/test_whisper_execution.py`
- `tests/test_windows_font_native.py`
- `tests/test_windows_font_resolver.py`
<!-- code-map:generated:end -->
