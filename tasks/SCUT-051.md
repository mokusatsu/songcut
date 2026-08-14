# SCUT-051 Sub波形上の歌詞行矩形によるスクラブ阻害を解消

## 目的

Subの歌詞行セグメントを選択した後も、波形上の再生カーソルをクリック／ドラッグで自由に移動できるようにする。

## 変更範囲

- `SubTimelineEditor` のSVG波形矩形と歌詞行矩形を波形スクラブに対してpointer透過にする
- 選択中行の開始・終了境界ハンドルだけはdrag可能なまま保つ
- 歌詞ラベルからの既存選択・本文編集経路を維持する
- 回帰テストを追加し、通常ポータブルビルドまで実行する

## 禁止事項

- Subの選択確定、再生range、境界drag lifecycle、表示素編集を変更しない
- Cut側や波形共通primitiveを変更しない
- 既存の未コミット変更を戻したり整理したりしない

## 完了条件

- 歌詞行矩形上のpointer操作が共有波形へ届き、scrubを遮らない
- 選択中行の境界ハンドルは従来どおりpointer dragできる
- 歌詞ラベルからの選択・本文編集経路は残る
- 対象Vitest、GUI typecheck、通常ポータブルビルドが成功する

## テスト方法

- `SubTimelineEditor.test.ts` で矩形本体のpointer透過と境界ハンドルのpointer有効化を固定する
- GUI typecheckを実行する
- `packaging/build_dist.ps1` による通常ビルドを実行し、成果物を確認する

## 停止条件

- 波形スクラブと歌詞行矩形の直接選択を同一pointer操作で両立させる別操作仕様が必要になる場合

## 開始記録

- 2026-08-13: `main`、HEAD `6bf1074`、既存の広範な未コミット変更を保持した状態で開始

## 実施証跡

- 2026-08-13: 原因はSVGの`.sub-waveform-segment`と上層の`.lyrics-segment`が波形のpointer操作を受け、選択処理を発火させていたことだった。両矩形を`pointerEvents="none"`の表示専用にし、歌詞ラベルの選択・本文編集と境界ハンドルの`pointerEvents: "auto"`は維持した
- 2026-08-13: `gui/node_modules/.bin/vitest.cmd run src/components/SubTimelineEditor.test.ts`が7 passed。SVG矩形の透過、上層矩形の透過、境界ハンドルのpointer有効化、歌詞ラベルの選択経路を固定した
- 2026-08-13: `pnpm run typecheck`が成功。`git diff --check`も空白エラーなし（既存のLF→CRLF警告のみ）
- 2026-08-13: 通常ポータブルビルド`packaging/build_dist.ps1`が成功。native font resolver test、GUI本番ビルド、PyInstallerを通過し、`dist/songcut-win-x64`をversion `1.1.76`として更新。必須成果物`songcut.exe`、runtime、app/dist、app/dist-electron、songcut-electron.exe、README.txtを確認し、Release ZIPは更新していない
- 2026-08-13: ビルド初回はGit未追跡・`.gitignore`済みの`third_party/uta_align/.pytest_cache`へのアクセス拒否、再試行は配布物内`songcut-electron.exe`（PID 32232）による`default_app.asar`ロックで停止した。不要cacheを削除し、特定した配布物内プロセスだけを終了して最終ビルドを成功させた
- 2026-08-13: code-map maintain/verify/validateが成功。`SubTimelineEditor.tsx`と同testのみ再解析、parse error 0。影響半径は`SubTimelineEditor → SubModePanel → App`
- 2026-08-14: 更新後の通常portable配布版Sub E2Eで、選択済み字幕行を含むwaveform操作後に`SUB_SCRATCH_PLAYBACK_OK`と`SUB_E2E_OK`を確認した。歌詞行矩形が共有waveformのscrubを遮らず、選択、境界ハンドル、歌詞編集を固定するcomponent testも全GUI Vitestに含めて成功した。
- 状態判断: 完了
