"use strict";

// fetch.sh must always exit 0 and always print one JSON envelope, so that a
// network blip, an expired token, or a missing dependency shows up as a
// message in the panel instead of looking like a crashed widget. Every branch
// here is driven by a stub `gh` pinned through PR_WIDGET_GH_BIN.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ROOT, readFixture, runFetchWithStubGh } = require("./helpers.js");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-widget-test-"));
}

describe("fetch.sh", () => {
  test("returns a normalized envelope on success", () => {
    const env = runFetchWithStubGh(tmp(), { stdout: readFixture("graphql-full.json") });
    assert.equal(env.ok, true);
    assert.equal(env.login, "octo-dev");
    assert.equal(env.needsAuth, false);
    assert.equal(env.error, "");
    assert.equal(env.prs.length, 3);
  });

  test("reports not-signed-in distinctly so the panel can say what to do", () => {
    const env = runFetchWithStubGh(tmp(), {
      code: 1,
      stderr: "To get started with GitHub CLI, please run: gh auth login",
    });
    assert.equal(env.ok, false);
    assert.equal(env.needsAuth, true);
    assert.match(env.error, /gh auth login/);
    assert.deepEqual(env.prs, []);
  });

  test("recognises an HTTP 401 as an auth problem too", () => {
    const env = runFetchWithStubGh(tmp(), { code: 1, stderr: "HTTP 401: Bad credentials" });
    assert.equal(env.needsAuth, true);
  });

  test("reports an unreachable network without blaming credentials", () => {
    const env = runFetchWithStubGh(tmp(), {
      code: 1,
      stderr: "dial tcp: lookup api.github.com: no such host",
    });
    assert.equal(env.ok, false);
    assert.equal(env.needsAuth, false);
    assert.match(env.error, /unreachable/i);
  });

  test("passes an unclassified failure through", () => {
    const env = runFetchWithStubGh(tmp(), { code: 3, stderr: "something else went wrong" });
    assert.equal(env.ok, false);
    assert.match(env.error, /something else went wrong/);
  });

  test("truncates a runaway error message", () => {
    const env = runFetchWithStubGh(tmp(), { code: 1, stderr: "x".repeat(5000) });
    assert.ok(env.error.length <= 220, `error was ${env.error.length} chars`);
    assert.match(env.error, /…$/);
  });

  test("collapses newlines in an error so the panel gets one line", () => {
    const env = runFetchWithStubGh(tmp(), { code: 1, stderr: "line one\nline two\nline three" });
    assert.doesNotMatch(env.error, /\n/);
    assert.match(env.error, /line one line two line three/);
  });

  test("surfaces a partial GraphQL error but keeps the data", () => {
    const env = runFetchWithStubGh(tmp(), { stdout: readFixture("graphql-partial-errors.json") });
    assert.equal(env.ok, true);
    assert.match(env.error, /SAML SSO/);
    assert.equal(env.prs.length, 3, "data that did come back is preserved");
  });

  test("rejects a response with no viewer", () => {
    const env = runFetchWithStubGh(tmp(), { stdout: readFixture("graphql-no-viewer.json") });
    assert.equal(env.ok, false);
    assert.match(env.error, /Unexpected response/);
  });

  test("rejects unparseable output", () => {
    const env = runFetchWithStubGh(tmp(), { stdout: "<html>502 Bad Gateway</html>" });
    assert.equal(env.ok, false);
    assert.ok(env.error.length > 0);
  });

  test("reports a missing gh rather than dying", () => {
    const env = runFetchWithStubGh(tmp(), { ghBin: path.join(tmp(), "definitely-not-here") });
    assert.equal(env.ok, false);
    assert.match(env.error, /GitHub CLI/);
    assert.deepEqual(env.prs, []);
  });

  test("exits 0 even when everything fails", () => {
    const dir = tmp();
    const out = execFileSync("bash", [path.join(ROOT, "fetch.sh")], {
      encoding: "utf8",
      env: { ...process.env, PR_WIDGET_GH_BIN: path.join(dir, "nope") },
    });
    assert.doesNotThrow(() => JSON.parse(out)); // execFileSync would have thrown on a non-zero exit
  });

  test("clamps the search limit it forwards to gh", () => {
    const dir = tmp();
    const bin = path.join(dir, "gh");
    const argsFile = path.join(dir, "args.txt");
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\ncat ${JSON.stringify(
        path.join(ROOT, "test/fixtures/graphql-empty.json")
      )}\n`
    );
    fs.chmodSync(bin, 0o755);

    const run = (limit) => {
      execFileSync("bash", [path.join(ROOT, "fetch.sh"), String(limit)], {
        encoding: "utf8",
        env: { ...process.env, PR_WIDGET_GH_BIN: bin },
      });
      // gh receives the variable as a single "limit=<n>" argv entry.
      const args = fs.readFileSync(argsFile, "utf8").trim().split("\n");
      const entry = args.find((a) => a.startsWith("limit="));
      assert.ok(entry, "fetch.sh did not pass a limit variable");
      return entry.slice("limit=".length);
    };

    assert.equal(run(40), "40");
    assert.equal(run(500), "100", "clamped to the API maximum");
    assert.equal(run(1), "10", "clamped to a sane minimum");
    assert.equal(run("garbage"), "40", "falls back to the default");
  });

  test("asks GitHub for all four involvement searches", () => {
    const dir = tmp();
    const bin = path.join(dir, "gh");
    const argsFile = path.join(dir, "args.txt");
    fs.writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\ncat ${JSON.stringify(
        path.join(ROOT, "test/fixtures/graphql-empty.json")
      )}\n`
    );
    fs.chmodSync(bin, 0o755);
    execFileSync("bash", [path.join(ROOT, "fetch.sh")], {
      encoding: "utf8",
      env: { ...process.env, PR_WIDGET_GH_BIN: bin },
    });
    const args = fs.readFileSync(argsFile, "utf8");
    for (const q of ["involves:@me", "review-requested:@me", "mentions:@me", "assignee:@me"]) {
      assert.ok(args.includes(q), `missing search ${q}`);
    }
    assert.ok(args.includes("is:pr is:open"), "only open pull requests");
    assert.ok(args.includes("archived:false"), "archived repos excluded");
  });
});
