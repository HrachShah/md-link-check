// Convert a Markdown heading text into its GitHub-style anchor slug.
// GitHub's algorithm (per github-slugger) is roughly:
//   1. Lowercase the text.
//   2. Strip non-alphanumeric/-/_/space characters.
//   3. Replace each run of whitespace with a single hyphen.
//   4. Collapse runs of hyphens into a single hyphen and trim leading and
//      trailing hyphens, so 'foo---bar' becomes 'foo-bar' and '---foo---'
//      becomes 'foo'. Without this, two distinct headings like 'foo bar'
//      and 'foo---bar' collide on the page (no anchor for either) but
//      produce different slugs, and an explicit '---' prefix/suffix
//      survives into the rendered anchor as a literal hyphen triple that
//      no real link author ever types.
//   5. If two headings would produce the same slug, suffix "-1", "-2", ...
//      (the deduplication itself is handled by the caller — see scan.js).
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s\-_]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
