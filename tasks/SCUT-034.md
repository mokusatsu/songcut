# SCUT-034 Timeline初回表示幅の同期

## 目的

CutからSubへ切り替えた直後に、タイムラインが固定の小さい幅で一度描画されてからウィンドウ幅へ拡大するちらつきをなくす。

## 変更範囲

- Cut/Sub共通Timeline viewportの初回幅計測タイミング
- 関連GUIテスト、型チェック、通常ポータブルビルド

## 禁止事項

- Cut/Sub別のサイズ計測処理を追加しない。
- ズーム、スクロール、境界編集の契約を変更しない。
- 無関係な既存変更を修正しない。
- Release ZIPを生成しない。

## 完了条件

- [x] Timeline viewportの実幅が初回ペイント前に反映される。
- [x] Cut/Sub共通のサイズ追従とResizeObserverが維持される。
- [x] 関連GUIテストとtypecheckが成功する。
- [x] 通常ビルドが成功し、`dist/songcut-win-x64`が更新される。

## テスト方法

- `pnpm test -- --run gui/src/lib/useTimelineViewport.test.ts gui/src/components/TimelineSurface.test.ts`
- `pnpm run typecheck`
- `packaging/build_dist.ps1`

## 停止条件

- 対象ファイルに未確認の既存変更が見つかった場合。
- 共通フックの変更でCut/Subいずれかの契約が変わる場合。
- 通常ビルドに必要な依存関係またはファイルロックを解消できない場合。

## 実施証跡

- 開始: 2026-08-08、branch `main`、HEAD `4849785`。既存のSCUT-033関連変更を保持。
- 実装: `useTimelineViewport`の初回幅計測を`useEffect`から`useLayoutEffect`へ変更し、既存の共通`ResizeObserver`を維持した。
- GUI unit: `vitest run src/lib/useTimelineViewport.test.ts src/components/TimelineSurface.test.ts` = 2 files / 16 tests passed。
- GUI typecheck: `pnpm run typecheck`成功。
- 通常ビルド: `packaging/build_dist.ps1`成功。`dist/songcut-win-x64`をversion `1.1.65`で更新し、Release ZIPは生成していない。
- コードマップ: update／validate成功。216 files / 2412 nodes / 8846 edges、parse error 0。
- 最終状態: 2026-08-08、branch `main`、HEAD `4849785`（commit未実施）。
