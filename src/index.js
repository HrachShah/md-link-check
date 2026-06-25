#!/usr/bin/env node
// CLI entrypoint: read one or more Markdown files (or - for stdin) and
// print any issues found, in a stable, grep-friendly format.
//
// Usage:
//   md-link-check path/to/file.md
//   md-link-check path/to/dir   # recursive
//   md-link-check path/a.md path/b.md
//   cat foo.md | md-link-check -
//
// Exit codes:
//   0 — no issues
//   1 — one or more issues found
//   2 — usage error / could not read input
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { findIssues } from "./scan.js";

function isMarkdown(name) {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

async function collectFiles(target) {
  if (target === "-") return [{ path: "<stdin>", read: () => readStdin() }];
  const abs = resolve(target);
  const st = await stat(abs);
  if (st.isDirectory()) {
    const entries = await readdir(abs, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      const child = join(abs, e.name);
      if (e.isDirectory()) {
        out.push(...(await collectFiles(child)));
      } else if (isMarkdown(e.name)) {
        out.push({ path: relative(process.cwd(), child), read: () => readFile(child, "utf8") });
      }
    }
    return out;
  }
  if (!isMarkdown(abs)) return [];
  return [{ path: relative(process.cwd(), abs), read: () => readFile(abs, "utf8") }];
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function formatIssue(issue) {
  return `${issue.path}:${issue.line}: [${issue.kind}] ${issue.message}`;
}

function printHelp() {
  process.stdout.write(
    [
      "md-link-check — find broken anchor links, missing alt text, and heading slug collisions",
      "",
      "Usage:",
      "  md-link-check <file.md> [<file2.md> ...]",
      "  md-link-check <dir>          (recursive)",
      "  md-link-check -              (read from stdin)",
      "",
      "Exit codes:",
      "  0  no issues",
      "  1  issues found",
      "  2  could not read input",
      "",
    ].join("\n"),
  );
}

async function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  let totalIssues = 0;
  let totalFiles = 0;
  for (const target of argv) {
    let files;
    try {
      files = await collectFiles(target);
    } catch (err) {
      process.stderr.write(`md-link-check: cannot read ${target}: ${err.message}\n`);
      return 2;
    }
    if (files.length === 0) {
      if (target !== "-") {
        process.stderr.write(`md-link-check: no markdown files under ${target}\n`);
      }
      continue;
    }
    for (const f of files) {
      let source;
      try {
        source = await f.read();
      } catch (err) {
        process.stderr.write(`md-link-check: cannot read ${f.path}: ${err.message}\n`);
        continue;
      }
      const issues = findIssues(source, f.path);
      totalFiles += 1;
      if (issues.length === 0) continue;
      for (const issue of issues) {
        process.stdout.write(formatIssue(issue) + "\n");
      }
      totalIssues += issues.length;
    }
  }

  if (totalIssues === 0) {
    process.stdout.write(`md-link-check: clean across ${totalFiles} file(s)\n`);
    return 0;
  }
  process.stdout.write(
    `md-link-check: ${totalIssues} issue(s) across ${totalFiles} file(s)\n`,
  );
  return 1;
}

// Run when invoked directly (`node src/index.js` or the installed bin).
// Module can still be imported for tests because of this guard.
const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`md-link-check: ${err.stack || err.message}\n`);
      process.exit(2);
    });
}

export { main, formatIssue };
