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

// Runs agents.sh with a sandboxed PATH, so "installed" means "this test said
// so" rather than "this machine happens to have codex". `agents` are the fake
// binaries to put on PATH; the launcher is stubbed through
// PR_WIDGET_LAUNCH_TUI and appends one argv per line to `<tmpdir>/launched`,
// which is what lets a test assert the exact command each agent was given.
function runAgents(tmpdir, args, { agents = [], defaultAgent = "", launcherExit = 0 } = {}) {
  const bin = path.join(tmpdir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const agent of agents) {
    const file = path.join(bin, agent);
    fs.writeFileSync(file, "#!/usr/bin/env bash\nexit 0\n");
    fs.chmodSync(file, 0o755);
  }

  const launchLog = path.join(tmpdir, "launched");
  const launcher = path.join(tmpdir, "launch-tui");
  fs.writeFileSync(
    launcher,
    "#!/usr/bin/env bash\n" +
      `printf '%s\\n' "$PWD" >> ${JSON.stringify(launchLog)}\n` +
      `for a in "$@"; do printf 'ARG %s\\n' "$a" >> ${JSON.stringify(launchLog)}; done\n` +
      `exit ${launcherExit}\n`
  );
  fs.chmodSync(launcher, 0o755);

  // A home of its own, so the default-agent file this test writes is the only
  // one agents.sh can find.
  const home = path.join(tmpdir, "home");
  fs.mkdirSync(path.join(home, ".config", "omarchy", "defaults"), { recursive: true });
  if (defaultAgent) {
    fs.writeFileSync(path.join(home, ".config", "omarchy", "defaults", "agent"), defaultAgent + "\n");
  }

  // PATH is replaced rather than prepended: omarchy-default-agent must not be
  // reachable, or the test would read this machine's choice instead of its own.
  const jqDir = path.dirname(execFileSync("bash", ["-c", "command -v jq"], { encoding: "utf8" }).trim());
  const out = execFileSync("bash", [path.join(ROOT, "agents.sh"), ...args], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${jqDir}:/usr/bin:/bin`,
      HOME: home,
      PR_WIDGET_LAUNCH_TUI: launcher,
    },
  });

  const launched = fs.existsSync(launchLog) ? fs.readFileSync(launchLog, "utf8") : "";
  return { envelope: JSON.parse(out), launched, home };
}

module.exports = {
  ROOT,
  FIXTURES,
  fixturePath,
  readFixture,
  runTransform,
  runFetchWithStubGh,
  runAgents,
};
