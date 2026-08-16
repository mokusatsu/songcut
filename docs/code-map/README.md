<!-- code-map:generated:start -->
## 現在のスナップショット

- Repository: `songcut`
- Generated: `2026-08-16T10:06:28+09:00`
- Mode: `update`
- Engine: embedded Python `2.0.0`
- VCS head: `2dcea33f5b63bb29970ec9068ca99f5ced8cc606`
- Dirty: `yes`
- Files／Nodes／Edges: 284／3256／11341
- Components／Flows: 7／18

## 最初に読む場所

- [`gui`](modules/gui.md): `gui`を中心とする依存クラスタ。代表シンボル: initializeRendererI18n, tr, currentUiLanguage, if
- [`songcut`](modules/songcut.md): `songcut`を中心とする依存クラスタ。代表シンボル: ProbeRequest, BoundaryRefinementRequest, validate_hysteresis, to_config
- [`third_party-uta_align`](modules/third_party-uta_align.md): `third_party/uta_align`を中心とする依存クラスタ。代表シンボル: parse_lyrics_text, load_lyrics, _context_token_count, _truncate_context
- [`tests`](modules/tests.md): `tests`を中心とする依存クラスタ。代表シンボル: NativeFontCollectorError, __init__, _CreateRequest, _EnumRequest
- [`packaging`](modules/packaging.md): `packaging`を中心とする依存クラスタ。代表シンボル: _set_windows_dll_directory, spawn_external_process, distribution_root, configure_logging

主要入口:
- `exportClips`（`flow_87f310366eafeed8`、推定）
- `if`（`flow_a42879ed63f86fd1`、推定）
- `moveSelectedSubtitleSegments`（`flow_452779c9b05a3c29`、推定）
- `if`（`flow_acbaab781455b14f`、推定）
- `checkRecoveryOnStartup`（`flow_4d28b202844b5aa9`、推定）

## 地図

- [アーキテクチャと依存境界](architecture.md)
- [代表実行フロー](flows.md)
- [Hub・Bridge・Knowledge gap](hotspots.md)
- [前回からの変更影響](change-impact.md)
- [機械可読manifest](manifest.json)

## 限界

この地図はローカルの静的解析結果です。Pythonは標準AST、その他の言語は同梱ヒューリスティックパーサーを使用します。実行時DI、reflection、生成コード、文字列による呼出は不明瞭または未確認として扱います。
<!-- code-map:generated:end -->
