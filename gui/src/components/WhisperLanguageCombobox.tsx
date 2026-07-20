import { useEffect, useId, useMemo, useRef, useState } from "react";
import { currentUiLanguage, tr, type UiLanguage } from "@/i18n";

export type WhisperLanguageOption = {
  code: string;
  label: string;
};

export const PRIMARY_WHISPER_LANGUAGES: readonly WhisperLanguageOption[] = [
  { code: "auto", label: "Auto detect" },
  { code: "ja", label: "Japanese" },
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
];

const primaryCodes = new Set(PRIMARY_WHISPER_LANGUAGES.map((language) => language.code));

export function localizeWhisperLanguages(
  languages: readonly WhisperLanguageOption[],
  locale: UiLanguage,
): WhisperLanguageOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: "language" });
  return languages.map((language) => ({
    code: language.code,
    label: language.code === "auto" ? (locale === "ja" ? "自動検出" : "Auto detect") : displayNames.of(language.code) ?? language.label,
  }));
}
export function rankWhisperLanguages(
  languages: readonly WhisperLanguageOption[],
  query: string,
  locale: UiLanguage = "en",
): WhisperLanguageOption[] {
  const labelCollator = new Intl.Collator(locale, { sensitivity: "base" });
  const localizedPrimary = localizeWhisperLanguages(PRIMARY_WHISPER_LANGUAGES, locale);
  const localizedLanguages = localizeWhisperLanguages(languages, locale);
  const byCode = new Map<string, WhisperLanguageOption>(
    localizedPrimary.map((language) => [language.code, language]),
  );
  for (const language of localizedLanguages) {
    const code = language.code.trim().toLocaleLowerCase();
    const label = language.label.trim();
    if (!code || !label || primaryCodes.has(code) || byCode.has(code)) continue;
    byCode.set(code, { code, label });
  }

  const secondary = [...byCode.values()]
    .filter((language) => !primaryCodes.has(language.code))
    .sort((left, right) => labelCollator.compare(left.label, right.label) || left.code.localeCompare(right.code));
  const ordered = [...localizedPrimary, ...secondary];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return ordered;

  return ordered
    .map((language, originalIndex) => ({
      language,
      originalIndex,
      rank: languageSearchRank(language, normalizedQuery),
    }))
    .filter((item) => item.rank !== null)
    .sort(
      (left, right) =>
        Number(left.rank) - Number(right.rank) ||
        labelCollator.compare(left.language.label, right.language.label) ||
        left.originalIndex - right.originalIndex,
    )
    .map((item) => item.language);
}

export function moveLanguageOptionIndex(current: number, optionCount: number, direction: 1 | -1) {
  if (optionCount <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : optionCount - 1;
  return (current + direction + optionCount) % optionCount;
}

function languageSearchRank(language: WhisperLanguageOption, query: string): number | null {
  const code = language.code.toLocaleLowerCase();
  const label = language.label.toLocaleLowerCase();
  if (code === query) return 0;
  if (label === query) return 1;
  if (code.startsWith(query) || label.startsWith(query)) return 2;
  if (code.includes(query) || label.includes(query)) return 3;
  return null;
}

export function WhisperLanguageCombobox(props: {
  value: string;
  languages: readonly WhisperLanguageOption[];
  onChange: (code: string) => void;
}) {
  const locale = currentUiLanguage();
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const allLanguages = useMemo(() => rankWhisperLanguages(props.languages, "", locale), [props.languages, locale]);
  const visibleLanguages = useMemo(
    () => rankWhisperLanguages(props.languages, query, locale),
    [props.languages, query, locale],
  );
  const selected = allLanguages.find((language) => language.code === props.value) ?? null;

  useEffect(() => {
    if (!open) return;
    setActiveIndex((current) => (current >= visibleLanguages.length ? visibleLanguages.length - 1 : current));
  }, [open, visibleLanguages.length]);

  const openList = () => {
    const unfiltered = rankWhisperLanguages(props.languages, "", locale);
    setQuery("");
    setOpen(true);
    setActiveIndex(Math.max(0, unfiltered.findIndex((language) => language.code === props.value)));
  };

  const closeList = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const selectLanguage = (language: WhisperLanguageOption) => {
    props.onChange(language.code);
    closeList();
    inputRef.current?.focus();
  };

  return (
    <div className="language-combobox">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-label={tr("whisper.language")}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        autoComplete="off"
        value={open ? query : selected?.label ?? props.value}
        onFocus={() => {
          if (!open) openList();
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onBlur={closeList}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openList();
              return;
            }
            setActiveIndex((current) =>
              moveLanguageOptionIndex(current, visibleLanguages.length, event.key === "ArrowDown" ? 1 : -1),
            );
          } else if (event.key === "Enter") {
            if (!open) {
              event.preventDefault();
              openList();
            } else if (activeIndex >= 0 && visibleLanguages[activeIndex]) {
              event.preventDefault();
              selectLanguage(visibleLanguages[activeIndex]);
            }
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeList();
          } else if (event.key === "Tab") {
            closeList();
          }
        }}
      />
      <button
        type="button"
        className="language-combobox-toggle"
        aria-label={tr(open ? "whisper.closeLanguages" : "whisper.openLanguages")}
        aria-expanded={open}
        aria-controls={listboxId}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            closeList();
          } else {
            openList();
            inputRef.current?.focus();
          }
        }}
      >
        {open ? "▴" : "▾"}
      </button>
      {open ? (
        <ul id={listboxId} className="language-combobox-list" role="listbox" aria-label={tr("whisper.languages")}>
          {visibleLanguages.length ? (
            visibleLanguages.map((language, index) => {
              const isSelected = language.code === props.value;
              const startsSecondary =
                !query.trim() && index > 0 && primaryCodes.has(visibleLanguages[index - 1].code) && !primaryCodes.has(language.code);
              return (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={language.code}
                  data-language-code={language.code}
                  className={`language-combobox-option${index === activeIndex ? " active" : ""}${isSelected ? " selected" : ""}${startsSecondary ? " secondary-start" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectLanguage(language)}
                >
                  <span>{language.label}</span>
                  <span className="language-combobox-code">{language.code}</span>
                  <span className="language-combobox-check" aria-hidden="true">
                    {isSelected ? "✓" : ""}
                  </span>
                </li>
              );
            })
          ) : (
            <li className="language-combobox-empty" role="option" aria-disabled="true">
              {tr("whisper.noLanguages")}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
