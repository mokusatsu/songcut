<!-- code-map:generated:start -->
## 変更時に注意すべき箇所

hub scoreは参照・呼出の集中、bridge scoreはcomponent境界上の媒介性を示す静的指標です。高得点だけで設計不良とは判断しません。

| シンボル | 種別 | Hub | Bridge | In／Out | テスト対応 | 根拠 |
|---|---|---:|---:|---:|---|---|
| `patch` | Function | 1008.4 | 706.7 | 434／1 | あり | `gui/src/components/SubModePanel.tsx:563` |
| `get` | Function | 858.8 | 761.5 | 370／3 | あり | `gui/src/lib/waveformSessionCache.ts:92` |
| `tr` | Function | 892.2 | 126.8 | 415／0 | あり | `gui/src/i18n.ts:510` |
| `parse_lyrics_text` | Function | 538.1 | 2.6 | 230／2 | あり | `third_party/uta_align/src/uta_align/lyrics.py:9` |
| `assertPass` | Function | 258.0 | 0.1 | 120／0 | 未確認 | `packaging/e2e_dist_smoke.js:183` |
| `align_lyrics` | Function | 227.1 | 29.1 | 62／50 | あり | `third_party/uta_align/src/uta_align/pipeline.py:1239` |
| `log` | Function | 232.2 | 0.1 | 108／0 | 未確認 | `packaging/e2e_dist_smoke.js:35` |
| `evaluate` | Function | 205.7 | 0.1 | 95／1 | 未確認 | `packaging/e2e_dist_smoke.js:123` |
| `waitFor` | Function | 193.5 | 0.1 | 90／0 | 未確認 | `packaging/e2e_dist_smoke.js:135` |
| `time` | Function | 111.2 | 77.6 | 48／0 | あり | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `_stage_four` | Function | 155.8 | 22.5 | 49／25 | あり | `third_party/uta_align/src/uta_align/fallback.py:2281` |
| `JobRecord` | Class | 95.8 | 81.3 | 41／0 | あり | `songcut/api.py:284` |
| `parse_guide_text` | Function | 90.3 | 66.5 | 35／5 | あり | `songcut/guide.py:56` |
| `assertPass` | Function | 152.7 | 0.1 | 71／0 | 未確認 | `packaging/e2e_sub_mode.js:31` |
| `select_global_lattice` | Function | 134.6 | 15.1 | 41／23 | あり | `third_party/uta_align/src/uta_align/lattice.py:819` |
| `runShortcutChecks` | Function | 139.3 | 0.1 | 1／98 | 未確認 | `packaging/e2e_dist_smoke.js:671` |
| `stringValue` | Function | 133.3 | 5.9 | 62／0 | 未確認 | `gui/electron/project-schema.ts:792` |
| `build_guided_exports` | Function | 79.6 | 56.5 | 29／7 | あり | `songcut/guide.py:134` |
| `FakeBackend` | Class | 130.2 | 1.6 | 56／0 | あり | `third_party/uta_align/src/uta_align/backends.py:126` |
| `build_rhythm_grid.add` | Function | 69.2 | 54.6 | 29／2 | あり | `songcut/rhythm_alignment.py:143` |
| `update_job` | Function | 109.4 | 13.3 | 42／3 | あり | `songcut/api.py:653` |
| `put` | Function | 36.5 | 85.5 | 15／3 | あり | `gui/src/lib/waveformSessionCache.ts:75` |
| `resolve_windows_font` | Function | 68.3 | 52.4 | 25／6 | あり | `songcut/windows_font_resolver.py:653` |
| `assertProjectDocument` | Function | 114.2 | 5.9 | 29／37 | あり | `gui/electron/project-schema.ts:354` |
| `evaluate` | Function | 119.7 | 0.1 | 55／1 | 未確認 | `packaging/e2e_sub_mode.js:112` |
| `SubtitleStyle` | Class | 58.3 | 49.1 | 25／0 | あり | `songcut/subtitle_export.py:31` |
| `median` | Function | 49.1 | 58.1 | 21／0 | 未確認 | `gui/src/lib/subtitles.ts:660` |
| `SmartRenderSpan` | Class | 61.1 | 44.0 | 26／0 | あり | `songcut/smart_export.py:64` |
| `size` | Function | 23.6 | 79.5 | 11／0 | あり | `gui/src/lib/waveformSessionCache.ts:127` |
| `clear` | Function | 32.1 | 69.5 | 14／0 | あり | `gui/src/lib/waveformSessionCache.ts:123` |

## Knowledge gap

- Python ASTの構文エラーは検出されませんでした。
- ヒューリスティック解析を使う言語: javascript 3件、powershell 1件、typescript 125件。call edgeや関数境界には推定が含まれます。
- reflection、DIコンテナ、設定ファイルからの型・関数選択、コード生成後の実体は完全には解決できません。
<!-- code-map:generated:end -->
