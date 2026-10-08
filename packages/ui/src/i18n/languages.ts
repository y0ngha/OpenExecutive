// Supported languages: code -> English name. The same list as LANGUAGES in
// packages/core/openexecutive/utils/i18n/__init__.py (scripts/i18n.test.mjs
// keeps them in step). The code is what OE_LANGUAGE takes and what
// <html lang> carries.
export const LANGUAGES = { en: "English", ko: "Korean" } as const;

export type Locale = keyof typeof LANGUAGES;

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The locale a value names, or null: a code ("ko", "ko-KR") or an English
 * name ("KOREAN"), in any case, so the values OE_LANGUAGE took before codes
 * keep working.
 */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  const text = (value ?? "").trim().toLowerCase();
  const base = text.split(/[-_]/)[0];
  for (const [code, name] of Object.entries(LANGUAGES) as [Locale, string][]) {
    if (text === code || base === code || text === name.toLowerCase()) return code;
  }
  return null;
}
