import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

export type UiLanguage = "en" | "ja";
export type UiLanguagePreference = "system" | UiLanguage;

const preferencesFilename = "app-preferences.json";

/** `normalizeUiLanguage`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeUiLanguage(locale: string): UiLanguage {
  return locale.trim().toLowerCase().split(/[-_]/, 1)[0] === "ja" ? "ja" : "en";
}

/** `normalizeUiLanguagePreference`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeUiLanguagePreference(value: unknown): UiLanguagePreference {
  return value === "en" || value === "ja" || value === "system" ? value : "system";
}

/** `loadLocalePreference`の対象をローカル環境から読み取り、型付きの値として返す。 */
export function loadLocalePreference(userDataDirectory: string): UiLanguagePreference {
  try {
    const parsed = JSON.parse(readFileSync(preferencesPath(userDataDirectory), "utf8")) as { uiLanguage?: unknown };
    return normalizeUiLanguagePreference(parsed.uiLanguage);
  } catch {
    return "system";
  }
}

/** `saveLocalePreference`の値を検証済みの形式で永続先へ保存する。 */
export async function saveLocalePreference(
  userDataDirectory: string,
  preference: UiLanguagePreference,
): Promise<void> {
  const normalized = normalizeUiLanguagePreference(preference);
  await mkdir(userDataDirectory, { recursive: true });
  const destination = preferencesPath(userDataDirectory);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ uiLanguage: normalized }, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
}

function preferencesPath(userDataDirectory: string) {
  return path.join(userDataDirectory, preferencesFilename);
}
