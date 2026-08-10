# SCUT-037 名前付きウェイト書体の字幕出力修正

## 目的

`Noto Sans JP Medium`など、物理ウェイトが400以外の非太字書体を選択した字幕でも、実書体を維持したままASS Effect付き出力を成功させる。

## 変更範囲

- Windows font resolverのbold／non-bold判定
- Light／Regular／Medium／SemiBold／Boldの回帰テスト
- 報告された`Noto Sans JP Medium`とMorning Mist設定によるASS生成確認
- portable `dist/songcut-win-x64`の更新
- 字幕出力前のWPF font probeをコンソール非表示で実行

## 禁止事項

- 別family、合成bold／italic、文字欠落faceへのfallbackを追加しない。
- Effect固有処理や上流ASS_Lyric_Effectsのparameterを変更しない。
- GUI E2E動画生成を再開しない。
- 無関係な既存差分を変更、破棄、commitしない。

## 完了条件

- [x] 非太字要求はOpenType weight 100–500、太字要求は600–900の物理faceを受け入れる。
- [x] 非太字要求で600以上、太字要求で500以下のfaceは明示エラーになる。
- [x] `Noto Sans JP Medium`、非太字、日本語テキストを実Windows環境でweight 500として解決できる。
- [x] Morning Mist設定を通るASS生成が成功する。
- [x] 関連Pythonテストとportable buildが成功する。
- [x] font probeのPowerShell子プロセスがコンソールウィンドウを表示しない。

## テスト方法

- `python -m pytest -q tests/test_windows_font_resolver.py tests/test_subtitle_export.py tests/test_api.py`
- 実Windows font probe／resolverで`Noto Sans JP Medium`を解決
- Morning Mistの代表的な日本語字幕を`render_ass_document()`で生成
- `packaging/build_dist.ps1`
- WPF probeの`subprocess.run()`へ`CREATE_NO_WINDOW`が常に渡ることをunit testで固定

## 停止条件

- Windows providerと実SFNT metadataが異なるfaceを返す場合。
- weight分類の変更が既存bold契約を曖昧にし、物理faceを一意に選べない場合。
- 対象ファイルに識別不能な並行変更が現れた場合。

## 実施証跡

- 開始: 2026-08-10。branch `codex/SCUT-036-ass-lyric-effects-integration`。
- 修正前再現: `Noto Sans JP Medium`はWindows WPF providerで`NOTOSANSJP-VF.TTF`、face index 0、weight 500、style Normal、simulation Noneとして解決されるが、resolverが非太字をweight 400に限定して`FontStyleMismatchError`を送出した。
- 実装: OpenType weight 1–999の妥当性を保ったうえで、100–500をnon-bold、600–900をboldの物理faceとして判定する。family一致、実file／face index、文字coverage、upright／italic、style simulation拒否は変更していない。
- resolverテスト: `python -m pytest -q tests/test_windows_font_resolver.py` → `23 passed`。Mediumのend-to-end解決、Light／Regular／Medium／SemiBold／Bold境界、逆クラス拒否を含む。
- 字幕／API回帰: `python -m pytest -q tests/test_subtitle_export.py tests/test_api.py` → `51 passed`。
- 実Windows確認: `resolve_windows_font('Noto Sans JP Medium', text='星の消えた夜に')` → `C:\Windows\Fonts\NotoSansJP-VF.ttf`、face index 0、weight 500、Normal、simulation None。
- 報告設定確認: `Noto Sans JP Medium`、非太字、Morning Mist、start/end 500ms、既定parameter、日本語10秒segmentで`render_ass_document(..., apply_effects=True)`が成功。469 Dialogue events、UTF-8 184,902 bytes。
- portable build: `packaging/build_dist.ps1`成功。`dist/songcut-win-x64` version `1.1.73`を2026-08-10 09:38に更新。GUI production buildとPyInstaller buildが成功した。
- コードマップ: embedded Python update、verify／validate成功、解析error 0、warning 0。
- 残る確認: 更新したportable GUIから、利用者の元project全体を再出力する実環境確認。
- 追加再現: Sub exportのASS生成前は、文字coverageを検証するWPF font probeが字幕テキスト単位でPowerShellを起動する。標準`subprocess.run()`に`CREATE_NO_WINDOW`がなく、各probeのコンソールが可視化されていた。
- 追加修正: resolverも既存の`win_safesubprocess`へ統一し、WPF probeの全起動へ`CREATE_NO_WINDOW`を渡す。子プロセスtree cleanupと非表示起動を他のFFmpeg／API経路と同じ契約にした。
- 追加回帰: `python -m pytest -q tests/test_windows_font_resolver.py tests/test_subtitle_export.py tests/test_api.py` → `75 passed`。WPF probeが非0の`CREATE_NO_WINDOW`を必ず渡すunit testを含む。
- 完了: 2026-08-10。portable `1.1.73`を再構築・起動し、API health／catalog成功を確認した。利用者から後続SCUT-038の実施指示を受け、全完了条件の証拠が揃ったSCUT-037を完了とした。
