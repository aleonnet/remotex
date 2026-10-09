// Light or dark: the system's until somebody chooses here, and a choice holds
// whatever the system is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseTheme, resolveTheme } from "./theme.ts";

test("with no choice kept, the theme is the system's", () => {
  assert.equal(chooseTheme(null), "system");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("a choice kept here holds whatever the system is", () => {
  assert.equal(chooseTheme("light"), "light");
  assert.equal(chooseTheme("dark"), "dark");
  assert.equal(chooseTheme("system"), "system");
  for (const systemDark of [true, false]) {
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(resolveTheme("dark", systemDark), "dark");
  }
});

test("something this page never wrote in its storage is no choice", () => {
  assert.equal(chooseTheme("sepia"), "system");
  assert.equal(chooseTheme(""), "system");
});
