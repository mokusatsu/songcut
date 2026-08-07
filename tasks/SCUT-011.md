# SCUT-011 Mode切替時のmedia/waveform再利用

- 目的: 同じ動画のCut/Sub切替で、同一fingerprint波形を再生成しない。
- 変更範囲: progressive waveform/session cache、hydrate/switch、tests。
- 禁止事項: mutable edit documentの共有、sidecar統合、永続cache形式の無断追加。
- 完了条件: in-memory fingerprint cacheを優先し、不一致・duration差では再生成し、scratch proxy挙動を維持する。
- テスト: cache hit/miss/invalidate、mode switch integration、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - Appインスタンス単位の`waveformSessionCache`を追加し、fingerprint、duration、generator、encoding、sample rate、channelsで完成済み波形を検証・cloneして保持する。
  - hydrate順をdocument snapshot、session cache、backend生成に固定し、新規videoとCut/Sub切替の両経路で同じpure decision helperを使用する。
  - duration／generator／encoding不一致ではcacheを無効化し、sourceがある場合だけ通常生成へfallbackする。
  - scratch proxy、waveform task registry、Cut/Subのmutable documentは共有せず既存挙動を維持した。
  - cache hit/clone、fingerprint miss、duration invalidate、metadata不一致、document優先、mode切替hit、generate fallbackを7テストで確認した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 32 files / 209 tests passed（scratch proxy tests含む）。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。
