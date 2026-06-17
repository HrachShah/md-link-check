# Changelog

## 0.1.0 — 2026-06-17

Initial release. Detects:

- **Broken anchor links** — `[text](#heading)` pointing to a heading whose slug doesn't match any heading in the file
- **Duplicate heading slugs** — two headings that GitHub would deduplicate with `-1`, `-2`, etc., so links anchored to the second occurrence silently rot
- **Images missing alt text** — `![]()` with no alt at all

Grep-friendly output: `<path>:<line>: [<kind>] <message>`, exit code 1 on any issue.

Works on a file, a directory (recursive), or stdin (`-`). Zero dependencies.
