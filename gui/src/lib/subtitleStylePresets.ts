import { normalizeSubtitleStyle, type SubtitleStyle } from "@/lib/subtitles";

export const SUBTITLE_STYLE_PRESETS_STORAGE_KEY = "songcut.subtitle-style-presets.v1";
const MAX_PRESETS = 100;

export type SubtitleStylePreset = {
  id: string;
  name: string;
  style: SubtitleStyle;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** `readSubtitleStylePresets`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function readSubtitleStylePresets(storage: StorageLike = window.localStorage): SubtitleStylePreset[] {
  try {
    return parseSubtitleStylePresets(storage.getItem(SUBTITLE_STYLE_PRESETS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** `writeSubtitleStylePresets`の値を検証済みの形式で永続先へ保存する。 */
export function writeSubtitleStylePresets(
  presets: readonly SubtitleStylePreset[],
  storage: StorageLike = window.localStorage
) {
  storage.setItem(
    SUBTITLE_STYLE_PRESETS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      presets: presets.slice(0, MAX_PRESETS),
    })
  );
}

/** `upsertSubtitleStylePreset`で同名presetを置換し、存在しない場合は新規追加する。 */
export function upsertSubtitleStylePreset(
  presets: readonly SubtitleStylePreset[],
  name: string,
  style: SubtitleStyle,
  createId: () => string = () => crypto.randomUUID()
): SubtitleStylePreset[] {
  const normalizedName = name.trim();
  if (!normalizedName) return [...presets];
  const existing = presets.find(
    (preset) => preset.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0
  );
  const next: SubtitleStylePreset = {
    id: existing?.id ?? createId(),
    name: normalizedName,
    style: normalizeSubtitleStyle(style),
  };
  return existing
    ? presets.map((preset) => (preset.id === existing.id ? next : preset))
    : [...presets, next].slice(-MAX_PRESETS);
}

/** `parseSubtitleStylePresets`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
export function parseSubtitleStylePresets(raw: string | null): SubtitleStylePreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const root = parsed as { version?: unknown; presets?: unknown };
    if (root.version !== 1 || !Array.isArray(root.presets)) return [];
    const presets: SubtitleStylePreset[] = [];
    const ids = new Set<string>();
    for (const value of root.presets.slice(0, MAX_PRESETS)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as { id?: unknown; name?: unknown; style?: unknown };
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!id || !name || ids.has(id)) continue;
      ids.add(id);
      presets.push({ id, name, style: normalizeSubtitleStyle(candidate.style) });
    }
    return presets;
  } catch {
    return [];
  }
}
