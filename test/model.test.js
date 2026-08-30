"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../Model.js");

const ME = "octo-dev";
const DOT = "·";
const NDASH = "–";

// Minimal pull request in the shape transform.jq emits.
function pr(overrides = {}) {
  return {
    url: "https://github.com/acme/api/pull/1",
    number: 1,
    title: "A change",
    repo: "acme/api",
    isPrivate: false,
    author: ME,
    isDraft: false,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    reviewDecision: "",
    mergeable: "MERGEABLE",
    ci: "SUCCESS",
    unresolved: 0,
    comments: 0,
    additions: 1,
    deletions: 1,
    headRefName: "topic",
    baseRefName: "main",
    reviewers: [],
    reviewRequested: false,
    mentioned: false,
    assigned: false,
    ...overrides,
  };
}

describe("parse", () => {
  test("reads a well-formed envelope", () => {
    const raw = JSON.stringify({
      ok: true, error: "", needsAuth: false, login: ME,
      fetchedAt: 123, truncated: true, prs: [pr()],
    });
    const env = M.parse(raw);
    assert.equal(env.ok, true);
    assert.equal(env.login, ME);
    assert.equal(env.fetchedAt, 123);
    assert.equal(env.truncated, true);
    assert.equal(env.prs.length, 1);
  });

  test("reports an empty response rather than throwing", () => {
    const env = M.parse("   ");
    assert.equal(env.ok, false);
    assert.match(env.error, /No response/);
    assert.deepEqual(env.prs, []);
  });

  test("reports malformed JSON", () => {
    const env = M.parse("{not json");
    assert.equal(env.ok, false);
    assert.match(env.error, /Could not parse/);
  });

  for (const [label, raw] of [["null", "null"], ["a number", "5"], ["a string", '"hi"']]) {
    test(`rejects ${label} at the top level`, () => {
      const env = M.parse(raw);
      assert.equal(env.ok, false);
      assert.match(env.error, /Could not parse/);
    });
  }

  test("coerces a missing prs array to empty", () => {
    const env = M.parse(JSON.stringify({ ok: true, login: ME }));
    assert.deepEqual(env.prs, []);
    assert.equal(env.truncated, false);
    assert.equal(env.needsAuth, false);
  });

  test("emptyEnvelope is a fresh object each call", () => {
    const a = M.emptyEnvelope();
    a.prs.push(1);
    assert.deepEqual(M.emptyEnvelope().prs, []);
  });
});

describe("categoryKey — your own pull requests", () => {
  const cases = [
    ["changesRequested", { reviewDecision: "CHANGES_REQUESTED" }],
    ["conflicts", { mergeable: "CONFLICTING" }],
    ["checksFailing", { ci: "FAILURE" }],
    ["checksFailing", { ci: "ERROR" }],
    ["unresolved", { unresolved: 2 }],
    ["draft", { isDraft: true }],
    ["readyToMerge", { reviewDecision: "APPROVED" }],
    ["checksRunning", { ci: "PENDING" }],
    ["checksRunning", { ci: "EXPECTED" }],
    ["awaitingReview", {}],
  ];
  for (const [expected, overrides] of cases) {
    test(`${JSON.stringify(overrides)} -> ${expected}`, () => {
      assert.equal(M.categoryKey(pr(overrides), ME), expected);
    });
  }

  test("the most urgent reason wins when several apply", () => {
    const messy = pr({
      reviewDecision: "CHANGES_REQUESTED",
      mergeable: "CONFLICTING",
      ci: "FAILURE",
      unresolved: 9,
    });
    assert.equal(M.categoryKey(messy, ME), "changesRequested");
    assert.equal(M.categoryKey(pr({ mergeable: "CONFLICTING", ci: "FAILURE" }), ME), "conflicts");
    assert.equal(M.categoryKey(pr({ ci: "FAILURE", unresolved: 9 }), ME), "checksFailing");
  });

  test("an unresolved thread outranks draft status", () => {
    assert.equal(M.categoryKey(pr({ isDraft: true, unresolved: 1 }), ME), "unresolved");
  });

  test("a draft outranks an approval", () => {
    assert.equal(M.categoryKey(pr({ isDraft: true, reviewDecision: "APPROVED" }), ME), "draft");
  });
});

describe("categoryKey — other people's pull requests", () => {
  const other = { author: "peer-dev" };
  test("a review request wins over every other involvement", () => {
    const p = pr({ ...other, reviewRequested: true, assigned: true, mentioned: true });
    assert.equal(M.categoryKey(p, ME), "reviewRequested");
  });
  test("assignment outranks a mention", () => {
    assert.equal(M.categoryKey(pr({ ...other, assigned: true, mentioned: true }), ME), "assigned");
  });
  test("a mention alone is a mention", () => {
    assert.equal(M.categoryKey(pr({ ...other, mentioned: true }), ME), "mentioned");
  });
  test("bare involvement is just watching", () => {
    assert.equal(M.categoryKey(pr(other), ME), "watching");
  });
  test("their broken CI is not your problem", () => {
    assert.equal(M.categoryKey(pr({ ...other, ci: "FAILURE" }), ME), "watching");
  });
  test("an unknown viewer login never counts a PR as yours", () => {
    assert.equal(M.categoryKey(pr({ author: "" }), ""), "watching");
  });
  test("a missing pull request degrades to watching", () => {
    assert.equal(M.categoryKey(null, ME), "watching");
  });
});

describe("category metadata", () => {
  test("every key in CATEGORIES is reachable and complete", () => {
    for (const key of Object.keys(M.CATEGORIES)) {
      const meta = M.CATEGORIES[key];
      assert.equal(typeof meta.label, "string", `${key} label`);
      assert.ok(meta.label.length > 0, `${key} label non-empty`);
      assert.equal(typeof meta.glyph, "string", `${key} glyph`);
      assert.equal(meta.glyph.length, 1, `${key} glyph is one character`);
      assert.equal(typeof meta.weight, "number", `${key} weight`);
      assert.equal(typeof meta.actionable, "boolean", `${key} actionable`);
      assert.equal(typeof meta.urgent, "boolean", `${key} urgent`);
    }
  });

  test("weights are unique so the sort is deterministic", () => {
    const weights = Object.values(M.CATEGORIES).map((c) => c.weight);
    assert.equal(new Set(weights).size, weights.length);
  });

  test("every urgent category is also actionable", () => {
    for (const [key, meta] of Object.entries(M.CATEGORIES)) {
      if (meta.urgent) assert.equal(meta.actionable, true, `${key} urgent implies actionable`);
    }
  });

  test("category() returns a detached copy of the metadata", () => {
    const c = M.category(pr({ ci: "FAILURE" }), ME);
    assert.equal(c.key, "checksFailing");
    assert.equal(c.urgent, true);
    c.label = "mutated";
    assert.notEqual(M.CATEGORIES.checksFailing.label, "mutated");
  });

  test("an unrecognised category falls back to watching", () => {
    assert.equal(M.category(undefined, ME).key, "watching");
  });
});

describe("decorate", () => {
  test("orders by urgency, then by most recently updated", () => {
    const list = M.decorate(
      [
        pr({ url: "u1", updatedAt: "2026-08-01T00:00:00Z" }),
        pr({ url: "u2", ci: "FAILURE", updatedAt: "2026-08-02T00:00:00Z" }),
        pr({ url: "u3", ci: "FAILURE", updatedAt: "2026-08-10T00:00:00Z" }),
        pr({ url: "u4", reviewDecision: "CHANGES_REQUESTED" }),
      ],
      ME
    );
    assert.deepEqual(list.map((p) => p.url), ["u4", "u3", "u2", "u1"]);
  });

  test("breaks a full tie on url so ordering never flickers", () => {
    const list = M.decorate(
      [pr({ url: "https://b" }), pr({ url: "https://a" })],
      ME
    );
    assert.deepEqual(list.map((p) => p.url), ["https://a", "https://b"]);
  });

  test("drops entries with no url and tolerates holes", () => {
    const list = M.decorate([pr(), null, undefined, { number: 9 }], ME);
    assert.equal(list.length, 1);
  });

  test("tolerates a non-array", () => {
    assert.deepEqual(M.decorate(undefined, ME), []);
    assert.deepEqual(M.decorate(null, ME), []);
  });

  test("does not mutate its input", () => {
    const input = pr();
    M.decorate([input], ME);
    assert.equal(input.category, undefined);
    assert.equal(input.mine, undefined);
  });

  test("marks authorship", () => {
    // decorate() sorts, so look rows up by url rather than by position.
    const byUrl = Object.fromEntries(
      M.decorate(
        [pr({ url: "a" }), pr({ url: "b", author: "peer-dev", reviewRequested: true })],
        ME
      ).map((p) => [p.url, p])
    );
    assert.equal(byUrl.a.mine, true);
    assert.equal(byUrl.b.mine, false);
  });
});

describe("counts", () => {
  const list = () =>
    M.decorate(
      [
        pr({ url: "a", ci: "FAILURE" }),                              // urgent
        pr({ url: "b", mergeable: "CONFLICTING" }),                   // urgent
        pr({ url: "c", unresolved: 1 }),                              // actionable
        pr({ url: "d" }),                                             // awaiting review
        pr({ url: "e", isDraft: true }),                              // draft
        pr({ url: "f", author: "peer-dev" }),                         // watching
      ],
      ME
    );

  test("actionable excludes drafts, waiting, and watching", () => {
    assert.equal(M.actionableCount(list()), 3);
  });
  test("urgent is the broken subset", () => {
    assert.equal(M.urgentCount(list()), 2);
  });
  test("both tolerate junk input", () => {
    assert.equal(M.actionableCount(undefined), 0);
    assert.equal(M.urgentCount(null), 0);
    assert.equal(M.actionableCount([{}]), 0);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  const ago = (ms) => M.relativeTime(new Date(now - ms).toISOString(), now);
  const S = 1000, MIN = 60 * S, HR = 60 * MIN, DAY = 24 * HR;

  test("sub-minute reads as just now", () => {
    assert.equal(ago(0), "just now");
    assert.equal(ago(59 * S), "just now");
  });
  test("minutes", () => {
    assert.equal(ago(60 * S), "1m ago");
    assert.equal(ago(59 * MIN), "59m ago");
  });
  test("hours", () => {
    assert.equal(ago(HR), "1h ago");
    assert.equal(ago(23 * HR), "23h ago");
  });
  test("days", () => {
    assert.equal(ago(DAY), "1d ago");
    assert.equal(ago(29 * DAY), "29d ago");
  });
  test("months", () => {
    assert.equal(ago(30 * DAY), "1mo ago");
    assert.equal(ago(359 * DAY), "11mo ago");
  });
  test("years", () => {
    assert.equal(ago(365 * DAY), "1y ago");
  });
  test("a future timestamp clamps rather than going negative", () => {
    assert.equal(ago(-5 * HR), "just now");
  });
  test("unparseable input yields an empty string", () => {
    assert.equal(M.relativeTime("", now), "");
    assert.equal(M.relativeTime(null, now), "");
    assert.equal(M.relativeTime("not a date", now), "");
  });
  test("defaults to the current clock when now is omitted", () => {
    assert.equal(M.relativeTime(new Date().toISOString()), "just now");
  });
});

describe("row text", () => {
  const decorated = (o) => M.decorate([pr(o)], ME)[0];

  test("your own pull request omits the author", () => {
    const p = decorated({ repo: "acme/api", number: 42 });
    assert.equal(M.rowMeta(p), "acme/api #42");
  });

  test("someone else's pull request names them", () => {
    const p = decorated({ author: "peer-dev", reviewRequested: true, repo: "acme/api", number: 7 });
    assert.equal(M.rowMeta(p), `acme/api #7 ${DOT} @peer-dev`);
  });

  test("a missing author renders as ghost", () => {
    const p = decorated({ author: "", mentioned: true, number: 7 });
    assert.equal(M.rowMeta(p), `acme/api #7 ${DOT} @ghost`);
  });

  test("unresolved threads are pluralised", () => {
    assert.equal(M.categoryDetail(decorated({ unresolved: 1 })), "1 open thread");
    assert.equal(M.categoryDetail(decorated({ unresolved: 4 })), "4 open threads");
  });

  test("a review request surfaces open threads too", () => {
    const p = decorated({ author: "peer-dev", reviewRequested: true, unresolved: 2 });
    assert.equal(M.categoryDetail(p), "2 open threads");
  });

  test("categories with nothing extra to say stay quiet", () => {
    assert.equal(M.categoryDetail(decorated({ ci: "FAILURE" })), "");
    assert.equal(M.categoryDetail(null), "");
    assert.equal(M.categoryDetail({}), "");
  });

  test("detailText joins category, location, and age", () => {
    const now = Date.parse("2026-08-30T12:00:00Z");
    const p = decorated({ ci: "FAILURE", number: 3, updatedAt: "2026-08-30T10:00:00Z" });
    assert.equal(M.detailText(p, now), `Checks failing ${DOT} acme/api #3 ${DOT} 2h ago`);
  });

  test("detailText and repoLabel tolerate nothing", () => {
    assert.equal(M.detailText(null), "");
    assert.equal(M.rowMeta(null), "");
    assert.equal(M.repoLabel(null), "");
    assert.equal(M.repoLabel({}), "");
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 23 }, (_, i) => i);

  test("pageCount rounds up and never returns zero", () => {
    assert.equal(M.pageCount(23, 10), 3);
    assert.equal(M.pageCount(20, 10), 2);
    assert.equal(M.pageCount(1, 10), 1);
    assert.equal(M.pageCount(0, 10), 1);
    assert.equal(M.pageCount(-5, 10), 1);
  });

  test("pageCount guards against a zero page size", () => {
    assert.equal(M.pageCount(5, 0), 5);
    assert.equal(M.pageCount(5, undefined), 5);
  });

  test("pageSlice returns each page, last one partial", () => {
    assert.deepEqual(M.pageSlice(items, 0, 10), items.slice(0, 10));
    assert.deepEqual(M.pageSlice(items, 1, 10), items.slice(10, 20));
    assert.deepEqual(M.pageSlice(items, 2, 10), items.slice(20, 23));
  });

  test("pageSlice past the end is empty, not an error", () => {
    assert.deepEqual(M.pageSlice(items, 99, 10), []);
    assert.deepEqual(M.pageSlice(items, -1, 10), items.slice(0, 10));
    assert.deepEqual(M.pageSlice(undefined, 0, 10), []);
  });

  test("pageLabel describes the visible window", () => {
    assert.equal(M.pageLabel(23, 0, 10), `1${NDASH}10 of 23`);
    assert.equal(M.pageLabel(23, 2, 10), `21${NDASH}23 of 23`);
    assert.equal(M.pageLabel(7, 0, 10), `1${NDASH}7 of 7`);
  });

  test("pageLabel handles an empty list", () => {
    assert.equal(M.pageLabel(0, 0, 10), "0 of 0");
    assert.equal(M.pageLabel(undefined, 0, 10), "0 of 0");
  });
});

describe("summary text", () => {
  const env = (o = {}) => ({ ok: true, error: "", needsAuth: false, login: ME, truncated: false, prs: [], ...o });
  const two = () => M.decorate([pr({ url: "a", ci: "FAILURE" }), pr({ url: "b", unresolved: 1 })], ME);
  const oneWaiting = () => M.decorate([pr({ url: "a" })], ME);

  test("no envelope at all", () => {
    assert.equal(M.summaryText(null, [], "actionable"), "Pull requests");
    assert.equal(M.heroMeta(null, []), "");
  });

  test("signed out", () => {
    assert.equal(M.summaryText(env({ ok: false, needsAuth: true }), [], "actionable"), "GitHub: not signed in");
    assert.equal(M.heroMeta(env({ ok: false, needsAuth: true }), []), "Not signed in");
  });

  test("a failure carries the reason through", () => {
    assert.equal(M.summaryText(env({ ok: false, error: "boom" }), [], "actionable"), "Pull requests: boom");
    assert.equal(M.summaryText(env({ ok: false }), [], "actionable"), "Pull requests: unavailable");
    assert.equal(M.heroMeta(env({ ok: false }), []), "Unavailable");
  });

  test("nothing open", () => {
    assert.equal(M.summaryText(env(), [], "actionable"), "No open pull requests involve you");
    assert.equal(M.heroMeta(env(), []), "Nothing open");
  });

  test("plural and singular agree with the count", () => {
    assert.equal(M.summaryText(env(), two(), "actionable"), `2 pull requests need you ${DOT} 2 open`);
    const one = M.decorate([pr({ ci: "FAILURE" })], ME);
    assert.equal(M.summaryText(env(), one, "actionable"), `1 pull request needs you ${DOT} 1 open`);
  });

  test("open but nothing owed", () => {
    assert.equal(M.summaryText(env(), oneWaiting(), "actionable"), `Nothing needs you ${DOT} 1 open`);
    assert.equal(M.heroMeta(env(), oneWaiting()), "All clear " + DOT + " 1 open");
  });

  test("countMode all is called out so the badge is never ambiguous", () => {
    assert.match(M.summaryText(env(), two(), "all"), /\(bar shows all\)$/);
  });

  test("truncation is disclosed", () => {
    assert.match(M.summaryText(env({ truncated: true }), two(), "actionable"), /list truncated$/);
  });

  test("heroMeta counts what needs you", () => {
    assert.equal(M.heroMeta(env(), two()), `2 need you ${DOT} 2 open`);
  });
});
