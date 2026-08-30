"use strict";

// Agents.js decides how the panel talks about the coding agents on this
// machine: what a stale setting resolves to, which agents a send actually
// reaches, and what the panel says afterwards. agents.sh owns the roster, so
// every test here hands the roster in rather than assuming one.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const Agents = require("../Agents.js");

const ROSTER = [
  { name: "claude", label: "Claude Code" },
  { name: "codex", label: "Codex" },
  { name: "gemini", label: "Gemini" },
];

function listEnvelope(extra = {}) {
  return JSON.stringify({
    ok: true,
    error: "",
    default: "claude",
    agents: ROSTER,
    launched: [],
    skipped: [],
    ...extra,
  });
}

describe("parseEnvelope", () => {
  test("reads a list envelope", () => {
    const env = Agents.parseEnvelope(listEnvelope());
    assert.equal(env.ok, true);
    assert.equal(env.defaultAgent, "claude");
    assert.equal(env.agents.length, 3);
    assert.deepEqual(env.agents[0], { name: "claude", label: "Claude Code" });
  });

  test("reads a review envelope", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({
        ok: true,
        dir: "/home/x/Work",
        launched: [{ name: "codex", label: "Codex" }],
        skipped: [{ name: "grok", reason: "Grok is not installed" }],
      })
    );
    assert.equal(env.ok, true);
    assert.equal(env.dir, "/home/x/Work");
    assert.deepEqual(env.launched, [{ name: "codex", label: "Codex" }]);
    assert.deepEqual(env.skipped, [{ name: "grok", reason: "Grok is not installed" }]);
  });

  test("carries the helper's own error through", () => {
    const env = Agents.parseEnvelope(JSON.stringify({ ok: false, error: "jq is not installed" }));
    assert.equal(env.ok, false);
    assert.equal(env.error, "jq is not installed");
  });

  test("an empty read is a failure with a reason, not an empty roster", () => {
    const env = Agents.parseEnvelope("");
    assert.equal(env.ok, false);
    assert.match(env.error, /No response/);
    assert.deepEqual(env.agents, []);
  });

  test("unparseable output does not throw", () => {
    const env = Agents.parseEnvelope("<html>nope</html>");
    assert.equal(env.ok, false);
    assert.match(env.error, /Could not read/);
  });

  test("a JSON scalar is not an envelope", () => {
    assert.equal(Agents.parseEnvelope("42").ok, false);
    assert.equal(Agents.parseEnvelope("null").ok, false);
  });

  test("drops entries with no name and defaults a missing label", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({ ok: true, agents: [{ label: "orphan" }, { name: "pi" }, null] })
    );
    assert.deepEqual(env.agents, [{ name: "pi", label: "pi" }]);
  });

  test("supplies a reason for a skip that arrives without one", () => {
    const env = Agents.parseEnvelope(JSON.stringify({ ok: true, skipped: [{ name: "pi" }, {}] }));
    assert.deepEqual(env.skipped, [{ name: "pi", reason: "could not be launched" }]);
  });
});

describe("decorate", () => {
  test("marks the agent omarchy would launch", () => {
    const decorated = Agents.decorate(ROSTER, "codex");
    assert.deepEqual(
      decorated.map((a) => a.isDefault),
      [false, true, false]
    );
  });

  test("marks nothing when no default is set", () => {
    const decorated = Agents.decorate(ROSTER, "");
    assert.ok(decorated.every((a) => a.isDefault === false));
  });
});

describe("settingList", () => {
  // `omarchy bar set <id> <key> <value>` stores a string unless you remember
  // --json, so every spelling of the same list has to mean the same thing.
  test("accepts a real array", () => {
    assert.deepEqual(Agents.settingList(["claude", "codex"]), ["claude", "codex"]);
  });

  test("accepts a JSON string", () => {
    assert.deepEqual(Agents.settingList('["claude","codex"]'), ["claude", "codex"]);
  });

  test("accepts a comma-separated string", () => {
    assert.deepEqual(Agents.settingList("claude, codex"), ["claude", "codex"]);
  });

  test("accepts a space-separated string", () => {
    assert.deepEqual(Agents.settingList("claude codex"), ["claude", "codex"]);
  });

  test("treats an empty or absent setting as no choice", () => {
    assert.deepEqual(Agents.settingList(""), []);
    assert.deepEqual(Agents.settingList("   "), []);
    assert.deepEqual(Agents.settingList(undefined), []);
    assert.deepEqual(Agents.settingList(null), []);
    assert.deepEqual(Agents.settingList([]), []);
  });

  test("a broken JSON string is no choice rather than a crash", () => {
    assert.deepEqual(Agents.settingList("[not json"), []);
  });

  test("ignores a value that is neither list nor string", () => {
    assert.deepEqual(Agents.settingList(7), []);
    assert.deepEqual(Agents.settingList({ claude: true }), []);
  });

  test("deduplicates and drops blanks", () => {
    assert.deepEqual(Agents.settingList("claude,,claude, codex"), ["claude", "codex"]);
  });
});

describe("normalizeSelection", () => {
  test("keeps only installed agents", () => {
    assert.deepEqual(Agents.normalizeSelection(["claude", "grok"], ROSTER), ["claude"]);
  });

  test("returns them in roster order, not the order asked for", () => {
    assert.deepEqual(Agents.normalizeSelection(["gemini", "claude"], ROSTER), ["claude", "gemini"]);
  });

  test("an empty roster can satisfy nothing", () => {
    assert.deepEqual(Agents.normalizeSelection(["claude"], []), []);
  });
});

describe("initialSelection", () => {
  test("uses the configured agents when they are installed", () => {
    assert.deepEqual(Agents.initialSelection(["codex"], ROSTER, "claude"), ["codex"]);
  });

  test("falls back to the machine default when nothing is configured", () => {
    assert.deepEqual(Agents.initialSelection([], ROSTER, "claude"), ["claude"]);
    assert.deepEqual(Agents.initialSelection("", ROSTER, "claude"), ["claude"]);
  });

  test("falls back when every configured agent has been uninstalled", () => {
    assert.deepEqual(Agents.initialSelection(["grok"], ROSTER, "codex"), ["codex"]);
  });

  test("ticks nothing rather than guessing when there is no default either", () => {
    assert.deepEqual(Agents.initialSelection([], ROSTER, ""), []);
    assert.deepEqual(Agents.initialSelection([], [], "claude"), []);
  });
});

describe("toggle", () => {
  test("adds then removes", () => {
    assert.deepEqual(Agents.toggle(["claude"], "codex"), ["claude", "codex"]);
    assert.deepEqual(Agents.toggle(["claude", "codex"], "claude"), ["codex"]);
  });

  test("a nameless toggle changes nothing", () => {
    assert.deepEqual(Agents.toggle(["claude"], ""), ["claude"]);
    assert.deepEqual(Agents.toggle(["claude"], undefined), ["claude"]);
  });
});

describe("selection reporting", () => {
  test("names the agents while the list is short", () => {
    assert.equal(Agents.selectionSummary(["claude"], ROSTER), "Claude Code");
    assert.equal(Agents.selectionSummary(["claude", "codex"], ROSTER), "Claude Code and Codex");
  });

  test("says 'all' once every installed agent is picked", () => {
    assert.equal(Agents.selectionSummary(["claude", "codex", "gemini"], ROSTER), "All 3 agents");
  });

  test("a single installed agent is named, not counted as 'all 1'", () => {
    assert.equal(Agents.selectionSummary(["claude"], [ROSTER[0]]), "Claude Code");
  });

  test("says so when nothing is picked", () => {
    assert.equal(Agents.selectionSummary([], ROSTER), "No agents selected");
    assert.equal(Agents.selectionSummary(["grok"], ROSTER), "No agents selected");
  });

  test("includes/allNames/agentLabel read the roster", () => {
    assert.equal(Agents.includes(["claude"], "claude"), true);
    assert.equal(Agents.includes(["claude"], "codex"), false);
    assert.deepEqual(Agents.allNames(ROSTER), ["claude", "codex", "gemini"]);
    assert.equal(Agents.agentLabel("codex", ROSTER), "Codex");
    assert.equal(Agents.agentLabel("grok", ROSTER), "grok", "an unknown agent is its own label");
    assert.deepEqual(Agents.labelsFor(["codex"], ROSTER), ["Codex"]);
  });

  test("joinLabels reads as prose", () => {
    assert.equal(Agents.joinLabels([]), "");
    assert.equal(Agents.joinLabels(["a"]), "a");
    assert.equal(Agents.joinLabels(["a", "b"]), "a and b");
    assert.equal(Agents.joinLabels(["a", "b", "c"]), "a, b and c");
  });
});

describe("dispatchSummary", () => {
  const pr = { repo: "acme/api", number: 421 };

  test("names the agents a review reached", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({ ok: true, launched: [{ name: "claude", label: "Claude Code" }] })
    );
    assert.equal(Agents.dispatchSummary(env, pr), "Sent to Claude Code · acme/api #421");
  });

  // A half-successful send is the case worth getting right: the windows that
  // did open must not hide the agent that never started.
  test("reports both halves of a partial send", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({
        ok: true,
        launched: [{ name: "claude", label: "Claude Code" }],
        skipped: [{ name: "grok", reason: "Grok is not installed" }],
      })
    );
    assert.equal(
      Agents.dispatchSummary(env, pr),
      "Sent to Claude Code · acme/api #421 · Grok is not installed"
    );
  });

  test("a total failure leads with the reason", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({ ok: false, skipped: [{ name: "grok", reason: "Grok is not installed" }] })
    );
    assert.equal(Agents.dispatchSummary(env, pr), "Grok is not installed");
  });

  test("the helper's own error wins over everything", () => {
    const env = Agents.parseEnvelope(JSON.stringify({ ok: false, error: "Not a pull request URL" }));
    assert.equal(Agents.dispatchSummary(env, pr), "Not a pull request URL");
  });

  test("says nothing happened when nothing did", () => {
    const env = Agents.parseEnvelope(JSON.stringify({ ok: true }));
    assert.equal(Agents.dispatchSummary(env, pr), "Nothing was sent");
  });

  test("omits the pull request when there is none to name", () => {
    const env = Agents.parseEnvelope(
      JSON.stringify({ ok: true, launched: [{ name: "codex", label: "Codex" }] })
    );
    assert.equal(Agents.dispatchSummary(env, null), "Sent to Codex");
    assert.equal(Agents.dispatchSummary(env, {}), "Sent to Codex");
  });

  test("no envelope, no sentence", () => {
    assert.equal(Agents.dispatchSummary(null, pr), "");
  });
});

describe("emptyReason", () => {
  test("says what to do when no agent is installed", () => {
    const env = Agents.parseEnvelope(listEnvelope({ agents: [] }));
    assert.match(Agents.emptyReason(env), /omarchy default agent/);
  });

  test("shows the helper's error when there was one", () => {
    const env = Agents.parseEnvelope(JSON.stringify({ ok: false, error: "jq is not installed" }));
    assert.equal(Agents.emptyReason(env), "jq is not installed");
  });

  test("reads as still-loading before the first answer", () => {
    assert.match(Agents.emptyReason(Agents.emptyEnvelope()), /Looking for/);
    assert.match(Agents.emptyReason(null), /Looking for/);
  });
});

describe("shared coercion", () => {
  test("toArray accepts array-likes and rejects everything else", () => {
    assert.deepEqual(Agents.toArray(["a"]), ["a"]);
    assert.deepEqual(Agents.toArray({ length: 2, 0: "a", 1: "b" }), ["a", "b"]);
    assert.deepEqual(Agents.toArray("ab"), [], "a string is not a list of agents");
    assert.deepEqual(Agents.toArray(null), []);
    assert.deepEqual(Agents.toArray(5), []);
  });

  test("cleanNames trims, drops blanks, and deduplicates", () => {
    assert.deepEqual(Agents.cleanNames([" claude ", "", null, "claude", "codex"]), ["claude", "codex"]);
  });

  test("cleanAgents and cleanSkipped tolerate junk", () => {
    assert.deepEqual(Agents.cleanAgents(null), []);
    assert.deepEqual(Agents.cleanSkipped(null), []);
  });

  test("capitalize leaves an empty string alone", () => {
    assert.equal(Agents.capitalize(""), "");
    assert.equal(Agents.capitalize(null), "");
    assert.equal(Agents.capitalize("grok is not installed"), "Grok is not installed");
  });
});
