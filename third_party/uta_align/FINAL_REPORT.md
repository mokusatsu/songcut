# uta-align 最終報告

## 結論

既知歌詞の全行を音声時間へ割り当て、JSON・SRT・LRCへ出力する
`uta-align 0.1.0` を更新した。通常の認識不足、曖昧性、anchor不足、
silence衝突では4段階fallbackによりexit 0で全行を返す。入力・decode・設定の
技術的失敗だけがnonzero終了になり得る。

今回の修正は公開コード・公開合成testだけで行い、非公開評価assetや
reviewer領域・logは参照していない。

## 主要変更

- progress priorのline local top1 collapseを廃止し、各lineのtop-K high-confidence
  unprompted/trusted word hypothesesを保持する。distinct-line pair modelを全line
  1 voteで評価し、inlier line coverage→time span→qualityの辞書式RANSAC/Hough選択後、
  Theil-Senでrefitする。候補本文は使わない。
- prior slopeをhard barrier除外usable audio span/総歌詞weightの比例rateと比較し、
  slope/span ratio、inlier line fraction、endpoint coverage、audio overlapをgeneric
  configでvalidateする。不適合時はproportional_fallbackとしprior penaltyを無効化する。
- candidate positive emissionをmedian/MADで正規化し、prior penalty capとskip penaltyを
  同じ相対尺度へ移した。selected ratio 0.70以上・prior validを満たす場合だけ（path marginは診断・confidence用）
  lattice全体をacceptし、不成立pathは全rejectしてlegacy経路へ一切部分注入しない。
- accepted latticeのnonstrong行はStage3/4のauthoritative local desired center+fused duration
  として実使用する。周囲へ伝播せず、strong unprompted/trusted anchorはexact保持する。
  診断はpath selected/accepted/rejected/injected/strong override/demotion件数とreasonのみ。
- 通常mixのfreezeにunpromptedまたはtrusted acoustic sourceを最低1つ必須にした。
  prompt-only multi-group consensusはsource-family相関cap後も局所provisionalに留める。
  segment-word corroborationも別group・別source familyかつreliable sourceを含む場合だけ成立する。
- 全line candidate poolにglobal monotonic latticeを追加した。candidate/line skip、時刻順・
  non-overlap、repeat slot一意性、hard barrier、durationを同時制約し、similarity・quality・
  strategy diversity・prompt correlationと歌詞文字進捗対time gapを全曲pathで評価する。
- 高信頼unprompted/trusted word候補だけから固定2.0秒inlierのdeterministic pair-consensus/
  Theil-Sen priorを作る。根拠不足時は全曲比例priorへ戻る。pathと矛盾するprompt-only freezeは
  降格し、path候補は自line限定provisionalとして補間・外挿へ伝播しない。
- start/path確定後、同line・start clusterのword/segment endをsource/group capしたHuber
  medoidで融合する。証拠不足endだけ、corroborated候補からrobustに学んだsec/char duration
  priorとraw endを固定50/50 blendし、next start・hard barrier・duration範囲でclampする。
  lattice診断は件数・score/margin・prior inlier・fusion件数のみで本文を含まない。
- full-audioの無prompt passを常時保持し、短いhead/global `initial_prompt`を最大1件、
  overlap/retryではunprompted・local `initial_prompt`・local `hotwords`を循環する。
  local文脈はwindow進捗と歌詞文字累積量から選び、token上限・総request budget・loop guardを
  適用する。prompt付き失敗は非致命で、診断へprompt本文を出さない。
- request schemaと観測/candidateにprompt strategy、source family、independence groupを
  追加した。同一window/strategy/boundary familyの重複はsupportを水増しできず、
  decorrelated group数とstrategy diversityを公開診断へ出す。
- 通常mixのsegment凍結はsimilarity 0.78以上、decorrelated group 2以上、strategy 2以上、
  別groupのword boundary時刻合意、duration/quality条件をすべて必須にした。失敗候補は
  局所weak hintだけに残り、補間・外挿・伝播には使わない。
- 同一反復歌詞を時刻occurrence slotへ順序通り一対一対応し、固有anchor、
  block、segment/line support、欠落内部回の位置priorで通常の近接候補を解く。
- strict曖昧性は構造化`AlignmentError`として単体検証可能なまま保持し、
  public pipelineは診断を残してrelaxed/provisional結果へfallbackする。
- stage 3は有効anchorを元時刻・元safe componentに凍結する。forbidden衝突・
  順序破綻anchorは移動せず降格し、未anchor行だけを左右anchor間または
  leading/trailing safe componentへ配置する。
- stage 3 allocatorはdesired centerに最も近い実行可能componentを選び、
  後続行用capacityを予約する。最終validate失敗時はstage 4へ移る。
- recognition gapは十分に歌詞一致したcandidateへ寄与する観測だけから求めるが、
  recognition-only gapはsoft timing penalty/診断でありhard forbiddenにしない。
  hard barrierはtrusted vocal由来confirmed acoustic silence、または隣接高品質anchor間の
  semantic barrierだけに限定する。confirmed silenceもmissing-line需要に対するsafe容量・
  minimum line・極端fragmentation guardを通らなければsoftへ降格する。
- decorrelated independence groupの候補を時刻cluster化し、weighted medianで代表時刻を求める。
  group/strategy support数・時刻dispersion・歌詞一致度・confidence・no-speech・境界種別を
  quality scoreとして診断へ出す。通常mixの単発generic候補、word/unknown境界、
  外れ値・別時刻競合は固定anchorにせず弱いhintへ降格する。
- 隣接する高品質歌詞anchor間のhard gapをsemantic no-singing barrierにする。
  stage 3の弱いhintはstrong anchor境界・barrier・safe componentを越えられない。
  同一反復歌詞は別occurrence slotとして競合降格の対象外に保つ。
- strict失敗後もeligible-only pathを先に復元する。通常の局所競合は当該行だけを
  降格するが、未解決の反復occurrence groupは全所属行を一括降格し、一部だけを
  強anchorとして残さない。resolved groupは保持する。診断はordinal group ID・
  行index・reasonのみで歌詞文字列を含まない。
- all-candidate DPはstrongがない行のweak hint補完専用とし、高score weakによる
  同一行strong上書きを禁止する。stage 3 APIもfrozen anchorsとweak hintsを分離した。
- recognition-only soft gapをstage 4 optimizerまで伝搬した。既定は有限・段階的な
  overlap penaltyで、zero-overlapを辞書式に強制しない。小さなsoft overlapと
  center/hint geometryを同じ有限目的で比較する。従来の回避・圧縮・最小侵入は
  `conservative_soft_gap_avoidance=true`の明示optionとして残した。trusted vocal
  activityはsoft penaltyより優先し、soft内のlow-support hintは当該行だけ局所downweight
  する。診断はpenalty mode/weight、overlap秒、activity有無を歌詞/STT本文なしで報告する。
- stage 4は複数barrier間のsafe componentへ全行を単調配置する。anchor間runは
  stage 3と同じdesired center・duration・weak hintを使い、余剰容量ではdurationを
  引き伸ばさない。既存consensus品質・support・dispersion・boundary条件を満たす
  weak hintは凍結せずprovisional直接観測として扱う。ただしstrong ambiguity、
  unresolved repetition group、temporal cluster競合、順序・barrier・component衝突を
  理由に降格した候補はdirect/低品質blendの両方から除外し、runへ時刻を伝播しない。
  group降格理由はcandidate metadataと行index/reasonだけの診断に保持する。
  安全な単調hint 2点以上から中間行を補間し、leading/trailing欠測を外挿する。
  no-trusted-hint runはanchor隣接safe componentまたは両anchor間の利用可能spanへ、
  歌詞weight累積分位で分散する。trusted vocal activityがあればbarrier/anchor境界内の
  activity component容量へ先に分位配置し、activity容量不足時だけ外側safe spanを使う。
  component割当と各行の順序制約付きweighted projectionは希望center誤差を最小化し、容量不足時
  だけdesired durationを比例圧縮してconfidenceを0.02以下にする。safe容量が真にzeroの場合のみ
  barrier_overrideを明示したemergency配置を使い、confidenceを0.01以下にする。
- stage 3がrun容量不足だけで失敗しても、stage 4はclassified strong anchorを
  exact時刻・component・provenanceのまま実出力へ保持する。leading/intermediate/
  trailingの未anchor runだけを独立圧縮し、zero-run競合時だけ低quality側anchorを
  降格して再試行する。
- selected input・classified frozen/demoted・actual final outputを別診断にした。
  actual frozen/demoted/weak-usedはline provenanceから再計算し、互換countもactualを示す。
- successful JSON全体から未知STT本文を除去した。rejected observationには
  reason・時刻・confidence・no-speech・provenance等の非本文metadataだけを出す。
- 表示歌詞はtrim済み元入力を保持する。NFKC・casefold・句読点除去は照合用
  `normalized`だけに適用する。

## Fallback contract

1. strict alignment
2. relaxed order-constrained assignment
3. frozen-anchor component-aware interpolation/extrapolation
4. barrier-aware provisional schedule（zero-capacity時のみemergency override）

全stageで入力歌詞の件数・文字列・順序を保持する。stage 2/3/4は低confidenceと
明示provenanceを持ち、fallback診断にはstage、reason、対象行、warning、STT
request数、元strict failureを格納する。曖昧時はscore margin、競合candidate時刻、
best/alternative pathも格納する。strong selected/frozen/demoted数、weak hint数、
上書き防止reason、barrier respect/override、safe容量、圧縮行数も格納する。

## 公開検証

| 検証 | 結果 |
|---|---|
| `pytest -q` | 158/158 pass |
| `ruff check .` | pass |
| `mypy src` | 14 source files、0 issue |
| wheel・sdist build | pass |
| CLI `--help` | exit 0 |
| sdist展開後test | 158/158 pass |

公開testには反復2/4/6/8回、真の曖昧性、無anchor・無音、全出力形式、
後方component anchor凍結、複数anchor/component、leading/trailing、anchor降格、
capacity不足、unknown STT本文非漏洩、全角記号・互換文字・内部空白・BOMの
表示保持に加え、robust consensus外れ値、単発generic降格、別時刻cluster競合、
反復slot分離、semantic barrier、weak hint component制約、strong/weak上書き防止、
局所競合strong保持、複数barrier Stage 4、容量不足圧縮、微小正容量、zero-capacity
emergency override、2-anchor exact保持、leading/intermediate/trailing run圧縮、
provenance由来actual count、zero-run低quality anchor降格、未解決反復group全体降格、
反復診断の歌詞非漏洩、Stage 4余剰容量でのleading/intermediate/trailing希望長・
希望center保持、weak hint有無に加え、高品質hint 2点による補間・前後外挿、
single hint非外挿、矛盾hint降格、barrier/component、不足容量圧縮、anchor exact保持、
設定上限を4.848秒超過するproxy anchorの降格、semantic conflict hint 7理由の
geometry除外、安全hint混在、single-pass維持、no-hint累積分位spread、複数component、
multi-observation robust endとlong single proxy除外、recognition-only soft gap、
confirmed silence capacity guard、trusted activity 0/1/multiple/global/不足時fallback、
soft gapのleading/intermediate/trailing・複数区間・hard barrier・frozen anchor・
比例圧縮・minimum不可避侵入・weak hint局所downweight・全fallbackに加え、
context locality/token cap、initial_prompt/hotwords正確転送と排他、文脈variantによる
coverage増加、prompt失敗fallback/本文非漏洩、decorrelated support cap、segment凍結
3条件の個別失敗と全条件成立、既定finite soft-gap penaltyを含む。さらにRound12でprompt-only multi-group拒否、unprompted corroboration、source-family cap、
global path一貫性、repeat slot、barrier/skip、progress prior outlier、path conflict demotion、
source-capped end fusion、robust duration blend、lattice failure時の全行Stage4を検証する。 Round13ではさらにcoherent alias majority、
plausible multi-hypothesis time-span選択、normalized skipで70%以上選択、sparse全reject、
Stage3 authoritative center/end、strong exact、reject時legacy全行、診断本文非漏洩を検証する。Round14ではmargin 0でもfull path受理と全hint実使用、remote top-path低confidence、weighted q=0.85のmedianより遅いendとclamp/order/duration、family cap、end reliability tie-break、aggregate診断のredaction/replay安定性を検証する。H14-1ではproportional priorのdefault atomic rejectと明示opt-in低confidence、28/30 partialの全reject/full completion、76秒相当absolute progress outlier、hard-barrier paddingを除いたin-envelope pass、trusted acoustic exemption、validated-prior residual gateを検証する。追加保守化ではdefault deviation 0.20で30等長line23の公開synthetic（deviation約0.221）をdemoteし、明示0.25のみpassかつrelaxed診断となることを固定する。

## 残存リスク

実faster-whisper modelと実歌唱音声による精度評価は未実施であり、実曲精度は
保証しない。stage 4は全行完走を保証する暫定scheduleであり、通常はbarrierを
尊重する。safe容量zeroのemergencyだけは無歌唱区間と重なり得るため、
barrier_override、confidence 0.01以下、warningを必ず確認すること。
