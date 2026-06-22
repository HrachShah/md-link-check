// Convert a Markdown heading text into its GitHub-style anchor slug.
// GitHub's algorithm (per github-slugger) is roughly:
//   1. Lowercase the text.
//   2. Strip non-alphanumeric/-/_/space characters.
//   3. Replace each run of whitespace with a single hyphen.
//   4. If two headings would produce the same slug, suffix "-1", "-2", ...
//      (the deduplication itself is handled by the caller — see scan.js).
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s\-_]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^[\s\-]+|[\s\-]+$/g, "");
}
