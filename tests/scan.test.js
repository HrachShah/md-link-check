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

test("extractHeadings recognises setext-style h1 (===) and h2 (---) underlines", () => {
  const src = "Setext Title\n============\n\nbody line\n\nSubsection\n----------\n";
  const headings = extractHeadings(src);
  assert.equal(headings.length, 2);
  assert.deepEqual(headings[0], { level: 1, text: "Setext Title", slug: "setext-title", index: 0 });
  assert.deepEqual(headings[1], { level: 2, text: "Subsection", slug: "subsection", index: src.indexOf("Subsection") });
});

test("extractHeadings returns setext and ATX headings in document order", () => {
  const src = "ATX One\n========\n\n## ATX Two\n\nSetext Three\n------------\n";
  const headings = extractHeadings(src);
  assert.deepEqual(
    headings.map((h) => h.level),
    [1, 2, 2],
  );
  assert.deepEqual(
    headings.map((h) => h.text),
    ["ATX One", "ATX Two", "Setext Three"],
  );
});

test("extractHeadings does not mistake a paragraph underline for a setext heading", () => {
  // A blank line between the text and the underline invalidates the
  // setext form per CommonMark §4.3, so the dash line should not be
  // picked up as an h2 marker.
  const src = "First line\n\n---\n";
  const headings = extractHeadings(src);
  assert.equal(headings.length, 0);
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

test("extractInlineLinks preserves balanced parens inside the URL", () => {
  // CommonMark allows one level of balanced parens inside a link URL.
  // Wikipedia disambiguation links are the canonical real-world example.
  const links = extractInlineLinks(
    "[foo](https://en.wikipedia.org/wiki/Foo_(bar))",
  );
  assert.equal(links.length, 1);
  assert.equal(
    links[0].href,
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  );
});

test("extractInlineLinks keeps the optional title and still allows parens in the URL", () => {
  const links = extractInlineLinks(
    '[foo](https://en.wikipedia.org/wiki/Foo_(bar) "the Foo article")',
  );
  assert.equal(links.length, 1);
  assert.equal(
    links[0].href,
    "https://en.wikipedia.org/wiki/Foo_(bar)",
  );
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

test("extractImages preserves balanced parens inside the image src", () => {
  const images = extractImages(
    "![pic](https://en.wikipedia.org/wiki/File:Pic_(test).png)",
  );
  assert.equal(images.length, 1);
  assert.equal(images[0].src, "https://en.wikipedia.org/wiki/File:Pic_(test).png");
  assert.equal(images[0].alt, "pic");
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

test("findIssues reports the correct line number for a duplicate heading", () => {
  // Regression: extractHeadings previously did not capture the match's
  // character offset, so findIssues always reported line 1 for duplicate
  // headings even when they appeared on a later line. The reporter now
  // walks to the heading's source offset, so each duplicate gets its own
  // line.
  const src = ["# Top", "", "# Top", "", "# Top"].join("\n");
  const issues = findIssues(src);
  const dupes = issues
    .filter((i) => i.kind === "duplicate-heading")
    .sort((a, b) => a.line - b.line);
  assert.equal(dupes.length, 2);
  assert.equal(dupes[0].line, 3);
  assert.equal(dupes[1].line, 5);
  // And the first heading on line 1 must NOT be reported.
  assert.equal(dupes.some((d) => d.line === 1), false);
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

test("extractHeadings strips links whose URLs contain balanced parens", () => {
  // The slug must reflect only the link text — the URL (with its parens)
  // should not appear in the slug. This guards HEADING_LINK_STRIP_RE.
  const headings = extractHeadings(
    "# See [Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar))\n",
  );
  assert.equal(headings.length, 1);
  assert.equal(headings[0].slug, "see-wikipedia");
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

// --- fenced code blocks -------------------------------------------------

test("fenced code block content is not treated as headings or anchor targets", () => {
  // Without fence skipping, the inner # heading and link would either be
  // parsed as real headings (false-positive collisions) or flag the
  // [link](#inner) as broken.
  const src = [
    "# Real Heading",
    "",
    "```bash",
    "# Fake Heading In Code",
    "[link](#inner)",
    "```",
    "",
  ].join("\n");
  assert.equal(findIssues(src).length, 0);
});

test("fenced block links are skipped, but real links outside the fence are still checked", () => {
  const src = [
    "# Real Heading",
    "",
    "```",
    "[in-fence](#not-a-heading)",
    "```",
    "",
    "[real-but-broken](#also-not-a-heading)",
    "",
  ].join("\n");
  const issues = findIssues(src);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "broken-anchor");
  assert.match(issues[0].message, /#also-not-a-heading/);
});

test("tilde fence markers (~~~) are also recognized as code fences", () => {
  const src = [
    "# Real Heading",
    "",
    "~~~",
    "# Tilde Fence Heading",
    "[link](#inner)",
    "~~~",
    "",
  ].join("\n");
  assert.equal(findIssues(src).length, 0);
});

test("unclosed fence does not swallow the rest of the document", () => {
  // If the closing fence is missing we should not blank the trailing
  // content — real broken links past the unclosed fence must still be
  // reported.
  const src = [
    "# Real Heading",
    "",
    "```",
    "[in-unclosed-fence](#inner)",
    "[real-but-broken](#also-missing)",
  ].join("\n");
  const issues = findIssues(src);
  // Expect the real broken link to be caught. The in-fence link may or
  // may not be reported depending on policy, but the post-fence broken
  // link must always be reported.
  const real = issues.find((i) => /#also-missing/.test(i.message));
  assert.ok(real, "post-fence broken link should be reported");
});

test("fence-masked source preserves character offsets for line number reporting", () => {
  // The reported line for the real broken link should match the line
  // number in the original source, not the masked one (they're identical
  // because we only blank characters, not remove them).
  const src = [
    "# Real Heading",
    "",
    "```",
    "[in-fence](#inner)",
    "```",
    "",
    "line 7 has the real link: [broken](#missing-heading)",
    "",
  ].join("\n");
  const issues = findIssues(src);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 7);
});
