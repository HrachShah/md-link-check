import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugify,
  extractHeadings,
  extractInlineLinks,
  extractImages,
  findIssues,
  lineOf,
} from "../src/scan.js";

// --- extractHeadings -----------------------------------------------------

test("extractHeadings returns level, text, and slug for each heading", () => {
  const src = "# Top\n\n## A Subsection\n\n### Deep heading here\n";
  const headings = extractHeadings(src);
  assert.equal(headings.length, 3);
  assert.deepEqual(headings[0], { level: 1, text: "Top", slug: "top", index: 0 });
  assert.deepEqual(headings[1], { level: 2, text: "A Subsection", slug: "a-subsection", index: 7 });
  assert.deepEqual(headings[2], { level: 3, text: "Deep heading here", slug: "deep-heading-here", index: 24 });
});

test("extractHeadings strips link targets before slugging", () => {
  // "# See [foo](bar) too" should slug to "see-foo-too", not "see-foobar-too".
  const headings = extractHeadings("# See [foo](bar) too\n");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].slug, "see-foo-too");
  assert.equal(headings[0].text, "See [foo](bar) too");
});

test("extractHeadings strips inline code before slugging", () => {
  const headings = extractHeadings("# Use `npm install`\n");
  assert.equal(headings.length, 1);
  assert.equal(headings[0].slug, "use-npm-install");
});

test("extractHeadings handles up to 6 levels of #", () => {
  const src = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6\n";
  const headings = extractHeadings(src);
  assert.equal(headings.length, 6);
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 3, 4, 5, 6]);
});

// --- extractInlineLinks --------------------------------------------------

test("extractInlineLinks finds inline links and ignores images", () => {
  const src = "see [docs](https://example.com) and ![pic](img.png)";
  const links = extractInlineLinks(src);
  assert.equal(links.length, 1);
  assert.equal(links[0].text, "docs");
  assert.equal(links[0].href, "https://example.com");
});

test("extractInlineLinks captures the link's character offset", () => {
  const src = "abc [x](y) z";
  const links = extractInlineLinks(src);
  assert.equal(links.length, 1);
  assert.equal(src.slice(links[0].index, links[0].index + 6), "[x](y)");
});

test("extractInlineLinks keeps anchor-only hrefs", () => {
  const links = extractInlineLinks("[jump](#somewhere)");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "#somewhere");
});

// --- extractImages -------------------------------------------------------

test("extractImages finds images with alt text", () => {
  const images = extractImages("![logo](logo.png)");
  assert.equal(images.length, 1);
  assert.equal(images[0].alt, "logo");
  assert.equal(images[0].src, "logo.png");
});

test("extractImages keeps empty alt string when brackets are empty", () => {
  // Important: alt comes back as "", and the source-level check in
  // findIssues then decides whether to flag it.
  const images = extractImages("![](decorative.png)");
  assert.equal(images.length, 1);
  assert.equal(images[0].alt, "");
});

// --- findIssues: anchors --------------------------------------------------

test("findIssues flags an anchor that has no matching heading", () => {
  const src = "# Real Heading\n\ngo to [missing](#nope)\n";
  const issues = findIssues(src);
  const broken = issues.filter((i) => i.kind === "broken-anchor");
  assert.equal(broken.length, 1);
  assert.match(broken[0].message, /#nope/);
});

test("findIssues accepts a valid anchor link", () => {
  const src = "# Real Heading\n\ngo to [real](#real-heading)\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "broken-anchor").length, 0);
});

test("findIssues is case-insensitive on anchor matching (GitHub renders lowercased)", () => {
  const src = "# Real Heading\n\ngo to [r](#Real-Heading)\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "broken-anchor").length, 0);
});

test("findIssues ignores empty href anchors ('[](#)')", () => {
  const src = "# H\n\nplaceholder [](#)\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "broken-anchor").length, 0);
});

// --- findIssues: duplicate headings -------------------------------------

test("findIssues reports the duplicate heading line", () => {
  const src = "# Setup\n\ntext\n\n## Setup\n";
  const duplicate = findIssues(src).find((issue) => issue.kind === "duplicate-heading");
  assert.equal(duplicate.line, 5);
});

test("findIssues flags duplicate heading slugs with a '-N' suffix", () => {
  const src = "# Setup\n\n## Setup\n";
  const issues = findIssues(src);
  const dupes = issues.filter((i) => i.kind === "duplicate-heading");
  assert.equal(dupes.length, 1);
  assert.match(dupes[0].message, /setup-1/);
});

test("findIssues does NOT flag headings whose slugs differ", () => {
  const src = "# Setup\n\n## Setup (advanced)\n\n## Config\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "duplicate-heading").length, 0);
});

test("findIssues flags GitHub-style duplicate when a stripped heading collides", () => {
  // GitHub's slugger strips punctuation, so "Setup" and "Setup!" both
  // produce the slug "setup" — the second one should be flagged as a
  // duplicate and the user pointed at the "-1" suffix it will get.
  const src = "# Setup\n\n## Setup!\n";
  const issues = findIssues(src);
  const dupes = issues.filter((i) => i.kind === "duplicate-heading");
  assert.equal(dupes.length, 1);
  assert.match(dupes[0].message, /setup-1/);
});

// --- findIssues: missing alt text ---------------------------------------

test("findIssues flags images whose alt text is literally missing", () => {
  const src = "![](./missing.png)\n";
  const issues = findIssues(src);
  const alt = issues.filter((i) => i.kind === "missing-alt");
  assert.equal(alt.length, 1);
});

test("findIssues does NOT flag images with intentional empty alt", () => {
  // User wrote 'decorative' explicitly — that's intentional decoration,
  // not a missing alt.
  const src = "![decorative](./pic.png)\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "missing-alt").length, 0);
});

test("findIssues does NOT flag images with meaningful alt", () => {
  const src = "![A picture of a cat](./cat.jpg)\n";
  const issues = findIssues(src);
  assert.equal(issues.filter((i) => i.kind === "missing-alt").length, 0);
});

// --- findIssues: combined -----------------------------------------------

test("findIssues reports multiple kinds in one pass", () => {
  const src = [
    "# Real",
    "",
    "go to [bad](#missing) and [good](#real)",
    "",
    "![](./pic.png)",
    "",
    "## Real",
  ].join("\n");
  const issues = findIssues(src);
  const kinds = new Set(issues.map((i) => i.kind));
  assert.ok(kinds.has("broken-anchor"));
  assert.ok(kinds.has("missing-alt"));
  assert.ok(kinds.has("duplicate-heading"));
});

test("findIssues returns no issues for a clean document", () => {
  const src = [
    "# Title",
    "",
    "## A Subsection",
    "",
    "See the [subsection](#a-subsection) below.",
    "",
    "![logo](logo.png)",
  ].join("\n");
  assert.equal(findIssues(src).length, 0);
});

// --- lineOf -------------------------------------------------------------

test("lineOf returns 1 for offset 0", () => {
  assert.equal(lineOf("hello", 0), 1);
});

test("lineOf increments at every newline", () => {
  const src = "abc\ndef\nghi";
  assert.equal(lineOf(src, 0), 1);
  assert.equal(lineOf(src, 4), 2);
  assert.equal(lineOf(src, 8), 3);
});
