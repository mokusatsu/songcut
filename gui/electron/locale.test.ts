import { describe, expect, it } from "vitest";
import { normalizeUiLanguage, normalizeUiLanguagePreference } from "./locale.js";
import { initializeMainI18n, mainI18n, mainTranslations } from "./i18n.js";

describe("normalizeUiLanguage", () => {
  it.each([
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["JA_jp", "ja"],
    ["en-US", "en"],
    ["fr-FR", "en"],
    ["", "en"],
  ])("maps %s to %s", (locale, expected) => {
    expect(normalizeUiLanguage(locale)).toBe(expected);
  });
});

describe("normalizeUiLanguagePreference", () => {
  it.each(["system", "en", "ja"])("keeps %s", (value) => {
    expect(normalizeUiLanguagePreference(value)).toBe(value);
  });

  it("falls back to system", () => {
    expect(normalizeUiLanguagePreference("de")).toBe("system");
    expect(normalizeUiLanguagePreference(null)).toBe("system");
  });
});

describe("main-process translations", () => {
  it("has complete non-empty resources and switches menu language", async () => {
    const flatten = (value: unknown): string[] =>
      typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(flatten) : [];
    expect(flatten(mainTranslations.en).every(Boolean)).toBe(true);
    expect(flatten(mainTranslations.ja).every(Boolean)).toBe(true);
    await initializeMainI18n("ja");
    expect(mainI18n.t("menu.settingsItem")).toBe("設定...");
    await initializeMainI18n("en");
    expect(mainI18n.t("menu.settingsItem")).toBe("Settings...");
  });
});
