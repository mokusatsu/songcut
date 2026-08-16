# コード解析地図：songcut

<!-- code-map:generated:start -->
## 概要

FastAPI と CLI を入口に、動画・音声の解析、文字起こし、境界調整、波形生成、クリップ・字幕書き出しを提供する Python バックエンド。

## 指標

- Files: 57
- Symbols: 945
- Incoming／Outgoing: 68／73
- Cohesion: 0.88
- Node kinds: Class 113、File 57、Function 446、Method 93、Test 236

## 代表パス

- `songcut/api.py`
- `tests/test_api.py`
- `gui/src/components/SubtitleStyleEditor.tsx`
- `songcut/subtitle_export.py`
- `songcut/transcription.py`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `time` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `nullableTime` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:72` |
| `db` | Function | `gui/src/components/BoundaryRefinementDialog.tsx:73` |
| `SubtitleStyleEditor` | Function | `gui/src/components/SubtitleStyleEditor.tsx:70` |
| `patch` | Function | `gui/src/components/SubtitleStyleEditor.tsx:85` |
| `patchEffect` | Function | `gui/src/components/SubtitleStyleEditor.tsx:89` |
| `patchEffectParam` | Function | `gui/src/components/SubtitleStyleEditor.tsx:93` |
| `saveStylePreset` | Function | `gui/src/components/SubtitleStyleEditor.tsx:97` |
| `applyStylePreset` | Function | `gui/src/components/SubtitleStyleEditor.tsx:115` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:122` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:277` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:295` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:306` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:330` |
| `if` | Function | `gui/src/components/SubtitleStyleEditor.tsx:342` |
| `replacePaletteColor` | Function | `gui/src/components/SubtitleStyleEditor.tsx:425` |
| `colorPickerValue` | Function | `gui/src/components/SubtitleStyleEditor.tsx:452` |
| `colorPickerResult` | Function | `gui/src/components/SubtitleStyleEditor.tsx:459` |
| `effectLabel` | Function | `gui/src/components/SubtitleStyleEditor.tsx:467` |
| `effectDescription` | Function | `gui/src/components/SubtitleStyleEditor.tsx:472` |
| `parameterLabel` | Function | `gui/src/components/SubtitleStyleEditor.tsx:477` |
| `choiceValueForUi` | Function | `gui/src/components/SubtitleStyleEditor.tsx:482` |
| `readChoiceValue` | Function | `gui/src/components/SubtitleStyleEditor.tsx:487` |
| `choiceLabel` | Function | `gui/src/components/SubtitleStyleEditor.tsx:494` |
| `clampCatalogNumber` | Function | `gui/src/components/SubtitleStyleEditor.tsx:501` |
| `groupEffectDefinitions` | Function | `gui/src/components/SubtitleStyleEditor.tsx:510` |
| `for` | Function | `gui/src/components/SubtitleStyleEditor.tsx:512` |
| `parse_args` | Function | `packaging/set_windows_exe_icon.py:10` |
| `main` | Function | `packaging/set_windows_exe_icon.py:19` |
| `ProbeRequest` | Class | `songcut/api.py:109` |
| `BoundaryRefinementRequest` | Class | `songcut/api.py:113` |
| `BoundaryRefinementRequest.validate_hysteresis` | Method | `songcut/api.py:127` |
| `BoundaryRefinementRequest.to_config` | Method | `songcut/api.py:132` |
| `AnalyzeRequest` | Class | `songcut/api.py:138` |
| `WhisperDownloadRequest` | Class | `songcut/api.py:150` |
| `DemucsDownloadRequest` | Class | `songcut/api.py:154` |
| `MmsDownloadRequest` | Class | `songcut/api.py:158` |
| `TranscriptionSegmentRequest` | Class | `songcut/api.py:162` |
| `TranscriptionRequest` | Class | `songcut/api.py:168` |
| `ExportItem` | Class | `songcut/api.py:177` |
| `ExportRequest` | Class | `songcut/api.py:186` |
| `ExportPlanRequest` | Class | `songcut/api.py:194` |
| `ScratchProxyRequest` | Class | `songcut/api.py:199` |
| `WaveformRequest` | Class | `songcut/api.py:203` |
| `LyricsAnalysisRequest` | Class | `songcut/api.py:207` |
| `SourceFingerprintRequest` | Class | `songcut/api.py:218` |
| `DisplayElementRequest` | Class | `songcut/api.py:223` |
| `DisplayElementRequest.validate_element` | Method | `songcut/api.py:251` |
| `DisplayElementRequest.to_display_element` | Method | `songcut/api.py:258` |
| `LyricsLineSnapshotRequest` | Class | `songcut/api.py:262` |
| `LyricsLineSnapshotRequest.validate_line` | Method | `songcut/api.py:278` |
| `LyricsLineContextRequest` | Class | `songcut/api.py:305` |
| `LyricsLineContextRequest.validate_line` | Method | `songcut/api.py:313` |
| `LyricsLineAnalysisRequest` | Class | `songcut/api.py:319` |
| `LyricsLineAnalysisRequest.validate_revisions` | Method | `songcut/api.py:333` |
| `SubtitleStyleRequest` | Class | `songcut/api.py:341` |
| `SubtitleEffectRequest` | Class | `songcut/api.py:357` |
| `SubtitleEffectRequest.validate_and_normalize_params` | Method | `songcut/api.py:364` |
| `SubtitleEffectEstimateRequest` | Class | `songcut/api.py:374` |
| `SubtitleSegmentRequest` | Class | `songcut/api.py:381` |
| `SubtitleSegmentRequest.validate_range` | Method | `songcut/api.py:390` |
| `SubtitleLaneRequest` | Class | `songcut/api.py:398` |
| `SubtitleExportRequest` | Class | `songcut/api.py:406` |
| `SubtitleFileDisplayElementRequest` | Class | `songcut/api.py:414` |
| `SubtitleFileDisplayElementRequest.validate_range` | Method | `songcut/api.py:422` |
| `SubtitleFileSegmentRequest` | Class | `songcut/api.py:428` |
| `SubtitleFileSegmentRequest.validate_range_and_elements` | Method | `songcut/api.py:440` |
| `SubtitleFileLaneRequest` | Class | `songcut/api.py:455` |
| `SubtitleFileExportRequest` | Class | `songcut/api.py:465` |
| `SubtitleFileExportRequest.validate_nonempty_lanes` | Method | `songcut/api.py:476` |
| `SubtitleRenderItemRequest` | Class | `songcut/api.py:482` |
| `SubtitleRenderRequest` | Class | `songcut/api.py:489` |
| `JobRecord` | Class | `songcut/api.py:495` |
| `_get_lyrics_artifact_cache` | Function | `songcut/api.py:541` |
| `_lyrics_artifact_payload` | Function | `songcut/api.py:550` |
| `health` | Function | `songcut/api.py:570` |
| `get_subtitle_effect_catalog` | Function | `songcut/api.py:584` |
| `estimate_subtitle_effect` | Function | `songcut/api.py:597` |
| `ffmpeg_check` | Function | `songcut/api.py:616` |
| `devices` | Function | `songcut/api.py:621` |

## ファイル一覧

- `gui/src/components/BoundaryRefinementDialog.tsx`
- `gui/src/components/SubtitleStyleEditor.tsx`
- `packaging/set_windows_exe_icon.py`
- `packaging/songcut_api_entry.py`
- `songcut/__init__.py`
- `songcut/api.py`
- `songcut/boundary_refiner.py`
- `songcut/cli.py`
- `songcut/element_reconciliation.py`
- `songcut/evaluate.py`
- `songcut/features.py`
- `songcut/ffmpeg_process.py`
- `songcut/ffmpeg_tools.py`
- `songcut/gui_pipeline.py`
- `songcut/guide.py`
- `songcut/hardware.py`
- `songcut/io.py`
- `songcut/lyrics_alignment.py`
- `songcut/lyrics_artifact_cache.py`
- `songcut/lyrics_elements.py`
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
- `tests/test_api.py`
- `tests/test_boundary_refiner.py`
- `tests/test_cli_integration.py`
- `tests/test_element_reconciliation.py`
- `tests/test_evaluate.py`
- `tests/test_ffmpeg_process.py`
- `tests/test_ffmpeg_tools.py`
- `tests/test_gui_pipeline.py`
- `tests/test_hardware.py`
- `tests/test_lyrics_alignment.py`
- `tests/test_lyrics_line_api.py`
- `tests/test_review.py`
- `tests/test_scratch_proxy.py`
- `tests/test_timestamps.py`
- `tests/test_transcription.py`
- `tests/test_uta_alignment.py`
- `tests/test_waveform.py`
- `tests/test_whisper_execution.py`
- `tests/test_windows_font_native.py`
<!-- code-map:generated:end -->
