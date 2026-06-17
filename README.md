# md-link-check

A small Node CLI (zero dependencies) that finds real, common Markdown bugs in your docs:

- **Broken anchor links** — `[text](#broken)` pointing to a heading that doesn't exist or has a different slug
- **Duplicate heading slugs** — two headings that GitHub will deduplicate with `-1`, `-2`, etc., so deep links rot silently
- **Images missing alt text** — `![]()` with no alt at all (fix: add a description like `![decorative](spacer.png)`)
- **Grep-friendly output** — `<path>:<line>: [<kind>] <message>`, exit code 1 if any issue found

## Install

```bash
npm install
```

## Usage

```bash
node src/index.js README.md
# README.md:7: [broken-anchor] anchor link "#broken" does not match any heading in this file

node src/index.js docs/   # recursive
cat CHANGES.md | node src/index.js -
```

Exit codes: `0` clean, `1` issues found, `2` could not read input.

## How heading slugs work

GitHub (and GitLab, etc.) turns `## Use \`npm install\`` into `#use-npm-install`. We use the same algorithm — lowercase, drop punctuation, collapse whitespace, hyphens between words — so the anchor links we accept match what your Markdown renderer actually produces. When two headings would produce the same slug, GitHub appends `-1`, `-2`, and we report that as a `duplicate-heading` so you can rewrite one of them before the second one silently breaks.

## Tests

```bash
npm test
```
