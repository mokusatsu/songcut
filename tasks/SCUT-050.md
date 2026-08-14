# SCUT-050 Cut選択時の再生カーソル固定を解消

## 目的

Cutの通常セグメントを選択した後、波形上の再生カーソル操作がセグメント先頭へ戻される不具合を解消する。

## 変更範囲

- 選択時に一度だけ開始位置へ合わせる既存仕様は維持する
- Cutの選択範囲オーバーレイが波形のpointer操作を遮断しないようにする
- 選択集合、primary選択、timeline focus requestは維持する

## 禁止事項

- `playFrom`、明示的な境界preview、セグメント追加・削除時の意図的なseekを変更しない
- Subの選択・再生挙動を変更しない
- 再生range sessionの停止・loop契約を変更しない

## 完了条件

- Cutの通常選択と複数選択は従来どおり選択開始位置へ一度だけ移動する
- 選択範囲上をクリック／ドラッグしても波形のscrubが実行され、開始位置へ戻されない
- 隣接セグメント移動や明示的な再生操作は従来どおりseekできる
- 対象Vitestとrenderer TypeScript型検査が成功する

## テスト方法

- `appComposition.test.ts`で選択時の一度だけのseekと、範囲オーバーレイのpointer transparencyを確認する
- GUI対象Vitestと`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`を実行する

## 停止条件

- 選択範囲自体をtimeline上で直接選択する必要があり、scrubと競合しない新しい操作仕様が必要になる場合

## 実施証跡

- 2026-08-13: 当初、`selectCutSegment`の単発`seek(primary.start)`を原因と誤認して除去したが、以前から同仕様でもカーソルは移動できたという利用者報告と矛盾するため直ちに復元した
- 2026-08-13: 原因は複数選択対応で`CutModePanel`のSVGセグメント範囲に追加したpointer event handlerだった。選択済み範囲が波形のscrubを遮断し、click時に選択の単発seekだけが走って開始位置へ戻っていた。範囲を`pointerEvents="none"`の表示専用へ変更した
- 2026-08-13: `pnpm exec vitest run src/lib/appComposition.test.ts`（7 passed）と`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`が成功。実アプリ上で、選択範囲内をクリック／ドラッグしても再生カーソルを移動できることは未確認
- 2026-08-13: 通常ポータブルビルド`packaging/build_dist.ps1`が成功。`dist/songcut-win-x64`をversion 1.1.76として更新し、Release ZIPは更新していない
- 2026-08-14: 更新後の通常portable配布版Cut E2Eで`WAVEFORM_DRAG_SEEK_ZOOM_OK`と`E2E_OK`を確認した。選択開始1.32352秒から、選択範囲上のdrag後は2.008995秒、zoom後のdragでも1.664497秒へ移動し、hit targetはいずれも`timeline-waveform-background`だった。開始位置への巻き戻りは再現しなかった。
- 状態判断: 完了
