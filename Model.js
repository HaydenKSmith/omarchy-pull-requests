// Pure helpers for the pull-request bar widget: envelope parsing, the
// "why does this need me" classification, sorting, and label formatting.
// Kept free of QML types so the rules are readable (and testable) on their own.

// Ordered by urgency. `weight` drives the sort, `actionable` decides whether a
// pull request is counted on the bar, and `urgent` marks the ones that should
// be read as "something is broken" rather than "your turn".
var CATEGORIES = {
  changesRequested: { weight: 10,  label: "Changes requested", glyph: "\uF071", actionable: true,  urgent: true },
  conflicts:        { weight: 20,  label: "Merge conflicts",   glyph: "\uF419", actionable: true,  urgent: true },
  checksFailing:    { weight: 30,  label: "Checks failing",    glyph: "\uF00D", actionable: true,  urgent: true },
  reviewRequested:  { weight: 40,  label: "Review requested",  glyph: "\uF06E", actionable: true,  urgent: false },
  unresolved:       { weight: 50,  label: "Unresolved",        glyph: "\uF075", actionable: true,  urgent: false },
  assigned:         { weight: 60,  label: "Assigned",          glyph: "\uF007", actionable: true,  urgent: false },
  mentioned:        { weight: 70,  label: "Mentioned",         glyph: "\uF1FA", actionable: true,  urgent: false },
  readyToMerge:     { weight: 80,  label: "Ready to merge",    glyph: "\uF00C", actionable: true,  urgent: false },
  checksRunning:    { weight: 90,  label: "Checks running",    glyph: "\uF017", actionable: false, urgent: false },
  awaitingReview:   { weight: 100, label: "Awaiting review",   glyph: "\uF252", actionable: false, urgent: false },
  draft:            { weight: 110, label: "Draft",             glyph: "\uF040", actionable: false, urgent: false },
  watching:         { weight: 120, label: "Commented",         glyph: "\uF27A", actionable: false, urgent: false }
}

function emptyEnvelope() {
  return {
    ok: false,
    error: "",
    needsAuth: false,
    login: "",
    fetchedAt: 0,
    truncated: false,
    prs: []
  }
}

function parse(raw) {
  var text = String(raw || "").trim()
  if (text === "") {
    var blank = emptyEnvelope()
    blank.error = "No response from the GitHub helper"
    return blank
  }
  try {
    var parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") throw new Error("not an object")
    var envelope = emptyEnvelope()
    envelope.ok = parsed.ok === true
    envelope.error = String(parsed.error || "")
    envelope.needsAuth = parsed.needsAuth === true
    envelope.login = String(parsed.login || "")
    envelope.fetchedAt = Number(parsed.fetchedAt || 0)
    envelope.truncated = parsed.truncated === true
    envelope.prs = Array.isArray(parsed.prs) ? parsed.prs : []
    return envelope
  } catch (e) {
    var failed = emptyEnvelope()
    failed.error = "Could not parse the pull request data"
    return failed
  }
}

// Which single reason best explains why this pull request is on the list.
// Your own pull requests are judged on their state; everyone else's on how you
// were pulled in. The first matching rule wins, so the returned category is
// always the most urgent one that applies.
function categoryKey(pr, login) {
  if (!pr) return "watching"
  var mine = String(pr.author || "") === String(login || "") && String(login || "") !== ""

  if (mine) {
    if (pr.reviewDecision === "CHANGES_REQUESTED") return "changesRequested"
    if (pr.mergeable === "CONFLICTING") return "conflicts"
    if (pr.ci === "FAILURE" || pr.ci === "ERROR") return "checksFailing"
    if (Number(pr.unresolved || 0) > 0) return "unresolved"
    if (pr.isDraft === true) return "draft"
    if (pr.reviewDecision === "APPROVED") return "readyToMerge"
    if (pr.ci === "PENDING" || pr.ci === "EXPECTED") return "checksRunning"
    return "awaitingReview"
  }

  if (pr.reviewRequested === true) return "reviewRequested"
  if (pr.assigned === true) return "assigned"
  if (pr.mentioned === true) return "mentioned"
  return "watching"
}

function category(pr, login) {
  var key = categoryKey(pr, login)
  var meta = CATEGORIES[key] || CATEGORIES.watching
  return {
    key: key,
    label: meta.label,
    glyph: meta.glyph,
    weight: meta.weight,
    actionable: meta.actionable,
    urgent: meta.urgent
  }
}

// Attaches the category to each pull request once, so the panel can sort,
// count, and render without re-deriving it per binding evaluation.
function decorate(prs, login) {
  var list = Array.isArray(prs) ? prs : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var pr = list[i]
    if (!pr || !pr.url) continue
    var copy = {}
    for (var key in pr) copy[key] = pr[key]
    copy.category = category(pr, login)
    copy.mine = String(pr.author || "") === String(login || "") && String(login || "") !== ""
    out.push(copy)
  }
  out.sort(function(a, b) {
    if (a.category.weight !== b.category.weight) return a.category.weight - b.category.weight
    var at = Date.parse(a.updatedAt || "") || 0
    var bt = Date.parse(b.updatedAt || "") || 0
    if (at !== bt) return bt - at
    return String(a.url).localeCompare(String(b.url))
  })
  return out
}

function actionableCount(decorated) {
  var list = Array.isArray(decorated) ? decorated : []
  var count = 0
  for (var i = 0; i < list.length; i++) {
    if (list[i].category && list[i].category.actionable) count++
  }
  return count
}

function urgentCount(decorated) {
  var list = Array.isArray(decorated) ? decorated : []
  var count = 0
  for (var i = 0; i < list.length; i++) {
    if (list[i].category && list[i].category.urgent) count++
  }
  return count
}

function relativeTime(iso, nowMs) {
  var ts = Date.parse(String(iso || ""))
  if (!isFinite(ts) || ts <= 0) return ""
  var now = nowMs === undefined ? Date.now() : Number(nowMs)
  var diff = Math.max(0, Math.floor((now - ts) / 1000))
  if (diff < 60) return "just now"
  var minutes = Math.floor(diff / 60)
  if (minutes < 60) return minutes + "m ago"
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h ago"
  var days = Math.floor(hours / 24)
  if (days < 30) return days + "d ago"
  var months = Math.floor(days / 30)
  if (months < 12) return months + "mo ago"
  return Math.floor(days / 365) + "y ago"
}

// "owner/name" is redundant once the account is obvious, but the widget spans
// personal and org repositories, so keep the owner and drop nothing.
function repoLabel(pr) {
  if (!pr) return ""
  return String(pr.repo || "")
}

// Everything on a row's second line except the category label, which the panel
// paints separately so it can carry the category's colour.
function rowMeta(pr) {
  if (!pr) return ""
  var parts = [repoLabel(pr) + " #" + String(pr.number)]
  if (!pr.mine) parts.push("@" + String(pr.author || "ghost"))
  var extra = categoryDetail(pr)
  if (extra !== "") parts.push(extra)
  return parts.join(" · ")
}

function detailText(pr, nowMs) {
  if (!pr) return ""
  var parts = []
  if (pr.category) parts.push(pr.category.label)
  var meta = rowMeta(pr)
  if (meta !== "") parts.push(meta)
  var when = relativeTime(pr.updatedAt, nowMs)
  if (when !== "") parts.push(when)
  return parts.join(" · ")
}

// Extra colour for the rows where a bare category label leaves out the number
// that actually matters.
function categoryDetail(pr) {
  if (!pr || !pr.category) return ""
  var unresolved = Number(pr.unresolved || 0)
  if (pr.category.key === "unresolved") {
    return unresolved + (unresolved === 1 ? " open thread" : " open threads")
  }
  if (pr.category.key === "reviewRequested" && unresolved > 0) {
    return unresolved + (unresolved === 1 ? " open thread" : " open threads")
  }
  return ""
}

function pageCount(total, pageSize) {
  var size = Math.max(1, Number(pageSize) || 1)
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / size))
}

function pageSlice(decorated, page, pageSize) {
  var list = Array.isArray(decorated) ? decorated : []
  var size = Math.max(1, Number(pageSize) || 1)
  var start = Math.max(0, Number(page) || 0) * size
  return list.slice(start, start + size)
}

function pageLabel(total, page, pageSize) {
  var count = Math.max(0, Number(total) || 0)
  if (count === 0) return "0 of 0"
  var size = Math.max(1, Number(pageSize) || 1)
  var start = Math.max(0, Number(page) || 0) * size
  var first = start + 1
  var last = Math.min(count, start + size)
  return first + "–" + last + " of " + count
}

// One-line bar tooltip. Says what needs doing first, then the wider total so
// the number on the bar is never ambiguous.
function summaryText(envelope, decorated, countMode) {
  if (!envelope) return "Pull requests"
  if (envelope.needsAuth) return "GitHub: not signed in"
  if (!envelope.ok) return "Pull requests: " + (envelope.error || "unavailable")

  var total = decorated.length
  var needed = actionableCount(decorated)
  if (total === 0) return "No open pull requests involve you"

  var head = needed === 0
    ? "Nothing needs you"
    : needed + (needed === 1 ? " pull request needs you" : " pull requests need you")
  var text = head + " · " + total + " open"
  if (countMode === "all") text += " (bar shows all)"
  if (envelope.truncated) text += " · list truncated"
  return text
}

function heroMeta(envelope, decorated) {
  if (!envelope) return ""
  if (envelope.needsAuth) return "Not signed in"
  if (!envelope.ok) return "Unavailable"
  var total = decorated.length
  if (total === 0) return "Nothing open"
  var needed = actionableCount(decorated)
  if (needed === 0) return "All clear · " + total + " open"
  return needed + " need you · " + total + " open"
}

if (typeof module !== "undefined") {
  module.exports = {
    CATEGORIES: CATEGORIES,
    emptyEnvelope: emptyEnvelope,
    parse: parse,
    categoryKey: categoryKey,
    category: category,
    decorate: decorate,
    actionableCount: actionableCount,
    urgentCount: urgentCount,
    relativeTime: relativeTime,
    repoLabel: repoLabel,
    rowMeta: rowMeta,
    detailText: detailText,
    categoryDetail: categoryDetail,
    pageCount: pageCount,
    pageSlice: pageSlice,
    pageLabel: pageLabel,
    summaryText: summaryText,
    heroMeta: heroMeta
  }
}
