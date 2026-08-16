# SCUT-073 Cut出力のAAC/Opus True Peak音量補正

## ユーザーからの指示

Cutの出力ダイアログに「音量を自動補正する」のチェックボックスを置き、チェックボックスがONになっているときのターゲット音量（デフォルトは-1dB）の設定項目を設けてください。

## 目的

Cutで書き出す動画の音声を、出力後のデコード音声で測定したTrue Peakが既定値
`-1.0 dBTP`程度になるように補正する。音量補正の段階ではPCM化後の再エンコードを
行わず、YouTubeへアップロードする入力ファイルへ補正結果を持たせる。

なお、現在のCut出力は区間の前後を作るために音声を一度AACまたはOpusへエンコード
している。このタスクで保証する「無劣化」は、その既存のCut用エンコードに対して
音量補正のための追加再エンコードを行わないことを意味し、元音声との完全な
ビット一致を意味しない。

## 取り込む既存成果物

- `lossless_audio_gain-0.1.0`は、ユーザーが配置したソースを変更せずに取り込む。
  現在の確認元は`.codex-temp/lossless_audio_gain-0.1.0`および
  `C:/Users/lain/Downloads/lossless_audio_gain-0.1.0-source.zip`である。
- ソースZIPのSHA-256は
  `43998C4C3FE7CB081E25C1FCA7FCD3BB4B7044089618839B9BBC4F1C6D5BBE20`。
  実装着手時に`third_party/lossless_audio_gain/lossless_audio_gain-0.1.0`へ
  同じ内容を固定し、作業用`.codex-temp`やDownloadsを実行時参照しない。
- パッケージの公開APIは`normalize_true_peak`、`measure_true_peak`、
  `GainResult`。Python依存はなく、`requires-python >=3.10`であるため、Songcutの
  現行Python要件内でそのまま利用する。
- `pyproject.toml`へローカル依存を追加し、テスト時はsourceディレクトリを解決する。
  `packaging/build_dist.ps1`は同sourceの`src`をPyInstallerの`--paths`へ追加し、
  `--collect-all lossless_audio_gain`で純Pythonモジュールをアプリ内へ取り込む。
  `lossless_audio_gain`自体を`dist/<package>/third_party`へ生コピーせず、配布用
  `third_party`の実行時コピーはFFmpegと今回明示されたmp3rgainのallowlistだけにする。
- ユーザー指示に従い、ライセンス確認を受入れ停止条件にはしない。ソース内容と固定
  hashの一致、および実行時に同じバージョンが使われることだけを確認する。

## 重要な依存・制約

- `lossless_audio_gain-0.1.0`のAAC実装は、内部で`mp3rgain` 3.2.0以上を呼び出して
  `global_gain`を書き換える。パッケージ単体だけではAAC処理は完結しない。
- 現在のSongcut作業ツリー／PATHには`mp3rgain`の配布用パッケージ全体がないため、
  実装前にその全体を`third_party/mp3rgain`へ配置し、含まれるファイル一覧とSHA-256を
  固定する。実行ファイルだけを抜き出したり、配布用ドキュメント等を削ったりしない。
  実行時は`third_party/mp3rgain`内の固定パスから`mp3rgain_bin`を解決し、PATH探索や
  実行時ダウンロードは行わない。
- リリース用portable packageの`third_party/mp3rgain`はfull／standardの両方へ同じ全体を
  コピーする。standardから除外してよいのは既存契約の`third_party/ffmpeg`等だけであり、
  `mp3rgain`をfull限定にしない。これはSCUT-062のFFmpeg限定コピー方針に対する、今回の
  ユーザー明示要件に限定したallowlist例外として記録する。
- 代替AAC parser、`aacfade`の別実装、`mp3rgain`互換helperを追加せず、AACの正規
  書換え経路は取り込んだパッケージへ一本化する。Windows用`mp3rgain.exe`を用意
  できない場合はAACを完了扱いにせず、Opusだけ先行完了もしない。
- パッケージのOpus実装はOgg Opusの単一論理ストリーム専用であり、WebM/MKAを直接
  受け付けない。したがって現行Cut出力のWebM/MKAへは直接渡さない。

## 変更範囲

- GUI/APIの現行Cut smart export（`/export/jobs`）とCLIの`--mode smart`に、出力音声の
  測定、補正、再検証を追加する。
- Cutの出力ダイアログに「音量を自動補正する」チェックボックスと、ON時のターゲット音量
  （デフォルト`-1.0 dBTP`）設定を追加する。チェックボックスがOFFのときは補正しない。
- `songcut/smart_export.py`を中心に、`lossless_audio_gain`の公開APIを呼び出す薄い
  統合処理を追加する。AAC／Opusのビットストリーム解析やゲイン計算をSongcut側へ
  複製しない。
- 既定ターゲットは`-1.0 dBTP`とし、GUIからチェックボックスON時に変更できる。設定画面や
  project schemaへは永続設定を追加しない（セッション内のダイアログ入力のみ）。
- CLIの`accurate`／`copy`は現行のlegacy経路であり、smart exportと共通化できることを
  検証した場合だけ同じ補正器へ接続する。接続しない場合は対象外であることをCLI文書と
  briefへ明記し、無音の挙動差を作らない。

## 実装方針

1. **共通の音声artifact段階を作る**

   - smart span経路とfull re-encode／fallback経路の両方を、video-only artifactと
     package対応の音声artifactへ分離する。現行full re-encodeのように動画と音声を
     一つのFFmpegコマンドで最終コンテナへ直接書く経路は、補正対象では使わない。
   - AACは常に一時`M4A`（`aac_low`、mono／stereo）へ一度だけエンコードし、Opusは
     常に一時Ogg Opus（`.opus`）へ一度だけエンコードする。最終コンテナがMP4、MKA、
     WebMのいずれでも、補正前後の音声artifactはこの形式に統一する。
   - 一時artifactは既存のCut用一時ディレクトリ内で管理し、公開出力へ書き込む前に
     補正と検証を完了する。

2. **`lossless_audio_gain`で補正する**

   - 音声artifactへ次の固定設定で`normalize_true_peak`を呼ぶ。
     `target_true_peak_dbtp=-1.0`、`verify=True`、`ffmpeg_bin`／`ffprobe_bin`は
     同梱FFmpegの絶対パス、AACは同梱`mp3rgain.exe`の絶対パス、
     `aac_write_undo=False`、`aac_check_reversible=True`、
     `r128_policy="neutralize"`とする。
   - パッケージの`GainResult`から、測定前、要求ゲイン、実適用ゲイン、予測値、検証後
     True Peak、backend、量子化誤差、警告を既存のsmart export結果／診断ログへ記録する。
   - 補正後の最終muxにも`measure_true_peak`を適用し、package対応artifactの値と最終
     コンテナの値を同じ測定方法で突き合わせる。失敗、NaN、無音、対象外codecは
     「補正済み」と報告しない。

3. **AAC**

   - `lossless_audio_gain`のAAC-LC検証と`mp3rgain` backendを使用する。 `global_gain`
     以外のAAC payload／codec configをSongcut側で触らない。
   - 自動モードの`not_above`量子化で、目標を超えない側へ安全に丸める。AACの約
     `1.50515 dB/step`による残差は結果へ残し、`-1.0 dBTP`へ細かく一致しない場合を
     正常な量子化誤差として扱う。
   - `aac_write_undo=False`でmp3rgainのundo metadataを付けず、`aac_check_reversible=True`
     として一時コピーのforward／inverse `mdat` hash検証を必須にする。
   - AAC-LC以外、raw ADTS、HE-AAC／xHE-AAC、3ch以上、複数音声stream、範囲外または
     変更field数0は、ファイルを公開出力へ昇格せず失敗にする。

4. **Opus**

   - Ogg Opus artifactへ`lossless_audio_gain`を適用し、`OpusHead`のOutput Gainを
     Q7.8で変更する。Opus audio packetは再エンコードせず、パッケージが行うCRC更新
     以外の変更を許可しない。
   - `r128_policy="neutralize"`で`R128_TRACK_GAIN`／`R128_ALBUM_GAIN`の二重適用を
     避ける。既存Output Gainは上書きせず累積deltaとして扱う。
   - 補正済みOggをWebM/MKAへ`-c:a copy`でremuxし、最終コンテナのCodecPrivate／
     `OpusHead`に補正値が引き継がれ、最終デコードTrue Peakにも反映されることを
     fixtureで確認する。引き継がれない場合はFFmpegの別metadata経路へ黙って切り替えず、
     パッケージ側の対応範囲または出力コンテナ方針の判断を停止条件にする。

5. **muxと互換性**

   - ゲイン適用後の最終muxは`-c:v copy`／`-c:a copy`とし、ゲイン適用後に音声encoderを
     呼ばない。必要なcontainer optionだけを既存profileから引き継ぐ。
   - 既存のcontainer選択、video smart render、音声のbitrate、Cutの区間契約を変更しない。
   - AAC/Opus以外の音声、音声なし、YouTube以外の用途へ新しい音量タグを強制しない。

6. **配布**

   - `lossless_audio_gain`のsource snapshotはPyInstallerに取り込む。`mp3rgain`は
     `third_party/mp3rgain`の配布用パッケージ全体を、配布先の同じ相対パスへコピーする。
     配布用`third_party`のコピーはFFmpegとmp3rgainの明示allowlistに限定し、汎用再帰コピーは
     復活させない。
   - アプリはportable rootから`third_party/mp3rgain`を解決して`mp3rgain_bin`へ渡す。
     clean source環境、通常portable build、PyInstaller実行後のimport、同梱FFmpeg、
     同梱mp3rgainの起動確認に加え、`-Release`のfull／standard ZIP双方の内容を検査する。

## 禁止事項

- `volume`、`loudnorm`、`replaygain`等のPCMフィルタを補正後の音声へ適用しない。
- AACを単なるMP4 metadata、ReplayGain tag、track volumeで代替しない。
- `lossless_audio_gain`の内部を改変しない。AAC global_gain parserやOpusHead parserを
  Songcut側へ複製しない。
- 補正後の音声へFFmpeg encoderを再度適用しない。OpusのFFmpeg `opus_metadata`だけへ
  切り替えるフォールバックも作らない。
- Sub出力、scratch proxy、project schema、Cut/SubのUI共通化へ変更を広げない。
- `lossless_audio_gain`のsource snapshotを配布先`third_party`へ生コピーしない。
- `third_party/mp3rgain`を実行ファイル単体へ縮小したり、full Releaseだけへ同梱したり、
  PyInstaller内部へ移して配布先`third_party`から外したりしない。実行時ダウンロードにも
  切り替えない。
- 既存README、GUI、Python、code-map、SCUT-064〜072関連dirty差分を戻す、整形する、
  stageする、commitする、pushする操作を行わない。

## 完了条件

- `lossless_audio_gain-0.1.0`のsource snapshotが指定hashと一致し、source実行環境と
  portable PyInstaller環境の両方で`normalize_true_peak`をimportできる。
- `third_party/mp3rgain`に配布用パッケージ全体が配置され、ファイル一覧／SHA-256が固定され、
  その内部の`mp3rgain.exe`のversion／絶対パス解決が固定され、AAC統合試験がPATH依存なしで通る。
- 通常portable packageの`third_party/mp3rgain`にsource packageと同じ全ファイルがあり、
  `-Release`で生成したfull／standard ZIPの両方にも同じ全体が含まれる。standard ZIPが
  `third_party/ffmpeg`を除外しても、`third_party/mp3rgain`は除外しない。
- AAC-LCとOpusのCut smart exportが、補正前後のTrue Peakを同じ測定方法で記録する。
- Opusは最終コンテナの補正後True Peakが`-1.0 dBTP ±0.05 dB`以内で、上限を超えない。
- AACは最終コンテナの補正後True Peakが`-1.0 dBTP`を超えず、対応fixtureでは量子化誤差を
  含めて`±0.75 dB`以内に入る。未達時は補正済みと報告せず、理由を記録する。
- AACではglobal_gain以外のAAC codec config／access unit数／frame durationを維持し、
  OpusではOutput GainとCRC以外のOpus packet payloadを維持することをfixtureで確認する。
- 最終mux後のvideo frame数、音声codec、sample rate、channel count、A/V durationが既存の
  Cut出力契約を満たす。
- コマンド記録またはtest doubleで、ゲイン適用後に音声codec encoderが呼ばれていないことを
  確認する。
- 取り込んだパッケージのfocused pytest、Songcutのfocused pytest、全Python pytest、
  必要なGUI typecheck、`git diff --check`が成功する。
- AAC／Opus入力を使う通常portable Cut E2Eで、出力のcodec、True Peak、再生可能性、
  package対応artifactから最終コンテナへのgain継承を確認する。
- YouTubeへprivateまたはunlisted fixtureをアップロードし、処理完了後の実ストリームまたは
  Stats for nerds等で補正が反映されたことを確認する。アカウントまたはYouTube側の処理を
  自動再現できない場合は、状態を`実環境検証待ち`として残し、ローカル検証だけで完了にしない。

## テスト方法

- 取り込み: source ZIP hash、`__version__`、公開API、PyInstaller後のimport、
  `third_party/mp3rgain`の全ファイル一覧／SHA-256、内部`mp3rgain.exe`の明示パスを検査する。
- パッケージ回帰: `lossless_audio_gain-0.1.0/tests`をsource pathで実行し、OpusのCRC／
  Q7.8、AACの量子化／backend JSON／reversibility、measure／probe契約を確認する。
- ゲイン統合: 目標との差、Opus既存Output Gain、AAC 1.5 dBステップ、負／正ゲイン、範囲外、
  非対象codec、測定失敗、mp3rgain不在をSongcut側unit testする。
- Cut fixture: bundled FFmpegでmono／stereo、44.1／48 kHz、AAC-LC／Opusの短いvideoを
  生成し、smart span／full re-encode／fallback各経路の補正前後decode成功、packet数、
  duration、True Peak、バイト差分の範囲を確認する。
- Opus container: Oggでpatch前後のaudio packet payloadを比較し、WebM/MKAへremux後の
  CodecPrivateとdecoded True Peakが一致することを確認する。
- AAC container: M4Aで`mdat`のforward／inverse hash、変更field数、final MP4／MKAの
  decode、profile、access unit維持を確認する。
- FFmpeg command: 音声encodeはartifact生成時に一度だけ、gain後は`-c:a copy`のみである
  ことをcommand assertionで固定する。
- 回帰: 既存`tests/test_smart_export.py`とAPI export jobのsmart render契約、既存のAAC／
  Opus scratch／Sub出力へ影響がないことを確認する。
- 配布: bundled FFmpegと`third_party/mp3rgain`を明示して通常portable buildを行い、
  `-Release`のfull／standard ZIP双方でmp3rgain全体の存在、standardでの非除外、FFmpegの
  既存除外を検査する。

## 停止条件

- 指定hashと異なるsourceしか取得できない、または公開APIが計画記録と一致しない。
- `third_party/mp3rgain`の配布用パッケージ全体を用意できない、ファイル一覧／SHA-256を
  固定できない、内部`mp3rgain.exe`を起動できない、またはpackageが要求するJSON契約／
  gain適用stepを検証できない。
- full／standardのいずれかのRelease ZIPから`third_party/mp3rgain`の一部または全体が欠落する、
  またはstandardで意図せず除外される。
- AAC-LC以外を安全に識別・拒否できない、global_gain書換え後のdecode／reversibility／
  packet検証が安定しない。
- OggからWebM/MKAへremuxした後にOpus Output GainがCodecPrivateまたはデコード音声へ
  引き継がれない。
- OpusのOutput GainをYouTube処理系が反映しないfixture結果になり、入力コンテナまたは
  受入条件の判断が必要になる。
- True Peak測定値とYouTubeの表示値の意味が一致せず、targetの定義を変更する必要がある。
- 既存dirty変更と同じ対象ファイルを編集する必要がある。
- API schema、配布契約、後方互換レイヤーの変更が必要になり、ユーザー判断を要する。

## 開始記録

- 2026-08-16: `main` / HEAD `2dcea33f5b63bb29970ec9068ca99f5ced8cc606`で計画を作成。SCUT-072と、README、docs、GUI、Python、code-map、SCUT-064〜072関連の既存dirty差分を保持する。
- 2026-08-16: 現行Cut smart exportは`smart_export.py`でsmart span時に音声を一時artifactへ分離できるが、full re-encode時は動画と音声を最終コンテナへ同時エンコードしていることを確認した。両経路を共通artifact段階へ寄せる。
- 2026-08-16: `lossless_audio_gain-0.1.0`のsource ZIPを確認した。versionは`0.1.0`、純Python、依存なし、source ZIP SHA-256は`43998C4C3FE7CB081E25C1FCA7FCD3BB4B7044089618839B9BBC4F1C6D5BBE20`。公開APIは`normalize_true_peak`／`measure_true_peak`／`GainResult`。
- 2026-08-16: 同パッケージはAAC-LC MP4/M4A/MOVに対して`mp3rgain`を外部backendとして使い、OpusはOgg Opusだけを受け付けることを確認した。現行PATH／作業ツリーには`mp3rgain`実行ファイルがないため、固定版の同梱が未解決である。
- 2026-08-16: 同梱FFmpeg `8.1.2`と現行portable配布契約を確認した。ユーザー要件により、`third_party/mp3rgain`の配布用パッケージ全体を配布先の同じ相対パスへコピーし、full／standard Releaseの両方へ含める。SCUT-062のFFmpeg限定はmp3rgainに限って明示allowlist例外として扱う。
- 2026-08-16: 現時点では`third_party/mp3rgain`の配布用パッケージ全体は未配置であり、確認できたのは別リポジトリの`mp3rgain`ライセンスファイルだけである。実装前にユーザー提供物をそのまま配置し、実行ファイル単体へ縮小しない。
- 2026-08-16: RFC 7845、YouTube公式の推奨入力codec／音声拡張仕様を調査した。YouTube反映はローカル出力と分離した実環境ゲートにする。

## 実施証跡

- 2026-08-16: 実装着手。`mp3rgain` v3.2.0 を GitHub Release（`M-Igashi/mp3rgain`）から取得し、
  `third_party/mp3rgain/`（`mp3rgain.exe` 2568704 bytes + `LOCAL_SOURCE.json`）へ固定した。
  distribution zip SHA-256 `aa1688afb0e33db146af53dc1903c33ef24d22231c3beffb05a6d158fe3fa146`、
  exe SHA-256 `6b8a5fdf5d0df8caa630f3f79b87a5da07bc567c87463eddcae912ed101dfce6`。
  `--version` で `mp3rgain version 3.2.0`、`-o json`/`-s s`/`-g`/`-k` 契約を確認した。
- 2026-08-16: ユーザー指示により `aacgain` 1.9.0 も単独プログラムとして同梱対象へ追加した。
  `third_party/aacgain/`（`aacgain.exe` + `COPYING` + `README` + `LOCAL_SOURCE.json`）へ固定。
  archive SHA-256 `653eedc6397ae1feda9b287a943da432a2b92df6676b91dff53f212ae9b29ab1`。
- 2026-08-16: `lossless_audio_gain-0.1.0` source snapshot を `third_party/lossless_audio_gain/lossless_audio_gain-0.1.0` へ固定した。
  source ZIP SHA-256 が指定値 `43998C4C3FE7CB081E25C1FCA7FCD3BB4B7044089618839B9BBC4F1C6D5BBE20` と一致。
  `pyproject.toml` にローカル依存を追加し、pytest の `pythonpath` に source dir を追加した。
- 2026-08-16: ユーザー指示により、同パッケージの subprocess 起動部（`measure.py`/`aac.py`/`probe.py`）を
  `win_safesubprocess` + `CREATE_NO_WINDOW` へ書き換えた（標準 subprocess への import フォールバック付き）。
- 2026-08-16: `songcut/ffmpeg_tools.py` に `find_mp3rgain()` を追加し、portable root の
  `third_party/mp3rgain/mp3rgain.exe` 固定パスを解決する（PATH 探索・実行時 download なし）。
- 2026-08-16: `songcut/smart_export.py` を書き換え、smart span 経路と full re-encode 経路の両方で
  音声を共通 artifact 段階（AAC は一時 M4A、Opus は一時 Ogg Opus）へ分離し、
  `lossless_audio_gain.normalize_true_peak`（`target_true_peak_dbtp=-1.0`, `verify=True`,
  `aac_write_undo=False`, `aac_check_reversible=True`, `r128_policy="neutralize"`）を適用。
  最終 mux は `-c:v copy`/`-c:a copy` とし、mux 後に `measure_true_peak` で再測定して突き合わせる。
  `GainResult` と最終 True Peak を export 結果の `true_peak` キーへ記録する。
  補正失敗時は「補正済み」と報告せず、未補正の音声を維持して結果を省略する。
- 2026-08-16: `packaging/build_dist.ps1` を更新し、`third_party/mp3rgain` と `third_party/aacgain` を
  配布先 `third_party` へコピー（full/standard 双方）、`lossless_audio_gain` を PyInstaller の
  `--paths`/`--collect-all lossless_audio_gain` で取り込んだ（`--copy-metadata` は pip 未 install のため不使用）。
  standard ZIP の除外は既存 `third_party/ffmpeg` のみのままで、mp3rgain/aacgain は除外しない。
- 2026-08-16: 検証。focused pytest（`tests/test_smart_export.py`）27 passed、`tests/test_api.py`/`test_cli_integration.py`
  42 passed / 3 skipped、lossless_audio_gain の package 回帰 18 passed / 1 skipped（`test_aac_backend.py` の
  3 件は Windows で shebang スクリプトを spawn できない既存のテスト設計問題で、実 mp3rgain.exe を使う
  統合試験は成功）。`git diff --check` 成功。
- 2026-08-16: 実統合試験。同梱相当 FFmpeg 8.1.2 と同梱 mp3rgain 3.2.0 で、AAC（mp3rgain backend）は
  `-1.130 dBTP`、Opus（python-opushead backend）は `-1.010 dBTP` に補正（いずれも再エンコードなし）。
  AAC は補正前後で profile=LC / sample_rate / channels / duration / frame 数が維持され、global_gain 以外は不変。
  Opus は Ogg→WebM remux 後も `-1.010 dBTP` で gain が引き継がれることを確認した。
- 2026-08-16: 通常 portable build 成功（Version 1.1.88）。配布先 `third_party/mp3rgain` に
  mp3rgain.exe + LOCAL_SOURCE.json がコピーされ、`find_mp3rgain(portable_root)` が解決することを確認。
  `-Release` で full/standard ZIP 双方に mp3rgain（3 エントリ）と aacgain（5 エントリ）が含まれ、
  standard でも除外されないことを確認した。PyInstaller の Analysis TOC に `lossless_audio_gain` と
  全サブモジュールが取り込まれ、warn に未解決 import がないことを確認した。
- 2026-08-16: 元briefの「ユーザーからの指示」に従い、Cut出力ダイアログへ「音量を自動補正する」
  チェックボックスとターゲット音量（デフォルト -1.0 dBTP）設定を追加した。backend `ExportRequest` に
  `normalize_audio`／`target_true_peak_dbtp` を追加し、`export_smart_clip` は `normalize_audio=False`
  のとき補正しない（既存 CLI/テスト互換）。GUI は `api.ts`/`useCutOperations.ts`/`App.tsx`/
  `AppDialogs.tsx`/`i18n.ts` にチェックボックスと数値入力を配線した。GUI typecheck 成功、
  GUI vitest 473 passed、全 Python pytest 342 passed / 9 skipped、`git diff --check` 成功。
- 2026-08-16: ユーザー指示により、調整幅のGUI進捗メッセージ表示は採用せず、音声調整結果を
  テキストファイル `gain_report.txt` としてExport先フォルダへ出力する方式に変更した。
  各行に ファイル名・target_true_peak_dbtp・applied_gain_db・verified_true_peak_dbtp を
  タブ区切りで記録し、補正に成功したクリップだけを列挙する（補正なしならファイル自体を生成しない）。
  backend `_export_job` に `_write_gain_report`/`_export_gain_info` を追加し、`result.gain_report_path` へ
  記録する。GUI 側の進捗メッセージ追加（exportingItemGain/Done）は撤去した。

## 状態判断

実装済み・ローカル検証済み。YouTube への private/unlisted fixture アップロードによる実環境確認は
未実施のため、本タスクは `実環境検証待ち` とする。AAC は最終 True Peak が `-1.0 dBTP` を超えず
（量子化誤差込みで `±0.75 dB` 内）、Opus は `-1.0 dBTP ±0.05 dB` 内で上限を超えないことをローカルで確認した。
mp3rgain/aacgain は full/standard Release の両方へ同梱され、standard で除外されない。
