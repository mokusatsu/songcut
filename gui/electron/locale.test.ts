import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadLastDialogDirectory,
  loadLocalePreference,
  normalizeUiLanguage,
  normalizeUiLanguagePreference,
  saveLastDialogDirectory,
  saveLocalePreference,
} from "./locale.js";
import { initializeMainI18n, mainI18n, mainTranslations } from "./i18n.js";

const temporaryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".codex-temp");

async function withPreferencesDirectory(callback: (directory: string) => Promise<void>) {
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, "locale-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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

describe("app preferences", () => {
  it("keeps the last dialog directory when the language preference changes", async () => {
    await withPreferencesDirectory(async (directory) => {
      await Promise.all([
        saveLocalePreference(directory, "ja"),
        saveLastDialogDirectory(directory, "C:\\media\\songs"),
        saveLocalePreference(directory, "en"),
      ]);

      expect(loadLocalePreference(directory)).toBe("en");
      expect(loadLastDialogDirectory(directory)).toBe("C:\\media\\songs");
    });
  });

  it("does not expose an empty saved dialog directory", async () => {
    await withPreferencesDirectory(async (directory) => {
      await saveLastDialogDirectory(directory, "   ");
      expect(loadLastDialogDirectory(directory)).toBeUndefined();
    });
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
    expect(mainI18n.t("menu.timestampHeading")).toBe("-- Timestamp --");
    await initializeMainI18n("en");
    expect(mainI18n.t("menu.settingsItem")).toBe("Settings...");
    expect(mainI18n.t("menu.timestampHeading")).toBe("-- Timestamp --");
  });
});
