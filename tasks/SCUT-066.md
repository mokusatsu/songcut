# SCUT-066 表示素空白文字の単独タイミング内挿

## 目的

Standard Alignが生成する表示素で、空白文字が直前の文字へ結合される現状を解消する。原文中の空白文字を一文字ずつ単独の表示素として保存し、前後の表示素タイミングから内挿した正の時間区間を与える。これにより、Project payloadと表示素時刻付きLRCを受け取る後段プログラムが、空白を他の文字と分離して処理できるようにする。

## 変更範囲

- `songcut/lyrics_elements.py`のStandard Align用表示素分割と時刻再配分を変更する。
  - `str.isspace()`となる各原文文字を、文字列・`source_start`・`source_end`を保持した一つの`DisplayElementSeed`にする。発音とMMS token範囲は空の範囲とする。
  - 空白を表示素のハード境界として扱い、非空白部分の結合文字、variation selector、小書きかな、促音、長音記号、句読点の既存規則を、空白で区切られた各範囲内で維持する。空白の前後に発音しない句読点しかない場合も、原文を再連結した順序が変わらないよう最小限に独立した非発音表示素を作る。
  - CTC token spanの終端と次のspanの開始が一致する場合でも空白を落とさない。空白だけの連続区間と隣接する自動表示素を、前後の表示素アンカーまたは行境界の間で既存の重み付けを使って再partitionする。各空白の重みは1とし、連続空白は文字順に内挿する。
  - 行頭、行末、空白だけの行、部分CTC、CTC不採用時にも、行境界を変えずに同じ不変条件を保つ。`text == ""`のVAD／手動blankと、本文が空白文字の表示素は別の概念として維持する。
- `songcut/element_reconciliation.py`とそのテストは、既存の手動表示素保護が新しい自動表示素列によって壊れないことを確認するためにのみ扱う。実測で回帰が示された場合だけ最小限に修正する。
- `tests/test_lyrics_elements.py`、`tests/test_element_reconciliation.py`、`tests/test_subtitle_export.py`、必要に応じてAPI／Project schemaの既存テストを更新または追加する。
- LRC書き出しは既存の表示素payloadをそのまま利用する。空白文字のための新規API、Project schema、source enum、GUI操作は追加しない。

## 禁止事項

- Uta Align、行境界、隣接行、beat grid、字幕焼き込み、ASS出力の仕様を変更しない。
- 空白以外の通常の句読点・記号の分割規則を広範囲に変更しない。空白によって原文順を保てない局所ケースだけを対象にする。
- `text == ""`の既存blank、手動merge、手動blank、手動境界の意味を変更しない。
- 既存の保存済みProjectや既存の手動表示素を自動変換、migration、再解析、互換層で書き換えない。既存データの遡及変換が必要になった場合は別タスクとユーザー判断を要する。
- 表示素の型、保存schema、公開API、LRCフォーマット、GUI文言を変更しない。
- 無関係なリファクタリング、stage、commit、push、PR作成、通常build／Release ZIP更新を行わない。

## 完了条件

- 新規のStandard Align結果で、半角空白、全角空白、タブを含む歌詞について、各`str.isspace()`文字が一つずつ独立した表示素になる。`"".join(element.text for element in elements)`は原文と一致し、各空白のsource rangeも原文位置と一致する。
- `"A B"`、`"A  B"`、`" A "`、空白だけの行、および空白に隣接する句読点の合成fixtureで、空白表示素が前後の文字に結合されず、順序どおりに残る。
- CTCの隣接token spanに時間的な隙間がないfixtureでも、各空白表示素が`1ms`以上の正時間長を持つ。行内要素は開始が行開始、終了が行終了、隣接境界が一致する連続partitionになる。
- 部分CTCとline-proportional経路でも同じ空白分割・正時間長・partition不変条件を満たす。自動表示素の局所再配分以外で、行境界と隣接行の時刻を変更しない。
- 既存の`text == ""` blankはblankのままであり、既存の手動merge／手動blank／手動境界はreconciliationで保護される。空白を含む既存手動表示素を遡及分割しない。
- 表示素時刻付きLRCで、各空白文字の直前にその表示素の開始時刻タグが付き、文字そのものが保持される。未解析行の既存fallbackは変わらない。
- 対象Pythonテストが成功し、必要なAPI／Project schema回帰テストが成功し、`git diff --check`が成功する。

## テスト方法

- `tests/test_lyrics_elements.py`で、空白のseed分割、source range、連続空白、行頭／行末／全空白、句読点隣接、CTC隣接span、部分CTC、line-proportionalの各fixtureを検証する。
- 同テストで、各表示素が正時間長、行全体がgap-free partition、空白の本文とtoken範囲が期待どおりであることを検証する。
- `tests/test_element_reconciliation.py`で、既存手動要素の保護と、新規自動結果にだけ空白表示素が現れることを検証する。
- `tests/test_subtitle_export.py`（必要ならAPI／Project schemaの対象テスト）で、LRCが空白文字を縮約せず、各空白の開始時刻タグを出力することを検証する。
- 対象pytest、必要時のGUI typecheck／対象Vitest、`git diff --check`を実行する。アプリケーションコードの変更範囲がPython側に留まる場合、通常portable buildとRelease ZIPは必須検証に含めない。

## 停止条件

- 行の長さが、生成すべき表示素数に対する既存の最小`1ms`制約を満たせず、空白ごとの正時間長とschema不変条件を同時に満たせない場合。
- 既存の保存済み／手動表示素をも空白単位へ遡及変換する必要が生じた場合。migrationまたは互換性方針はユーザー判断を得る。
- 手動表示素保護を維持するために、Project schema、公開API、Uta Align、行境界、隣接行の時刻、または広範囲の句読点規則を変更する必要が生じた場合。
- CTCの実測結果から、前後アンカーだけでは空白の時刻を決められず、時刻配分の利用者向け仕様判断が必要になった場合。

## 実施証跡

- 2026-08-15: ユーザー指示により登録。状態は未着手、優先度は高、依存はSCUT-041／043／049。
- 登録時のbranchは`main`、HEADは`1214708`。既存の`tasks/task-list.md`変更と未追跡の`tasks/SCUT-064.md`、`tasks/SCUT-065.md`は保持対象とし、上書きしていない。
- 登録前の調査で、`split_display_elements`が空白を含む非発音文字を直前の表示素へ結合すること、`_interpolate_missing_bounds`がtoken span終端と次span開始の間だけを使うため隣接spanでは空白を生成できないこと、LRCが表示素本文と開始時刻をそのまま書き出すことを確認した。
- タスク登録時にアプリケーションコード、テスト、schema、GUI、配布物は変更していない。登録前の`git diff --check`は成功している。

## 実施記録

- 2026-08-15: SCUT-065完了後、`main` / HEAD `2dcea33`で着手。既存のSCUT-064/065ドキュメント差分と未stage状態を保持し、SCUT-066の変更対象を`songcut/lyrics_elements.py`と対象pytestに限定する。
- 2026-08-15: 実装前の確認で、`split_display_elements`の非発音文字結合、空発音seedの重み、`_interpolate_missing_bounds`のゼロ幅区間未処理、`_to_partition`のblank挿入経路を確認した。
- 2026-08-15: `str.isspace()`の各code pointを独立seedにし、空の発音・token範囲と原文source rangeを保持した。空白を跨がない既存の小かな・促音・長音・句読点規則は維持した。
- 2026-08-15: CTCの隣接spanで空白区間がゼロ幅になる場合は、直接の前後anchorを含む局所範囲だけを重み再partitionし、本文空白を`text == ""` blankと混同しないようにした。既存の手動マージが新seedへ遡及分割されない連続source-range保護も追加した。
- 2026-08-15: `tests/test_lyrics_elements.py`、`tests/test_element_reconciliation.py`、`tests/test_api.py`を実行し、合計65件が成功。`tests/test_subtitle_export.py -k lrc`は3件成功し、空白本文と開始時刻タグを確認した。対象ファイルの`compileall`と`git diff --check`も成功した。GUI／portable buildはPython側の変更のみのため未実施。

## 状態判断

完了。新規Standard Alignのseed分割、隣接／部分CTC、line-proportional、空白行、句読点境界、LRC保持、既存手動マージ保護を対象テストで確認した。既存の保存済み／手動表示素のmigrationや公開schema/API変更は行っていない。
