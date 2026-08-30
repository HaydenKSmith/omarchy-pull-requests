#!/usr/bin/env bash
#
# Coding-agent discovery and code-review dispatch for the pull-request widget.
#
#   agents.sh list                       Print the coding agents installed here.
#   agents.sh review [--dir <path>] <pr-url> <agent>...
#                                        Open one terminal window per agent,
#                                        each reviewing that pull request.
#
# Both subcommands always print one JSON envelope on stdout and always exit 0,
# for the same reason fetch.sh does: the panel renders failures from the
# envelope's `ok` / `error` fields rather than from a process status.

set -uo pipefail

# Omarchy's roster, in the order the panel offers them. Kept in step with
# `omarchy default agent <name>` -- an agent Omarchy cannot set as the default
# is one this widget has no launch recipe for either.
ROSTER=(
  "claude:Claude Code"
  "codex:Codex"
  "gemini:Gemini"
  "copilot:GitHub Copilot"
  "opencode:OpenCode"
  "crush:Crush"
  "grok:Grok"
  "pi:Pi"
  "omp:Oh My Pi"
)

jq_bin="$(command -v jq 2>/dev/null)"

fail() {
  local message="$1"
  if [[ -n $jq_bin ]]; then
    # shellcheck disable=SC2016  # $e is a jq variable, not a shell expansion
    "$jq_bin" -nc --arg e "$message" \
      '{ok: false, error: $e, default: "", agents: [], launched: [], skipped: []}'
  else
    printf '{"ok":false,"error":"%s","default":"","agents":[],"launched":[],"skipped":[]}\n' \
      "${message//\"/\\\"}"
  fi
  exit 0
}

[[ -n $jq_bin ]] || fail "jq is not installed"

label_for() {
  local name="$1" entry
  for entry in "${ROSTER[@]}"; do
    if [[ ${entry%%:*} == "$name" ]]; then
      printf '%s' "${entry#*:}"
      return 0
    fi
  done
  return 1
}

# Which agent Omarchy launches for the keybinding and menu. Preferred through
# the command so the storage location stays Omarchy's business; the file is the
# fallback for a machine whose PATH does not carry omarchy's bin dir.
default_agent() {
  local agent=""
  if command -v omarchy-default-agent > /dev/null 2>&1; then
    agent="$(omarchy-default-agent 2>/dev/null | head -1)"
  elif [[ -r ${OMARCHY_DEFAULTS_DIR:-$HOME/.config/omarchy/defaults}/agent ]]; then
    read -r agent < "${OMARCHY_DEFAULTS_DIR:-$HOME/.config/omarchy/defaults}/agent"
  fi
  printf '%s' "${agent:-}"
}

cmd_list() {
  local entry name label
  # shellcheck disable=SC2016  # $default is a jq variable, not a shell expansion
  {
    for entry in "${ROSTER[@]}"; do
      name="${entry%%:*}"
      label="${entry#*:}"
      # An `if` rather than `&&`: under `pipefail` a trailing failed test would
      # make the whole pipeline -- and so the script -- exit non-zero purely
      # because the last agent on the roster happens not to be installed.
      if command -v "$name" > /dev/null 2>&1; then
        printf '%s\t%s\n' "$name" "$label"
      fi
    done
  } | "$jq_bin" -Rsc --arg default "$(default_agent)" '
        {
          ok: true,
          error: "",
          default: $default,
          agents: [
            split("\n")[] | select(length > 0) | split("\t") | {name: .[0], label: .[1]}
          ],
          launched: [],
          skipped: []
        }'
}

# The review brief every agent gets. It has no local checkout to read, so the
# GitHub CLI is the whole source of truth -- and because agents are launched
# with their approval prompts disabled (see argv_for), the brief has to be
# explicit that this is a read-only errand.
review_prompt() {
  local url="$1"
  cat << EOF
Review the GitHub pull request $url.

You have no local checkout of this repository, so read it with the GitHub CLI:

  gh pr view $url --comments
  gh pr diff $url

Then report what a careful reviewer would raise, most serious first:

- Correctness bugs. For each one, name the input or state that triggers it and
  what goes wrong.
- Security, data-loss, and concurrency risks.
- Behaviour the change leaves untested, where a test would have caught a real
  mistake.
- Simplifications that remove genuine complexity. Skip stylistic nits.

Quote the file and line for every finding, and say plainly when the change
looks correct rather than inventing problems to report.

This is a read-only review. Do not edit files, commit, push, or post anything
to GitHub -- print your findings in this terminal.
EOF
}

# Each agent spells "do not stop to ask" differently, and gets it here for the
# same reason `omarchy agent` passes it: a review window that blocks on an
# approval prompt for `gh pr diff` reviews nothing. Kept deliberately identical
# to the case block in omarchy-agent.
argv_for() {
  local agent="$1" prompt="$2"
  case "$agent" in
    opencode) argv=(opencode --auto --prompt "$prompt") ;;
    gemini) argv=(gemini --yolo --prompt-interactive "$prompt") ;;
    copilot) argv=(copilot --allow-all --interactive "$prompt") ;;
    # --yolo belongs to the interactive command only; `crush run` never prompts.
    crush) argv=(crush run "$prompt") ;;
    claude) argv=(claude --permission-mode auto -- "$prompt") ;;
    grok) argv=(grok --permission-mode bypassPermissions -- "$prompt") ;;
    codex) argv=(codex --approve-for-me -- "$prompt") ;;
    omp) argv=(omp --auto-approve -- "$prompt") ;;
    pi) argv=(pi "$prompt") ;;
    *) return 1 ;;
  esac
}

# Agents refuse to remember trust for $HOME, so a review starts in the work
# directory when there is one -- the same concession omarchy-agent makes.
review_dir() {
  local requested="${1:-}"
  [[ -n $requested && -d $requested ]] && { printf '%s' "$requested"; return 0; }
  [[ -d $HOME/Work ]] && { printf '%s' "$HOME/Work"; return 0; }
  printf '%s' "$HOME"
}

cmd_review() {
  local requested_dir=""
  if [[ ${1:-} == "--dir" ]]; then
    requested_dir="${2:-}"
    shift 2
  fi

  local url="${1:-}"
  shift || true

  # The URL is interpolated into a prompt handed to an agent running without
  # approval prompts, so it is pinned to the one shape a pull request can have
  # rather than merely checked for a scheme.
  [[ $url =~ ^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/pull/[0-9]+$ ]] \
    || fail "Not a pull request URL"
  (($# > 0)) || fail "No agents selected"

  local launcher="${PR_WIDGET_LAUNCH_TUI:-}"
  [[ -n $launcher ]] || launcher="$(command -v omarchy-launch-tui 2>/dev/null)"
  [[ -n $launcher ]] || fail "omarchy-launch-tui is not available"

  local dir prompt
  dir="$(review_dir "$requested_dir")"
  prompt="$(review_prompt "$url")"

  local agent label status
  local -a argv
  local launched="" skipped=""

  for agent in "$@"; do
    if ! label="$(label_for "$agent")"; then
      skipped+="$agent"$'\t'"is not an agent Omarchy knows"$'\n'
      continue
    fi
    if ! command -v "$agent" > /dev/null 2>&1; then
      skipped+="$agent"$'\t'"$label is not installed"$'\n'
      continue
    fi
    if ! argv_for "$agent" "$prompt"; then
      skipped+="$agent"$'\t'"$label has no launch recipe"$'\n'
      continue
    fi

    # A fixed app-id rather than the default org.omarchy.<binary>, so review
    # windows share the class every agent window already uses.
    (cd "$dir" && exec "$launcher" --app-id=org.omarchy.agent "${argv[@]}") \
      > /dev/null 2>&1
    status=$?
    if ((status == 0)); then
      launched+="$agent"$'\t'"$label"$'\n'
    else
      skipped+="$agent"$'\t'"$label could not be launched"$'\n'
    fi
  done

  # shellcheck disable=SC2016  # $launched/$skipped/$dir are jq variables
  "$jq_bin" -nc \
    --arg launched "$launched" \
    --arg skipped "$skipped" \
    --arg dir "$dir" '
      def rows($text; $keys):
        [ $text | split("\n")[] | select(length > 0) | split("\t")
          | { ($keys[0]): .[0], ($keys[1]): .[1] } ];
      {
        ok: (rows($launched; ["name", "label"]) | length) > 0,
        error: "",
        default: "",
        dir: $dir,
        agents: [],
        launched: rows($launched; ["name", "label"]),
        skipped: rows($skipped; ["name", "reason"])
      }'
}

case "${1:-}" in
  list) cmd_list ;;
  review)
    shift
    cmd_review "$@"
    ;;
  *) fail "Usage: agents.sh list | agents.sh review [--dir <path>] <pr-url> <agent>..." ;;
esac
