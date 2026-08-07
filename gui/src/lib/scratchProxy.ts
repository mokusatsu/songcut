export type ScratchProxyState = "idle" | "disabled" | "original" | "preparing" | "loading" | "ready" | "failed";
export type ScratchPreviewSource = "original" | "proxy";

/** `normalizeScratchAudioProxyEnabled`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeScratchAudioProxyEnabled(value: unknown) {
  if (value === null || value === undefined) return true;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return true;
}

/** `shouldCreateScratchProxy`の入力が要求された条件やschemaを満たすか検証する。 */
export function shouldCreateScratchProxy(enabled: boolean, codec: unknown) {
  return enabled && typeof codec === "string" && codec.toLowerCase() === "opus";
}

/** `selectScratchPreviewSource`の候補と条件から、利用すべき値または操作を決定する。 */
export function selectScratchPreviewSource(enabled: boolean, proxyReady: boolean, proxyAvailable: boolean): ScratchPreviewSource {
  return enabled && proxyReady && proxyAvailable ? "proxy" : "original";
}

/** `scratchProxyStatusLabel`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
export function scratchProxyStatusLabel(state: ScratchProxyState) {
  switch (state) {
    case "disabled":
      return "Scratch audio: Disabled";
    case "preparing":
    case "loading":
      return "Scratch audio: Preparing AAC proxy";
    case "ready":
      return "Scratch audio: AAC proxy";
    case "failed":
      return "Scratch audio: Original (proxy failed)";
    case "idle":
    case "original":
      return "Scratch audio: Original";
  }
}
