# SCUT-002 モード安全性と operation 契約の修正

- 目的: 後続共通化の前に、Sub operationとrelinkが誤ったCut経路へ入る可能性を除く。
- 変更範囲: `project-schema.ts`、`App.tsx`、project/store関連テスト。
- 禁止事項: schema version変更、sidecar統合、Sub jobのresume仕様の推測実装。
- 完了条件:
  - validatorが型で許可された全operation kindを受理する。
  - quit recoveryが実行中のSub operation kindを保持する。
  - Sub relink先が`.sub.songcut`となり、Cut sidecarをarchive/上書きしない。
  - 対象test、全Vitest、typecheckが成功する。
- 停止条件: Sub operationをresumableにするか否かの製品判断が必要になった場合は、永続化契約を「interrupted記録のみ」に限定する。
- 完了証拠 (2026-08-05):
  - runtime validatorとquit recoveryを全5種の永続operation kindへ対応し、Sub relinkでactive modeをsidecar resolverへ渡した。
  - 全operation kindのparse／interrupted normalizationとCut/Sub sidecar分離をテストで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 25 files / 165 tests passed。
  - `git diff --check`: exit 0。
