# コード解析地図：packaging

<!-- code-map:generated:start -->
## 概要

Windows 配布物の構築、パッケージ済み GUI の E2E スモーク検証、字幕フレーム評価などを担う配布・検証補助。

## 指標

- Files: 6
- Symbols: 88
- Incoming／Outgoing: 1／8
- Cohesion: 0.00
- Node kinds: Class 7、File 6、Function 74、Test 1

## 代表パス

- `packaging/songcut_launcher_entry.py`
- `packaging/e2e_sub_mode.js`
- `packaging/evaluate_subtitle_frame.py`
- `packaging/e2e_scratch_proxy.js`
- `packaging/build_dist.ps1`

## 主なシンボル

| シンボル | 種別 | 根拠 |
|---|---|---|
| `Resolve-ToolPath` | Function | `packaging/build_dist.ps1:13` |
| `ConvertTo-ZipEntryName` | Function | `packaging/build_dist.ps1:43` |
| `transformers` | Class | `packaging/build_dist.ps1:385` |
| `pandas` | Class | `packaging/build_dist.ps1:387` |
| `PIL` | Class | `packaging/build_dist.ps1:389` |
| `pytest` | Class | `packaging/build_dist.ps1:391` |
| `torchaudio` | Class | `packaging/build_dist.ps1:393` |
| `openvino` | Class | `packaging/build_dist.ps1:395` |
| `openvino` | Class | `packaging/build_dist.ps1:397` |
| `Resolve-MSBuildPath` | Test | `packaging/build_native_font_resolver.ps1:21` |
| `log` | Function | `packaging/e2e_scratch_proxy.js:19` |
| `assertPass` | Function | `packaging/e2e_scratch_proxy.js:23` |
| `sleep` | Function | `packaging/e2e_scratch_proxy.js:27` |
| `createInputs` | Function | `packaging/e2e_scratch_proxy.js:31` |
| `for` | Function | `packaging/e2e_scratch_proxy.js:32` |
| `getPage` | Function | `packaging/e2e_scratch_proxy.js:62` |
| `connect` | Function | `packaging/e2e_scratch_proxy.js:74` |
| `if` | Function | `packaging/e2e_scratch_proxy.js:81` |
| `close` | Function | `packaging/e2e_scratch_proxy.js:95` |
| `evaluate` | Function | `packaging/e2e_scratch_proxy.js:102` |
| `waitFor` | Function | `packaging/e2e_scratch_proxy.js:108` |
| `while` | Function | `packaging/e2e_scratch_proxy.js:111` |
| `prepareRenderer` | Function | `packaging/e2e_scratch_proxy.js:119` |
| `clickLoad` | Function | `packaging/e2e_scratch_proxy.js:161` |
| `proxyState` | Function | `packaging/e2e_scratch_proxy.js:180` |
| `beginScratch` | Function | `packaging/e2e_scratch_proxy.js:202` |
| `moveScratch` | Function | `packaging/e2e_scratch_proxy.js:226` |
| `endScratch` | Function | `packaging/e2e_scratch_proxy.js:239` |
| `pressSpace` | Function | `packaging/e2e_scratch_proxy.js:250` |
| `assertScratchPlaybackRecovery` | Function | `packaging/e2e_scratch_proxy.js:267` |
| `assertOriginalScratch` | Function | `packaging/e2e_scratch_proxy.js:293` |
| `assertProxyScratch` | Function | `packaging/e2e_scratch_proxy.js:315` |
| `runCase` | Function | `packaging/e2e_scratch_proxy.js:338` |
| `if` | Function | `packaging/e2e_scratch_proxy.js:363` |
| `log` | Function | `packaging/e2e_sub_mode.js:38` |
| `assertPass` | Function | `packaging/e2e_sub_mode.js:44` |
| `sleep` | Function | `packaging/e2e_sub_mode.js:48` |
| `withTimeout` | Function | `packaging/e2e_sub_mode.js:52` |
| `captureOptionalScreenshot` | Function | `packaging/e2e_sub_mode.js:61` |
| `for` | Function | `packaging/e2e_sub_mode.js:64` |
| `getPage` | Function | `packaging/e2e_sub_mode.js:82` |
| `connect` | Function | `packaging/e2e_sub_mode.js:94` |
| `if` | Function | `packaging/e2e_sub_mode.js:100` |
| `close` | Function | `packaging/e2e_sub_mode.js:122` |
| `evaluate` | Function | `packaging/e2e_sub_mode.js:129` |
| `if` | Function | `packaging/e2e_sub_mode.js:135` |
| `waitFor` | Function | `packaging/e2e_sub_mode.js:142` |
| `while` | Function | `packaging/e2e_sub_mode.js:145` |
| `waitForJson` | Function | `packaging/e2e_sub_mode.js:153` |
| `while` | Function | `packaging/e2e_sub_mode.js:156` |
| `clickButton` | Function | `packaging/e2e_sub_mode.js:176` |
| `pressSpace` | Function | `packaging/e2e_sub_mode.js:188` |
| `cleanup` | Function | `packaging/e2e_sub_mode.js:205` |
| `prepareBoundaryDragProject` | Function | `packaging/e2e_sub_mode.js:218` |
| `sampleVideoFrame` | Function | `packaging/e2e_sub_mode.js:270` |
| `dragSubBoundary` | Function | `packaging/e2e_sub_mode.js:310` |
| `runSubBoundaryDragE2E` | Function | `packaging/e2e_sub_mode.js:411` |
| `for` | Function | `packaging/e2e_sub_mode.js:503` |
| `if` | Function | `packaging/e2e_sub_mode.js:563` |
| `if` | Function | `packaging/e2e_sub_mode.js:628` |
| `if` | Function | `packaging/e2e_sub_mode.js:713` |
| `if` | Function | `packaging/e2e_sub_mode.js:1310` |
| `extract_frame` | Function | `packaging/evaluate_subtitle_frame.py:14` |
| `weighted_bounds` | Function | `packaging/evaluate_subtitle_frame.py:38` |
| `weighted_bounds.quantile_bounds` | Function | `packaging/evaluate_subtitle_frame.py:42` |
| `weighted_centroid` | Function | `packaging/evaluate_subtitle_frame.py:55` |
| `cosine_similarity` | Function | `packaging/evaluate_subtitle_frame.py:61` |
| `main` | Function | `packaging/evaluate_subtitle_frame.py:68` |
| `main.global_bounds` | Function | `packaging/evaluate_subtitle_frame.py:140` |
| `_set_windows_dll_directory` | Function | `packaging/songcut_launcher_entry.py:28` |
| `spawn_external_process` | Function | `packaging/songcut_launcher_entry.py:39` |
| `distribution_root` | Function | `packaging/songcut_launcher_entry.py:59` |
| `configure_logging` | Function | `packaging/songcut_launcher_entry.py:65` |
| `configure_standard_streams` | Function | `packaging/songcut_launcher_entry.py:78` |
| `create_software_decoder_restart_request_path` | Function | `packaging/songcut_launcher_entry.py:89` |
| `consume_software_decoder_restart_args` | Function | `packaging/songcut_launcher_entry.py:94` |
| `redact_electron_args_for_logging` | Function | `packaging/songcut_launcher_entry.py:112` |
| `configure_environment` | Function | `packaging/songcut_launcher_entry.py:122` |
| `wait_for_health` | Function | `packaging/songcut_launcher_entry.py:138` |
| `show_startup_error` | Function | `packaging/songcut_launcher_entry.py:154` |

## ファイル一覧

- `packaging/build_dist.ps1`
- `packaging/build_native_font_resolver.ps1`
- `packaging/e2e_scratch_proxy.js`
- `packaging/e2e_sub_mode.js`
- `packaging/evaluate_subtitle_frame.py`
- `packaging/songcut_launcher_entry.py`
<!-- code-map:generated:end -->
