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
// already disallows 'inline backticks' for the simple case. The actual
// fenced-block skip lives in `stripFencedCodeBlocks` below: `findIssues`
// masks fence regions with spaces before extracting, so regex matches
// outside fences keep their original indexes and line numbers.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

// Setext-style headings: a non-empty text line followed by a line of only
// "=" chars (level 1) or "-" chars (level 2). Per CommonMark §4.3 the
// underline may be indented up to 3 spaces and the trailing spaces don't
// matter, but the text line must not be blank and must not itself be a
// block-level construct (a paragraph line is fine). Setext headings
// coexist with ATX headings and produce the same {level, text, slug, index}
// shape from extractHeadings.
const SETEXT_HEADING_RE = /^([ \t]{0,3})(?<text>\S.*)\n[ \t]{0,3}(?<uline>={1,}|\-{1,})[ \t]*(?:\n|$)/gm;

// Markdown links:  [text](href)  (skip images — those start with '!')
// We also support reference-style links:  [text][ref]  and  [text]
// The URL may contain one level of balanced parens — required for
// CommonMark-conformant links to Wikipedia and other URLs that include
// disambiguation like /wiki/Foo_(bar). The shape is:
//   text: any run (including empty) of non-']' chars
//   url:  a run of chars that may include one balanced pair of parens
//   title (optional): a double-quoted string after a single space
// We capture the title as group 3 when present, so callers that ignore
// it (extractInlineLinks, extractImages) can still rely on m[2] for the
// URL.
const INLINE_LINK_RE = /(?<!\!)\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))*)(?:\s+"([^"]*)")?\)/g;

// Explicit reference links like `[text][ref]` and shortcut references like
// `[text]` when a matching `[text]: ...` definition exists.
const REFERENCE_LINK_RE = /(?<!\!)\[([^\]]+)\]\[([^\]]+)\]/g;
const SHORT_REF_RE = /\[([^\]]+)\](?!\s*[\(\[:])/g;
const REFERENCE_DEF_RE = /^\s*\[([^\]]+)\]:\s*(\S+)/gm;

// Images:  ![alt](src)  — same balanced-paren shape as INLINE_LINK_RE so
// image URLs that contain parens (e.g. Wikimedia Commons file URLs) are
// preserved verbatim instead of being truncated at the first ')'.
const IMAGE_RE = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))*)(?:\s+"([^"]*)")?\)/g;

// Fenced code blocks: ``` … ``` or ~~~ … ~~~ (with an optional info string
// after the opening fence). Used to mask fence contents with spaces so
// headings/links/images inside fences are ignored by the extractors while
// their source offsets stay intact.
const FENCE_OPEN_RE = /^([`~]{3,})[^`~\n]*$/m;

// Headings have content between [start] markers that may include link
// targets. Strip them before slugging, so '# See [foo](bar)' produces
// 'see-foo' rather than 'see-foobar'. Mirrors the balanced-paren shape
// of INLINE_LINK_RE so URLs that include parens are stripped cleanly
// instead of leaving a stray ')' in the heading text.
const HEADING_LINK_STRIP_RE = /!?\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g;

// Strip inline code (single backticks) from heading text before slugging,
// because GitHub does the same: '# Use `npm install`' becomes
// 'use-npm-install'. We drop only the backticks, NOT the inner text.
const HEADING_CODE_STRIP_RE = /`+/g;

// Replace the contents of every fenced code block with spaces, leaving the
// block's length and line count unchanged. Lines inside the block are
// blanked character-for-character so any regex with `^` and `m` flag (or
// the `m.index` it returns) keeps matching the original offsets. The
// result is a copy of `source` safe to feed to the extractors: nothing
// inside a fence will be mistaken for a heading, link, or image, even
// when the fence's content would otherwise look like one.
//
// We support two fence characters (` and ~), per CommonMark §4.5. The
// opening fence must be at the start of a line and have an optional info
// string; the matching closing fence must use the same character and be
// at least as long. Unclosed fences are conservatively left alone — better
// to over-report than to swallow real markdown.
function stripFencedCodeBlocks(source) {
  const lines = source.split("\n");
  const out = lines.slice();
  let openMarker = null; // null | { char, length, startLine }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openMarker === null) {
      const m = /^\s*([`~]{3,})[^`~\n]*$/.exec(line);
      if (!m) continue;
      const marker = m[1];
      openMarker = { char: marker[0], length: marker.length, startLine: i };
      // Blank the opening fence line so the heading regex can't see a
      // `# foo` lookalike. Preserve newlines (the join below restores
      // them) by keeping the line as a same-length run of spaces.
      out[i] = " ".repeat(line.length);
    } else {
      const char = openMarker.char === "`" ? "`" : "~";
      const m = new RegExp(
        `^\\s*\\${char}{${openMarker.length},}[ \\t]*$`,
      ).exec(line);
      if (m) {
        // Blank the line that closes the fence.
        out[i] = " ".repeat(line.length);
        openMarker = null;
      } else {
        // Inside the fence: blank the whole line so its contents can't
        // match HEADING_RE, INLINE_LINK_RE, or IMAGE_RE.
        out[i] = " ".repeat(line.length);
      }
    }
  }
  // An unclosed fence is left intact — we don't guess where the user
  // meant it to end. Restore the original lines from the opening fence
  // onwards so the rest of the document is still checked. This matches
  // the "conservatively left alone" comment above and avoids silently
  // masking real headings or links after a stray opening fence.
  if (openMarker !== null) {
    for (let i = openMarker.startLine; i < lines.length; i++) {
      out[i] = lines[i];
    }
  }
  return out.join("\n");
}

function extractHeadings(source) {
  const out = [];
  // Setext headings come first because their underline lines are about
  // to be blanked by the ATX pass below (the underline looks like an
  // Setext h1/h2 marker, not an ATX heading). Index points at the start
  // of the text line so the rest of the report is line-accurate.
  SETEXT_HEADING_RE.lastIndex = 0;
  let sm;
  while ((sm = SETEXT_HEADING_RE.exec(source)) !== null) {
    const raw = sm.groups.text;
    const level = sm.groups.uline.startsWith("=") ? 1 : 2;
    const stripped = raw
      .replace(HEADING_LINK_STRIP_RE, "$1")
      .replace(HEADING_CODE_STRIP_RE, "");
    out.push({ level, text: raw, slug: slugify(stripped), index: sm.index });
  }
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
  // Return in document order. Mixed ATX/Setext documents are valid, so
  // sort by source offset rather than walking the file twice.
  out.sort((a, b) => a.index - b.index);
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
    defs.set(m[1].trim().toLowerCase(), m[2].trim());
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
  // Mask fenced code blocks before extracting so a `#` heading or
  // `[link](#foo)` inside a documentation code sample doesn't get
  // treated as real markdown. The mask preserves offsets, so the
  // `lineOf` calls below still report the correct source lines for
  // any matches we DO find outside fences.
  const masked = stripFencedCodeBlocks(source);
  const headings = extractHeadings(masked);
  const referenceDefinitions = extractReferenceDefinitions(masked);

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
    ...extractInlineLinks(masked),
    ...extractReferenceLinks(masked, referenceDefinitions),
    ...extractShortRefLinks(masked, referenceDefinitions),
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
  const images = extractImages(masked);
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
  extractImages,
  findIssues,
  lineOf,
};
