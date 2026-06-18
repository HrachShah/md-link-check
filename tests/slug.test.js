import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("lowercases the text", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("collapses internal whitespace into a single hyphen", () => {
  assert.equal(slugify("foo   bar\tbaz"), "foo-bar-baz");
});

test("strips punctuation but keeps hyphen and underscore", () => {
  assert.equal(slugify("foo! bar? — baz_qux"), "foo-bar-baz_qux");
});

test("preserves accented characters (unicode letters)", () => {
  assert.equal(slugify("café résumé"), "café-résumé");
});

test("trims leading and trailing whitespace before slugifying", () => {
  assert.equal(slugify("  spaced out  "), "spaced-out");
});

test("collapses surrounding hyphens around dropped punctuation", () => {
  // "!!!foo!!!" -> after stripping '!' (not letter/number/space/hyphen/underscore)
  // we get "foo" — but the surrounding whitespace stays trimmed.
  assert.equal(slugify("!!!foo!!!"), "foo");
});

test("returns empty string for empty input", () => {
  assert.equal(slugify(""), "");
});

test("collapses consecutive hyphens into one", () => {
  // "a - b" lowercases/strips to "a - b", whitespace collapses to
  // "a---b" — GitHub's slugger then collapses those to a single "-".
  assert.equal(slugify("a - b"), "a-b");
  assert.equal(slugify("Hello - world"), "hello-world");
  assert.equal(slugify("a --- b"), "a-b");
});

test("strips leading and trailing hyphens after punctuation removal", () => {
  // "---foo---" -> after strip + trim the hyphens stay; collapse doesn't
  // strip them. We need a final /^-|-$/ pass.
  assert.equal(slugify("---foo---"), "foo");
  assert.equal(slugify("!hello!"), "hello");
});

test("returns empty string for whitespace-only input", () => {
  assert.equal(slugify("   \t\n"), "");
});
