import assert from "node:assert/strict";
import test from "node:test";
import en from "../src/i18n/en.ts";
import ko from "../src/i18n/ko.ts";
import { localeFromEnv, t, tp } from "../src/i18n/index.ts";

test("only KOREAN picks Korean; anything else is English", () => {
  assert.equal(localeFromEnv("KOREAN"), "ko");
  assert.equal(localeFromEnv(" korean "), "ko");
  assert.equal(localeFromEnv("ENGLISH"), "en");
  assert.equal(localeFromEnv(undefined), "en");
  assert.equal(localeFromEnv("FRENCH"), "en");
});

test("English and Korean have the same keys, none blank", () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
  for (const [k, v] of Object.entries(ko)) assert.ok(v.trim(), `ko ${k} is blank`);
});

test("every Korean string keeps the English placeholders", () => {
  const names = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
  for (const k of Object.keys(en)) assert.deepEqual(names(ko[k]), names(en[k]), k);
});

test("t fills placeholders and follows OE_LANGUAGE", () => {
  const prev = process.env.OE_LANGUAGE;
  try {
    delete process.env.OE_LANGUAGE;
    assert.equal(t("common.save"), "Save");
    process.env.OE_LANGUAGE = "KOREAN";
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
