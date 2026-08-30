# Pull requests — an Omarchy bar widget

[![CI](https://github.com/HaydenKSmith/omarchy-pull-requests/actions/workflows/ci.yml/badge.svg)](https://github.com/HaydenKSmith/omarchy-pull-requests/actions/workflows/ci.yml)

Shows how many GitHub pull requests are waiting on **you**, and lists them ten
at a time. Click a row to open it in your browser, or send it to the coding
agents installed on this machine for a review.

![The pull request panel](docs/panel.png)

The bar shows a count in your theme's urgent colour when something needs you,
and dims to a plain icon when nothing does:

![The bar indicator](docs/bar.png)

---

## Why not just `gh pr status`?

Because "needs me" is not one query. GitHub's `involves:` qualifier does *not*
include review requests, and none of the search qualifiers tell you that your
own pull request is red, conflicted, or sitting on unanswered review threads.

This widget runs four searches in a single GraphQL round trip, merges them, and
gives every pull request the *single most urgent reason* it is on your list.

## What counts as "waiting on you"

| Reason | Counted on the bar | When |
|---|:--:|---|
| Changes requested | ● urgent | your PR, a reviewer asked for changes |
| Merge conflicts | ● urgent | your PR, `mergeable: CONFLICTING` |
| Checks failing | ● urgent | your PR, the check rollup came back `FAILURE`/`ERROR` |
| Review requested | ● | you (or a team you are in) are a requested reviewer |
| Unresolved | ● | your PR has open, non-outdated review threads |
| Assigned | ● | you are the assignee but not a reviewer |
| Mentioned | ● | you were @-mentioned |
| Ready to merge | ● | your PR is approved |
| Checks running | ○ | your PR, checks still pending |
| Awaiting review | ○ | your PR, nobody has looked yet |
| Draft | ○ | your PR is a draft |
| Commented | ○ | you commented; nothing is owed |

The number on the bar is the count of ● rows. The panel always lists
everything, ordered by that table and then by most recently updated, so the
things that are actually blocked sit at the top.

Precedence is strict and first-match-wins, so a pull request that is *both*
conflicted and failing CI reports the conflict — the thing you have to fix
first. Your own pull requests are judged on their state; everyone else's on how
you were pulled in.

## Install

Requires [Omarchy](https://omarchy.org/) 4.x (the Quickshell-based shell),
[`gh`](https://cli.github.com/) authenticated with `gh auth login`, and `jq`.

```bash
omarchy plugin add https://github.com/HaydenKSmith/omarchy-pull-requests.git
omarchy plugin enable io.github.haydenksmith.pull-requests
omarchy bar move io.github.haydenksmith.pull-requests --section right
```

`omarchy plugin add` clones into `~/.config/omarchy/plugins/io.github.haydenksmith.pull-requests/`
and leaves the plugin disabled so you can read the code first — it runs
unsandboxed inside the shell process. Later, `omarchy plugin update
io.github.haydenksmith.pull-requests` fast-forwards the checkout.

### Updating

```bash
omarchy plugin update io.github.haydenksmith.pull-requests
```

### Removing

```bash
omarchy plugin disable io.github.haydenksmith.pull-requests
omarchy plugin remove io.github.haydenksmith.pull-requests
```

`remove` deletes `~/.config/omarchy/plugins/io.github.haydenksmith.pull-requests/` after
taking a timestamped backup alongside it. The plugin writes nothing outside
its own directory and its entry in `~/.config/omarchy/shell.json`; if you
removed it by hand, delete that entry from `bar.layout` too. Nothing else on
your system is touched — no state files, no caches, no credentials (it reads
GitHub through your existing `gh` login and never stores a token).

## Using it

**Bar icon** — left click opens the panel · right click refreshes · middle
click opens <https://github.com/pulls>.

**In the panel** — `↑`/`↓` or `j`/`k` move · `←`/`→` or `h`/`l` change page ·
`Enter` opens the highlighted pull request · `a` sends it to a coding agent ·
`r` refreshes · `g` opens the GitHub dashboard · `Esc` closes.

Bind a key to summon it directly, in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER CTRL", "P", "omarchy-shell io.github.haydenksmith.pull-requests toggle")
```

It also answers IPC, which is handy for scripts and status lines:

```bash
omarchy-shell io.github.haydenksmith.pull-requests count    # -> 2
omarchy-shell io.github.haydenksmith.pull-requests status   # -> 2 pull requests need you · 3 open
omarchy-shell io.github.haydenksmith.pull-requests refresh
omarchy-shell io.github.haydenksmith.pull-requests review   # -> sent acme/api #421
```

## Sending a pull request to your coding agents

Press `a` on a row (or click its ✈ button) and the panel turns into a picker of
the coding agents installed on this machine — the same roster
`omarchy default agent` knows, filtered to the ones you actually have. Tick the
ones you want and press `Enter`.

Each agent opens in its own terminal window, with the same app id
(`org.omarchy.agent`) and the same "don't stop to ask" flags `omarchy agent`
uses, and gets the same brief: read the pull request with `gh pr view` and
`gh pr diff`, report correctness bugs, security and data-loss risks, missing
test coverage, and real simplifications, then say plainly when the change looks
correct. Sending to several agents at once and comparing what each one finds is
the point of the "all" button.

**In the picker** — `↑`/`↓` or `j`/`k` move · `Space` ticks an agent · `a`
ticks or clears all of them · `Enter` sends · `Esc` goes back to the list.

Reviews are read-only by contract. The brief tells every agent not to edit
files, commit, push, or post anything to GitHub — it has no checkout to edit in
any case, since it reads the pull request through the GitHub CLI. That matters
because agents are launched with their approval prompts disabled; without it, an
agent with `--yolo` and a spare thought could start "fixing" what it reviewed.

Reviews run wherever `reviewDir` points — `~/Work` by default, or your home
directory when that does not exist, matching what `omarchy agent` does. Nothing
is checked out, so the agent sees the diff and the discussion but not the
surrounding codebase. Point `reviewDir` at a checkout if you would rather it
had both.

The `review` IPC call skips the picker entirely and sends the pull request at
the top of the list to whatever `reviewAgents` names, which makes a keybinding
out of it:

```lua
o.bind("SUPER CTRL", "R", "omarchy-shell io.github.haydenksmith.pull-requests review")
```

## Settings

There are two ways to change a setting, and they behave slightly differently.

**Edit `~/.config/omarchy/shell.json`** and save — the shell hot-reloads it, no
restart needed. Find the widget's entry under `bar.layout.right` and add keys
to it:

```json
{
  "id": "io.github.haydenksmith.pull-requests",
  "refreshIntervalSec": 600,
  "pageSize": 8,
  "countMode": "all"
}
```

**Or use the CLI**, which edits the same entry for you:

```bash
omarchy bar set io.github.haydenksmith.pull-requests pageSize 8
omarchy bar set io.github.haydenksmith.pull-requests countMode all
omarchy bar set io.github.haydenksmith.pull-requests hideWhenEmpty true --json   # note --json
```

> `omarchy bar set` writes the value as a **string** unless you pass `--json`,
> so it stores `"true"` rather than `true`. This widget coerces `"true"`,
> `"1"`, `"yes"` and `"on"` (and their negatives) as well as real booleans, and
> accepts `"8"` as readily as `8`, so either form works here. Pass `--json` if
> you want the file to be tidy.

To put a setting back to its default, delete the key from the entry.

**There is no settings GUI** — not for this widget, and not for any widget.
Omarchy 4.0.1's on-bar gestures cover layout only (drag empty bar space to move
the bar to another edge, double-click the centre to toggle transparency, drag
widgets to reorder). Values live in `shell.json`.

The groundwork for a settings panel is in place though: `BarWidgetRegistry`
carries each widget's `schema` and `settingsForm`, and `shell.qml` notes that
"the settings panel reads metadata from the registry". Nothing consumes it yet.
The `barWidget.schema` block in this plugin's `manifest.json` is written to
Omarchy's conventions (`integer` / `enum` / `boolean`, each with a label,
description and default) so the widget populates that panel for free when it
ships — `test/manifest.test.js` guards the vocabulary.

| Key | Default | Range | What it does |
|---|---|---|---|
| `refreshIntervalSec` | `300` | 60–3600 | how often to poll GitHub |
| `pageSize` | `10` | 3–25 | rows per page in the panel |
| `countMode` | `actionable` | `actionable` \| `all` | whether the bar counts only ● rows or every open PR |
| `searchLimit` | `40` | 10–100 | results fetched per search; the panel says so when it truncates |
| `hideWhenEmpty` | `false` | | hide the icon entirely when nothing needs you |
| `reviewAgents` | `[]` | any of the roster | which agents a review goes to by default; empty means whichever agent `omarchy agent` launches |
| `reviewDir` | `""` | a path | where a review agent starts; empty means `~/Work`, or `$HOME` when that does not exist |

The widget polls once per bar surface, so a multi-monitor setup makes one
request per monitor per interval. At the default five minutes that is a
rounding error against GitHub's 5000-points-per-hour GraphQL budget.

## When things go wrong

Failures are reported *inside the panel*, never as a silently blank icon:

- **Not signed in** — the panel says so and tells you to run `gh auth login`.
- **GitHub unreachable** — reported as a network problem, not a credentials one.
- **Partial API errors** — an SSO-gated organisation returns a `200` with an
  `errors` array. The message is surfaced and the data that *did* come back is
  still shown.
- **Truncated results** — if a search had more hits than `searchLimit`, the
  panel says so rather than quietly under-reporting.

`fetch.sh` always exits `0` and always prints a JSON envelope, precisely so a
flaky network never looks like a crashed widget.

If `gh` lives somewhere unusual, pin it: `PR_WIDGET_GH_BIN=/path/to/gh`.

## How it fits together

```
Panel.qml     bar button + popup, keyboard/mouse navigation, pagination,
              and the agent picker (a second mode of the same panel)
  └ Service.qml   polling, process lifecycle, opening URLs, dispatching reviews
      ├ fetch.sh      one `gh api graphql` call, normalized to a JSON envelope
      │   ├ query.graphql   the four searches + the PullRequest fragment
      │   └ transform.jq    merge, deduplicate, flatten
      └ agents.sh     which agents are installed, and launching a review in each
  ├ Model.js    classification, sorting, pagination, formatting
  └ Agents.js   selection coercion and the sentences the picker prints
```

`agents.sh` is the single source of truth for agents: the roster, the argv each
one is launched with, and the review brief all live there, so `Agents.js` never
decides which agents exist — it only formats what it is handed. The picker
offers the same roster `omarchy default agent` accepts, filtered to what
`command -v` can find. A manifest test reads the roster back out of the script
to keep the settings form from drifting away from it.

The picker is a second mode of the existing panel rather than a popup inside
it: it wants the same `j`/`k`/`Enter` handling the list already has, and a
popup within a popup is another surface to keep anchored, themed, and
dismissable.

`Model.js` and `Agents.js` are deliberately free of QML types: they are plain
script-style JavaScript with a guarded `module.exports` tail, so the same files
are loaded by QML via `import "Model.js" as Model` **and** by Node in the test
suite. That is why they use `var` and top-level function declarations — do not
"modernise" them into ES modules or wrap them in an IIFE, or the QML side gets
an empty object.

## Development

```bash
npm test           # unit tests + coverage thresholds (no install needed)
npm run lint       # eslint, shellcheck, jq, JSON, qmllint
npm run check      # both
```

`npm test` uses Node's built-in test runner and needs **no dependencies** —
just Node 22+ and `jq`. Only the linters need `npm install`.

The suite is 118 tests over four areas:

| File | Covers |
|---|---|
| `test/model.test.js` | every classification rule and precedence pair, sorting, pagination edges, relative-time boundaries, summary strings |
| `test/transform.test.js` | runs the real `transform.jq` over fixtures: deduplication, flag merging, ghost authors, live-vs-outdated threads, team reviewers, truncation |
| `test/fetch.test.js` | runs the real `fetch.sh` against a stub `gh`: every failure branch, error truncation, argument construction |
| `test/agents.test.js` | selection coercion (`omarchy bar set` stores strings), what a stale or uninstalled choice resolves to, and every sentence the picker prints |
| `test/agents-sh.test.js` | runs the real `agents.sh` against a sandboxed `PATH` and `HOME`: discovery, the exact argv each agent is launched with, the read-only brief, working directory, and URL rejection |
| `test/manifest.test.js` | the manifest contract with Omarchy's `PluginRegistry` |

Coverage is enforced in CI at **100% lines, 100% functions, 90% branches** for
`Model.js` (currently 100 / 100 / 92). The shell and jq layers are covered
behaviourally by running the real programs rather than by line counting.

### Two traps worth knowing

**Quickshell caches compiled QML.** Editing a `.qml` file logs
`Local plugin changed, reloading` and resets widget state, but can keep running
the *previously compiled* code from `~/.cache/quickshell/qmlcache`.
`rescanPlugins` does not clear it either, so an edit can appear to do nothing.
After any QML change:

```bash
rm -rf ~/.cache/quickshell/qmlcache && omarchy restart shell
```

(That command may print "Omarchy shell did not become ready after restart" —
that is the readiness probe racing a cold recompile. Check `omarchy-shell shell
ping`.) Edits to `fetch.sh` and `Model.js` reload normally.

**Do not `npm install` inside the live plugin directory.** Omarchy watches
`~/.config/omarchy/plugins` with `inotifywait -m -r`, so creating a
`node_modules` tree there fires thousands of reload events at the shell. Clone
the repo somewhere else for development, or accept the thrash. Running
`npm test` in place is fine — it installs nothing.

`npm run lint:qml` only has anything to check on an Omarchy machine: it
synthesizes the `qs` module root that Quickshell provides at runtime and points
qmllint at it. It skips cleanly everywhere else, including CI, so run it
locally before pushing QML changes.

Two qmllint categories are disabled in `.qmllint.ini`, both structural rather
than fixable here: `MissingProperty` (the host injects `bar` as an untyped
`QtObject`, and the `Style`/`Color` singletons expose tokens through nested
untyped objects) and `BadSignalHandlerParameters` (Quickshell's
`Process.exited` carries an unregistered `QProcess::ExitStatus`).

## License

MIT — see [LICENSE](LICENSE).
