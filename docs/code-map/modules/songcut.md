# コード解析地図：songcut

<!-- code-map:generated:start -->
## 概要

FastAPI と CLI を入口に、動画・音声の解析、文字起こし、境界調整、波形生成、クリップ・字幕書き出しを提供する Python バックエンド。

## 指標

- Files: 46
- Symbols: 721
- Incoming／Outgoing: 61／71
- Cohesion: 0.72
- Node kinds: Class 88、File 46、Function 406、Method 59、Test 122

## 代表パス

- `songcut/api.py`
- `gui/src/components/SubModePanel.tsx`
- `songcut/transcription.py`
- `songcut/subtitle_export.py`
- `songcut/smart_export.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `time` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `nullableTime` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:72` |
| `db` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:73` |
| `SubModePanel` | Function | `gui/src/components/SubModePanel.tsx:113` |
| `analyzeLyrics` | Function | `gui/src/components/SubModePanel.tsx:210` |
| `openLyricsDialog` | Function | `gui/src/components/SubModePanel.tsx:218` |
| `exportSubtitles` | Function | `gui/src/components/SubModePanel.tsx:231` |
| `addLane` | Function | `gui/src/components/SubModePanel.tsx:236` |
| `removeLane` | Function | `gui/src/components/SubModePanel.tsx:249` |
| `updateLane` | Function | `gui/src/components/SubModePanel.tsx:266` |
| `update` | Function | `gui/src/components/SubModePanel.tsx:463` |
| `patch` | Function | `gui/src/components/SubModePanel.tsx:563` |
| `patchEffect` | Function | `gui/src/components/SubModePanel.tsx:567` |
| `patchEffectParam` | Function | `gui/src/components/SubModePanel.tsx:571` |
| `saveStylePreset` | Function | `gui/src/components/SubModePanel.tsx:575` |
| `applyStylePreset` | Function | `gui/src/components/SubModePanel.tsx:593` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:600` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:747` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:766` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:778` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:795` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:808` |
| `colorPickerValue` | Function | `gui/src/components/SubModePanel.tsx:903` |
| `colorPickerResult` | Function | `gui/src/components/SubModePanel.tsx:910` |
| `effectLabel` | Function | `gui/src/components/SubModePanel.tsx:918` |
| `effectDescription` | Function | `gui/src/components/SubModePanel.tsx:923` |
| `parameterLabel` | Function | `gui/src/components/SubModePanel.tsx:928` |
| `parameterDescription` | Function | `gui/src/components/SubModePanel.tsx:933` |
| `choiceValueForUi` | Function | `gui/src/components/SubModePanel.tsx:938` |
| `readChoiceValue` | Function | `gui/src/components/SubModePanel.tsx:943` |
| `choiceLabel` | Function | `gui/src/components/SubModePanel.tsx:950` |
| `clampCatalogNumber` | Function | `gui/src/components/SubModePanel.tsx:957` |
| `groupEffectDefinitions` | Function | `gui/src/components/SubModePanel.tsx:966` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:968` |
| `findSubtitleEffectError` | Function | `gui/src/components/SubModePanel.tsx:995` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:996` |
| `for` | Function | `gui/src/components/SubModePanel.tsx:1002` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:1017` |
| `hasSubtitleSegments` | Function | `gui/src/components/SubModePanel.tsx:1024` |
| `samplePoints` | Test | `gui/src/lib/waveformSessionCache.test.ts:99` |
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
| `ProbeRequest` | Class | `songcut/api.py:89` |
| `BoundaryRefinementRequest` | Class | `songcut/api.py:93` |
| `BoundaryRefinementRequest.validate_hysteresis` | Method | `songcut/api.py:107` |
| `BoundaryRefinementRequest.to_config` | Method | `songcut/api.py:112` |
| `AnalyzeRequest` | Class | `songcut/api.py:118` |
| `WhisperDownloadRequest` | Class | `songcut/api.py:130` |
| `DemucsDownloadRequest` | Class | `songcut/api.py:134` |
| `MmsDownloadRequest` | Class | `songcut/api.py:138` |
| `TranscriptionSegmentRequest` | Class | `songcut/api.py:142` |
| `TranscriptionRequest` | Class | `songcut/api.py:148` |
| `ExportItem` | Class | `songcut/api.py:157` |
| `ExportRequest` | Class | `songcut/api.py:166` |
| `ExportPlanRequest` | Class | `songcut/api.py:174` |
| `ScratchProxyRequest` | Class | `songcut/api.py:179` |
| `WaveformRequest` | Class | `songcut/api.py:183` |
| `LyricsAnalysisRequest` | Class | `songcut/api.py:187` |
| `SubtitleStyleRequest` | Class | `songcut/api.py:198` |
| `SubtitleEffectRequest` | Class | `songcut/api.py:214` |
| `SubtitleEffectRequest.validate_and_normalize_params` | Method | `songcut/api.py:221` |
| `SubtitleEffectEstimateRequest` | Class | `songcut/api.py:231` |

## ファイル一覧

- `gui/src/components/BoundaryRefinementDialog.tsx`
- `gui/src/components/SubModePanel.tsx`
- `gui/src/lib/waveformSessionCache.test.ts`
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
<!-- code-map:generated:end -->
