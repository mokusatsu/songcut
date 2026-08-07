# SCUT-006 TimelineSurface の共通化

- 目的: viewport、waveform、playhead、wheel routing、range overlayの二重実装を共通shellへ移す。
- 変更範囲: 新規`TimelineSurface.tsx`、Cut timeline、Sub timeline、CSS、テスト。
- 禁止事項: Sub lane layout、Cut selected-only下段、波形既定表示の変更。
- 完了条件: 両モードが同じsurfaceを使い、mode固有rowをslotで描画し、wheel/scrub/focusが同じ経路を通る。
- テスト: component/unit、全Vitest、typecheck、必要ならE2E重点確認。
- 完了証拠 (2026-08-05):
  - `TimelineSurface.tsx`へviewport、ScrollArea、content sizing、playhead、waveform、scrub、focus、wheel routeを集約し、Cut/Sub両timelineを移行した。
  - Cutのselected-only rowとSubのguide/grid/lane DOM・既存classはslotとして維持し、CSS変更は不要だった。
  - wheel scopeを共通shell内で明示し、Cutはsurface全体を横scroll、Subはwaveform上だけ横scroll、laneは縦scrollを維持した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 29 files / 185 tests passed。
  - `cd gui; pnpm run build`: exit 0。
  - `git diff --check`: exit 0。ブラウザE2E視覚確認はSCUT-015へ送る。
