// Pure helpers for dispatching a pull request to the coding agents installed
// on this machine: envelope parsing, selection coercion, and the sentences the
// panel prints. The roster itself lives in agents.sh -- this file never decides
// which agents exist, only how to talk about the ones it is handed.
//
// Kept free of QML types, in the same ES5-with-a-module-tail shape as Model.js,
// so the rules stay readable (and testable) on their own.

// One envelope shape covers both agents.sh subcommands: `list` fills in
// `agents`, `review` fills in `launched` / `skipped`, and the panel reads
// whichever half it asked for.
function emptyEnvelope() {
  return {
    ok: false,
    error: "",
    defaultAgent: "",
    dir: "",
    agents: [],
    launched: [],
    skipped: []
  }
}

function parseEnvelope(raw) {
  var text = String(raw || "").trim()
  if (text === "") {
    var blank = emptyEnvelope()
    blank.error = "No response from the agent helper"
    return blank
  }
  try {
    var parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") throw new Error("not an object")
    var out = emptyEnvelope()
    out.ok = parsed.ok === true
    out.error = String(parsed.error || "")
    out.defaultAgent = String(parsed.default || "")
    out.dir = String(parsed.dir || "")
    out.agents = cleanAgents(parsed.agents)
    out.launched = cleanAgents(parsed.launched)
    out.skipped = cleanSkipped(parsed.skipped)
    return out
  } catch (e) {
    var failed = emptyEnvelope()
    failed.error = "Could not read the list of agents"
    return failed
  }
}

// QML hands arrays across as JSValue lists that can fail `Array.isArray`, so
// anything array-like is accepted and copied into a real array.
function toArray(value) {
  if (!value || typeof value === "string" || typeof value.length !== "number") return []
  var out = []
  for (var i = 0; i < value.length; i++) out.push(value[i])
  return out
}

function cleanAgents(list) {
  var src = toArray(list)
  var out = []
  for (var i = 0; i < src.length; i++) {
    var entry = src[i]
    if (!entry || !entry.name) continue
    out.push({ name: String(entry.name), label: String(entry.label || entry.name) })
  }
  return out
}

function cleanSkipped(list) {
  var src = toArray(list)
  var out = []
  for (var i = 0; i < src.length; i++) {
    var entry = src[i]
    if (!entry || !entry.name) continue
    out.push({ name: String(entry.name), reason: String(entry.reason || "could not be launched") })
  }
  return out
}

function agentLabel(name, agents) {
  var list = toArray(agents)
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].name) === String(name)) return String(list[i].label || list[i].name)
  }
  return String(name || "")
}

// Marks the agent `omarchy agent` would launch, so the panel can say which one
// is the machine's default without re-reading Omarchy's config itself.
function decorate(agents, defaultAgent) {
  var list = cleanAgents(agents)
  var out = []
  for (var i = 0; i < list.length; i++) {
    out.push({
      name: list[i].name,
      label: list[i].label,
      isDefault: list[i].name === String(defaultAgent || "") && String(defaultAgent || "") !== ""
    })
  }
  return out
}

// A settings value that should be a list of agent names.
//
// Hand-edited shell.json gives a real array, but `omarchy bar set <id> <key>
// <value>` stores a *string* unless you remember --json -- so a JSON array, a
// comma-separated list, and a space-separated list all have to mean the same
// thing as the array they stand in for.
function settingList(value) {
  if (value === undefined || value === null) return []
  var arrayish = toArray(value)
  if (arrayish.length > 0) return cleanNames(arrayish)
  if (typeof value !== "string") return []
  var text = value.trim()
  if (text === "") return []
  if (text.charAt(0) === "[") {
    try {
      return cleanNames(toArray(JSON.parse(text)))
    } catch (e) {
      return []
    }
  }
  return cleanNames(text.split(/[,\s]+/))
}

function cleanNames(list) {
  var out = []
  var seen = {}
  for (var i = 0; i < list.length; i++) {
    var name = String(list[i] === undefined || list[i] === null ? "" : list[i]).trim()
    if (name === "" || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

// Keeps only names that are actually installed, in the roster's own order, so
// a stale setting naming an uninstalled agent never dispatches into a void.
function normalizeSelection(names, agents) {
  var wanted = {}
  var list = cleanNames(toArray(names))
  for (var i = 0; i < list.length; i++) wanted[list[i]] = true
  var installed = cleanAgents(agents)
  var out = []
  for (var j = 0; j < installed.length; j++) {
    if (wanted[installed[j].name]) out.push(installed[j].name)
  }
  return out
}

// What the picker starts with: the configured set when it still resolves to
// something installed, otherwise the machine's default agent, otherwise
// nothing pre-ticked rather than a guess.
function initialSelection(setting, agents, defaultAgent) {
  var configured = normalizeSelection(settingList(setting), agents)
  if (configured.length > 0) return configured
  var fallback = normalizeSelection([defaultAgent], agents)
  return fallback
}

function toggle(names, name) {
  var list = cleanNames(toArray(names))
  var target = String(name || "")
  if (target === "") return list
  var index = list.indexOf(target)
  if (index === -1) list.push(target)
  else list.splice(index, 1)
  return list
}

function allNames(agents) {
  var list = cleanAgents(agents)
  var out = []
  for (var i = 0; i < list.length; i++) out.push(list[i].name)
  return out
}

function includes(names, name) {
  return cleanNames(toArray(names)).indexOf(String(name || "")) !== -1
}

// "a", "a and b", "a, b and c" -- an Oxford-comma-free list, because these
// read as prose in a status line rather than as a data dump.
function joinLabels(labels) {
  var list = toArray(labels)
  if (list.length === 0) return ""
  if (list.length === 1) return String(list[0])
  var head = []
  for (var i = 0; i < list.length - 1; i++) head.push(String(list[i]))
  return head.join(", ") + " and " + String(list[list.length - 1])
}

function labelsFor(names, agents) {
  var list = cleanNames(toArray(names))
  var out = []
  for (var i = 0; i < list.length; i++) out.push(agentLabel(list[i], agents))
  return out
}

// The picker's footer: how many agents this send would reach.
function selectionSummary(names, agents) {
  var list = normalizeSelection(names, agents)
  if (list.length === 0) return "No agents selected"
  if (list.length === allNames(agents).length && list.length > 1) return "All " + list.length + " agents"
  return joinLabels(labelsFor(list, agents))
}

// The line the panel shows after a dispatch. A partial send has to name both
// halves: which windows opened, and which agent it could not reach and why.
function dispatchSummary(envelope, pr) {
  if (!envelope) return ""
  if (envelope.error) return String(envelope.error)

  var launched = toArray(envelope.launched)
  var skipped = toArray(envelope.skipped)
  var where = pr && pr.number ? " · " + String(pr.repo || "") + " #" + String(pr.number) : ""

  var labels = []
  for (var i = 0; i < launched.length; i++) labels.push(String(launched[i].label || launched[i].name))

  var reasons = []
  for (var j = 0; j < skipped.length; j++) reasons.push(String(skipped[j].reason || "could not be launched"))

  if (labels.length === 0) {
    if (reasons.length > 0) return capitalize(joinLabels(reasons))
    return "Nothing was sent"
  }

  var text = "Sent to " + joinLabels(labels) + where
  if (reasons.length > 0) text += " · " + joinLabels(reasons)
  return text
}

function capitalize(text) {
  var s = String(text || "")
  if (s === "") return s
  return s.charAt(0).toUpperCase() + s.substring(1)
}

// Why the picker has nothing to offer, in the words that say what to do next.
function emptyReason(envelope) {
  if (!envelope) return "Looking for coding agents…"
  if (envelope.error) return String(envelope.error)
  if (!envelope.ok) return "Looking for coding agents…"
  return "No coding agents are installed. Install one with: omarchy default agent <name>"
}

if (typeof module !== "undefined") {
  module.exports = {
    emptyEnvelope: emptyEnvelope,
    parseEnvelope: parseEnvelope,
    toArray: toArray,
    cleanAgents: cleanAgents,
    cleanSkipped: cleanSkipped,
    agentLabel: agentLabel,
    decorate: decorate,
    settingList: settingList,
    cleanNames: cleanNames,
    normalizeSelection: normalizeSelection,
    initialSelection: initialSelection,
    toggle: toggle,
    allNames: allNames,
    includes: includes,
    joinLabels: joinLabels,
    labelsFor: labelsFor,
    selectionSummary: selectionSummary,
    dispatchSummary: dispatchSummary,
    capitalize: capitalize,
    emptyReason: emptyReason
  }
}
