"use strict";

// agents.sh is the only thing that decides which agents exist, what each one
// is launched with, and where it runs. It keeps fetch.sh's contract -- always
// exit 0, always print one JSON envelope -- so a missing dependency reads as a
// sentence in the panel rather than a crashed widget.
//
// Every test runs against a sandboxed PATH and HOME, so "installed" means what
// the test said and never what this machine happens to have.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runAgents } = require("./helpers.js");

const PR = "https://github.com/acme/api/pull/421";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr-widget-agents-"));
}

// The launcher log is one line per argv element, prefixed with ARG, after a
// first line carrying the working directory.
function argvFor(launched, agent) {
  const lines = launched.split("\n");
  const start = lines.findIndex((l) => l === `ARG ${agent}`);
  if (start === -1) return [];
  const argv = [];
  for (let i = start; i < lines.length; i++) {
    if (!lines[i].startsWith("ARG ")) break;
    argv.push(lines[i].slice(4));
  }
  return argv;
}

describe("agents.sh list", () => {
  test("reports only the agents actually installed", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["claude", "codex"] });
    assert.equal(envelope.ok, true);
    assert.deepEqual(
      envelope.agents.map((a) => a.name),
      ["claude", "codex"]
    );
  });

  test("gives each agent the name Omarchy shows it under", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["copilot", "omp"] });
    const labels = Object.fromEntries(envelope.agents.map((a) => [a.name, a.label]));
    assert.equal(labels.copilot, "GitHub Copilot");
    assert.equal(labels.omp, "Oh My Pi");
  });

  test("returns the roster in a stable order, not PATH order", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["pi", "claude", "gemini"] });
    assert.deepEqual(
      envelope.agents.map((a) => a.name),
      ["claude", "gemini", "pi"]
    );
  });

  test("an empty machine is an empty list, not a failure", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: [] });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.agents, []);
  });

  test("reads the default agent from Omarchy's own config", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["claude"], defaultAgent: "claude" });
    assert.equal(envelope.default, "claude");
  });

  test("reports no default when Omarchy has none set", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["claude"] });
    assert.equal(envelope.default, "");
  });

  test("ignores an agent that is not on the roster at all", () => {
    const { envelope } = runAgents(tmp(), ["list"], { agents: ["claude", "aider"] });
    assert.deepEqual(
      envelope.agents.map((a) => a.name),
      ["claude"]
    );
  });
});

describe("agents.sh review", () => {
  test("opens one window per selected agent", () => {
    const { envelope, launched } = runAgents(tmp(), ["review", PR, "claude", "codex"], {
      agents: ["claude", "codex"],
    });
    assert.equal(envelope.ok, true);
    assert.deepEqual(
      envelope.launched.map((a) => a.name),
      ["claude", "codex"]
    );
    assert.deepEqual(envelope.skipped, []);
    assert.equal(launched.split("ARG --app-id=org.omarchy.agent").length - 1, 2);
  });

  // These flags are why a review window gets anywhere: an agent that stops to
  // ask permission for `gh pr diff` reviews nothing. Kept in step with the
  // case block in omarchy-agent.
  test("launches each agent with its own spelling of unattended", () => {
    const { launched } = runAgents(
      tmp(),
      ["review", PR, "claude", "codex", "gemini", "copilot", "opencode", "crush"],
      { agents: ["claude", "codex", "gemini", "copilot", "opencode", "crush"] }
    );
    assert.deepEqual(argvFor(launched, "claude").slice(0, 3), ["claude", "--permission-mode", "auto"]);
    assert.deepEqual(argvFor(launched, "codex").slice(0, 2), ["codex", "--approve-for-me"]);
    assert.deepEqual(argvFor(launched, "gemini").slice(0, 3), ["gemini", "--yolo", "--prompt-interactive"]);
    assert.deepEqual(argvFor(launched, "copilot").slice(0, 3), ["copilot", "--allow-all", "--interactive"]);
    assert.deepEqual(argvFor(launched, "opencode").slice(0, 3), ["opencode", "--auto", "--prompt"]);
    assert.deepEqual(argvFor(launched, "crush").slice(0, 2), ["crush", "run"]);
  });

  test("hands every agent the same brief, naming the pull request", () => {
    const { launched } = runAgents(tmp(), ["review", PR, "claude"], { agents: ["claude"] });
    assert.match(launched, /Review the GitHub pull request https:\/\/github\.com\/acme\/api\/pull\/421/);
    assert.match(launched, /gh pr diff/);
  });

  // Agents are launched with approvals disabled, so the brief has to be the
  // thing that keeps a review from becoming an edit.
  test("the brief tells the agent this is read-only", () => {
    const { launched } = runAgents(tmp(), ["review", PR, "claude"], { agents: ["claude"] });
    assert.match(launched, /read-only review/i);
    assert.match(launched, /Do not edit files, commit, push, or post anything/i);
  });

  test("runs in ~/Work when there is one", () => {
    const dir = tmp();
    const work = path.join(dir, "home", "Work");
    fs.mkdirSync(work, { recursive: true });
    const { envelope, launched } = runAgents(dir, ["review", PR, "claude"], { agents: ["claude"] });
    assert.equal(envelope.dir, work);
    assert.equal(launched.split("\n")[0], work);
  });

  test("falls back to home when there is no work directory", () => {
    const dir = tmp();
    const { envelope } = runAgents(dir, ["review", PR, "claude"], { agents: ["claude"] });
    assert.equal(envelope.dir, path.join(dir, "home"));
  });

  test("honours an explicit --dir", () => {
    const dir = tmp();
    const target = path.join(dir, "elsewhere");
    fs.mkdirSync(target);
    const { envelope } = runAgents(dir, ["review", "--dir", target, PR, "claude"], {
      agents: ["claude"],
    });
    assert.equal(envelope.dir, target);
  });

  test("ignores a --dir that does not exist rather than failing the send", () => {
    const dir = tmp();
    const { envelope } = runAgents(dir, ["review", "--dir", "/no/such/place", PR, "claude"], {
      agents: ["claude"],
    });
    assert.equal(envelope.dir, path.join(dir, "home"));
    assert.equal(envelope.ok, true);
  });

  test("skips an agent that is not installed, and says which", () => {
    const { envelope } = runAgents(tmp(), ["review", PR, "claude", "grok"], { agents: ["claude"] });
    assert.deepEqual(
      envelope.launched.map((a) => a.name),
      ["claude"]
    );
    assert.equal(envelope.skipped.length, 1);
    assert.match(envelope.skipped[0].reason, /Grok is not installed/);
  });

  test("skips a name that is not an agent at all", () => {
    const { envelope } = runAgents(tmp(), ["review", PR, "rm -rf /"], { agents: ["claude"] });
    assert.deepEqual(envelope.launched, []);
    assert.match(envelope.skipped[0].reason, /not an agent Omarchy knows/);
  });

  test("reports a launcher that refuses to start", () => {
    const { envelope } = runAgents(tmp(), ["review", PR, "claude"], {
      agents: ["claude"],
      launcherExit: 1,
    });
    assert.equal(envelope.ok, false);
    assert.match(envelope.skipped[0].reason, /could not be launched/);
  });

  // The URL is interpolated into a brief handed to an agent running without
  // approval prompts, so anything but a pull request URL is refused outright.
  test("refuses anything that is not a pull request URL", () => {
    for (const bad of [
      "http://github.com/acme/api/pull/421",
      "https://evil.example/acme/api/pull/421",
      "https://github.com/acme/api/issues/421",
      "https://github.com/acme/api/pull/421;id",
      "https://github.com/acme/api/pull/abc",
      "",
    ]) {
      const { envelope, launched } = runAgents(tmp(), ["review", bad, "claude"], {
        agents: ["claude"],
      });
      assert.equal(envelope.ok, false, `accepted ${bad}`);
      assert.match(envelope.error, /Not a pull request URL/);
      assert.equal(launched, "", `launched something for ${bad}`);
    }
  });

  test("refuses a send with no agents", () => {
    const { envelope } = runAgents(tmp(), ["review", PR], { agents: ["claude"] });
    assert.equal(envelope.ok, false);
    assert.match(envelope.error, /No agents selected/);
  });

  test("a send that reaches nobody is not ok", () => {
    const { envelope } = runAgents(tmp(), ["review", PR, "grok"], { agents: ["claude"] });
    assert.equal(envelope.ok, false);
    assert.deepEqual(envelope.launched, []);
  });
});

describe("agents.sh contract", () => {
  test("an unknown subcommand explains itself instead of failing", () => {
    const { envelope } = runAgents(tmp(), ["frobnicate"], { agents: [] });
    assert.equal(envelope.ok, false);
    assert.match(envelope.error, /Usage/);
  });

  test("no subcommand at all is the same", () => {
    const { envelope } = runAgents(tmp(), [], { agents: [] });
    assert.equal(envelope.ok, false);
    assert.match(envelope.error, /Usage/);
  });

  test("every path prints an envelope with the keys the panel reads", () => {
    for (const args of [["list"], ["review", PR, "claude"], ["nonsense"]]) {
      const { envelope } = runAgents(tmp(), args, { agents: ["claude"] });
      for (const key of ["ok", "error", "agents", "launched", "skipped"]) {
        assert.ok(key in envelope, `${args[0]} envelope is missing ${key}`);
      }
    }
  });
});
