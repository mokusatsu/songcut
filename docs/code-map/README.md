<!-- code-map:generated:start -->
## 現在のスナップショット

- Repository: `songcut`
- Generated: `2026-08-10T22:46:38+09:00`
- Mode: `verify`
- Engine: embedded Python `2.0.0`
- VCS head: `c10970c2de270ff7e8a08ef44eea21578f3ca597`
- Dirty: `yes`
- Files／Nodes／Edges: 226／2543／9305
- Components／Flows: 5／18

## 最初に読む場所

- [`gui`](modules/gui.md): `gui`を中心とする依存クラスタ。代表シンボル: initializeRendererI18n, tr, currentUiLanguage, if
- [`songcut`](modules/songcut.md): `songcut`を中心とする依存クラスタ。代表シンボル: ProbeRequest, BoundaryRefinementRequest, validate_hysteresis, to_config
- [`third_party-uta_align`](modules/third_party-uta_align.md): `third_party/uta_align`を中心とする依存クラスタ。代表シンボル: _context_token_count, _truncate_context, _local_lyric_context, _request_with_strategy
- [`tests`](modules/tests.md): `tests`を中心とする依存クラスタ。代表シンボル: put, get, invalidate, clear
- `packaging`: `packaging`を中心とする依存クラスタ。代表シンボル: extract_frame, weighted_bounds, quantile_bounds, weighted_centroid

主要入口:
- `exportClips`（`flow_87f310366eafeed8`、推定）
- `if`（`flow_acbaab781455b14f`、推定）
- `checkRecoveryOnStartup`（`flow_4d28b202844b5aa9`、推定）
- `switch`（`flow_2b99029c15ce92cc`、推定）
- `send`（`flow_0da193a90ef9fbb2`、推定）

## 地図

- [アーキテクチャと依存境界](architecture.md)
- [代表実行フロー](flows.md)
- [Hub・Bridge・Knowledge gap](hotspots.md)
- [前回からの変更影響](change-impact.md)
- [機械可読manifest](manifest.json)

## 限界

この地図はローカルの静的解析結果です。Pythonは標準AST、その他の言語は同梱ヒューリスティックパーサーを使用します。実行時DI、reflection、生成コード、文字列による呼出は不明瞭または未確認として扱います。
<!-- code-map:generated:end -->
