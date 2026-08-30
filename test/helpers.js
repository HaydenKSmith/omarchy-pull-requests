"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");

function fixturePath(name) {
  return path.join(FIXTURES, name);
}

function readFixture(name) {
  return fs.readFileSync(fixturePath(name), "utf8");
}

// Runs transform.jq exactly the way fetch.sh does.
function runTransform(fixtureName, partial = "") {
  const out = execFileSync(
    "jq",
    ["-c", "--arg", "partial", partial, "-f", path.join(ROOT, "transform.jq"), fixturePath(fixtureName)],
    { encoding: "utf8" }
  );
  return JSON.parse(out);
}

// Runs fetch.sh with a stub `gh` pinned via PR_WIDGET_GH_BIN. The stub is a
// throwaway script that prints `stdout`/`stderr` and exits with `code`, which
// is how every failure branch in fetch.sh gets exercised without a network.
function runFetchWithStubGh(tmpdir, { stdout = "", stderr = "", code = 0, ghBin } = {}) {
  let bin = ghBin;
  if (bin === undefined) {
    bin = path.join(tmpdir, "gh");
    fs.writeFileSync(
      bin,
      "#!/usr/bin/env bash\n" +
        `cat <<'STUB_STDOUT_EOF'\n${stdout}\nSTUB_STDOUT_EOF\n` +
        `cat >&2 <<'STUB_STDERR_EOF'\n${stderr}\nSTUB_STDERR_EOF\n` +
        `exit ${code}\n`
    );
    fs.chmodSync(bin, 0o755);
  }

  const result = execFileSync("bash", [path.join(ROOT, "fetch.sh"), "40"], {
    encoding: "utf8",
    env: { ...process.env, PR_WIDGET_GH_BIN: bin },
  });
  return JSON.parse(result);
}

module.exports = { ROOT, FIXTURES, fixturePath, readFixture, runTransform, runFetchWithStubGh };
