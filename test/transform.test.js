"use strict";

// transform.jq turns the raw four-search GraphQL response into the flat
// envelope the widget consumes. These run the real jq program against
// fixtures, so the filter itself is under test, not a re-implementation.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { runTransform } = require("./helpers.js");

describe("transform.jq", () => {
  const full = () => runTransform("graphql-full.json");
  const byUrl = (env) => Object.fromEntries(env.prs.map((p) => [p.url, p]));

  test("reports success and the viewer login", () => {
    const env = full();
    assert.equal(env.ok, true);
    assert.equal(env.login, "octo-dev");
    assert.equal(env.needsAuth, false);
    assert.equal(typeof env.fetchedAt, "number");
  });

  test("deduplicates a pull request found by several searches", () => {
    const env = full();
    assert.equal(env.prs.length, 3);
    assert.equal(new Set(env.prs.map((p) => p.url)).size, 3);
  });

  test("ORs the involvement flags across searches", () => {
    const a = byUrl(full())["https://github.com/acme/api/pull/1"];
    assert.equal(a.reviewRequested, true, "found by the review search");
    assert.equal(a.mentioned, true, "found by the mentions search");
    assert.equal(a.assigned, false, "not found by the assignee search");
  });

  test("keeps flags off for a pull request only the involves search saw", () => {
    const b = byUrl(full())["https://github.com/acme/api/pull/2"];
    assert.deepEqual(
      { r: b.reviewRequested, m: b.mentioned, a: b.assigned },
      { r: false, m: false, a: false }
    );
  });

  test("drops issue nodes, which the PullRequest fragment leaves empty", () => {
    assert.ok(full().prs.every((p) => typeof p.url === "string" && p.url.length > 0));
  });

  test("counts only live review threads", () => {
    // fixture has one open, one resolved, one open-but-outdated
    assert.equal(byUrl(full())["https://github.com/acme/api/pull/2"].unresolved, 1);
  });

  test("a deleted author becomes ghost", () => {
    assert.equal(byUrl(full())["https://github.com/acme/api/pull/2"].author, "ghost");
  });

  test("a pull request with no commits has no check state", () => {
    assert.equal(byUrl(full())["https://github.com/acme/api/pull/2"].ci, "");
  });

  test("a null statusCheckRollup has no check state", () => {
    assert.equal(byUrl(full())["https://github.com/acme/web/pull/3"].ci, "");
  });

  test("reviewers cover both users and teams, skipping nulls", () => {
    assert.deepEqual(
      byUrl(full())["https://github.com/acme/api/pull/1"].reviewers,
      ["octo-dev", "platform"]
    );
  });

  test("carries repository privacy and draft state through", () => {
    const c = byUrl(full())["https://github.com/acme/web/pull/3"];
    assert.equal(c.isPrivate, true);
    assert.equal(c.isDraft, true);
    assert.equal(c.repo, "acme/web");
  });

  test("defaults a missing review decision to an empty string", () => {
    assert.ok(full().prs.every((p) => typeof p.reviewDecision === "string"));
  });

  test("truncated is false when every result fit", () => {
    assert.equal(full().truncated, false);
  });

  test("truncated is true when a search reported more than it returned", () => {
    assert.equal(runTransform("graphql-truncated.json").truncated, true);
  });

  test("an empty account yields an empty list, not an error", () => {
    const env = runTransform("graphql-empty.json");
    assert.equal(env.ok, true);
    assert.deepEqual(env.prs, []);
    assert.equal(env.truncated, false);
  });

  test("the partial-error argument is passed straight through", () => {
    assert.equal(runTransform("graphql-full.json", "SAML SSO required").error, "SAML SSO required");
    assert.equal(runTransform("graphql-full.json").error, "");
  });

  test("emits every field Model.js reads", () => {
    const required = [
      "url", "number", "title", "repo", "isPrivate", "author", "isDraft",
      "createdAt", "updatedAt", "reviewDecision", "mergeable", "ci",
      "unresolved", "comments", "reviewers", "reviewRequested", "mentioned", "assigned",
    ];
    for (const p of full().prs) {
      for (const key of required) {
        assert.ok(key in p, `${p.url} is missing ${key}`);
      }
    }
  });
});
