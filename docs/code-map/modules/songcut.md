# コード解析地図：songcut

<!-- code-map:generated:start -->
## 概要

FastAPI と CLI を入口に、動画・音声の解析、文字起こし、境界調整、波形生成、クリップ・字幕書き出しを提供する Python バックエンド。

## 指標

- Files: 47
- Symbols: 716
- Incoming／Outgoing: 61／67
- Cohesion: 0.76
- Node kinds: Class 81、File 47、Function 400、Method 66、Test 122

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
| `SubModePanel` | Function | `gui/src/components/SubModePanel.tsx:105` |
| `analyzeLyrics` | Function | `gui/src/components/SubModePanel.tsx:193` |
| `openLyricsDialog` | Function | `gui/src/components/SubModePanel.tsx:201` |
| `exportSubtitles` | Function | `gui/src/components/SubModePanel.tsx:214` |
| `addLane` | Function | `gui/src/components/SubModePanel.tsx:219` |
| `removeLane` | Function | `gui/src/components/SubModePanel.tsx:232` |
| `updateLane` | Function | `gui/src/components/SubModePanel.tsx:249` |
| `update` | Function | `gui/src/components/SubModePanel.tsx:437` |
| `patch` | Function | `gui/src/components/SubModePanel.tsx:528` |
| `patchEffect` | Function | `gui/src/components/SubModePanel.tsx:532` |
| `patchEffectParam` | Function | `gui/src/components/SubModePanel.tsx:536` |
| `saveStylePreset` | Function | `gui/src/components/SubModePanel.tsx:540` |
| `applyStylePreset` | Function | `gui/src/components/SubModePanel.tsx:558` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:693` |
| `if` | Function | `gui/src/components/SubModePanel.tsx:708` |
| `subtitleEffectLabel` | Function | `gui/src/components/SubModePanel.tsx:764` |
| `subtitleEffectParameterLabel` | Function | `gui/src/components/SubModePanel.tsx:771` |
| `subtitleEffectOptionLabel` | Function | `gui/src/components/SubModePanel.tsx:778` |
| `hasSubtitleSegments` | Function | `gui/src/components/SubModePanel.tsx:785` |
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
| `ProbeRequest` | Class | `songcut/api.py:82` |
| `BoundaryRefinementRequest` | Class | `songcut/api.py:86` |
| `BoundaryRefinementRequest.validate_hysteresis` | Method | `songcut/api.py:100` |
| `BoundaryRefinementRequest.to_config` | Method | `songcut/api.py:105` |
| `AnalyzeRequest` | Class | `songcut/api.py:111` |
| `WhisperDownloadRequest` | Class | `songcut/api.py:123` |
| `DemucsDownloadRequest` | Class | `songcut/api.py:127` |
| `MmsDownloadRequest` | Class | `songcut/api.py:131` |
| `TranscriptionSegmentRequest` | Class | `songcut/api.py:135` |
| `TranscriptionRequest` | Class | `songcut/api.py:141` |
| `ExportItem` | Class | `songcut/api.py:150` |
| `ExportRequest` | Class | `songcut/api.py:159` |
| `ExportPlanRequest` | Class | `songcut/api.py:167` |
| `ScratchProxyRequest` | Class | `songcut/api.py:172` |
| `WaveformRequest` | Class | `songcut/api.py:176` |
| `LyricsAnalysisRequest` | Class | `songcut/api.py:180` |
| `SubtitleStyleRequest` | Class | `songcut/api.py:191` |
| `SubtitleEffectRequest` | Class | `songcut/api.py:207` |
| `SubtitleSegmentRequest` | Class | `songcut/api.py:214` |
| `SubtitleSegmentRequest.validate_range` | Method | `songcut/api.py:223` |
| `SubtitleLaneRequest` | Class | `songcut/api.py:231` |
| `SubtitleExportRequest` | Class | `songcut/api.py:239` |
| `SubtitleRenderItemRequest` | Class | `songcut/api.py:247` |
| `SubtitleRenderRequest` | Class | `songcut/api.py:254` |
| `JobRecord` | Class | `songcut/api.py:260` |
| `health` | Function | `songcut/api.py:295` |
| `ffmpeg_check` | Function | `songcut/api.py:309` |
| `devices` | Function | `songcut/api.py:314` |
| `whisper_model_status` | Function | `songcut/api.py:326` |
| `download_whisper_model` | Function | `songcut/api.py:345` |
| `get_demucs_model_status` | Function | `songcut/api.py:355` |
| `download_demucs_model` | Function | `songcut/api.py:360` |
| `get_mms_model_status` | Function | `songcut/api.py:365` |
| `download_mms_model` | Function | `songcut/api.py:370` |
| `probe` | Function | `songcut/api.py:375` |
| `create_analysis_job` | Function | `songcut/api.py:393` |
| `create_waveform_job` | Function | `songcut/api.py:398` |

## ファイル一覧

- `gui/src/components/BoundaryRefinementDialog.tsx`
- `gui/src/components/SubModePanel.tsx`
- `gui/src/lib/waveformSessionCache.test.ts`
- `packaging/e2e_sub_mode.js`
- `packaging/set_windows_exe_icon.py`
- `songcut/__init__.py`
- `songcut/api.py`
- `songcut/ass_effects23/__init__.py`
- `songcut/ass_effects23/core.py`
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
- `songcut/subtitle_export.py`
- `songcut/timestamps.py`
- `songcut/transcription.py`
- `songcut/uta_alignment.py`
- `songcut/waveform.py`
- `songcut/whisper_execution.py`
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
- `third_party/ass-effects23/examples/generate_catalog.py`
<!-- code-map:generated:end -->
