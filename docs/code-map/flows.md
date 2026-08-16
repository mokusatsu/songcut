<!-- code-map:generated:start -->
## 代表フロー

以下は静的call edgeから得た代表経路です。実行時に必ずこの順で通ることを保証するものではありません。

### 1. `exportClips`

- Flow ID: `flow_87f310366eafeed8`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1920`の`exportClips`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `exportClips` | Function | `gui/src/App.tsx:1920` |
| 2 | `localizeFilenameTemplateError` | Function | `gui/src/i18n.ts:698` |
| 3 | `tr` | Function | `gui/src/i18n.ts:679` |

### 2. `if`

- Flow ID: `flow_a42879ed63f86fd1`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2371`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:2371` |
| 2 | `tr` | Function | `gui/src/i18n.ts:679` |

### 3. `moveSelectedSubtitleSegments`

- Flow ID: `flow_452779c9b05a3c29`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2364`の`moveSelectedSubtitleSegments`
- エージェント確認メモ: 選択中のSubセグメントを既存のLyricsLaneへ一括移動する入口。移動先がない、選択がない、同一Timelineだけ、または時刻範囲が重複する場合は状態を変えず拒否し、成功時のみ対象レーンを更新する。

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `moveSelectedSubtitleSegments` | Function | `gui/src/App.tsx:2364` |
| 2 | `tr` | Function | `gui/src/i18n.ts:679` |

### 4. `if`

- Flow ID: `flow_acbaab781455b14f`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2004`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:2004` |
| 2 | `tr` | Function | `gui/src/i18n.ts:679` |

### 5. `checkRecoveryOnStartup`

- Flow ID: `flow_4d28b202844b5aa9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1324`の`checkRecoveryOnStartup`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `checkRecoveryOnStartup` | Function | `gui/src/App.tsx:1324` |
| 2 | `loadRecovery` | Function | `gui/electron/project-store.ts:78` |
| 3 | `assertRecoverySnapshot` | Function | `gui/electron/project-schema.ts:567` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:423` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:1018` |

### 6. `if`

- Flow ID: `flow_63d1ded3cc9750ae`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1096`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1096` |
| 2 | `loadProjectPath` | Function | `gui/src/App.tsx:1620` |
| 3 | `parseProjectOpenResult` | Function | `gui/src/lib/project.ts:194` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:423` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:1018` |

### 7. `listener`

- Flow ID: `flow_c6228872ba7b1bb9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:567`の`listener`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `listener` | Function | `gui/src/App.tsx:567` |
| 2 | `FakeEventTarget.addEventListener` | Test | `gui/src/lib/useBoundaryDrag.test.ts:16` |
| 3 | `build_rhythm_grid.add` | Function | `songcut/rhythm_alignment.py:143` |
| 4 | `RhythmGridPoint` | Class | `songcut/rhythm_alignment.py:19` |

### 8. `send`

- Flow ID: `flow_0da193a90ef9fbb2`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:461`の`send`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `send` | Function | `gui/electron/main.ts:461` |
| 2 | `send` | External | `外部I/O` |

### 9. `atomicWriteJson`

- Flow ID: `flow_3e50ab519c941b42`
- 信頼度: 推定
- 入口: `gui/electron/project-store.ts:176`の`atomicWriteJson`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `atomicWriteJson` | Function | `gui/electron/project-store.ts:176` |
| 2 | `readJsonLimited` | Function | `gui/electron/project-store.ts:214` |
| 3 | `readTextLimited` | Function | `gui/electron/project-store.ts:218` |
| 4 | `readFile` | External | `外部I/O` |

### 10. `disposeScratchProxy`

- Flow ID: `flow_c0b2c273a3209c57`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1842`の`disposeScratchProxy`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `disposeScratchProxy` | Function | `gui/src/App.tsx:1842` |
| 2 | `finishScratchPreview` | Function | `gui/src/App.tsx:2670` |
| 3 | `cancelScratchPreview` | Function | `gui/src/App.tsx:2647` |
| 4 | `pauseMedia` | Function | `gui/src/App.tsx:2612` |
| 5 | `pause` | Test | `gui/src/lib/displayElementZoomPlayback.test.ts:18` |

### 11. `if`

- Flow ID: `flow_9cb8fa5a5e44dcfc`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:424`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/electron/main.ts:424` |
| 2 | `sendMenuCommand` | Function | `gui/electron/main.ts:711` |
| 3 | `webContents.send` | External | `外部I/O` |

### 12. `sendMenuCommand`

- Flow ID: `flow_79222e1d6e0b5911`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:711`の`sendMenuCommand`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `sendMenuCommand` | Function | `gui/electron/main.ts:711` |
| 2 | `webContents.send` | External | `外部I/O` |

### 13. `updateSegment`

- Flow ID: `flow_071f16f84c039ff4`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2019`の`updateSegment`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `updateSegment` | Function | `gui/src/App.tsx:2019` |
| 2 | `markProjectChanged` | Function | `gui/src/App.tsx:764` |

### 14. `if`

- Flow ID: `flow_af6faea865efb642`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1192`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1192` |
| 2 | `pauseMedia` | Function | `gui/src/App.tsx:2612` |
| 3 | `pause` | Test | `gui/src/lib/displayElementZoomPlayback.test.ts:18` |

### 15. `if`

- Flow ID: `flow_979312b90b2a0970`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:461`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:461` |
| 2 | `put` | Function | `gui/src/lib/waveformSessionCache.ts:75` |
| 3 | `normalizeFingerprint` | Function | `gui/src/lib/waveformSessionCache.ts:186` |

### 16. `if`

- Flow ID: `flow_fa47ffcf8a16cc06`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1795`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1795` |
| 2 | `cancelScratchProxy` | Function | `gui/src/lib/api.ts:441` |

### 17. `if`

- Flow ID: `flow_a2bdac49a6b968c7`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1811`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1811` |
| 2 | `releaseScratchProxy` | Function | `gui/src/lib/api.ts:446` |

### 18. `buildBaseOutputItems`

- Flow ID: `flow_a4ed8a0280c4223b`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1973`の`buildBaseOutputItems`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `buildBaseOutputItems` | Function | `gui/src/App.tsx:1973` |
| 2 | `segmentTitle` | Function | `gui/src/App.tsx:4636` |
<!-- code-map:generated:end -->
