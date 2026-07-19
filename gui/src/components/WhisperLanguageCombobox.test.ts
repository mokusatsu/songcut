import { describe, expect, it } from "vitest";
import {
  moveLanguageOptionIndex,
  rankWhisperLanguages,
  type WhisperLanguageOption,
} from "./WhisperLanguageCombobox";

const languages: WhisperLanguageOption[] = [
  { code: "jv", label: "Javanese" },
  { code: "az", label: "Azerbaijani" },
  { code: "ja", label: "Japanese" },
  { code: "gu", label: "Gujarati" },
  { code: "en", label: "English" },
  { code: "pa", label: "Punjabi" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "auto", label: "Auto detect" },
  { code: "fr", label: "French" },
  { code: "ja", label: "Japanese duplicate" },
];

describe("Whisper language ordering", () => {
  it("opens with the five primary languages first and does not filter by the selected code", () => {
    const options = rankWhisperLanguages(languages, "");

    expect(options.slice(0, 5).map((language) => language.code)).toEqual(["auto", "ja", "en", "zh", "ko"]);
    expect(options.filter((language) => language.code === "ja")).toHaveLength(1);
    expect(options.slice(5).map((language) => language.label)).toEqual([
      "Azerbaijani",
      "French",
      "Gujarati",
      "Javanese",
      "Punjabi",
    ]);
  });

  it("ranks an explicit code search ahead of labels that merely contain it", () => {
    const options = rankWhisperLanguages(languages, "ja");

    expect(options[0]).toEqual({ code: "ja", label: "Japanese" });
    expect(options.map((language) => language.label)).toContain("Azerbaijani");
    expect(options.map((language) => language.label)).toContain("Javanese");
  });

  it.each([
    ["japanese", "ja"],
    ["en", "en"],
    ["korean", "ko"],
  ])("searches language names and codes case-insensitively: %s", (query, expectedCode) => {
    expect(rankWhisperLanguages(languages, query)[0].code).toBe(expectedCode);
    expect(rankWhisperLanguages(languages, query.toUpperCase())[0].code).toBe(expectedCode);
  });

  it("supports wrapping keyboard option movement", () => {
    expect(moveLanguageOptionIndex(-1, 5, 1)).toBe(0);
    expect(moveLanguageOptionIndex(-1, 5, -1)).toBe(4);
    expect(moveLanguageOptionIndex(4, 5, 1)).toBe(0);
    expect(moveLanguageOptionIndex(0, 5, -1)).toBe(4);
  });
});
