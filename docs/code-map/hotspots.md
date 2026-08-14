<!-- code-map:generated:start -->
## 変更時に注意すべき箇所

hub scoreは参照・呼出の集中、bridge scoreはcomponent境界上の媒介性を示す静的指標です。高得点だけで設計不良とは判断しません。

| シンボル | 種別 | Hub | Bridge | In／Out | テスト対応 | 根拠 |
|---|---|---:|---:|---:|---|---|
| `patch` | Function | 1092.0 | 188.4 | 470／1 | あり | `gui/src/components/SubtitleStyleEditor.tsx:85` |
| `tr` | Function | 894.4 | 91.4 | 416／0 | あり | `gui/src/i18n.ts:673` |
| `parse_lyrics_text` | Function | 539.8 | 5.2 | 230／3 | あり | `third_party/uta_align/src/uta_align/lyrics.py:9` |
| `NativeFontCollector.enumerate` | Method | 337.9 | 142.3 | 136／11 | あり | `songcut/windows_font_native.py:395` |
| `assertPass` | Function | 273.1 | 0.4 | 127／0 | 未確認 | `packaging/e2e_dist_smoke.js:189` |
| `assertPass` | Function | 247.2 | 0.0 | 115／0 | 未確認 | `packaging/e2e_sub_mode.js:44` |
| `log` | Function | 240.8 | 0.4 | 112／0 | 未確認 | `packaging/e2e_dist_smoke.js:41` |
| `evaluate` | Function | 220.7 | 0.4 | 102／1 | 未確認 | `packaging/e2e_dist_smoke.js:129` |
| `align_lyrics` | Function | 207.8 | 6.3 | 62／38 | あり | `third_party/uta_align/src/uta_align/pipeline.py:1239` |
| `size` | Function | 92.5 | 104.5 | 43／0 | あり | `gui/src/lib/waveformSessionCache.ts:127` |
| `evaluate` | Function | 194.9 | 0.0 | 90／1 | 未確認 | `packaging/e2e_sub_mode.js:129` |
| `waitFor` | Function | 191.3 | 0.4 | 89／0 | 未確認 | `packaging/e2e_dist_smoke.js:141` |
| `LyricsArtifactCache.get` | Method | 158.4 | 26.3 | 66／1 | あり | `songcut/lyrics_artifact_cache.py:374` |
| `build_rhythm_grid.add` | Function | 93.8 | 85.4 | 41／1 | あり | `songcut/rhythm_alignment.py:143` |
| `SubtitleStyleEditor` | Function | 82.6 | 96.4 | 0／59 | 未確認 | `gui/src/components/SubtitleStyleEditor.tsx:70` |
| `stringValue` | Function | 163.4 | 6.1 | 76／0 | 未確認 | `gui/electron/project-schema.ts:1018` |
| `clear` | Function | 86.9 | 82.5 | 38／0 | あり | `gui/src/lib/waveformSessionCache.ts:123` |
| `parse_guide_text` | Function | 92.0 | 65.0 | 35／6 | あり | `songcut/guide.py:56` |
| `SubtitleStyle` | Class | 83.9 | 72.0 | 36／0 | あり | `songcut/subtitle_export.py:34` |
| `_stage_four` | Function | 142.9 | 6.5 | 49／17 | あり | `third_party/uta_align/src/uta_align/fallback.py:2281` |
| `SubtitleSegment` | Class | 79.5 | 64.0 | 34／0 | あり | `songcut/subtitle_export.py:51` |
| `runShortcutChecks` | Function | 142.2 | 0.4 | 1／100 | 未確認 | `packaging/e2e_dist_smoke.js:722` |
| `select_global_lattice` | Function | 131.3 | 11.0 | 41／21 | あり | `third_party/uta_align/src/uta_align/lattice.py:819` |
| `median` | Function | 56.2 | 83.7 | 24／0 | 未確認 | `gui/src/lib/subtitles.ts:934` |
| `createLyricsLane` | Function | 96.0 | 37.7 | 44／1 | あり | `gui/src/lib/subtitles.ts:378` |
| `time` | Function | 129.9 | 3.7 | 56／0 | あり | `gui/src/components/BoundaryRefinementDialog.tsx:71` |
| `validateSubtitleState` | Function | 121.5 | 10.1 | 35／33 | あり | `gui/electron/project-schema.ts:625` |
| `build_guided_exports` | Function | 78.0 | 53.0 | 29／6 | あり | `songcut/guide.py:134` |
| `JobRecord` | Class | 114.8 | 15.9 | 49／0 | あり | `songcut/api.py:495` |
| `FakeBackend` | Class | 130.2 | 0.2 | 56／0 | あり | `third_party/uta_align/src/uta_align/backends.py:126` |

## Knowledge gap

- Python ASTの構文エラーは検出されませんでした。
- ヒューリスティック解析を使う言語: c_cpp 3件、javascript 3件、powershell 2件、typescript 171件。call edgeや関数境界には推定が含まれます。
- reflection、DIコンテナ、設定ファイルからの型・関数選択、コード生成後の実体は完全には解決できません。
<!-- code-map:generated:end -->
