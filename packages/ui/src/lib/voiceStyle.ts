// Settings → Act as me → How I write: the style as a few plain sentences
// instead of a form, which of them a described style adds, and the phrases a
// person can tap into their description. Kept free of React so scripts/ can
// test it.

import { t, type MessageKey } from "../i18n/index.ts";

export interface VoiceStyle {
  greetings: Record<string, string>;
  sign_off: string;
  length: string;
  formality: string;
  habits: string[];
  avoid: string[];
}

// The audiences a greeting is learned for (delegation/voice.py AUDIENCES).
const AUDIENCE_PHRASE: Record<string, MessageKey> = {
  team: "lib.voice.audience.team",
  contact: "lib.voice.audience.contact",
  other: "lib.voice.audience.other",
};
const LENGTH_WORD: Record<string, MessageKey> = {
  short: "lib.voice.length.short",
  medium: "lib.voice.length.medium",
  long: "lib.voice.length.long",
};
const FORMALITY_WORD: Record<string, MessageKey> = {
  casual: "lib.voice.formality.casual",
  neutral: "lib.voice.formality.neutral",
  formal: "lib.voice.formality.formal",
};

// Each item is read through t() when it is used, so it follows the
// deployment's language.
function lazyList(keys: readonly MessageKey[]): string[] {
  const list: string[] = [];
  keys.forEach((key, i) => Object.defineProperty(list, i, { get: () => t(key), enumerable: true }));
  return list;
}

// Phrases a person can tap to add to their description.
export const STYLE_PHRASES: readonly string[] = lazyList([
  "lib.voice.phrase.short",
  "lib.voice.phrase.warm",
  "lib.voice.phrase.formalClients",
  "lib.voice.phrase.firstNames",
  "lib.voice.phrase.noEmojis",
  "lib.voice.phrase.noExclamation",
  "lib.voice.phrase.bullets",
]);

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const first = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

// A greeting as a person reads it: {first} is their recipient's first name.
function shown(greeting: string): string {
  return greeting.replaceAll("{first}", t("lib.voice.firstName"));
}

/** The style as plain sentences, in the order drafts use them. */
export function styleSentences(style: VoiceStyle): string[] {
  const out: string[] = [];
  const lengthKey = LENGTH_WORD[style.length];
  const formalityKey = FORMALITY_WORD[style.formality];
  const length = lengthKey && t(lengthKey);
  const formality = formalityKey && t(formalityKey);
  if (length && formality) out.push(t("lib.voice.usuallyBoth", { length, formality }));
  else if (length || formality) out.push(t("lib.voice.usuallyOne", { word: length ?? formality }));

  const greetings = Object.entries(style.greetings).filter(([a, g]) => AUDIENCE_PHRASE[a] && g.trim());
  const distinct = new Set(greetings.map(([, g]) => g.trim()));
  if (greetings.length === Object.keys(AUDIENCE_PHRASE).length && distinct.size === 1) {
    out.push(t("lib.voice.opensWith", { greeting: shown(greetings[0][1].trim()) }));
  } else {
    for (const [audience, greeting] of greetings) {
      out.push(t("lib.voice.opensWithTo", { greeting: shown(greeting.trim()), audience: t(AUDIENCE_PHRASE[audience]) }));
    }
  }
  const signOff = style.sign_off
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
  if (signOff) out.push(t("lib.voice.signsOff", { signOff }));
  for (const rule of [...style.habits, ...style.avoid]) {
    const s = sentence(rule);
    if (s) out.push(s);
  }
  return out;
}

/** Each sentence of `next`, marked new when `current` doesn't already say it. */
export function markNew(current: VoiceStyle, next: VoiceStyle): { text: string; isNew: boolean }[] {
  const had = new Set(styleSentences(current).map((s) => s.toLowerCase()));
  return styleSentences(next).map((text) => ({ text, isNew: !had.has(text.toLowerCase()) }));
}

/** The description with `phrase` added as its own sentence (once). */
export function addPhrase(text: string, phrase: string): string {
  const t = text.trimEnd();
  if (t.toLowerCase().includes(phrase.toLowerCase())) return text;
  if (!t) return `${phrase}.`;
  return `${t}${/[.!?]$/.test(t) ? "" : "."} ${phrase}.`;
}
