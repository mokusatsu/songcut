<!-- code-map:generated:start -->
## 解析基点

- 動作モード: `update`
- VCS: `git`
- Base: `5b34d47250cc5c26877fb37d23ba34e589bbcbad`
- Head: `5b34d47250cc5c26877fb37d23ba34e589bbcbad`
- Dirty: `yes`

## 変更ファイル

- `gui/electron/locale.test.ts`
- `gui/electron/locale.ts`
- `gui/electron/main.ts`
- `packaging/build_dist.ps1`

## 影響半径

| 距離 | 状態 | ファイル |
|---:|---|---|
| 0 | 現在 | `gui/electron/locale.test.ts` |
| 0 | 現在 | `gui/electron/locale.ts` |
| 0 | 現在 | `gui/electron/main.ts` |
| 0 | 現在 | `packaging/build_dist.ps1` |
| 1 | 現在 | `gui/electron/i18n.ts` |
| 1 | 現在 | `gui/src/lib/waveform.test.ts` |
| 1 | 現在 | `gui/src/lib/waveform.ts` |
| 1 | 現在 | `gui/src/lib/waveformPreferences.ts` |
| 2 | 現在 | `gui/src/components/SettingsDialog.tsx` |
| 2 | 現在 | `gui/src/components/TimelineWaveform.tsx` |
| 2 | 現在 | `gui/src/lib/settingsScopes.ts` |
| 2 | 現在 | `gui/src/lib/waveformPreferences.test.ts` |

## リスク

| ファイル | 状態 | Score | Level | 依存先 | Entry point | 未テストsymbol |
|---|---|---:|---|---:|---:|---:|
| `gui/electron/main.ts` | 変更 | 100.0 | critical | 8 | 5 | 28 |
| `gui/electron/locale.ts` | 変更 | 83.0 | critical | 8 | 0 | 4 |
| `packaging/build_dist.ps1` | 変更 | 73.5 | high | 8 | 0 | 9 |
| `gui/electron/locale.test.ts` | 変更 | 48.4 | medium | 8 | 0 | 0 |

## 影響component・flow・test

- Components: `gui`、`packaging`
- Flows: `flow_0da193a90ef9fbb2`、`flow_9cb8fa5a5e44dcfc`、`flow_79222e1d6e0b5911`
- Tests: `gui/electron/locale.test.ts`、`gui/src/lib/waveform.test.ts`、`gui/src/lib/waveformPreferences.test.ts`
<!-- code-map:generated:end -->
