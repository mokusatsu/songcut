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

describe("renderer translations", () => {
  it("contains no empty English or Japanese translations", () => {
    expect(flatten(rendererTranslations.en).every(Boolean)).toBe(true);
    expect(flatten(rendererTranslations.ja).every(Boolean)).toBe(true);
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
    await initializeRendererI18n("ja");
    expect(localizeJobMessage({ message: "Transcribed 1/2 segments.", message_code: "transcriptionProgress", message_args: { current: 1, total: 2 } }))
      .toBe("2 件中 1 件を文字起こししました。");
    expect(localizeFilenameTemplateError("Filename template cannot be empty."))
      .toBe("ファイル名テンプレートを空にはできません。");
  });
});
