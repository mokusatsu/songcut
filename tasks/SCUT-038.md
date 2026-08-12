# SCUT-038 MSVC DirectWrite font resolverへの置換

## 目的

SubのASS Effect生成で必要なWindows実フォントの物理file、collection face index、weight／style、文字coverageを、runtimeのPowerShell／WPF子プロセスに依存せず取得する。MSVCで構築したx64 native DLLをPythonから直接呼び、現在の厳格なfont contractとlibass互換性を維持しながら、環境依存、console表示、字幕数に比例するprocess起動をなくす。

## 変更範囲

### Native resolver

- `native/windows_font_resolver/`へMSVC C++のx64 DLL projectとnative test targetを追加する。
- `DWriteCreateFactory()`とsystem font collectionを使い、installed fontのlocalized family name、face name、full name、PostScript name、weight、style、stretch、simulationをraw metadataとして列挙する。
- DLLはrequested name、bold／non-bold、upright／italic、stretch、simulationの合否を判定しない。具体的な照合・選択・拒否はPython側で行う。
- `IDWriteFont::CreateFontFace()`で物理faceを生成し、`IDWriteFontFace::GetFiles()`、`IDWriteLocalFontFileLoader::GetFilePathFromKey()`、`IDWriteFontFace::GetIndex()`から絶対pathとTTC／OTC face indexを取得する。
- Pythonが選択したcandidate IDとUCS4 code point列を`IDWriteFontFace::GetGlyphIndices()`へ渡し、raw glyph index列を返す。glyph index 0の合否やcontrol／format／surrogate／variation selectorの扱いはPythonが判定する。
- native APIとして取得不能なfile／path／faceはHRESULTとraw状態を返す。remote、in-memory、複数file、複数の異なる物理faceの製品上の合否はPythonが判定する。

### Native／Python ABI

- subprocessではなく`ctypes.WinDLL`から呼ぶversioned C ABIを公開する。
- ABIは`abi_version`と`struct_size`を必須にする。第1段階でinstalled fontを列挙し、collection generation付きcandidate IDを返す。第2段階でcandidate IDとUCS4 code point列を入力してface情報をprobeする。
- 第1段階の結果はcandidate ID、weight、style、stretch、simulationsとfamily／subfamily／full／PostScript nameを持つraw record群とする。第2段階はfile count、local-loader可否、物理path、face index、code pointごとのglyph indexを返す。
- 可変長dataは「必要buffer size取得 → 呼出側bufferを確保 → 再呼出」の2段階契約にし、DLLが割り当てたmemoryをPythonへ所有させない。
- DLLはnull、bounds、overflow、ABI、buffer、COM／HRESULTだけを検証し、製品policyを持たない。Python側が名前正規化、weight境界、許容style、simulation拒否、coverage、path／metadata、ambiguityを判定し、既存errorへ対応付ける。
- Python側の`ResolvedFont` public contract、cache key、SFNT name照合、file SHA-256、HarfBuzz計測呼出は維持する。

### 旧runtime経路の削除

- `_POWERSHELL_SCRIPT`、`_powershell_executable()`、`_run_wpf_probe()`、`SONGCUT_POWERSHELL`、Base64 command生成を削除する。
- native DLL欠落時にPowerShellへ戻るfallbackやcompatibility aliasは追加しない。DLL／ABI不備は起動または初回使用時の明示errorにする。
- `win_safesubprocess`はFFmpeg、API、launcher等の既存用途に残すが、font resolutionでは使用しない。

### Build／portable packaging

- Visual Studio Community／Build ToolsのMSVC v145（VS 18）またはv143（VS 2022）とWindows SDKを前提に、x64 Release、Unicode、`/MT`、warnings-as-errors、Control Flow Guard、ASLR／DEP有効でDLLを構築する。
- build entrypointはMSBuildを`vswhere`または明示pathから一意に解決し、利用不能時は必要componentを示して停止する。
- `packaging/build_dist.ps1`のPyInstaller入力へnative DLLを明示追加し、source開発とfrozen runtimeの双方で同じloaderが一意のDLLを開く配置にする。
- DLLのABI version、machine=x64、import依存、SHA-256をbuild／portable smokeで検証し、build文書とthird-party／license記録を更新する。

## 禁止事項

- PowerShell／WPF、registry-only推定、GDIだけの推定、別familyへのfallbackを残さない。
- PythonでDirectWrite COM vtableを独自再実装しない。Windows APIとの境界はMSVC DLLへ限定する。
- DLLへ名前照合規則、weight境界、許容style、simulation／coverage／ambiguityの判定条件を固定しない。
- font幅計測、Effect geometry、ASS parameter schemaをnativeへ移さない。
- requested nameに曖昧な部分一致、weightの最近傍fallback、style simulationを追加しない。
- prebuilt DLLだけを根拠なくcommitし、対応source／build手順／ABI testを欠落させない。
- SCUT-037の実環境検証完了前に本タスクを開始しない。
- 無関係な変更、commit、push、PR作成を行わない。

## 完了条件

- [x] font resolutionのruntime pathがMSVC native DLLのin-process呼出だけになり、PowerShell／WPF scriptとfont resolver用子プロセスが存在しない。
- [x] 現行`ResolvedFont`の全field、error category、cache、strict family／style／coverage contractが維持される。
- [x] DLLはraw情報収集だけを担当し、候補選択と合否判定条件がPython code／Pythonから渡すparameterだけに存在する。
- [x] `Noto Sans JP Medium` non-boldは実fileのweight 500、`Yu Gothic UI` regular／boldは正しいpathとface indexで一意に解決され、italic simulationは拒否される。
- [x] BMP、supplementary plane、ZWJ／ZWNJ、variation selector、unpaired surrogate、missing glyphの現契約がnative integration testで固定される。
- [x] 物理font path、TTC／OTC face index、family／face／full／PostScript nameがWindows providerとSFNT検証で一致する。
- [x] DLL欠落、ABI version／struct size不一致、x86 DLL、non-local font、複数物理faceが黙ってfallbackせず明示errorになる。
- [x] PowerShellをPATHから除外した隔離環境で、Morning Mistを含む全97 EffectのASS生成、sidecar、動画焼き込みが成功する。
- [x] font resolution中に`powershell.exe`、`pwsh.exe`その他font helper processが生成されないことを自動testと実process観測で確認する。
- [x] native unit／ABI／Python／GUI／portable build／Sub export回帰が成功し、DLL build toolchain、hash、検証証跡が記録される。
- [x] 公開build文書、コードマップ、task証跡がnative build／runtime構成と一致する。

## テスト方法

- MSVC native unit test: enumeration／candidate ID、collection generation、buffer sizing、null／bounds／overflow、HRESULT、raw metadata／glyph index取得。製品policyの期待値はnative testに置かない。
- Python policy unit test: Unicode name正規化、照合対象、weight／style分類、simulation拒否、coverage、candidate dedup／ambiguity、native error mapping。
- Windows DirectWrite integration: `Noto Sans JP Medium`、`Yu Gothic UI` regular／bold、TTC face、missing glyph、supplementary code point。
- Python ABI test: DLL version／struct size、2段階buffer、malformed output、error mapping、cache、SFNT metadata、SHA-256。
- `subprocess.run`／`Popen`を失敗させても`resolve_windows_font()`が成功するtestと、font resolver内の`powershell|pwsh|SONGCUT_POWERSHELL|EncodedCommand`静的検索0件。
- `python -m pytest -q`、GUI Vitest／typecheck／production build。
- `packaging/build_dist.ps1`、portable DLL machine／dependency／hash確認、PowerShellなしのportable smoke。
- `Noto Sans JP Medium`＋Morning Mist、複数style／複数行、全97 EffectのASS sidecar／burn-in回帰。
- Process tree観測でfont resolution中の新規子processが0件であることを確認する。

## 停止条件

- DirectWrite native選択と同梱FFmpeg/libassのDirectWrite providerが、同じfamily／weight／italic入力で異なる物理faceを選ぶ場合。
- variable font named instance、remote font、複数file faceについて、path／face indexを一意に証明できない場合。
- 現行利用fontに`IDWriteLocalFontFileLoader`で取得できない必要faceが存在する場合。
- ABIをversioned C boundaryに限定できず、PythonまたはMSVC compiler versionへ強く結合する必要が生じる場合。
- MSVC v143／Windows SDKを通常buildとCIで再現可能に用意できず、未検証binaryの同梱が必要になる場合。
- 対象ファイルに識別不能な並行変更が現れた場合。

## 実施証跡

- 計画追加: 2026-08-10。状態は未着手、依存はSCUT-037。
- 実施開始: 2026-08-10。利用者の明示指示により開始。開始branch `codex/SCUT-036-ass-lyric-effects-integration`、開始HEAD `c3f21e650f6be8ce9a9cb541c790a835ec77f13f`、dirty worktreeの既存SCUT-036／037差分を保持する。
- 設計確定: MSVC DLLは情報収集だけを行う2-stage ABIとする。第1段階でraw candidate catalog、第2段階で選択candidateのphysical face／glyph indicesを返し、全具体的判定はPythonへ置く。
- toolchain確認: Visual Studio Community 2026 `18.8.2`、MSVC `14.51.36231`、Windows SDK `10.0.26100.0`、x64 MSBuild／cl.exeを確認した。
- 現行調査: `windows_font_resolver.py`はPowerShellからWPF `GlyphTypeface`を呼び、font text／styleごとに候補を取得する。SCUT-037で`win_safesubprocess`＋`CREATE_NO_WINDOW`へ修正したが、PowerShell runtimeとprocess起動は残る。
- repository調査: 現行にnative project／DLL loaderはなく、portableは`packaging/build_dist.ps1`からPyInstaller `--onedir --windowed`で作る。従ってMSVC build、C ABI loader、PyInstaller binary同梱を一つのvertical sliceとして追加する必要がある。
- API根拠: Microsoft DirectWriteの`IDWriteFont`はphysical font、localized face／informational names、weight／style／simulation、font face生成を提供する。`IDWriteFontFace`はfile references、collection index、simulation、glyph indexを提供する。
- 物理path根拠: `IDWriteLocalFontFileLoader::GetFilePathFromKey()`はlocal font file reference keyから絶対pathを取得する。
- coverage根拠: `IDWriteFontFace::GetGlyphIndices()`はUCS4 code pointをCMAPのnominal glyph indexへ変換し、欠落文字はindex 0を返す。variation selectorはdefault variant扱いなので現契約どおりcoverage対象外にする。
- native実装: `native/windows_font_resolver/`にversioned C ABI、DirectWrite情報収集DLL、native ABI test、VS solutionを追加した。DLLはrequested family／bold／italic等を入力として受け取らず、raw candidate／name／file／glyph recordだけを返す。製品判定は`windows_font_resolver.py`に残した。
- Python実装: `windows_font_native.py`の`ctypes.WinDLL`二段階buffer bindingを追加し、旧PowerShell／WPF script、Base64 command、font resolverの`win_safesubprocess`経路を削除した。fallbackは追加していない。
- 実font確認: `Noto Sans JP Medium`は`C:\Users\lain\AppData\Local\Microsoft\Windows\Fonts\NotoSansJP-Medium.ttf`、face 0、weight 500、Normal、simulationなしへ解決した。DirectWriteのbase familyと静的Medium fileのSFNT family差は、全identity照合後に要求名と一致する実SFNT faceをPython側で優先する。
- native build: Visual Studio Community 2026 `18.8.2`、toolset v145、x64 Releaseでnative tests成功。最終DLL SHA-256は`2C0F1FA6BAAB33CB37633422B38DD5D598647F46D9B265CF9F0407BCC2F18F2D`、machine `0x8664`。package内`runtime/songcut_native/songcut_font_resolver.dll`とsource DLLのSHA-256完全一致を確認した。
- 自動検証: 全Python `428 passed, 2 skipped, 1 subtests passed`、native／resolver focused `28 passed`、字幕／APIを含むfocused `79 passed`。GUI typecheck成功、Vitest `48 files / 302 tests passed`、production build成功、`git diff --check`はerrorなし。
- portable: `packaging/build_dist.ps1`で`C:\dev\songcut\dist\songcut-win-x64` version `1.1.73`を更新。起動後`/health`、`/subtitle-effects/catalog`、model／FFmpeg確認はHTTP 200。catalogはv3.0.0、97 effects／97 unique stable IDs。起動processはportable launcherとElectronのみで、PowerShell/helperの常駐なし。
- コードマップ: embedded Pythonで224 files／2,541 nodes／9,296 edges、parse error 0、validate `ok: true`。native C ABI、ctypes bridge、Python policy、packaging flowを反映した。
- 当初停止: 利用者の「E2Eは停止して」という明示指示を優先し、PowerShellをPATHから除外した全97 EffectのASS／sidecar／動画焼き込みと、そのexport中のprocess tree観測を一時停止した。
- 検証再開: 2026-08-10。利用者からリリースビルド前に長尺E2Eを実行し、問題があれば修正・再コミット後にreleaseを作る明示指示を受けた。97 effects×10秒、PowerShellを除外したPATH、Python子process観測付きで再開する。
- 長尺E2E成功: `out/e2e-all-subtitle-effects-c08fdac-release`へ1280x720／24fps、97 effects×10秒の黒動画、ASS、SRT／style、manifest、字幕焼き込みMP4を生成した。manifestは97 unique stable IDs、連続した各10秒、expected／actual durationとも970.0秒。SRTは97 entries、動画9,848,401 bytes、ASS 19,719,838 bytes。
- 映像検証: 各区間の中央frame `120 + 240×index`を97枚抽出してsignalstatsを確認し、YAVG最小16.3798、黒／空白frame 0件。全区間に描画が存在する。
- process観測: PowerShellを除外したPATHでE2E Pythonの子processを250ms間隔で監視し、観測は期待される`ffmpeg.exe`とWindows `conhost.exe`のみ。`powershell.exe`／`pwsh.exe`は0件。E2E exit 0、stderr 0 bytes。
- 参考一次資料:
  - https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nn-dwrite-idwritefont
  - https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nn-dwrite-idwritefontface
  - https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nn-dwrite-idwritelocalfontfileloader
  - https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefontface-getglyphindices
