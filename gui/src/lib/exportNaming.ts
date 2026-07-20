import { formatTime } from "@/lib/time";

export const DEFAULT_FILENAME_TEMPLATE = "{index}_{title}";
export const FILENAME_TEMPLATE_PLACEHOLDERS = ["index", "title", "id", "start", "end"] as const;

type TemplateItem = {
  id: string;
  segmentId: string;
  title: string;
  start: number;
  end: number;
};

export type FilenameTemplateResult<T> = {
  items: Array<T & { filename_stem: string }>;
  error: string | null;
};

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g;
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function applyFilenameTemplate<T extends TemplateItem>(items: readonly T[], template: string): FilenameTemplateResult<T> {
  const normalized = template.trim();
  if (!normalized) return { items: [], error: "Filename template cannot be empty." };

  const placeholders = [...normalized.matchAll(PLACEHOLDER_RE)].map((match) => match[1].toLowerCase());
  const unsupported = [...new Set(placeholders.filter((value) => !FILENAME_TEMPLATE_PLACEHOLDERS.includes(value as never)))];
  if (unsupported.length) {
    return { items: [], error: `Unsupported placeholder: ${unsupported.map((value) => `{${value}}`).join(", ")}` };
  }
  if (/[{}]/.test(normalized.replace(PLACEHOLDER_RE, ""))) {
    return { items: [], error: "Filename template contains an unmatched brace." };
  }

  const width = Math.max(2, String(Math.max(1, items.length)).length);
  const used = new Set<string>();
  const rendered = items.map((item, itemIndex) => {
    const values: Record<(typeof FILENAME_TEMPLATE_PLACEHOLDERS)[number], string> = {
      index: String(itemIndex + 1).padStart(width, "0"),
      title: item.title.trim() || item.segmentId || item.id,
      id: item.segmentId || item.id,
      start: filenameTime(item.start),
      end: filenameTime(item.end)
    };
    const raw = normalized.replace(PLACEHOLDER_RE, (_match, name: string) => values[name.toLowerCase() as keyof typeof values]);
    const base = safeFilenameStem(raw, item.segmentId || item.id || `clip-${itemIndex + 1}`);
    const filenameStem = uniqueFilenameStem(base, used);
    return { ...item, filename_stem: filenameStem };
  });
  return { items: rendered, error: null };
}

export function safeFilenameStem(value: string, fallback = "clip", maxLength = 120) {
  let result = value
    .replaceAll("/", " - ")
    .replaceAll("\\", " - ")
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!result || WINDOWS_RESERVED_RE.test(result)) result = fallback;
  if (result.length > maxLength) result = result.slice(0, maxLength).replace(/[. ]+$/g, "");
  return result || fallback;
}

function uniqueFilenameStem(base: string, used: Set<string>) {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    const marker = `_${suffix++}`;
    candidate = `${base.slice(0, Math.max(1, 120 - marker.length)).replace(/[. ]+$/g, "")}${marker}`;
  }
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function filenameTime(seconds: number) {
  return formatTime(seconds).replaceAll(":", "-");
}
