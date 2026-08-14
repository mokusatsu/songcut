# SCUT-063: 1.1.83 Release build

## 目的

`main` の clean HEAD を基準に、利用者へ渡せる portable package と Release ZIP を生成し、
SCUT-062 の `third_party` 限定が成果物へ反映されていることを確認する。

## 変更範囲

- `packaging/build_dist.ps1 -Release` による `dist/` の更新
- `docs/code-map/` の現行 HEAD スナップショット更新
- 本 brief とタスク一覧への実行証跡

## 禁止事項

- アプリケーションコード、テスト、パッケージング設定を変更しない
- 既存 Release ZIP を再利用して成功扱いにしない
- `dist/` の生成物を Git に stage または commit しない
- このタスクと無関係な差分を commit しない

## 完了条件

- 最終 committed tree（commit count 83）に対する `build_dist.ps1 -Release` が終了コード 0 で完了する
- `dist/songcut-win-x64` に launcher、runtime、GUI、Electron、README が存在する
- `dist/songcut-1.1.83-full.zip` と `dist/songcut-1.1.83.zip` が生成され、必須ファイルを含む
- 展開版の `third_party` 直下は `ffmpeg` だけで、通常版 ZIP に `third_party/ffmpeg` とモデル内容が含まれない
- `docs/code-map` の validate が成功し、`git diff --check` が成功する

## テスト方法

- Codex bundled runtime を明示指定した `packaging/build_dist.ps1 -Release`
- native font resolver の Release build と native test（build script 内）
- GUI production build（build script 内）
- PyInstaller 生成、Release archive の build-script 内照合
- 展開版と ZIP entry の後検査、SHA-256 採取
- `docs/code-map` validate と `git diff --check`

## 停止条件

- `dist/songcut-win-x64` 内の実行中プロセスが出力ファイルをロックしている場合
- 必須 runtime、local ASS wheel、Electron runtime、または FFmpeg が見つからない場合
- build script、archive 検査、必須ファイル検査のいずれかが失敗した場合

## 開始記録

- 2026-08-14: ユーザーが commit と Release build の作成を明示依頼した。開始時の `main` は clean で、HEAD は `9581e4b`、`origin/main` より 6 commits ahead だった。候補の `songcut`、`songcut-electron`、`electron` 実行プロセスは検出されなかった。証跡 commit 後の最終 build は commit count 83 で実行した。

## 実施証拠

- 2026-08-14: bundled Python 3.12.13、Node 24.19.0、pnpm 11.19.0、Git 2.53.0 を明示指定して `packaging/build_dist.ps1 -Release` を実行し、終了コード 0 で完了した。最終 run の version は `1.1.83`。
- 2026-08-14: native font resolver の Release build と native test が成功した。DLL SHA-256 は `76545D193F73D99EFE9A9633907F2F9EC93A1D14C79366EFB1472DBF9B8A2BB9`、machine は `0x8664`。
- 2026-08-14: GUI production build は 1,778 modules transformed で成功し、PyInstaller collect も完了した。build script 内の Release archive 内容照合も成功した。
- 2026-08-14: 展開版の必須パス `songcut.exe`、`runtime/`、`app/dist/`、`app/dist-electron/`、`electron/songcut-electron.exe`、`README.txt` を確認した。`app/package.json` の version は `1.1.83`。`third_party` 直下は `ffmpeg` のみだった。
- 2026-08-14: Full ZIP は 2,782 entries、`third_party/ffmpeg` entries 49、モデル内容 entries 84。通常版 ZIP は 2,649 entries、`third_party/ffmpeg` entries 0、モデル内容 entries 0 で、両方に必須 launcher、Electron executable、README が存在した。
- 2026-08-14: `dist/songcut-1.1.83-full.zip` の SHA-256 は `03D4757E826DCBD70CF7BEF59DFCE75EDA0FAA76CC3C758723B3561A3F51515D`。`dist/songcut-1.1.83.zip` の SHA-256 は `8EF5C16ECC056E59B5AF7DDA87B88330DAFC74E04A67C684138B10B2E1776E1B`。
- 2026-08-14: `docs/code-map` update/validate が成功した（279 files、3,136 nodes、10,909 edges、parse errors 0）。`git diff --check` が終了コード 0 で成功した。

## 状態判断

2026-08-14: 完了。最終 Release artifact の version と final Git commit count はともに 83。`dist/` は Git 管理外の成果物として保持し、証跡とコードマップ更新だけを commit に記録する。
