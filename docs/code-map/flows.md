<!-- code-map:generated:start -->
## 代表フロー

以下は静的call edgeから得た代表経路です。実行時に必ずこの順で通ることを保証するものではありません。

### 1. `exportClips`

- Flow ID: `flow_87f310366eafeed8`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1916`の`exportClips`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `exportClips` | Function | `gui/src/App.tsx:1916` |
| 2 | `localizeFilenameTemplateError` | Function | `gui/src/i18n.ts:692` |
| 3 | `tr` | Function | `gui/src/i18n.ts:673` |

### 2. `if`

- Flow ID: `flow_a42879ed63f86fd1`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2349`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:2349` |
| 2 | `tr` | Function | `gui/src/i18n.ts:673` |

### 3. `moveSelectedSubtitleSegments`

- Flow ID: `flow_452779c9b05a3c29`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2342`の`moveSelectedSubtitleSegments`
- エージェント確認メモ: 選択中のSubセグメントを既存のLyricsLaneへ一括移動する入口。移動先がない、選択がない、同一Timelineだけ、または時刻範囲が重複する場合は状態を変えず拒否し、成功時のみ対象レーンを更新する。

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `moveSelectedSubtitleSegments` | Function | `gui/src/App.tsx:2342` |
| 2 | `tr` | Function | `gui/src/i18n.ts:673` |

### 4. `if`

- Flow ID: `flow_acbaab781455b14f`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2000`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:2000` |
| 2 | `tr` | Function | `gui/src/i18n.ts:673` |

### 5. `checkRecoveryOnStartup`

- Flow ID: `flow_4d28b202844b5aa9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1321`の`checkRecoveryOnStartup`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `checkRecoveryOnStartup` | Function | `gui/src/App.tsx:1321` |
| 2 | `loadRecovery` | Function | `gui/electron/project-store.ts:78` |
| 3 | `assertRecoverySnapshot` | Function | `gui/electron/project-schema.ts:567` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:423` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:1018` |

### 6. `if`

- Flow ID: `flow_63d1ded3cc9750ae`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1093`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1093` |
| 2 | `loadProjectPath` | Function | `gui/src/App.tsx:1617` |
| 3 | `parseProjectOpenResult` | Function | `gui/src/lib/project.ts:194` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:423` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:1018` |

### 7. `listener`

- Flow ID: `flow_c6228872ba7b1bb9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:564`の`listener`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `listener` | Function | `gui/src/App.tsx:564` |
| 2 | `FakeEventTarget.addEventListener` | Test | `gui/src/lib/useBoundaryDrag.test.ts:16` |
| 3 | `build_rhythm_grid.add` | Function | `songcut/rhythm_alignment.py:143` |
| 4 | `RhythmGridPoint` | Class | `songcut/rhythm_alignment.py:19` |

### 8. `send`

- Flow ID: `flow_0da193a90ef9fbb2`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:441`の`send`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `send` | Function | `gui/electron/main.ts:441` |
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
- 入口: `gui/src/App.tsx:1838`の`disposeScratchProxy`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `disposeScratchProxy` | Function | `gui/src/App.tsx:1838` |
| 2 | `finishScratchPreview` | Function | `gui/src/App.tsx:2648` |
| 3 | `cancelScratchPreview` | Function | `gui/src/App.tsx:2625` |
| 4 | `pauseMedia` | Function | `gui/src/App.tsx:2590` |
| 5 | `pause` | Test | `gui/src/lib/displayElementZoomPlayback.test.ts:18` |

### 11. `if`

- Flow ID: `flow_9cb8fa5a5e44dcfc`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:404`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/electron/main.ts:404` |
| 2 | `sendMenuCommand` | Function | `gui/electron/main.ts:691` |
| 3 | `webContents.send` | External | `外部I/O` |

### 12. `sendMenuCommand`

- Flow ID: `flow_79222e1d6e0b5911`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:691`の`sendMenuCommand`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `sendMenuCommand` | Function | `gui/electron/main.ts:691` |
| 2 | `webContents.send` | External | `外部I/O` |

### 13. `updateSegment`

- Flow ID: `flow_071f16f84c039ff4`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2015`の`updateSegment`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `updateSegment` | Function | `gui/src/App.tsx:2015` |
| 2 | `markProjectChanged` | Function | `gui/src/App.tsx:761` |

### 14. `if`

- Flow ID: `flow_af6faea865efb642`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1189`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1189` |
| 2 | `pauseMedia` | Function | `gui/src/App.tsx:2590` |
| 3 | `pause` | Test | `gui/src/lib/displayElementZoomPlayback.test.ts:18` |

### 15. `if`

- Flow ID: `flow_979312b90b2a0970`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:458`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:458` |
| 2 | `put` | Function | `gui/src/lib/waveformSessionCache.ts:75` |
| 3 | `normalizeFingerprint` | Function | `gui/src/lib/waveformSessionCache.ts:186` |

### 16. `if`

- Flow ID: `flow_fa47ffcf8a16cc06`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1791`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1791` |
| 2 | `cancelScratchProxy` | Function | `gui/src/lib/api.ts:441` |

### 17. `if`

- Flow ID: `flow_a2bdac49a6b968c7`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1807`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1807` |
| 2 | `releaseScratchProxy` | Function | `gui/src/lib/api.ts:446` |

### 18. `buildBaseOutputItems`

- Flow ID: `flow_a4ed8a0280c4223b`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1969`の`buildBaseOutputItems`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `buildBaseOutputItems` | Function | `gui/src/App.tsx:1969` |
| 2 | `segmentTitle` | Function | `gui/src/App.tsx:4603` |
<!-- code-map:generated:end -->
