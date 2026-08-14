# SCUT-055 ASS_Lyric_Effects v3 最新wheel取り込み

## 目的

Songcutが使用する`ass-lyric-effects` v3 wheelを、指定された`C:\dev\ASS_Lyric_Effects40`のクリーンHEAD版へ更新し、既存の97効果・字幕出力・配布版収集を維持する。

## 変更範囲

- `pyproject.toml`の固定wheel URLとSHA256だけを、ASS_Lyric_Effects40のクリーンHEAD `4af57f7`に対応する配布wheelへ更新する。
- Codex同梱Pythonで依存を再インストールし、Songcutの既存ASS統合テストと必要なcatalog/API回帰を実行する。
- 通常portable buildを実行し、配布版に新しいwheelが収集されたことを確認する。

## 禁止事項

- ASS_Lyric_Effects40の未コミット変更、preview、docs、生成スクリプトをSongcutへ暗黙に取り込まない。
- effect catalog、effect ID、schema、Songcutのbackend API、Project schema、既存のASS出力契約を変更しない。
- `api.py`、`subtitle_export.py`、関連testsなど、既存dirty worktreeの別タスク差分を戻したり整理したりしない。
- commit、stage、push、Release ZIP更新を行わない。

## 完了条件

- `pyproject.toml`が`4af57f7b8275e18b737c246fcb5d3fb67a625d54`のwheel URLとSHA256 `46c25138f9d390ef79b427419e218b285512887bfa08e03a09472874b9b692cb`を固定する。
- URLから取得したwheelのSHA256が固定値と一致し、ローカル指定repoのクリーンHEAD配布wheelとも一致する。
- Songcut環境でインストール済み`ass_lyric_effects`が更新wheel由来であり、catalogが97効果を返す。
- `tests/test_ass_lyric_effects_v3_integration.py`、catalog/APIの対象テスト、`git diff --check`が成功する。
- 通常portable buildが成功し、配布版に収集された`ass_lyric_effects`のdirect URL/hashが新しい固定値と一致する。

## テスト方法

- `Get-FileHash`でローカルwheelと固定URL取得wheelを比較する。
- Codex同梱Pythonで`pip install -e ".[gui,dev]"`を実行した後、ASS統合テストとcatalog/API対象pytestを実行する。
- `packaging/build_dist.ps1`をReleaseなしで実行し、`dist/songcut-win-x64`のinstalled metadataとruntime module hashを確認する。

## 停止条件

- 固定URLのwheel hashが指定repoのクリーンHEAD wheelと一致しない場合。
- 97 effect IDまたはparameter schemaに変更があり、後方互換性の判断が必要になる場合。
- 既存dirty差分と依存固定行が競合する場合。

## 開始記録

- 2026-08-14: `main`、HEAD `6bf1074`。SCUT-040〜054を含む広範な未コミット差分を保持した状態で開始。
- 2026-08-14: 指定repoのHEADは`4af57f7b8275e18b737c246fcb5d3fb67a625d54`、`source/ass_lyric_effects-3.0.0-py3-none-any.whl`のSHA256は`46c25138f9d390ef79b427419e218b285512887bfa08e03a09472874b9b692cb`。worktreeにはNatural36、preview、docs等の未コミット差分があり、配布wheelには未収載であることを確認した。

## 実施証跡

- 2026-08-14: GitHub固定URLから一時取得したwheel（178,836 bytes）のSHA256が、指定repoのクリーンHEAD配布wheelと同じ`46c25138f9d390ef79b427419e218b285512887bfa08e03a09472874b9b692cb`であることを確認した。
- 2026-08-14: `pyproject.toml`の`ass-lyric-effects`固定URLを`4af57f7b8275e18b737c246fcb5d3fb67a625d54`へ更新し、Codex同梱Pythonで`pip install --force-reinstall --no-deps`を実行した。`pip check`は成功し、install済み`direct_url.json`は更新URL/hash、catalogはschema `1.0`・97効果を示した。
- 2026-08-14: `python -m pytest -q tests/test_ass_lyric_effects_v3_integration.py tests/test_subtitle_export.py`は38 passed（68.87秒）。全97効果、9 alignment、2解像度、単一／複数行のASS生成と字幕出力を確認した。
- 2026-08-14: `python -m pytest -q tests/test_api.py -k 'subtitle_effect_catalog_returns_fresh_v3_payload or subtitle_effect_request_normalizes_v3_parameters_and_rejects_unknown or subtitle_export_request_preserves_segment_style_and_effect_overrides or subtitle_file_export_route_keeps_display_elements_and_overrides or subtitle_render_job_returns_cache_identity_with_png'`は5 passed, 32 deselected。
- 2026-08-14: Codex同梱runtimeを明示した`packaging/build_dist.ps1`（Releaseなし）が成功。portable version `1.1.76`、`dist/songcut-win-x64/songcut.exe`、Electron runtime、app本体を確認し、Release ZIPは新規生成・更新していない。
- 2026-08-14: 配布runtimeの`ass_lyric_effects-3.0.0.dist-info/direct_url.json`が新しいURL/hashを保持することを確認した。`core.py`は指定repoのsourceと一致し、local worktreeの未コミット`_natural36_engine.py`差分はwheelに未収載のため意図的に取り込んでいない。
- 2026-08-14: code-map maintain／validate成功、parse error 0。依存URL/hashは静的call graphの対象外だが、ASS v3統合テストは検出済み。
- 2026-08-14: `git diff --check`および未追跡briefの`git diff --no-index --check`が成功（既存のLF→CRLF注意のみ）。
- 状態判断: 完了。
