# Cut/Sub共通化campaignの設計背景

この文書は、SCUT-001〜031を立案した際の横断的な設計判断を保存する履歴です。現在の作業状態は[汎用タスクリスト](../docs/task-list.md)、個々の完了条件と証拠は各`SCUT-NNN.md`を参照してください。

## Operation責務の再評価（SCUT-018〜024）

2026-08-05の再評価では、共通UI shellとoperation lifecycleは共有できている一方、operation orchestrationの所有場所がCut/Subで非対称であることを確認した。Cutの解析・転写・exportは`App.tsx`、Subの歌詞解析・字幕exportは`SubModePanel.tsx`が所有していたため、どちらか一方のcomponentへ寄せず、同じ階層のmode別coordinatorへ分離する方針とした。

```text
App.tsx
├─ common media / playback / waveform / persistence / task registry
├─ useCutOperations(common context, Cut state adapter)
├─ useSubOperations(common context, Sub state adapter)
├─ CutModePanel  ← action・job viewを受け取るpresentation
└─ SubModePanel  ← action・job viewを受け取るpresentation
```

- 共通化する責務: duplicate-start防止、project operation記録、task登録、poll、progress、成功、失敗、interrupted、利用者向けjob view。
- mode別に残す責務: endpoint、request payload、result型、成功結果のstate反映、resume可否、解析／出力の意味。
- `App.tsx`または単一の巨大なmode switchへ全operationを集約しない。
- Panelから`OperationRunner`や生のoperation APIを直接呼ばず、mode coordinatorが返すactionとjob viewだけを渡す。
- Cutの通常drag／nudgeの最小長0.1秒と時間dialogの最小長0.001秒は意図的差分として維持する。
- Cut/Subの解析pipeline、domain model、REST endpoint、sidecarは統合しない。

## Panel境界の再精査（SCUT-025〜031）

SCUT-024完了後、ModeSessionの生成は対称でもPanelでの消費境界が非対称であることを確認した。Cut Panelは主に共通viewと操作callbackを受ける一方、Sub Panelはraw ModeController、SubOperationCoordinator、Electron API、model準備手順まで参照していた。

最小計画ではCut/Subのdomainを統合せず、同じ意味を持つ境界だけを共有する方針とした。

- 共有する: Panelの共通view、toolbar command、media/timeline契約、boundary drag lifecycle、operation lifecycle。
- mode固有のまま保つ: Cutのclip・transcript・export candidate、Subのlane・style・lyrics alignment。
- raw controller/coordinator/platform依存をPanelから除去する。
- 新しい状態管理ライブラリ、永続化schema migration、UI仕様変更は導入しない。
- 詳細な目的、範囲、禁止事項、完了条件、検証、停止条件は各task briefを正本とする。
