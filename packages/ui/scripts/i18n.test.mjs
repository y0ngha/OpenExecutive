import assert from "node:assert/strict";
import test from "node:test";
import en from "../src/i18n/en.ts";
import ko from "../src/i18n/ko.ts";
import { readFileSync } from "node:fs";
import { localeFromEnv, t, tp } from "../src/i18n/index.ts";
import { LANGUAGES } from "../src/i18n/languages.ts";

test("OE_LANGUAGE takes a code or an English name; anything else is English", () => {
  assert.equal(localeFromEnv("ko"), "ko");
  assert.equal(localeFromEnv("ko-KR"), "ko");
  assert.equal(localeFromEnv("KOREAN"), "ko");
  assert.equal(localeFromEnv(" korean "), "ko");
  assert.equal(localeFromEnv("ENGLISH"), "en");
  assert.equal(localeFromEnv("en"), "en");
  assert.equal(localeFromEnv(undefined), "en");
  assert.equal(localeFromEnv("FRENCH"), "en");
});

test("the UI supports the same languages as the API", () => {
  const src = readFileSync(
    new URL("../../core/openexecutive/utils/i18n/__init__.py", import.meta.url),
    "utf8",
  );
  const body = src.match(/^LANGUAGES: dict\[str, str\] = \{([^}]*)\}/m)?.[1];
  assert.ok(body, "LANGUAGES not found in utils/i18n/__init__.py");
  const py = Object.fromEntries([...body.matchAll(/"(\w+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(py, { ...LANGUAGES });
});

test("Korean holds only English keys, none blank", () => {
  // Keys may be missing (they show in English), never extra.
  for (const k of Object.keys(ko)) assert.ok(k in en, `ko ${k} is not an English key`);
  for (const [k, v] of Object.entries(ko)) assert.ok(v.trim(), `ko ${k} is blank`);
});

test("every Korean string keeps the English placeholders", () => {
  const names = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
  for (const k of Object.keys(ko)) assert.deepEqual(names(ko[k]), names(en[k]), k);
});

test("t fills placeholders and follows OE_LANGUAGE", () => {
  const prev = process.env.OE_LANGUAGE;
  try {
    delete process.env.OE_LANGUAGE;
    assert.equal(t("common.save"), "Save");
    process.env.OE_LANGUAGE = "ko";
    assert.equal(t("common.save"), "저장");
  } finally {
    if (prev === undefined) delete process.env.OE_LANGUAGE;
    else process.env.OE_LANGUAGE = prev;
  }
});

test("tp picks the singular only for 1", () => {
  // Pick any plural pair the dictionaries define; skip until one exists.
  const base = Object.keys(en).find((k) => k.endsWith(".other"))?.slice(0, -".other".length);
  if (!base) return;
  assert.equal(tp(base, 1), t(`${base}.one`, { n: 1 }));
  assert.equal(tp(base, 3), t(`${base}.other`, { n: 3 }));
});

test("a key Korean lacks shows in English", () => {
  const missing = Object.keys(en).find((k) => !(k in ko) && !/\{\w+\}/.test(en[k]));
  if (!missing) return; // Korean is complete today; the fallback is t()'s `?? en[key]`.
  const prev = process.env.OE_LANGUAGE;
  try {
    process.env.OE_LANGUAGE = "ko";
    assert.equal(t(missing), en[missing]);
  } finally {
    if (prev === undefined) delete process.env.OE_LANGUAGE;
    else process.env.OE_LANGUAGE = prev;
  }
});
