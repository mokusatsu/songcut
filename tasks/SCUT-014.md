# SCUT-014 Sub UI ローカライズ統合

- 目的: Subの利用者向け固定日本語を既存i18n経路へ統合する。
- 変更範囲: `SubModePanel.tsx`、`i18n.ts`、renderer locale tests。
- 禁止事項: 技術識別子、効果名、仕様文言の意味変更。
- 完了条件: Subの主要toolbar/dialog/error/aria文言が英日resourceを持ち、空翻訳検査が成功する。
- テスト: i18n completeness、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `i18n.ts`へSubのtoolbar、dialog、job、error、style editor、effect label／parameter／optionを含む英日resourceを追加した。
  - `SubModePanel.tsx`の利用者向け固定日本語を`tr(key, args)`へ移し、JobProgressDialog props、確認文、動的effect表示も同じ経路へ統合した。
  - 英日leaf key集合の完全一致、空翻訳、主要Sub文言を`i18n.test.ts`で検証した。
  - `rg`による`SubModePanel.tsx`の固定CJK literal検査: 0件。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 35 files / 229 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。
