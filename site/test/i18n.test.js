import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import en from "../src/lib/i18n/en.js";
import es from "../src/lib/i18n/es.js";
import fr from "../src/lib/i18n/fr.js";
import it from "../src/lib/i18n/it.js";

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

for (const [name, dict] of Object.entries({ fr, es, it })) {
  test(`${name}: same keys and placeholders as English`, () => {
    assert.deepEqual(Object.keys(dict).filter((k) => !(k in en)), [], "keys unknown to English");
    assert.deepEqual(Object.keys(en).filter((k) => !(k in dict)), [], "keys missing");
    for (const k of Object.keys(en)) assert.deepEqual(placeholders(dict[k]), placeholders(en[k]), k);
  });
}

test("every key used by the public pages exists in English", () => {
  const files = [
    ...readdirSync(new URL("../src/pages/", import.meta.url)).map((f) => `../src/pages/${f}`),
    "../src/lib/layout.js",
    "../src/lib/util.js",
    "../src/lib/wallet.js",
  ];
  const html = readFileSync(new URL("../whitepaper.html", import.meta.url), "utf8");
  const used = new Set([...html.matchAll(/data-i18n="([\w.]+)"/g)].map((m) => m[1]));
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\btn\("([\w.]+)"/g)) used.add(`${m[1]}.one`).add(`${m[1]}.other`);
  }
  assert.deepEqual([...used].filter((k) => !(k in en)), []);
});
