#!/usr/bin/env bash
#
# Collects every open GitHub pull request that involves the authenticated user
# and prints one normalized JSON envelope on stdout.
#
# The envelope is always valid JSON and the exit status is always 0. The bar
# widget renders failures from the `ok` / `error` / `needsAuth` fields rather
# than from a process status, so a flaky network never looks like a crash.
#
# Usage: fetch.sh [max-results-per-search]

set -uo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

limit="${1:-40}"
[[ $limit =~ ^[0-9]+$ ]] || limit=40
((limit > 100)) && limit=100
((limit < 10)) && limit=10

jq_bin="$(command -v jq 2>/dev/null)"

fail() {
  local message="$1" needs_auth="${2:-false}"
  if [[ -n $jq_bin ]]; then
    # shellcheck disable=SC2016  # $e/$a are jq variables, not shell expansions
    "$jq_bin" -nc --arg e "$message" --argjson a "$needs_auth" \
      '{ok: false, error: $e, needsAuth: $a, login: "", fetchedAt: (now | floor), truncated: false, prs: []}'
  else
    printf '{"ok":false,"error":"%s","needsAuth":%s,"login":"","truncated":false,"prs":[]}\n' \
      "${message//\"/\\\"}" "$needs_auth"
  fi
  exit 0
}

[[ -n $jq_bin ]] || fail "jq is not installed"

# PR_WIDGET_GH_BIN pins the binary outright: useful when gh lives somewhere
# unusual, and what the test suite uses to inject a stub.
gh_bin="${PR_WIDGET_GH_BIN:-}"
if [[ -z $gh_bin ]]; then
  # The shell inherits the session PATH, which normally already has gh on it
  # (including via the mise shims dir). Fall back to the usual install
  # locations so a PATH-less launch context still works.
  gh_bin="$(command -v gh 2>/dev/null)"
fi
if [[ -z $gh_bin ]]; then
  for candidate in \
    "$HOME/.local/share/mise/shims/gh" \
    "$HOME/.local/bin/gh" \
    /usr/bin/gh \
    /usr/local/bin/gh; do
    if [[ -x $candidate ]]; then
      gh_bin="$candidate"
      break
    fi
  done
fi
[[ -n $gh_bin && -x $gh_bin ]] || fail "GitHub CLI (gh) is not installed"

stderr_file="$(mktemp)"
trap 'rm -f "$stderr_file"' EXIT

raw="$("$gh_bin" api graphql \
  -F query=@"$here/query.graphql" \
  -f involves='is:pr is:open involves:@me archived:false' \
  -f review='is:pr is:open review-requested:@me archived:false' \
  -f mentions='is:pr is:open mentions:@me archived:false' \
  -f assigned='is:pr is:open assignee:@me archived:false' \
  -F limit="$limit" 2>"$stderr_file")"
status=$?

err="$(tr '\n\r' '  ' < "$stderr_file" | sed 's/  */ /g; s/^ //; s/ $//')"
((${#err} > 220)) && err="${err:0:217}…"

if ((status != 0)); then
  shopt -s nocasematch
  if [[ $err == *"gh auth login"* || $err == *"not logged"* \
     || $err == *"bad credentials"* || $err == *"authentication"* \
     || $err == *"requires authentication"* || $err == *"HTTP 401"* ]]; then
    fail "Not signed in to GitHub. Run: gh auth login" true
  fi
  if [[ $err == *"could not resolve host"* || $err == *"no such host"* \
     || $err == *"dial tcp"* || $err == *"network is unreachable"* \
     || $err == *"connection refused"* || $err == *"timeout"* ]]; then
    fail "GitHub is unreachable — check your connection"
  fi
  shopt -u nocasematch
  fail "${err:-gh api graphql failed with status $status}"
fi

# A 200 response can still carry a partial `errors` array (a single org behind
# SSO, say). Surface the first message but keep whatever data did come back.
# shellcheck disable=SC2016  # single-quoted jq filter, not a shell expansion
partial="$(printf '%s' "$raw" | "$jq_bin" -r '(.errors // []) | if length > 0 then (.[0].message // "GitHub returned an error") else "" end' 2>/dev/null)"

if ! printf '%s' "$raw" | "$jq_bin" -e '.data.viewer.login? != null' > /dev/null 2>&1; then
  fail "${partial:-Unexpected response from the GitHub API}"
fi

printf '%s' "$raw" | "$jq_bin" -c --arg partial "$partial" -f "$here/transform.jq" \
  || fail "Could not parse the GitHub API response"
