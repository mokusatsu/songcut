import { describe, expect, it } from "vitest";
import {
  initializeRendererI18n,
  localizeFilenameTemplateError,
  localizeJobMessage,
  rendererTranslations,
  tr,
} from "./i18n";

function flatten(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(flatten);
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("renderer translations", () => {
  it("contains no empty English or Japanese translations", () => {
    expect(flatten(rendererTranslations.en).every(Boolean)).toBe(true);
    expect(flatten(rendererTranslations.ja).every(Boolean)).toBe(true);
  });

  it("keeps Sub English and Japanese resource keys complete", async () => {
    expect(leafPaths(rendererTranslations.ja).sort()).toEqual(leafPaths(rendererTranslations.en).sort());

    await initializeRendererI18n("en");
    expect(tr("sub.lyricsAnalysisComplete", { lines: 3, bpm: "120.0" }))
      .toBe("Lyrics analysis complete. 3 lines, BPM 120.0");
    expect(tr("sub.effect.option.left_to_right")).toBe("Left to right");

    await initializeRendererI18n("ja");
    expect(tr("sub.lyricsAnalysisComplete", { lines: 3, bpm: "120.0" }))
      .toBe("歌詞解析が完了しました。3行、BPM 120.0");
    expect(tr("sub.effect.option.left_to_right")).toBe("左から右");
  });

  it("uses English plurals and fallback", async () => {
    await initializeRendererI18n("en");
    expect(tr("app.copiedLines", { count: 1 })).toBe("Copied 1 timestamp line to the clipboard.");
    expect(tr("app.copiedLines", { count: 2 })).toBe("Copied 2 timestamp lines to the clipboard.");
  });

  it("uses bilingual language settings only in Japanese", async () => {
    await initializeRendererI18n("ja");
    expect(tr("settings.languageHeading")).toBe("Language / 言語");
    expect(tr("settings.english")).toBe("English / 英語");
    expect(tr("settings.languageNextStart")).toContain(" / ");

    await initializeRendererI18n("en");
    expect(tr("settings.languageHeading")).toBe("Language");
    expect(tr("settings.english")).toBe("English");
  });

  it("localizes structured progress and filename errors", async () => {
    await initializeRendererI18n("en");
    expect(localizeJobMessage({
      message: "Exporting First Song (2/3)",
      message_code: "exportingItemProgress",
      message_args: { title: "First Song", current: 2, total: 3 },
    })).toBe("Exporting First Song (2/3)");

    await initializeRendererI18n("ja");
    expect(localizeJobMessage({
      message: "Exporting First Song (2/3)",
      message_code: "exportingItemProgress",
      message_args: { title: "First Song", current: 2, total: 3 },
    })).toBe("First Song を書き出しています (2/3)");
    expect(localizeJobMessage({ message: "Transcribed 1/2 segments.", message_code: "transcriptionProgress", message_args: { current: 1, total: 2 } }))
      .toBe("2 件中 1 件を文字起こししました。");
    expect(localizeFilenameTemplateError("Filename template cannot be empty."))
      .toBe("ファイル名テンプレートを空にはできません。");
  });
});
