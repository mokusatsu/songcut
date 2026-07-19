export type ScratchProxyState = "idle" | "disabled" | "original" | "preparing" | "loading" | "ready" | "failed";
export type ScratchPreviewSource = "original" | "proxy";

export function normalizeScratchAudioProxyEnabled(value: unknown) {
  if (value === null || value === undefined) return true;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return true;
}

export function shouldCreateScratchProxy(enabled: boolean, codec: unknown) {
  return enabled && typeof codec === "string" && codec.toLowerCase() === "opus";
}

export function selectScratchPreviewSource(enabled: boolean, proxyReady: boolean, proxyAvailable: boolean): ScratchPreviewSource {
  return enabled && proxyReady && proxyAvailable ? "proxy" : "original";
}

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
