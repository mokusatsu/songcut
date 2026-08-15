# SCUT-069 全体pytestの進捗ログ強化と長時間無出力原因調査

## 目的

全体pytestが長時間無出力に見える状態を解消し、`python -m pytest` の収集対象・
実行中テスト・phase・経過時間を観測できるようにする。ログで最後に開始したテストと
停止しているphaseを特定し、長時間無出力の原因を実行証拠付きで記録する。

## 変更範囲

- `pyproject.toml` のpytest testpaths／標準出力設定
- `tests/conftest.py` の進捗・phase・heartbeat reporter
- 必要最小限のbuild/test手順文書
- このbriefと `tasks/task-list.md` の状態・証拠

## 禁止事項

- 本番アプリケーション、MMS、字幕アルゴリズム、テスト期待値を変更しない
- 長時間テストを通すためにskip、timeout、並列化、fixture差し替えを追加しない
- `out/`、`.codex-temp/`、既存生成物を削除・移動・追跡しない
- 既存のSCUT-064〜068の変更を戻さない
- commit、push、PRを作成しない

## 完了条件

- `python -m pytest --collect-only` が`tests/`だけを収集し、`out/`配下を収集しない
- 通常の全体pytestで収集件数、各テストの開始・phase・終了・経過時間、長時間heartbeatが見える
- 進捗機能を無効化する明示的なCLIまたは環境設定があり、既存のquiet実行も選択できる
- 長時間無出力の最後のtest nodeid・phase・経過時間・再現コマンド・原因候補を記録する
- 対象pytest、進捗reporterの動作確認、`git diff --check`が成功する

## テスト方法

- Codex同梱Pythonで`python -m pytest --collect-only -q`
- 小規模対象で進捗ログのSTART／PHASE／ENDを確認
- `python -m pytest tests -q`を進捗ログ付きで実行し、必要に応じて60秒以上のheartbeatを観測
- 変更対象のpytestと`git diff --check`

## 停止条件

- pytest hookの追加だけでは最後のtestを特定できず、テスト本体へのinstrumentationが必要になる場合
- 原因が外部モデル、GPU、FFmpeg、権限、プロセスロックなどの外部状態で、追加権限やユーザー判断が必要になる場合
- テストの仕様変更、skip、timeout、並列実行が必要になる場合

## 開始記録

- 2026-08-15: branch `main`、HEAD `1214708`。SCUT-068完了後の作業ツリーに、SCUT-064〜068およびbenchmark関連の既存変更があることを確認し、保持して開始
- 2026-08-15: `pytest tests -q -p no:cacheprovider --basetemp .codex-temp\pytest-tests` は43%・65%まで進んだ後、長時間無出力となった。既存の全pytestでは`out/`生成物収集による権限エラーも確認済み

## 実施証拠

- `pyproject.toml`に`testpaths = ["tests"]`を追加し、`--collect-only -q`は`330 tests collected`で終了した。`out/`配下の収集・権限エラーは再現しなかった。
- `tests/conftest.py`に、収集件数、`START`、setup/call/teardownの`PHASE-START`／`PHASE-END`、phase結果、`END`、既定30秒間隔のheartbeatを追加した。`--no-songcut-progress`で専用ログを無効化できる。
- 進捗付き全体実行（`NUMBA_CACHE_DIR=.codex-temp\numba-cache-probe`、`-p no:cacheprovider`、`--basetemp .codex-temp\pytest-full-progress-numba`）は `327 passed, 3 skipped, 1 subtests passed in 69.13s` で完了した。収集件数は330件。
- 無出力区間の最後は `[228/330] tests/test_source_separation.py::SourceSeparationTests::test_spectrogram_frontend_has_openvino_model_shape_and_roundtrips` の`call` phaseだった。進捗付き実行では30、60、90、120、150、180、210秒のheartbeatを確認した。
- `faulthandler`付き単独再現およびpytest外の同一STFT再現で、`songcut/source_separation.py:253`の初回`librosa.stft`からlazy importされた`librosa.core.notation`が、Numba `ensure_cache_path`（`numba/core/caching.py:112`）の`TemporaryFile`作成で停止することを確認した。約70秒後の単独pytest再現ではWindows access violationも発生した。
- `NUMBA_CACHE_DIR`未設定時のキャッシュ先はlibrosaインストール配下の`librosa/core/__pycache__`で、そこでの`TemporaryFile`作成が停止した。一方、書き込み可能な`.codex-temp\numba-cache-probe`を指定した同一STFTは約15.7秒で完了し、全体pytestも完走した。したがってpytestのハングではなく、Codex同梱PythonのNumbaキャッシュ先へのWindowsファイル作成待ち／保護が長時間無出力の原因候補である。
- ログ出力の追加だけでは原因を隠さず、対象nodeid・phase・経過時間をheartbeatで可視化し、必要時の再現コマンドと回避条件を`docs/BUILD.ja.md`／`docs/BUILD.md`へ記録した。

## 状態判断

完了。収集対象の固定、進捗・heartbeatの標準表示、無効化CLI、長時間無出力の最後の対象と原因切り分け、書き込み可能なNumbaキャッシュ先での全体pytest完走を確認した。
