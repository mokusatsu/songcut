# SCUT-067: Standard AlignへのomniASR-CTC局所救済エンジン追加


## ユーザーの追記
omniASR-CTC-300M-openvino-fp16 にOpenVINO化したモデルを配置している。
最初から本体に実装せず、テストコードでomniASR-CTCによる再解析で精度が上がるかどうかを検証する。その結果を受けて本体に実装するかどうかを判断する。

## 目的

Standard Alignの表示素タイミング推定で、既存MMS/CTCが品質ゲートを通過できず`line-proportional`へフォールバックした日本語行だけを、`facebook/omniASR-CTC-300M`の局所CTCで再解析する。

MMSが合格した行、最終確定済みの歌詞行境界、手動表示素、既存の局所再解析契約は変更しない。omniASRも不採用の場合は、omniASR導入前と同じMMS由来`line-proportional`結果を返す。

## 背景と固定する判断

- SCUT-041は「Standard Alignの最終行区間を固定したまま」表示素タイミングを生成する。この不変条件を維持する。
- SCUT-043は対象行だけの再解析、同一行旧jobの取消、revision／epoch guard、manual表示素保護を実装済みである。新しいエンジンはこの経路を迂回しない。
- omniASRはMMSと競合する主エンジンではなく、MMSが`line-proportional`になった局所だけを救済する第2エンジンとする。
- 初期対象言語は日本語だけとする。英語・韓国語・中国語その他は本タスクで新規対応せず、既存MMS経路を維持する。
- 初期対象は表示素タイミングだけとする。Whisperが失った行頭や行境界そのものの補正は別タスクとし、本タスクへ混在させない。
- Everyric2のOWSM、BS-PolarFormer、全曲router、発音候補referee、vocal dominanceは本タスクへ導入しない。

## 基準リビジョンと参照実装

- songcut基準: `121470828e5e2d940c5b6b983c69a634a9fe953d`
- Everyric2参照基準: `b968a58655696e806d7abcb732e78ac9b4207963`
- モデル: `facebook/omniASR-CTC-300M`

参照コードの実装詳細を無条件にコピーせず、モデル入出力、tokenizer、blank ID、frame間隔、正規化を変換前後の一致試験で確定する。Everyric2およびモデルのライセンス、NOTICE、配布条件を確認し、派生物へ必要な表示を含める。

## 変更範囲

- MMS固有のemission生成と、表示素への逆写像・品質判定を最小の内部interfaceで分離する
- 既存MMS runnerを新interfaceへ適合させ、omniASR無効時の結果を完全に維持する
- omniASR-CTC 300Mの開発時変換、変換manifest、OpenVINO runtime loaderを追加する
- 日本語行について、表示素と独立した仮名CTC target、およびtarget tokenから表示素へのownershipを生成する
- Standard Align全体解析とSCUT-043行再解析の両方へ、MMS失敗時だけ動く局所omniASR救済を追加する
- MMS用とomniASR用の品質profileを分離し、raw confidenceをエンジン間で直接比較しない
- 表示素と診断情報へ、選択エンジン、target種別、model revision、測定／補間／fallbackのprovenanceをoptional fieldとして追加する
- 既存schema v3、旧project、GUIの未知optional field roundtripを維持する。新しい設定UIや編集UIは追加しない
- モデルstatus／download APIと既存model preparationへの最小限の配線を追加する
- full portable packageへ、ローカルに存在する変換済みomniASRモデルを収集できるようにする。通常版ZIPは既存どおりモデル本体を含めない
- Python unit／API／schema回帰、変換一致試験、ローカル実音声benchmark、portable build検査を追加する
- `docs/SUB_STANDARD_ALIGN.ja.md`、本brief、`tasks/task-list.md`、必要なコードマップを更新する

## 禁止事項

- MMS結果の`source`が`mms-ctc`または`mms-ctc-interpolated`である行にomniASRを実行・採用しない
- omniASRから歌詞行の`start`、`end`、`confidence`、`start_locked`、`end_locked`を変更しない
- 表示素解析からbeat snap、周辺行変更、全曲歌詞DP、Whisper再実行、Demucs再実行を行わない
- SCUT-043の通常行再解析で全曲MMSまたは全曲omniASRを実行しない
- omniASRの全曲logits／emissions、歌詞、音源、派生timingをartifact cacheへ永続化しない
- manual境界、manual merge、manual blank、stable ID、source range、origin keyを自動値で上書きまたは削除しない
- MMSとomniASRのraw confidenceまたはpath scoreの大小だけで採用エンジンを決めない
- PyTorch、Transformers、fairseq2、omnilingual-asrを通常runtimeまたはportable packageの依存へ追加しない
- 出所不明、revision未固定、hash未記録の変換済みモデルをダウンロードまたは同梱しない
- official tokenizerのpiece、ID順、blank IDを推測で実装しない
- omniASR modelが未準備または推論失敗の場合にStandard Align全体を失敗させない
- 本タスクへ行頭／行境界救済、OWSM、BS-PolarFormer、発音候補比較、伴奏dominance、GUI機能追加を混在させない
- 外部モデル成果物の公開、commit、push、PR作成をユーザーの明示依頼なしに行わない

## 設計上の不変条件

### 1. 救済ルーティング

採用順は次で固定する。

```text
MMS表示素推定
  ├─ source == mms-ctc                 -> 既存結果をそのまま返す
  ├─ source == mms-ctc-interpolated    -> 既存結果をそのまま返す
  └─ source == line-proportional       -> 日本語かつomniASR準備済みなら局所救済
                                           ├─ omni品質合格 -> omni結果を返す
                                           └─ 不合格／例外／取消 -> 元のMMS結果を返す
```

omniASR不採用時に新しい比例分割を作り直してはならない。MMSが返した元の`DisplayAlignmentResult`を保持して返す。

### 2. CTC emission interface

既存公開APIを壊さない内部interfaceとして、少なくとも次を表現する。

```python
@dataclass(frozen=True)
class CtcEmission:
    log_probabilities: np.ndarray
    vocabulary: tuple[str, ...]
    blank_id: int
    frame_seconds: float
    audio_seconds: float
    engine_id: str
    model_id: str
    model_revision: str
    target_kind: str

class CtcEmissionProvider(Protocol):
    def emissions(self, audio: np.ndarray) -> CtcEmission: ...
```

- `MmsOnnxRunner`はadapter経由でこのinterfaceを満たす。
- `MmsStandardAlignmentContext`、`prepare_standard_alignment_with_mms()`、`align_standard_display_elements()`、`align_single_standard_display_line()`の既存呼出契約は互換ラッパーで維持してよい。
- `align_display_elements()`へengine／source prefix／quality profileを渡せるようにするが、defaultは現行MMSとし、既存fixtureの値を変えない。

### 3. omniASRモデル変換とruntime

- 開発用変換スクリプトを`tools/`配下へ置き、通常runtime依存から隔離する。
- 初期基準はFP16 OpenVINO IRとする。INT8はFP16参照との一致条件を満たした場合だけ同一タスク内で追加してよい。
- 変換manifestへ、source repo、source revision、source file hash、tokenizer hash、converter revision、OpenVINO version、precision、sample rate、blank ID、input/output名、frame ratio、licenseを記録する。
- runtimeは変換manifestと全必須fileを検証し、不一致・欠落時はmodel unavailableとして扱う。
- 変換済みmodelの配布先はユーザーが承認したimmutable revisionを使用する。配布先を推測で新設しない。
- local／downloaded／bundledの探索順とatomic downloadは既存MMS model管理に合わせる。
- inference runnerはcompile済みmodelをprocess内poolで再利用し、同時推論を既存MMSと同等に直列化する。
- 音声入力の正規化は参照実装と一致試験から確定する。MMSの正規化を根拠なく流用しない。
- 局所探索窓は16kHz mono vocalsを使用し、最大30秒とする。30秒を超える場合は本タスクではchunk結合せず救済不採用にする。

### 4. 日本語CTC targetと表示素ownership

- 既存の`DisplayElementSeed`、source range、stable ID、表示テキストを正本とする。
- MMS用ローマ字targetは変更しない。
- omniASR用には、行全体の文脈を保持した仮名読みtargetを別に生成する。初期実装は既存pykakasiの行全体`hira`出力を再利用してよい。
- `target[i]`ごとに所有表示素を保持し、1表示素が複数の仮名tokenを所有できるようにする。
- 促音、拗音、長音、句読点、空白で、表示テキストの連結が原文と一致し、targetから表示素への対応が単調であることを検証する。
- tokenizerに存在しない文字は黙って除去せず、件数と文字種を診断へ記録する。句読点など発音対象外の文字は表示素として維持し、既存補間・blank処理へ渡す。
- tokenizer pieceの実査で「1文字1token」が成立しない場合もrange mappingで扱い、1文字1tokenを前提に配列をzipしない。

### 5. 局所窓と次アンカー

- 現行MMSと同じ行境界、vocals artifact、通常0.75秒／低信頼1.5秒のpaddingを初期値として使う。
- 対象行に続く最初の信頼できるWhisper行がある場合、その先頭3個のomniASR tokenを終了側アンカーとしてtargetへ加える。
- 次アンカーが遠く、窓が30秒を超える場合はomniASRを実行しない。
- synthetic star stateを使う場合は既存CTC Viterbiとの共通化を優先するが、MMSのstate pathを変更してはならない。
- omniASRは対象行のtoken spanだけを表示素へ返し、次行アンカーtokenを次行結果へ書き込まない。

### 6. 品質profile

omniASR専用profileを作り、次を少なくとも診断する。

- token coverage
- model内でのtoken confidence
- star ratio
- window edge concentration
- token speed
- next-anchor displacement
- monotonicity violation
- unsupported token ratio
- interpolated display-element ratio
- isolated first token

閾値はMMS定数を無条件に共用せず、ローカル検証セットで校正する。omniASRの採用はomniASR profile単独の合否で決め、MMS scoreとの大小比較は行わない。

### 7. provenanceと互換性

既存`source`値は変更せず、omniASR採用時だけ次を追加する。

- `omniasr-ctc`
- `omniasr-ctc-interpolated`

omniASR採用結果だけにoptional fieldとして、少なくとも次を保存・roundtripする。初期実装では既存MMS結果へこれらを追記せず、MMS合格行のserialized payloadを変えない。

- `alignment_engine`: `omniasr`。将来MMSへ同fieldを追加できる型にはするが、本タスクでは既存MMS payloadへ出力しない
- `model_id`と`model_revision`
- `target_kind`: `romanized-mms`または`japanese-kana`
- `timing_provenance`: `measured`、`interpolated`、`fallback`、`manual`
- `token_space`: token indexの解釈に必要なmodel／vocabulary識別子
- `fallback_reason`: omniASR未準備、不適格、品質不合格、30秒超過、取消、推論失敗など

旧schema v3でfieldが欠落していても読めること、旧projectを保存し直しても既存表示素を失わないことを固定する。

### 8. SCUT-043行再解析への統合

- cache hitでは保存済みvocalsから対象windowを読み、MMS局所解析後、必要な場合だけomniASR局所解析を行う。
- cache missでは既存どおりvocalsを一度だけ再生成・保存した後、対象行だけを処理する。
- 同一行再入、queued／running cancel、AbortSignal、project epoch、line revision、display-element revisionのguardを維持する。
- OpenVINO呼出しの途中取消ができない場合も、呼出し前後でcancelを確認し、取消後の結果、progress、cache mutationを適用しない。
- reconciliationは既存`element_reconciliation.py`を通し、manual要素をLCS対応または`orphaned_manual`／`text_conflict`として保持する。

## 実装手順

1. 現行MMSのみのunit、API、Kiritan benchmark結果を保存し、比較基準を固定する。
2. generic CTC emission／target／quality profile interfaceを追加し、MMS adapterだけで全既存試験とbenchmarkを再実行する。
3. 公式checkpointとtokenizerをrevision固定して取得し、開発用変換スクリプト、manifest、ライセンス収集を実装する。
4. PyTorch参照とOpenVINO FP16について、logit shape、frame mapping、token ID、top-1系列、forced-alignment境界の一致試験を行う。
5. `OmniAsrOpenVinoRunner`、model status、resolve、download、pool、lockを実装する。
6. 日本語kana targetとownershipを実装し、表示素seed／token rangeへ接続する。
7. Standard Align全体解析へMMS失敗行限定の救済routerを追加する。
8. SCUT-043の単一行jobへ同じrouterを追加し、取消・stale・manual保護を回帰試験する。
9. provenance、schema optional field、API payload、GUI pass-through roundtripを追加する。
10. 合成fixture、ローカルMMS失敗行、Kiritan非退行、portable buildを検証する。
11. 文書、task-list、コードマップ、実施証跡を更新する。

## 完了条件

- omniASRを無効化または未準備にした状態で、現行MMS unit／API／benchmark結果が回帰しない
- MMS結果が`mms-ctc`または`mms-ctc-interpolated`の行について、表示素、診断、行時刻、serialized field setが導入前と同一である
- `line-proportional`になった日本語行だけでomniASR inferenceが呼ばれることをspy／fixtureで証明する
- omniASR品質合格時は`omniasr-ctc`または`omniasr-ctc-interpolated`を返し、不合格・例外・model未準備・30秒超過・取消時は元のMMS結果を返す
- すべての経路で表示素が行全体をblank込みで隙間・重複なく覆い、順序・包含違反が0である
- 行`start`／`end`／lock／confidence、周辺行、beat結果がomniASR前後で変化しない
- manual境界、merge、追加blank、stable ID、source range、origin keyが局所再解析後も保持される
- 全曲Standard AlignでomniASRはMMS失敗行の局所窓だけを逐次処理し、全曲emissionsを生成・保存しない
- PyTorch参照とOpenVINO FP16でtoken ID順とframe mappingが一致し、変換一致試験の閾値と実測値が証跡へ記録される
- model status／download／bundled resolveがimmutable revisionとhashを検証し、壊れたmodelをready扱いしない
- 通常runtimeとportable packageにPyTorch、Transformers、fairseq2、omnilingual-asrが混入しない
- 旧schema v3 field欠落projectと新provenance fieldのroundtripが成功する
- 全Python test、対象GUI Vitest、GUI typecheck、production build、`git diff --check`が成功する
- full portable buildで変換済みmodelを収集でき、通常版ZIPにmodel本体が含まれないことを確認する
- ローカル実音声benchmarkで、既存Kiritan 8曲・24行・381内部境界の中央値が28.5317ms＋5ms以内、P90が108.8587ms＋10ms以内、構造違反0を満たす
- Git非追跡のMMS失敗日本語セットを3曲以上・12行以上・内部境界100件以上で評価し、omniASR採用行の中央値100ms以下、P90 250ms以下、行範囲外または次行への誤吸着0、かつ`line-proportional`件数が導入前より1件以上減る
- CPUでmodel compile時間、初回／再利用時の行推論時間、peak RSSを記録し、portable版でハング・process crash・メモリ不足がない

## テスト方法

### 自動テスト

- `tests/test_mms_alignment.py`: MMS adapter後の完全回帰、MMS accepted時のomni非呼出し
- `tests/test_omniasr_alignment.py`: model manifest、vocab、blank、target、ownership、local CTC、quality gate、30秒上限、次アンカー、例外fallback
- `tests/test_lyrics_elements.py`: engine別source／profile、補間、blank、partition、token-space provenance
- `tests/test_lyrics_line_api.py`: cache hit／miss、cancel、stale、revision、manual reconciliation
- `tests/test_api.py`: model status／download、全体解析router、旧schema互換
- GUI schema／project roundtrip Vitest: 新optional field保持と旧field欠落
- 変換一致test: 参照PyTorchとOpenVINO FP16の固定短音声、無音、日本語歌唱局所窓

### ローカル実音声benchmark

- 既存`tools/benchmark_kiritan_display_elements.py`をMMS非退行確認に使用する
- 新規rescue benchmarkは、MMS結果、omni候補、採否理由、境界誤差、構造違反、実行時間、RSSを同じJSONへ記録する
- 音源、歌詞、label、派生timing、raw logitsをGitへ追加しない
- 校正用lineと最終評価lineを分離し、同じlineで閾値調整と合否判定を行わない

### 配布検査

- `packaging/build_dist.ps1`の別名portable build
- full／通常版のmodel entry検査
- `runtime`内のPyTorch／Transformers／fairseq2／omnilingual-asr不在検査
- 変換manifest、LICENSE、NOTICE、model hashの存在確認
- `docs/code-map` maintain／validateと`git diff --check`

## 停止条件

- 公式checkpointからOpenVINOへ再現可能に変換できない、または参照実装とのtoken／frame対応を確定できない場合
- tokenizer piece、blank ID、sample rate、frame ratioを実測・manifestで固定できない場合
- ユーザー承認済みの変換済みmodel配布先とimmutable revisionがなく、download経路を推測しなければならない場合
- モデルまたは変換コードのライセンス条件がportable packageで満たせない場合
- generic化だけで既存MMS合格行の結果またはKiritan非退行条件が変化する場合
- omniASR採用可否をraw MMS scoreとの直接比較なしに校正できない場合
- 救済のために行境界、周辺行、beat、全曲Whisper、全曲omniASRを変更する必要が生じた場合
- manual constraintと新結果が矛盾し、ユーザー値を変更せずreconciliationできない場合
- ローカルMMS失敗セットを完了条件の件数で用意できない場合
- OpenVINO runtimeでportable対象機のmemory不足、process crash、または実用不能な停止が再現する場合

停止時は代替実装へ勝手に拡張せず、失敗した段階、再現コマンド、model／converter revision、実測値、残る選択肢を本briefへ記録してユーザー判断を待つ。

## 開始記録

- 未着手。開始時にbranch、HEAD、worktree状態、既存dirty差分、model artifactの所在とrevision、Kiritan基準値の再実行結果を記録する。

## 実施証跡

- 未着手。実行コマンド、変更ファイル、テスト件数、変換一致結果、model hash、ローカルbenchmark、CPU実測、portable build、archive内容、コードマップ検証を追記する。

## 状態判断

未着手。brief定義のみ。実装開始、commit、push、PR作成は別途明示された範囲で行う。

## task-list追記

`tasks/task-list.md`の「次のタスクID」を`SCUT-068`へ更新し、一覧へ次の行を追加する。

```markdown
| SCUT-067 | AI・解析 | Standard AlignへのomniASR-CTC局所救済エンジン追加 | 未着手 | 高 | SCUT-041, SCUT-043 | MMSが`line-proportional`へ落ちた日本語行だけをomniASRで局所救済し、MMS合格行・行境界・手動表示素を維持する | [詳細・証拠](../tasks/SCUT-067.md) |
```

## 根拠資料

- [Task brief運用](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/tasks/README.md)
- [SCUT-041 Standard Align表示素タイミング検出](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/tasks/SCUT-041.md)
- [SCUT-043 10秒遅延の行再解析と手動表示素保護](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/tasks/SCUT-043.md)
- [Songcut MMS alignment](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/songcut/mms_alignment.py)
- [Songcut display-element alignment](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/songcut/lyrics_elements.py)
- [Everyric2 omniASR engine](https://github.com/onpe5679/Everyric2/blob/b968a58655696e806d7abcb732e78ac9b4207963/everyric2/alignment/omniasr_engine.py)
- [Everyric2 alignment target](https://github.com/onpe5679/Everyric2/blob/b968a58655696e806d7abcb732e78ac9b4207963/everyric2/text/align_target.py)
- [facebook/omniASR-CTC-300M model card](https://huggingface.co/facebook/omniASR-CTC-300M)

SCUT-041の原文は次の不変条件を定めている。

> `Standard Alignの最終行区間を固定したままMMS/CTCの局所証拠から表示素タイミングを生成`

Everyric2のomniASR engineはtokenizerについて次の実装前提を記録している。ただしSongcut側では変換時に実査して固定する。

> `vocab: 9,812 SentencePiece 조각`
