<!-- code-map:generated:start -->
## 代表フロー

以下は静的call edgeから得た代表経路です。実行時に必ずこの順で通ることを保証するものではありません。

### 1. `exportClips`

- Flow ID: `flow_87f310366eafeed8`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1346`の`exportClips`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `exportClips` | Function | `gui/src/App.tsx:1346` |
| 2 | `localizeFilenameTemplateError` | Function | `gui/src/i18n.ts:529` |
| 3 | `tr` | Function | `gui/src/i18n.ts:510` |

### 2. `if`

- Flow ID: `flow_acbaab781455b14f`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1429`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1429` |
| 2 | `tr` | Function | `gui/src/i18n.ts:510` |

### 3. `checkRecoveryOnStartup`

- Flow ID: `flow_4d28b202844b5aa9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:784`の`checkRecoveryOnStartup`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `checkRecoveryOnStartup` | Function | `gui/src/App.tsx:784` |
| 2 | `loadRecovery` | Function | `gui/electron/project-store.ts:78` |
| 3 | `assertRecoverySnapshot` | Function | `gui/electron/project-schema.ts:498` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:354` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:792` |

### 4. `switch`

- Flow ID: `flow_2b99029c15ce92cc`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2267`の`switch`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `switch` | Function | `gui/src/App.tsx:2267` |
| 2 | `openProject` | Function | `gui/src/App.tsx:1065` |
| 3 | `parseProjectOpenResult` | Function | `gui/src/lib/project.ts:194` |
| 4 | `assertProjectDocument` | Function | `gui/electron/project-schema.ts:354` |
| 5 | `stringValue` | Function | `gui/electron/project-schema.ts:792` |

### 5. `send`

- Flow ID: `flow_0da193a90ef9fbb2`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:364`の`send`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `send` | Function | `gui/electron/main.ts:364` |
| 2 | `send` | External | `外部I/O` |

### 6. `atomicWriteJson`

- Flow ID: `flow_3e50ab519c941b42`
- 信頼度: 推定
- 入口: `gui/electron/project-store.ts:176`の`atomicWriteJson`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `atomicWriteJson` | Function | `gui/electron/project-store.ts:176` |
| 2 | `readJsonLimited` | Function | `gui/electron/project-store.ts:214` |
| 3 | `readTextLimited` | Function | `gui/electron/project-store.ts:218` |
| 4 | `readFile` | External | `外部I/O` |

### 7. `switch`

- Flow ID: `flow_ed7fa71733f22ef7`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2095`の`switch`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `switch` | Function | `gui/src/App.tsx:2095` |
| 2 | `clamp` | Function | `gui/src/lib/time.ts:11` |

### 8. `if`

- Flow ID: `flow_9cb8fa5a5e44dcfc`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:327`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/electron/main.ts:327` |
| 2 | `sendMenuCommand` | Function | `gui/electron/main.ts:614` |
| 3 | `webContents.send` | External | `外部I/O` |

### 9. `sendMenuCommand`

- Flow ID: `flow_79222e1d6e0b5911`
- 信頼度: 推定
- 入口: `gui/electron/main.ts:614`の`sendMenuCommand`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `sendMenuCommand` | Function | `gui/electron/main.ts:614` |
| 2 | `webContents.send` | External | `外部I/O` |

### 10. `if`

- Flow ID: `flow_44bdc595373a0c96`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:335`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:335` |
| 2 | `put` | Function | `gui/src/lib/waveformSessionCache.ts:75` |
| 3 | `normalizeFingerprint` | Function | `gui/src/lib/waveformSessionCache.ts:186` |

### 11. `updateSegment`

- Flow ID: `flow_071f16f84c039ff4`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1444`の`updateSegment`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `updateSegment` | Function | `gui/src/App.tsx:1444` |
| 2 | `markProjectChanged` | Function | `gui/src/App.tsx:525` |

### 12. `if`

- Flow ID: `flow_8e401bcdf1521ba9`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2263`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:2263` |
| 2 | `runEditorCommand` | Function | `gui/src/App.tsx:2092` |
| 3 | `executeEditorAction` | Function | `gui/src/lib/editorCommands.ts:133` |
| 4 | `execute` | Function | `gui/src/App.tsx:2094` |

### 13. `disposeScratchProxy`

- Flow ID: `flow_ee02df1afd6d9353`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1280`の`disposeScratchProxy`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `disposeScratchProxy` | Function | `gui/src/App.tsx:1280` |
| 2 | `finishScratchPreview` | Function | `gui/src/App.tsx:1760` |
| 3 | `cancelScratchPreview` | Function | `gui/src/App.tsx:1737` |

### 14. `runEditorCommand`

- Flow ID: `flow_5225c9736f1f57ae`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:2092`の`runEditorCommand`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `runEditorCommand` | Function | `gui/src/App.tsx:2092` |
| 2 | `executeEditorAction` | Function | `gui/src/lib/editorCommands.ts:133` |
| 3 | `execute` | Function | `gui/src/App.tsx:2094` |

### 15. `if`

- Flow ID: `flow_fa47ffcf8a16cc06`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1233`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1233` |
| 2 | `cancelScratchProxy` | Function | `gui/src/lib/api.ts:331` |

### 16. `if`

- Flow ID: `flow_eb35f7b7e4b96eed`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1807`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1807` |
| 2 | `cancelScratchPreview` | Function | `gui/src/App.tsx:1737` |

### 17. `if`

- Flow ID: `flow_a2bdac49a6b968c7`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1249`の`if`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `if` | Function | `gui/src/App.tsx:1249` |
| 2 | `releaseScratchProxy` | Function | `gui/src/lib/api.ts:336` |

### 18. `buildBaseOutputItems`

- Flow ID: `flow_a4ed8a0280c4223b`
- 信頼度: 推定
- 入口: `gui/src/App.tsx:1398`の`buildBaseOutputItems`

| Step | シンボル | 種別 | 根拠 |
|---:|---|---|---|
| 1 | `buildBaseOutputItems` | Function | `gui/src/App.tsx:1398` |
| 2 | `segmentTitle` | Function | `gui/src/App.tsx:3109` |
<!-- code-map:generated:end -->
