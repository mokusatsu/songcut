import i18next, { type TOptions } from "i18next";
import { initReactI18next } from "react-i18next";

export type UiLanguage = "en" | "ja";
export type UiLanguagePreference = "system" | UiLanguage;

const en = {
  common: {
    load: "Load", analyze: "Analyze", export: "Export", exportTs: "Export TS", settings: "Settings",
    close: "Close", hide: "Hide", cancel: "Cancel", back: "Back", retry: "Retry", ok: "OK",
    done: "Done", discard: "Discard", recover: "Recover", unknown: "unknown", unknownTitle: "Unknown",
    before: "Before", after: "After", view: "View", skip: "Skip", auto: "Auto",
  },
  settings: {
    title: "Settings", playback: "Playback and analysis", scratchDuration: "Scratch preview duration",
    useProxy: "Use scratch audio proxy", waveform: "Waveform display", peak: "Peak Envelope", peakRms: "Peak + RMS",
    analysisDevice: "Singing analysis device", whisper: "Whisper transcription", export: "Export",
    filenameTemplate: "Filename template", placeholders: "Available placeholders: {{placeholders}}",
    projectOnly: "This setting is saved separately for each .songcut project.", tools: "Tools",
    toolsHelp: "Check the ffmpeg and ffprobe executables used by analysis and export.", ffmpegCheck: "ffmpeg Check",
    applied: "Changes are applied immediately and project settings are autosaved.",
    languageHeading: "Language", system: "System default", english: "English", japanese: "Japanese",
    languageNextStart: "Changes apply the next time songcut starts.",
  },
  whisper: {
    aria: "Whisper transcription settings", enable: "Enable Whisper transcription", bundled: "Bundled", ready: "Ready",
    missing: "Not downloaded", checking: "Checking…", model: "Model", language: "Language", device: "Device",
    prepare: "Prepare Whisper Model", transcribe: "Transcribe", retranscribe: "Transcribe / Re-transcribe",
    stale: "Settings changed — re-transcription required", installed: "{{size}} installed", auto: "Auto detect",
    openLanguages: "Open language options", closeLanguages: "Close language options", languages: "Whisper languages",
    noLanguages: "No matching languages", fastest: "Fastest", basic: "Basic", balanced: "Balanced", good: "Good",
    slower: "Slower", best: "Best",
  },
  app: {
    sourceMissingBanner: "Source missing — saved guide, segments, waveform, and transcripts remain available.", relink: "Relink",
    readOnly: "Read only", guidePlaceholder: "Paste timestamp comment here", model: "Model", language: "Language",
    device: "Device", transcriptMissing: "Transcript has not been generated yet.",
    transcriptFailed: "Latest transcription attempt failed: {{error}}", exportTsTitle: "Export TS",
    copiedLines_one: "Copied {{count}} timestamp line to the clipboard.",
    copiedLines_other: "Copied {{count}} timestamp lines to the clipboard.",
    proxyEnabled: "Scratch audio proxy enabled.", proxyDisabled: "Scratch audio proxy disabled.",
    waveformSet: "Waveform display set to {{mode}}.", analysisDeviceSet: "Singing analysis device set to {{device}}.",
    sourceMissing: "Source media is missing.", projectNotFound: "Project not found: {{path}}",
    saving: "Saving…", saved: "Saved", recoveryOnly: "Recovery only", saveFailed: "Save failed", unsaved: "Unsaved changes", saveError: "Save error", noProject: "No project", idle: "Idle",
    waveformFinalizing: "Waveform: Finalizing", waveformReady: "Waveform: Ready", waveformUnavailable: "Waveform: Unavailable",
    waveformWaiting: "Waveform: Waiting", waveformProgress: "Waveform: {{progress}}%",
    scratchDisabled: "Scratch audio: Disabled", scratchPreparing: "Scratch audio: Preparing AAC proxy",
    scratchReady: "Scratch audio: AAC proxy", scratchFailed: "Scratch audio: Original (proxy failed)", scratchOriginal: "Scratch audio: Original",
  },
  controls: {
    playStart: "Play start boundary (A)", playEnd: "Play end boundary (D)", boundarySeconds: "Boundary seconds",
    nudgeLeft: "Nudge nearest boundary left (Q)", nudgeRight: "Nudge nearest boundary right (E)",
    nudgeSeconds: "Boundary nudge seconds", start: "Start", previous: "Previous boundary (Ctrl+A)",
    play: "Play (Space)", pause: "Pause (Space)", next: "Next boundary (Ctrl+D)", zoomOut: "Zoom out (Z)",
    zoomReset: "100% zoom (X)", zoomIn: "Zoom in (C)", retryWaveform: "Retry",
  },
  tasks: {
    analysis: "Analysis", transcription: "Transcription", export: "Export", download: "Whisper model download",
    waveform: "Waveform generation", proxy: "Scratch audio preparation", generic: "A task",
  },
  segments: {
    export: "Export", title: "Title", id: "ID", start: "Start", end: "End", duration: "Duration", newTitle: "New Segment",
    confidence: "Confidence", text: "Text", editTitle: "Edit title", management: "Segment Management",
    removeTitle: "Remove Segment?", removeMessage: "The following segment will be permanently removed from this project.",
    removeUncheckedTitle: "Remove All Unchecked Segments?",
    removeUncheckedMessage_one: "The following {{count}} unchecked segment will be permanently removed from this project.",
    removeUncheckedMessage_other: "The following {{count}} unchecked segments will be permanently removed from this project.",
    sortTitle: "Sort Segments?", sortMessage: "Segments will be reordered by start time. Review the current and resulting order before continuing.",
    remove: "Remove Segment", removeMany: "Remove Segments", removeAll: "Remove All", sort: "Sort Segments",
  },
  timestamp: {
    choose: "Choose timestamp guide", found: "Timestamp guides were found in the yt-dlp metadata. Choose the version you want to review and edit.",
    candidates: "Timestamp guide candidates", timestamps: "{{count}} timestamps", likes: "{{count}} likes",
    editSelected: "Edit selected", edit: "Edit {{source}}", removeNonSongs: "Remove timestamps that do not mark songs, such as the stream start, MC, promotions, chat, or announcements.",
    apply: "Apply to guide", description: "Video description", comment: "Comment",
  },
  timestampExport: {
    choose: "Choose the timestamp output type.", "timestamp-comment": "Timestamp Comment",
    "youtube-chapter": "YouTube Chapters", "tsv-excel": "TSV/Excel", csv: "CSV", "audacity-label": "Audacity Labels",
  },
  output: {
    review: "Export Review", placeholders: "Placeholders: {{placeholders}}",
    createFolder: "Create a “{{name}}” folder inside the selected output folder", file: "File",
    checking: "Checking", smart: "Smart render", full: "Full re-encode",
    checkingSummary: "Checking source format and keyframes for each clip.", checkFailed: "Render mode could not be checked: {{error}}",
    smartCount: "Smart render {{count}}", fullCount: "Full re-encode {{count}}",
    allSmart: "All clips can copy their keyframe-aligned GOPs.", mixed: "Render mode is determined separately for each clip.",
    noGop: "No complete keyframe-aligned GOP is inside this range; the entire clip will be re-encoded.",
    unsupported: "{{codec}} in {{container}} is not eligible for smart rendering.", fullDetail: "The entire clip will be re-encoded.",
    smartDetail: "{{codec}} / copies {{copied}}; re-encodes {{encoded}} at the boundaries",
    progress: "Export Progress", preparing: "Preparing export.", failed: "Export failed.", complete: "Export complete.",
    progressNote: "Smart-render clips copy eligible GOPs and re-encode their boundaries; other clips are fully re-encoded.",
  },
  dialogs: {
    whisperNotReady: "Whisper model is not ready", whisperMissing: "The selected {{model}} model is not installed. Downloading is always an explicit action.",
    analyzeWithout: "Analyze without transcription", downloadAnalyze: "Download & Analyze",
    recoveryTitle: "Recover unsaved songcut edits?", recoveryAvailable: "A recovery snapshot is available.",
    recoveryDetail: "{{filename}} has a recovery snapshot from {{date}} at revision {{revision}}.",
    saveFailedTitle: "Could not save the current project", saveFailed: "The current project could not be saved.",
    recoveryWouldReplace: "A recovery snapshot is available, but it would be replaced after switching videos.",
    recoveryUpdateFailed: "The recovery snapshot could not be updated either.", discardChanges: "Discard changes",
    relinkConflictTitle: "Project already exists at relink destination",
    relinkDamaged: "The destination sidecar is damaged or uses an unsupported schema. It will not be overwritten unless you explicitly archive it as a timestamped conflict.",
    relinkExists: "A project already exists beside the selected source. Open it, replace it with the current project, or cancel.",
    openExisting: "Open existing", archiveReplace: "Archive conflict & replace", replaceCurrent: "Replace with current",
    quitTitle: "Quit songcut?", taskRunning: "A task is still running. Quitting now will stop it.",
    taskRunningNamed: "{{task}} is still running. Quitting now will stop the task and any external processes it started.", quitAnyway: "Quit anyway",
  },
  ffmpeg: {
    title: "ffmpeg Check", checking: "Checking ffmpeg.exe and ffprobe.exe.", available: "ffmpeg.exe and ffprobe.exe are available.",
    missing: "ffmpeg.exe and ffprobe.exe were not found.", failed: "ffmpeg check failed.", download: "Open ffmpeg download page",
  },
  messages: {
    waveformReady: "Waveform ready.", waveformPreparing: "Preparing waveform.", waveformFinalizing: "Finalizing waveform.", waveformUnavailable: "Waveform unavailable.",
    waveformCancelled: "Waveform generation cancelled.", analysisRunning: "Analyzing singing segments.", analysisSingingComplete: "Singing analysis complete.", analysisComplete: "Analysis complete.",
    transcriptionPreparing: "Preparing Whisper transcription.", transcriptionProgress: "Transcribed {{current}}/{{total}} segments.",
    whisperDownloading: "Downloading Whisper {{model}}.", whisperReady: "Whisper {{model}} model ready.",
    exportingItem: "Exporting {{id}}.", proxyPreparing: "Preparing AAC scratch proxy.", proxyCreating: "Creating AAC scratch proxy.", proxyReady: "Scratch proxy ready.", proxyCancelled: "Scratch proxy generation cancelled.",
    loadingVideo: "Loading video.", videoLoaded: "Video loaded and project created.", projectLoaded: "Project loaded.",
    projectRestored: "Project restored. The active operation was interrupted and can be resumed.",
    sourceRelinked: "Source relinked and the project was saved beside the media.", transcriptionBackground: "Transcribing in background.",
    transcriptionComplete: "Transcription complete.", exportComplete: "Export complete.", noChecked: "No checked segments to copy.",
    sorted: "Sorted segments by start time.", checkedAll: "Checked all segments for export.", uncheckedAll: "Unchecked all segments for export.",
    inverted: "Inverted the export selection.", dropFile: "Drop a video or .songcut project file.", added: "Added {{id}}.",
    removed_one: "Removed {{count}} segment.", removed_other: "Removed {{count}} segments.",
    detected: "Detected {{count}} segments.", copiedTs: "Copied {{count}} TS comment lines.",
    copiedTimestamp: "Copied {{count}} {{format}} entries.",
    scratchDuration: "Scratch preview duration set to {{milliseconds}} ms.", whisperModelReady: "Whisper {{model}} model is ready.",
    ffmpegFailed: "ffmpeg check failed.", recoveredSaved: "Recovered edits were saved to the project sidecar.",
    candidateDurationMismatch: "The candidate source has a different duration and was not linked.",
    fingerprintMismatch: "The selected file has a different fingerprint. It was not linked to this project.",
    durationMismatch: "The selected file has a different duration. It was not linked to this project.",
    droppedProjectPath: "Could not read the dropped project path.", droppedFilePath: "Could not read the dropped file path.",
    unexpectedError: "The operation failed. Technical details: {{detail}}",
  },
  filename: {
    empty: "Filename template cannot be empty.", unsupported: "Unsupported placeholder: {{placeholders}}",
    unmatched: "Filename template contains an unmatched brace.",
  },
} as const;

type TranslationShape<T> = { [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]> };

const ja: TranslationShape<typeof en> = {
  common: {
    load: "読み込む", analyze: "解析", export: "書き出し", exportTs: "TSを書き出す", settings: "設定",
    close: "閉じる", hide: "隠す", cancel: "キャンセル", back: "戻る", retry: "再試行", ok: "OK",
    done: "完了", discard: "破棄", recover: "復元", unknown: "不明", unknownTitle: "不明",
    before: "変更前", after: "変更後", view: "表示", skip: "スキップ", auto: "自動",
  },
  settings: {
    title: "設定", playback: "再生と解析", scratchDuration: "スクラッチ試聴時間",
    useProxy: "スクラッチ音声プロキシを使用", waveform: "波形表示", peak: "ピーク包絡", peakRms: "ピーク + RMS",
    analysisDevice: "歌唱解析デバイス", whisper: "Whisper 文字起こし", export: "書き出し",
    filenameTemplate: "ファイル名テンプレート", placeholders: "使用可能なプレースホルダー: {{placeholders}}",
    projectOnly: "この設定は .songcut プロジェクトごとに保存されます。", tools: "ツール",
    toolsHelp: "解析と書き出しに使用する ffmpeg と ffprobe を確認します。", ffmpegCheck: "ffmpeg 確認",
    applied: "変更はすぐに適用され、プロジェクト設定は自動保存されます。",
    languageHeading: "Language / 言語", system: "System default / システムの設定", english: "English / 英語", japanese: "Japanese / 日本語",
    languageNextStart: "Changes apply the next time songcut starts. / 変更は次回の songcut 起動時に適用されます。",
  },
  whisper: {
    aria: "Whisper 文字起こし設定", enable: "Whisper 文字起こしを有効化", bundled: "同梱済み", ready: "準備完了",
    missing: "未ダウンロード", checking: "確認中…", model: "モデル", language: "言語", device: "デバイス",
    prepare: "Whisper モデルを準備", transcribe: "文字起こし", retranscribe: "文字起こし／再実行",
    stale: "設定が変更されました — 再文字起こしが必要です", installed: "{{size}} インストール済み", auto: "自動検出",
    openLanguages: "言語選択肢を開く", closeLanguages: "言語選択肢を閉じる", languages: "Whisper の言語",
    noLanguages: "一致する言語がありません", fastest: "最速", basic: "基本", balanced: "バランス", good: "良好",
    slower: "低速", best: "最高",
  },
  app: {
    sourceMissingBanner: "ソースがありません — 保存済みのガイド、セグメント、波形、文字起こしは利用できます。", relink: "再リンク",
    readOnly: "読み取り専用", guidePlaceholder: "タイムスタンプコメントを貼り付け", model: "モデル", language: "言語",
    device: "デバイス", transcriptMissing: "文字起こしはまだ生成されていません。",
    transcriptFailed: "直近の文字起こしに失敗しました: {{error}}", exportTsTitle: "TSを書き出す",
    copiedLines_one: "タイムスタンプ {{count}} 行をクリップボードへコピーしました。",
    copiedLines_other: "タイムスタンプ {{count}} 行をクリップボードへコピーしました。",
    proxyEnabled: "スクラッチ音声プロキシを有効にしました。", proxyDisabled: "スクラッチ音声プロキシを無効にしました。",
    waveformSet: "波形表示を {{mode}} に設定しました。", analysisDeviceSet: "歌唱解析デバイスを {{device}} に設定しました。",
    sourceMissing: "ソースメディアがありません。", projectNotFound: "プロジェクトが見つかりません: {{path}}",
    saving: "保存中…", saved: "保存済み", recoveryOnly: "復元データのみ", saveFailed: "保存失敗", unsaved: "未保存の変更", saveError: "保存エラー", noProject: "プロジェクトなし", idle: "待機中",
    waveformFinalizing: "波形: 仕上げ中", waveformReady: "波形: 準備完了", waveformUnavailable: "波形: 利用不可",
    waveformWaiting: "波形: 待機中", waveformProgress: "波形: {{progress}}%",
    scratchDisabled: "スクラッチ音声: 無効", scratchPreparing: "スクラッチ音声: AAC プロキシを準備中",
    scratchReady: "スクラッチ音声: AAC プロキシ", scratchFailed: "スクラッチ音声: オリジナル（プロキシ失敗）", scratchOriginal: "スクラッチ音声: オリジナル",
  },
  controls: {
    playStart: "開始境界を再生 (A)", playEnd: "終了境界を再生 (D)", boundarySeconds: "境界の試聴秒数",
    nudgeLeft: "最寄りの境界を左へ微調整 (Q)", nudgeRight: "最寄りの境界を右へ微調整 (E)",
    nudgeSeconds: "境界の微調整秒数", start: "先頭へ", previous: "前の境界 (Ctrl+A)",
    play: "再生 (Space)", pause: "一時停止 (Space)", next: "次の境界 (Ctrl+D)", zoomOut: "縮小 (Z)",
    zoomReset: "100% に戻す (X)", zoomIn: "拡大 (C)", retryWaveform: "再試行",
  },
  tasks: {
    analysis: "解析", transcription: "文字起こし", export: "書き出し", download: "Whisper モデルのダウンロード",
    waveform: "波形生成", proxy: "スクラッチ音声の準備", generic: "タスク",
  },
  segments: {
    export: "書き出し", title: "タイトル", id: "ID", start: "開始", end: "終了", duration: "長さ", newTitle: "新しいセグメント",
    confidence: "信頼度", text: "テキスト", editTitle: "タイトルを編集", management: "セグメント管理",
    removeTitle: "セグメントを削除しますか？", removeMessage: "次のセグメントをプロジェクトから完全に削除します。",
    removeUncheckedTitle: "未選択セグメントをすべて削除しますか？",
    removeUncheckedMessage_one: "未選択のセグメント {{count}} 件をプロジェクトから完全に削除します。",
    removeUncheckedMessage_other: "未選択のセグメント {{count}} 件をプロジェクトから完全に削除します。",
    sortTitle: "セグメントを並べ替えますか？", sortMessage: "セグメントを開始時刻順に並べ替えます。続行前に現在と変更後の順序を確認してください。",
    remove: "セグメントを削除", removeMany: "複数のセグメントを削除", removeAll: "すべて削除", sort: "セグメントを並べ替え",
  },
  timestamp: {
    choose: "タイムスタンプガイドを選択", found: "yt-dlp メタデータにタイムスタンプガイドが見つかりました。確認して編集する版を選択してください。",
    candidates: "タイムスタンプガイド候補", timestamps: "タイムスタンプ {{count}} 件", likes: "高評価 {{count}} 件",
    editSelected: "選択項目を編集", edit: "{{source}}を編集", removeNonSongs: "配信開始、MC、宣伝、チャット、告知など、曲を示さないタイムスタンプを削除してください。",
    apply: "ガイドへ適用", description: "動画の説明", comment: "コメント",
  },
  timestampExport: {
    choose: "タイムスタンプの出力形式を選択してください。", "timestamp-comment": "タイムスタンプコメント",
    "youtube-chapter": "YouTubeチャプター", "tsv-excel": "TSV/Excel", csv: "CSV", "audacity-label": "Audacityラベル",
  },
  output: {
    review: "書き出し確認", placeholders: "プレースホルダー: {{placeholders}}",
    createFolder: "選択した出力フォルダー内に「{{name}}」フォルダーを作成", file: "ファイル",
    checking: "確認中", smart: "スマートレンダー", full: "全体を再エンコード",
    checkingSummary: "各クリップのソース形式とキーフレームを確認しています。", checkFailed: "レンダーモードを確認できませんでした: {{error}}",
    smartCount: "スマートレンダー {{count}}", fullCount: "全体を再エンコード {{count}}",
    allSmart: "すべてのクリップでキーフレームに揃った GOP をコピーできます。", mixed: "レンダーモードはクリップごとに決定されます。",
    noGop: "この範囲には完全なキーフレーム単位の GOP がないため、クリップ全体を再エンコードします。",
    unsupported: "{{container}} の {{codec}} はスマートレンダーの対象外です。", fullDetail: "クリップ全体を再エンコードします。",
    smartDetail: "{{codec}} / {{copied}} をコピー、境界の {{encoded}} を再エンコード",
    progress: "書き出し進捗", preparing: "書き出しを準備しています。", failed: "書き出しに失敗しました。", complete: "書き出しが完了しました。",
    progressNote: "スマートレンダー対象クリップは利用可能な GOP をコピーして境界のみ再エンコードし、その他は全体を再エンコードします。",
  },
  dialogs: {
    whisperNotReady: "Whisper モデルの準備ができていません", whisperMissing: "選択した {{model}} モデルは未インストールです。ダウンロードは明示的な操作でのみ行います。",
    analyzeWithout: "文字起こしなしで解析", downloadAnalyze: "ダウンロードして解析",
    recoveryTitle: "未保存の songcut 編集を復元しますか？", recoveryAvailable: "復元用スナップショットがあります。",
    recoveryDetail: "{{filename}} には {{date}}、リビジョン {{revision}} の復元用スナップショットがあります。",
    saveFailedTitle: "現在のプロジェクトを保存できませんでした", saveFailed: "現在のプロジェクトを保存できませんでした。",
    recoveryWouldReplace: "復元用スナップショットがありますが、動画を切り替えると置き換えられます。",
    recoveryUpdateFailed: "復元用スナップショットも更新できませんでした。", discardChanges: "変更を破棄",
    relinkConflictTitle: "再リンク先にプロジェクトがすでに存在します",
    relinkDamaged: "リンク先のサイドカーは破損しているか未対応のスキーマです。タイムスタンプ付き競合ファイルとして明示的に退避しない限り上書きしません。",
    relinkExists: "選択したソースの隣にプロジェクトがすでにあります。既存プロジェクトを開くか、現在のプロジェクトで置換するか、キャンセルしてください。",
    openExisting: "既存を開く", archiveReplace: "競合を退避して置換", replaceCurrent: "現在の内容で置換",
    quitTitle: "songcut を終了しますか？", taskRunning: "タスクが実行中です。今終了すると停止します。",
    taskRunningNamed: "{{task}} が実行中です。今終了すると、タスクと起動した外部プロセスを停止します。", quitAnyway: "終了する",
  },
  ffmpeg: {
    title: "ffmpeg 確認", checking: "ffmpeg.exe と ffprobe.exe を確認しています。", available: "ffmpeg.exe と ffprobe.exe を利用できます。",
    missing: "ffmpeg.exe と ffprobe.exe が見つかりません。", failed: "ffmpeg の確認に失敗しました。", download: "ffmpeg ダウンロードページを開く",
  },
  messages: {
    waveformReady: "波形の準備ができました。", waveformPreparing: "波形を準備しています。", waveformFinalizing: "波形を仕上げています。", waveformUnavailable: "波形を利用できません。",
    waveformCancelled: "波形生成をキャンセルしました。", analysisRunning: "歌唱セグメントを解析しています。", analysisSingingComplete: "歌唱解析が完了しました。", analysisComplete: "解析が完了しました。",
    transcriptionPreparing: "Whisper 文字起こしを準備しています。", transcriptionProgress: "{{total}} 件中 {{current}} 件を文字起こししました。",
    whisperDownloading: "Whisper {{model}} をダウンロードしています。", whisperReady: "Whisper {{model}} モデルの準備ができました。",
    exportingItem: "{{id}} を書き出しています。", proxyPreparing: "AAC スクラッチプロキシを準備しています。", proxyCreating: "AAC スクラッチプロキシを作成しています。", proxyReady: "スクラッチプロキシの準備ができました。", proxyCancelled: "スクラッチプロキシ生成をキャンセルしました。",
    loadingVideo: "動画を読み込んでいます。", videoLoaded: "動画を読み込み、プロジェクトを作成しました。", projectLoaded: "プロジェクトを読み込みました。",
    projectRestored: "プロジェクトを復元しました。実行中だった操作は中断されており、再開できます。",
    sourceRelinked: "ソースを再リンクし、メディアの隣にプロジェクトを保存しました。", transcriptionBackground: "バックグラウンドで文字起こししています。",
    transcriptionComplete: "文字起こしが完了しました。", exportComplete: "書き出しが完了しました。", noChecked: "コピー対象のセグメントがありません。",
    sorted: "セグメントを開始時刻順に並べ替えました。", checkedAll: "すべてのセグメントを書き出し対象にしました。", uncheckedAll: "すべてのセグメントを書き出し対象から外しました。",
    inverted: "書き出し対象を反転しました。", dropFile: "動画または .songcut プロジェクトをドロップしてください。", added: "{{id}} を追加しました。",
    removed_one: "セグメント {{count}} 件を削除しました。", removed_other: "セグメント {{count}} 件を削除しました。",
    detected: "{{count}} 件のセグメントを検出しました。", copiedTs: "TS コメント {{count}} 行をコピーしました。",
    copiedTimestamp: "{{format}} {{count}} 件をコピーしました。",
    scratchDuration: "スクラッチ試聴時間を {{milliseconds}} ms に設定しました。", whisperModelReady: "Whisper {{model}} モデルの準備ができました。",
    ffmpegFailed: "ffmpeg の確認に失敗しました。", recoveredSaved: "復元した編集内容をプロジェクトのサイドカーへ保存しました。",
    candidateDurationMismatch: "候補ソースの長さが異なるためリンクしませんでした。",
    fingerprintMismatch: "選択したファイルのフィンガープリントが異なるため、このプロジェクトへリンクしませんでした。",
    durationMismatch: "選択したファイルの長さが異なるため、このプロジェクトへリンクしませんでした。",
    droppedProjectPath: "ドロップされたプロジェクトのパスを取得できませんでした。", droppedFilePath: "ドロップされたファイルのパスを取得できませんでした。",
    unexpectedError: "操作に失敗しました。技術情報: {{detail}}",
  },
  filename: {
    empty: "ファイル名テンプレートを空にはできません。", unsupported: "未対応のプレースホルダー: {{placeholders}}",
    unmatched: "ファイル名テンプレートの波括弧が対応していません。",
  },
};

export const rendererTranslations = { en, ja } as const;

export async function initializeRendererI18n(language: UiLanguage) {
  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: ["en", "ja"],
    resources: { en: { translation: en }, ja: { translation: ja } },
    interpolation: { escapeValue: false },
  });
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

export function tr(key: string, options?: TOptions) {
  return String(i18next.t(key, options));
}

export function currentUiLanguage(): UiLanguage {
  return i18next.resolvedLanguage === "ja" ? "ja" : "en";
}

export function localizeJobMessage(job: { message?: string; message_code?: string; message_args?: Record<string, string | number> } | null | undefined) {
  if (!job) return "";
  if (job.message_code && i18next.exists(`messages.${job.message_code}`)) {
    return tr(`messages.${job.message_code}`, job.message_args);
  }
  return job.message ?? "";
}

export function localizeFilenameTemplateError(error: string | null) {
  if (!error) return null;
  if (error === "Filename template cannot be empty.") return tr("filename.empty");
  if (error === "Filename template contains an unmatched brace.") return tr("filename.unmatched");
  const unsupported = error.match(/^Unsupported placeholder: (.+)$/);
  return unsupported ? tr("filename.unsupported", { placeholders: unsupported[1] }) : error;
}

const knownUiMessages: Record<string, string> = {
  "Loading video.": "messages.loadingVideo",
  "Video loaded and project created.": "messages.videoLoaded",
  "Project loaded.": "messages.projectLoaded",
  "Project restored. The active operation was interrupted and can be resumed.": "messages.projectRestored",
  "Source relinked and the project was saved beside the media.": "messages.sourceRelinked",
  "Transcribing in background.": "messages.transcriptionBackground",
  "Transcription complete.": "messages.transcriptionComplete",
  "Export complete.": "messages.exportComplete",
  "No checked segments to copy.": "messages.noChecked",
  "Sorted segments by start time.": "messages.sorted",
  "Checked all segments for export.": "messages.checkedAll",
  "Unchecked all segments for export.": "messages.uncheckedAll",
  "Inverted the export selection.": "messages.inverted",
  "Drop a video or .songcut project file.": "messages.dropFile",
  "Waveform ready.": "messages.waveformReady",
  "Preparing waveform.": "messages.waveformPreparing",
  "Finalizing waveform.": "messages.waveformFinalizing",
  "Waveform unavailable.": "messages.waveformUnavailable",
  "ffmpeg check failed.": "messages.ffmpegFailed",
  "Recovered edits were saved to the project sidecar.": "messages.recoveredSaved",
  "The candidate source has a different duration and was not linked.": "messages.candidateDurationMismatch",
  "The selected file has a different fingerprint. It was not linked to this project.": "messages.fingerprintMismatch",
  "The selected file has a different duration. It was not linked to this project.": "messages.durationMismatch",
  "Could not read the dropped project path.": "messages.droppedProjectPath",
  "Could not read the dropped file path.": "messages.droppedFilePath",
};

export function localizeUiMessage(message: string) {
  if (!message || currentUiLanguage() === "en" || /[\u3040-\u30ff\u3400-\u9fff]/.test(message)) return message;
  const key = knownUiMessages[message];
  if (key) return tr(key);
  const detected = message.match(/^Detected (\d+) segments\.$/);
  if (detected) return tr("messages.detected", { count: Number(detected[1]) });
  const copied = message.match(/^Copied (\d+) TS comment lines\.$/);
  if (copied) return tr("messages.copiedTs", { count: Number(copied[1]) });
  const scratch = message.match(/^Scratch preview duration set to (\d+) ms\.$/);
  if (scratch) return tr("messages.scratchDuration", { milliseconds: Number(scratch[1]) });
  const whisper = message.match(/^Whisper (.+) model is ready\.$/);
  if (whisper) return tr("messages.whisperModelReady", { model: whisper[1] });
  return tr("messages.unexpectedError", { detail: message });
}
