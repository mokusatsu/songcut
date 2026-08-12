<!-- code-map:generated:start -->
## 変更時に注意すべき箇所

hub scoreは参照・呼出の集中、bridge scoreはcomponent境界上の媒介性を示す静的指標です。高得点だけで設計不良とは判断しません。

| シンボル | 種別 | Hub | Bridge | In／Out | テスト対応 | 根拠 |
|---|---|---:|---:|---:|---|---|
| `patch` | Function | 1008.4 | 706.0 | 434／1 | あり | `gui/src/components/SubModePanel.tsx:580` |
| `get` | Function | 882.3 | 780.3 | 380／3 | あり | `gui/src/lib/waveformSessionCache.ts:92` |
| `tr` | Function | 892.2 | 129.8 | 415／0 | あり | `gui/src/i18n.ts:510` |
| `parse_lyrics_text` | Function | 539.8 | 4.9 | 230／3 | あり | `third_party/uta_align/src/uta_align/lyrics.py:9` |
| `NativeFontCollector.enumerate` | Method | 248.9 | 121.3 | 98／11 | あり | `songcut/windows_font_native.py:395` |
| `assertPass` | Function | 260.1 | 0.1 | 121／0 | 未確認 | `packaging/e2e_dist_smoke.js:183` |
| `align_lyrics` | Function | 227.1 | 28.4 | 62／50 | あり | `third_party/uta_align/src/uta_align/pipeline.py:1239` |
| `log` | Function | 232.2 | 0.1 | 108／0 | 未確認 | `packaging/e2e_dist_smoke.js:35` |
| `size` | Function | 92.5 | 134.3 | 43／0 | あり | `gui/src/lib/waveformSessionCache.ts:127` |
| `evaluate` | Function | 207.8 | 0.1 | 96／1 | 未確認 | `packaging/e2e_dist_smoke.js:123` |
| `waitFor` | Function | 193.5 | 0.1 | 90／0 | 未確認 | `packaging/e2e_dist_smoke.js:135` |
| `time` | Function | 111.2 | 78.1 | 48／0 | あり | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `_stage_four` | Function | 157.3 | 24.2 | 49／26 | あり | `third_party/uta_align/src/uta_align/fallback.py:2281` |
| `JobRecord` | Class | 95.8 | 84.0 | 41／0 | あり | `songcut/api.py:285` |
| `assertPass` | Function | 169.8 | 0.1 | 79／0 | 未確認 | `packaging/e2e_sub_mode.js:31` |
| `parse_guide_text` | Function | 92.0 | 65.1 | 35／6 | あり | `songcut/guide.py:56` |
| `select_global_lattice` | Function | 137.8 | 19.0 | 41／25 | あり | `third_party/uta_align/src/uta_align/lattice.py:819` |
| `runShortcutChecks` | Function | 139.3 | 0.1 | 1／98 | 未確認 | `packaging/e2e_dist_smoke.js:671` |
| `stringValue` | Function | 133.3 | 5.8 | 62／0 | 未確認 | `gui/electron/project-schema.ts:792` |
| `build_guided_exports` | Function | 79.6 | 55.1 | 29／7 | あり | `songcut/guide.py:134` |
| `FakeBackend` | Class | 130.2 | 1.2 | 56／0 | あり | `third_party/uta_align/src/uta_align/backends.py:126` |
| `evaluate` | Function | 128.2 | 0.1 | 59／1 | 未確認 | `packaging/e2e_sub_mode.js:112` |
| `update_job` | Function | 109.4 | 16.0 | 42／3 | あり | `songcut/api.py:654` |
| `build_rhythm_grid.add` | Function | 69.2 | 53.5 | 29／2 | あり | `songcut/rhythm_alignment.py:143` |
| `put` | Function | 36.5 | 84.3 | 15／3 | あり | `gui/src/lib/waveformSessionCache.ts:75` |
| `assertProjectDocument` | Function | 114.2 | 5.8 | 29／37 | あり | `gui/electron/project-schema.ts:354` |
| `_resolve_candidate` | Function | 92.1 | 26.5 | 5／47 | あり | `songcut/windows_font_resolver.py:438` |
| `SubtitleStyle` | Class | 60.6 | 52.5 | 26／0 | あり | `songcut/subtitle_export.py:34` |
| `clear` | Function | 36.4 | 72.3 | 16／0 | あり | `gui/src/lib/waveformSessionCache.ts:123` |
| `SubtitleSegment` | Class | 58.4 | 48.5 | 25／0 | あり | `songcut/subtitle_export.py:51` |

## Knowledge gap

- Python ASTの構文エラーは検出されませんでした。
- ヒューリスティック解析を使う言語: c_cpp 3件、javascript 3件、powershell 2件、typescript 127件。call edgeや関数境界には推定が含まれます。
- reflection、DIコンテナ、設定ファイルからの型・関数選択、コード生成後の実体は完全には解決できません。
<!-- code-map:generated:end -->
