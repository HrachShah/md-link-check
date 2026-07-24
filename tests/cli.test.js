import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/index.js", import.meta.url));

function runCli(args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", (b) => (err += b.toString("utf8")));
    child.on("close", (code) => resolveRun({ code, out, err }));
    child.on("error", rejectRun);
    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

test("CLI exits 0 and reports 'clean' on a document with no issues", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdlc-"));
  try {
    const file = join(dir, "good.md");
    await writeFile(file, "# Title\n\n## Section\n\n[ok](#title)\n\n![alt](img.png)\n");
    const { code, out } = await runCli([file]);
    assert.equal(code, 0);
    assert.match(out, /clean across 1 file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI exits 1 and lists each issue with file:line: [kind] message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdlc-"));
  try {
    const file = join(dir, "bad.md");
    await writeFile(file, "# Top\n\n[bad](#nope)\n\n![](./missing.png)\n");
    const { code, out } = await runCli([file]);
    assert.equal(code, 1);
    assert.match(out, /bad\.md:3: \[broken-anchor\]/);
    assert.match(out, /bad\.md:5: \[missing-alt\]/);
    assert.match(out, /2 issue\(s\) across 1 file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI walks a directory recursively", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdlc-"));
  try {
    const sub = join(dir, "sub");
    await import("node:fs/promises").then((m) => m.mkdir(sub));
    await writeFile(join(dir, "a.md"), "# A\n\n## B\n\n[ok](#a)\n");
    await writeFile(join(sub, "b.md"), "# B\n\n[bad](#nope)\n");
    const { code, out } = await runCli([dir]);
    assert.equal(code, 1);
    assert.match(out, /\[broken-anchor\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI reads from stdin when given '-'", async () => {
  const { code, out } = await runCli(["-"], {
    stdin: "# Top\n\n[bad](#nope)\n",
  });
  assert.equal(code, 1);
  assert.match(out, /\[broken-anchor\]/);
});

test("CLI prints help and exits 0 on --help", async () => {
  const { code, out } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.match(out, /Usage:/);
});

test("CLI exits 2 when given a non-existent path", async () => {
  const { code, err } = await runCli(["/nonexistent/path/to/file.md"]);
  assert.equal(code, 2);
  assert.match(err, /cannot read/);
});

test("CLI exits 2 when a discovered Markdown file cannot be read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mdlc-"));
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(join(dir, "missing-source.md"), join(dir, "unreadable.md"));
    const { code, err } = await runCli([dir]);
    assert.equal(code, 2);
    assert.match(err, /cannot read/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
