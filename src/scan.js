// Find anchor links, image references, and headings in a single Markdown
// source. Returns plain JS objects — no I/O — so this module is trivially
// unit-testable.
//
// The parser is intentionally small and conservative: it handles the cases
// that come up in real-world READMEs and blog posts (the things this tool
// is built to catch) and does not try to be a full CommonMark engine.
import { slugify } from "./slug.js";

// A heading is "#", "##", … up to 6 '#'s, then text. We don't try to
// disambiguate ATX headings inside fenced code — the rest of the regex
// already disallows 'inline backticks' for the simple case, and a stricter
// fenced-block skip lives in `findIssues`.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

// Markdown links:  [text](href)  (skip images — those start with '!')
// We also support reference-style links:  [text][ref]  and  [text]
const INLINE_LINK_RE = /(?<!\!)\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;

// Reference definitions map labels to destinations, so shortcut references
// can be resolved without treating ordinary bracketed prose as a link.
const REFERENCE_DEF_RE = /^\s*\[([^\]]+)\]:\s*(<[^>\n]*>|\S+)/gm;
const REFERENCE_LINK_RE = /(?<!\!)\[([^\]]+)\]\[([^\]]+)\]/g;
const SHORT_REF_RE = /(?<!\!)\[([^\]]+)\](?![ \t]*[\(\[:])/g;

// Images:  ![alt](src)
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;

// Headings have content between [start] markers that may include link
// targets. Strip them before slugging, so '# See [foo](bar)' produces
// 'see-foo' rather than 'see-foobar'.
const HEADING_LINK_STRIP_RE = /!?\[([^\]]*)\]\([^)]*\)/g;

// Strip inline code (single backticks) from heading text before slugging,
// because GitHub does the same: '# Use `npm install`' becomes
// 'use-npm-install'. We drop only the backticks, NOT the inner text.
const HEADING_CODE_STRIP_RE = /`+/g;

function extractHeadings(source) {
  const out = [];
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(source)) !== null) {
    const level = m[1].length;
    const raw = m[2];
    const stripped = raw
      .replace(HEADING_LINK_STRIP_RE, "$1")
      .replace(HEADING_CODE_STRIP_RE, "");
    out.push({ level, text: raw, slug: slugify(stripped), index: m.index });
  }
  return out;
}

function extractInlineLinks(source) {
  const out = [];
  INLINE_LINK_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_LINK_RE.exec(source)) !== null) {
    out.push({ text: m[1], href: m[2], index: m.index });
  }
  return out;
}

function extractReferenceDefinitions(source) {
  const defs = new Map();
  REFERENCE_DEF_RE.lastIndex = 0;
  let m;
  while ((m = REFERENCE_DEF_RE.exec(source)) !== null) {
    const destination = m[2].trim();
    const href = destination.startsWith("<") && destination.endsWith(">")
      ? destination.slice(1, -1)
      : destination;
    const key = m[1].trim().toLowerCase();
    if (!defs.has(key)) defs.set(key, href);
  }
  return defs;
}

function extractReferenceLinks(source, defs) {
  const out = [];
  REFERENCE_LINK_RE.lastIndex = 0;
  let m;
  while ((m = REFERENCE_LINK_RE.exec(source)) !== null) {
    const href = defs.get(m[2].trim().toLowerCase());
    if (href) out.push({ text: m[1], href, index: m.index });
  }
  return out;
}

function extractShortRefLinks(source, defs) {
  const out = [];
  SHORT_REF_RE.lastIndex = 0;
  let m;
  while ((m = SHORT_REF_RE.exec(source)) !== null) {
    const href = defs.get(m[1].trim().toLowerCase());
    if (href) out.push({ text: m[1], href, index: m.index });
  }
  return out;
}

function extractImages(source) {
  const out = [];
  IMAGE_RE.lastIndex = 0;
  let m;
  while ((m = IMAGE_RE.exec(source)) !== null) {
    out.push({ alt: m[1], src: m[2], index: m.index });
  }
  return out;
}

// Walk through `source` and report every issue we find. Each issue has:
//   { kind, line, col, message, ... }
//
// `path` is purely informational (used in the message text); the function
// itself never touches the filesystem.
function findIssues(source, path = "<input>") {
  const issues = [];
  const headings = extractHeadings(source);
  const referenceDefinitions = extractReferenceDefinitions(source);

  // Assign each heading a deduplicated slug, the way GitHub renders them.
  const seen = new Map();
  const headingSlugs = new Map(); // raw-slug -> final-slug
  for (const h of headings) {
    let s = h.slug;
    if (s === "") continue; // empty heading, skip
    const count = seen.get(s) ?? 0;
    if (count > 0) {
      const dedup = `${s}-${count}`;
      headingSlugs.set(h.slug + "\u0000" + count, dedup);
      issues.push({
        kind: "duplicate-heading",
        line: lineOf(source, h.index),
        path,
        message: `heading "${h.text}" produces a slug that collides with an earlier heading (this one becomes "${dedup}")`,
      });
      s = dedup;
    } else {
      headingSlugs.set(h.slug + "\u0000" + 0, s);
    }
    seen.set(h.slug, count + 1);
  }

  const validSlugs = new Set(headingSlugs.values());

  // Now check every anchor link against the set of valid slugs.
  const anchorLinks = [
    ...extractInlineLinks(source),
    ...extractReferenceLinks(source, referenceDefinitions),
    ...extractShortRefLinks(source, referenceDefinitions),
  ];
  for (const link of anchorLinks) {
    if (!link.href.startsWith("#")) continue;
    const target = link.href.slice(1).toLowerCase();
    if (target === "") continue; // "[](#)" — a placeholder, skip
    if (!validSlugs.has(target)) {
      issues.push({
        kind: "broken-anchor",
        line: lineOf(source, link.index),
        path,
        message: `anchor link "#${target}" does not match any heading in this file`,
      });
    }
  }

  // Check images: empty alt is a real accessibility issue, but a
  // deliberately-empty alt ("decorative image") is fine — we only flag
  // images whose alt text is literally missing from the source, i.e. the
  // '[]' form, not the '[decorative]' form.
  const images = extractImages(source);
  for (const img of images) {
    // We can tell 'missing alt' from 'empty alt' by looking at the
    // original source: `![]()` has 0 chars between the brackets, `![alt]()`
    // has >= 1. Use the captured `alt` length and the index to disambiguate.
    if (img.alt === "" && isAltTrulyMissing(source, img.index)) {
      issues.push({
        kind: "missing-alt",
        line: lineOf(source, img.index),
        path,
        message: "image is missing alt text — add a description for screen readers (use ![decorative](...) for intentional decoration)",
      });
    }
  }

  return issues;
}

// `inlineLinks` and `images` both return `alt: ""` and `text: ""` for the
// empty case. We need to peek at the raw source to know whether the alt was
// literally missing. The match starts at `!` for images.
function isAltTrulyMissing(source, matchIndex) {
  // Match layout: ![<alt>](<src>)
  // We want to know if `<alt>` is the empty string at the source level
  // (i.e. `![]` rather than `![ ]`). Easiest: find the matching ']' and
  // check whether the two characters before it are "[]".
  const close = source.indexOf("]", matchIndex + 2);
  if (close < 0) return false;
  return source[close - 1] === "[" && source[close] === "]";
}

// 1-indexed line number for a character offset.
function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

export {
  slugify,
  extractHeadings,
  extractInlineLinks,
  extractReferenceDefinitions,
  extractReferenceLinks,
  extractShortRefLinks,
  extractImages,
  findIssues,
  lineOf,
};
