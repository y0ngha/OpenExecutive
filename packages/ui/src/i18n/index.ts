// UI strings in English or Korean, chosen by OE_LANGUAGE (ENGLISH | KOREAN)
// for the whole deployment. The server reads the variable; the browser reads
// the <html lang> the root layout stamped from it, so both render the same
// text and hydration matches.
//
// Imports here use relative `.ts` paths (not `@/`) so the node:test suites in
// scripts/ can load lib files that call t().
import en from "./en.ts";
import ko from "./ko.ts";

export type Locale = "en" | "ko";
export type MessageKey = keyof typeof en;
type Vars = Record<string, string | number>;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, ko };

/** Locale from an OE_LANGUAGE value. Anything but KOREAN is English. */
export function localeFromEnv(value: string | undefined): Locale {
  return (value ?? "").trim().toUpperCase() === "KOREAN" ? "ko" : "en";
}

export function locale(): Locale {
  if (typeof document === "undefined") return localeFromEnv(process.env.OE_LANGUAGE);
  return document.documentElement.lang === "ko" ? "ko" : "en";
}

/** BCP 47 tag for Intl / toLocale*String. */
export function displayLocale(): string {
  return locale() === "ko" ? "ko-KR" : "en-US";
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** The current locale's text for `key`, with `{name}` placeholders filled. */
export function t(key: MessageKey, vars?: Vars): string {
  return fill(MESSAGES[locale()][key] ?? en[key] ?? key, vars);
}

/** Keys that come in `.one` / `.other` pairs, named without the suffix. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer B}.other`
    ? B
    : never
  : never;

/** `t` for a count: `<key>.one` when n is 1, else `<key>.other`. `{n}` is filled. */
export function tp(key: PluralKey, n: number, vars?: Vars): string {
  const form = (n === 1 ? `${key}.one` : `${key}.other`) as MessageKey;
  return t(form, { n, ...vars });
}
