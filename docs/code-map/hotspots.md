<!-- code-map:generated:start -->
## 変更時に注意すべき箇所

hub scoreは参照・呼出の集中、bridge scoreはcomponent境界上の媒介性を示す静的指標です。高得点だけで設計不良とは判断しません。

| シンボル | 種別 | Hub | Bridge | In／Out | テスト対応 | 根拠 |
|---|---|---:|---:|---:|---|---|
| `patch` | Function | 1092.0 | 198.8 | 470／1 | あり | `gui/src/components/SubtitleStyleEditor.tsx:85` |
| `tr` | Function | 924.5 | 93.9 | 430／0 | あり | `gui/src/i18n.ts:679` |
| `NativeFontCollector.enumerate` | Method | 401.1 | 282.8 | 163／11 | あり | `songcut/windows_font_native.py:395` |
| `parse_lyrics_text` | Function | 539.8 | 5.0 | 230／3 | あり | `third_party/uta_align/src/uta_align/lyrics.py:9` |
| `assertPass` | Function | 273.1 | 0.3 | 127／0 | 未確認 | `packaging/e2e_dist_smoke.js:189` |
| `assertPass` | Function | 247.2 | 0.0 | 115／0 | 未確認 | `packaging/e2e_sub_mode.js:44` |
| `log` | Function | 240.8 | 0.3 | 112／0 | 未確認 | `packaging/e2e_dist_smoke.js:41` |
| `evaluate` | Function | 220.7 | 0.3 | 102／1 | 未確認 | `packaging/e2e_dist_smoke.js:129` |
| `align_lyrics` | Function | 207.8 | 5.8 | 62／38 | あり | `third_party/uta_align/src/uta_align/pipeline.py:1239` |
| `split_display_elements` | Function | 117.6 | 85.9 | 43／10 | あり | `songcut/lyrics_elements.py:421` |
| `evaluate` | Function | 194.9 | 0.0 | 90／1 | 未確認 | `packaging/e2e_sub_mode.js:129` |
| `waitFor` | Function | 191.3 | 0.3 | 89／0 | 未確認 | `packaging/e2e_dist_smoke.js:141` |
| `size` | Function | 92.5 | 94.7 | 43／0 | あり | `gui/src/lib/waveformSessionCache.ts:127` |
| `LyricsArtifactCache.get` | Method | 158.4 | 26.2 | 66／1 | あり | `songcut/lyrics_artifact_cache.py:374` |
| `build_rhythm_grid.add` | Function | 93.8 | 83.5 | 41／1 | あり | `songcut/rhythm_alignment.py:143` |
| `SubtitleStyleEditor` | Function | 82.6 | 90.8 | 0／59 | 未確認 | `gui/src/components/SubtitleStyleEditor.tsx:70` |
| `stringValue` | Function | 163.4 | 7.2 | 76／0 | 未確認 | `gui/electron/project-schema.ts:1018` |
| `SubtitleStyle` | Class | 88.5 | 79.7 | 38／0 | あり | `songcut/subtitle_export.py:34` |
| `createLyricsLane` | Function | 117.5 | 45.8 | 54／1 | あり | `gui/src/lib/subtitles.ts:388` |
| `clear` | Function | 86.9 | 72.7 | 38／0 | あり | `gui/src/lib/waveformSessionCache.ts:123` |
| `parse_guide_text` | Function | 92.0 | 67.6 | 35／6 | あり | `songcut/guide.py:56` |
| `median` | Function | 60.9 | 95.8 | 26／0 | 未確認 | `gui/src/lib/subtitles.ts:1010` |
| `_stage_four` | Function | 142.9 | 6.3 | 49／17 | あり | `third_party/uta_align/src/uta_align/fallback.py:2281` |
| `SubtitleSegment` | Class | 79.5 | 67.7 | 34／0 | あり | `songcut/subtitle_export.py:51` |
| `runShortcutChecks` | Function | 142.2 | 0.3 | 1／100 | 未確認 | `packaging/e2e_dist_smoke.js:722` |
| `select_global_lattice` | Function | 131.3 | 10.9 | 41／21 | あり | `third_party/uta_align/src/uta_align/lattice.py:819` |
| `SubtitleLane` | Class | 76.4 | 63.7 | 32／1 | あり | `songcut/subtitle_export.py:85` |
| `align_display_elements` | Function | 81.2 | 53.9 | 23／16 | あり | `songcut/lyrics_elements.py:950` |
| `validateSubtitleState` | Function | 121.5 | 11.2 | 35／33 | あり | `gui/electron/project-schema.ts:625` |
| `JobRecord` | Class | 114.8 | 17.8 | 49／0 | あり | `songcut/api.py:495` |

## Knowledge gap

- Python ASTの構文エラーは検出されませんでした。
- ヒューリスティック解析を使う言語: c_cpp 3件、javascript 3件、powershell 2件、typescript 173件。call edgeや関数境界には推定が含まれます。
- reflection、DIコンテナ、設定ファイルからの型・関数選択、コード生成後の実体は完全には解決できません。
<!-- code-map:generated:end -->
