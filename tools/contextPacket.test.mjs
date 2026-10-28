import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPacket, verifyPacket } from "./contextPacket.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-packet-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("builds and verifies an exact source packet with provenance and byte reduction metrics", () => {
  withTempDir((dir) => {
    const fileA = path.join(dir, "src", "math.js");
    fs.mkdirSync(path.dirname(fileA), { recursive: true });
    fs.writeFileSync(
      fileA,
      [
        "// header comment",
        "export function add(a, b) {",
        "  return a + b;",
        "}",
        "export function mul(a, b) {",
        "  return a * b;",
        "}",
      ].join("\n") + "\n",
      "utf8"
    );

    const packet = buildPacket(
      {
        id: "pkt-math-add",
        goal: "Inspect add implementation",
        excerpts: [{ path: "src/math.js", startLine: 2, endLine: 4, reason: "add function body" }],
      },
      { root: dir, now: "2026-10-28" }
    );

    assert.equal(packet.id, "pkt-math-add");
    assert.equal(packet.excerpts.length, 1);
    assert.equal(packet.excerpts[0].content, "export function add(a, b) {\n  return a + b;\n}");
    assert.ok(packet.metrics.totalExcerptBytes < packet.metrics.totalSourceBytes);
    assert.ok(packet.metrics.byteReductionRatio > 0);

    const check = verifyPacket(packet, { root: dir });
    assert.equal(check.ok, true);
    assert.deepEqual(check.errors, []);
  });
});

test("rejects stale source file when underlying file changes after packet creation", () => {
  withTempDir((dir) => {
    const f = path.join(dir, "mod.js");
    fs.writeFileSync(f, "const x = 1;\nconst y = 2;\n", "utf8");
    const packet = buildPacket({
      id: "pkt-stale",
      goal: "Check staleness",
      excerpts: [{ path: "mod.js", startLine: 1, endLine: 2 }],
    }, { root: dir });

    fs.writeFileSync(f, "const x = 99;\nconst y = 2;\n", "utf8");
    const check = verifyPacket(packet, { root: dir });
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("stale source file")));
  });
});

test("rejects tampered excerpt content and mismatched byte counts", () => {
  withTempDir((dir) => {
    const f = path.join(dir, "mod.js");
    fs.writeFileSync(f, "line1\nline2\nline3\n", "utf8");
    const packet = buildPacket({
      id: "pkt-tamper",
      goal: "Check tamper detection",
      excerpts: [{ path: "mod.js", startLine: 1, endLine: 2 }],
    }, { root: dir });

    const tampered = structuredClone(packet);
    tampered.excerpts[0].content = "line1\nHACKED";
    const check = verifyPacket(tampered, { root: dir });
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("excerptSha256 mismatch")));
  });
});

test("rejects path traversal, invalid line bounds, duplicates, and oversized packets", () => {
  withTempDir((dir) => {
    const f = path.join(dir, "a.txt");
    fs.writeFileSync(f, "one\ntwo\nthree\n", "utf8");

    assert.throws(
      () =>
        buildPacket({
          id: "bad-path",
          goal: "Escape root",
          excerpts: [{ path: "../outside.txt", startLine: 1, endLine: 1 }],
        }, { root: dir }),
      /escapes root/
    );

    assert.throws(
      () =>
        buildPacket({
          id: "bad-range",
          goal: "Out of bounds line",
          excerpts: [{ path: "a.txt", startLine: 2, endLine: 10 }],
        }, { root: dir }),
      /exceeds file line count/
    );

    assert.throws(
      () =>
        buildPacket({
          id: "dup-range",
          goal: "Duplicate excerpt",
          excerpts: [
            { path: "a.txt", startLine: 1, endLine: 2 },
            { path: "a.txt", startLine: 1, endLine: 2 },
          ],
        }, { root: dir }),
      /Duplicate excerpt range/
    );

    assert.throws(
      () =>
        buildPacket({
          id: "oversize",
          goal: "Exceed maxBytes",
          maxBytes: 4,
          excerpts: [{ path: "a.txt", startLine: 1, endLine: 3 }],
        }, { root: dir }),
      /exceed maxBytes/
    );
  });
});
