import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Owns the polling of GitHub and the decorated pull-request list. The heavy
// lifting lives in fetch.sh (one GraphQL round trip) and Model.js (parsing and
// classification); this item is the QML-facing state plus the timers.
Item {
  id: root

  property var settings: ({})

  property var envelope: Model.emptyEnvelope()
  property var items: []
  property bool everLoaded: false
  property bool refreshing: false
  property double lastRefreshMs: 0

  readonly property string login: String(envelope.login || "")
  readonly property bool ok: envelope.ok === true
  readonly property bool failed: everLoaded && !ok
  readonly property bool needsAuth: envelope.needsAuth === true
  readonly property string errorText: String(envelope.error || "")
  readonly property bool truncated: envelope.truncated === true

  readonly property int totalCount: items.length
  readonly property int actionableCount: Model.actionableCount(items)
  readonly property int urgentCount: Model.urgentCount(items)

  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 300, 60, 3600)
  readonly property int searchLimit: intSetting("searchLimit", 40, 10, 100)
  readonly property bool busy: fetchProcess.running

  // The plugin can be installed anywhere under ~/.config/omarchy/plugins, so
  // resolve the helper relative to this QML file rather than hardcoding a path.
  readonly property string pluginDir: {
    var url = String(Qt.resolvedUrl("."))
    if (url.indexOf("file://") === 0) url = url.substring(7)
    return decodeURIComponent(url).replace(/\/+$/, "")
  }
  readonly property string helperPath: pluginDir + "/fetch.sh"

  property string _output: ""
  property string _error: ""

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, min, max) {
    return Model.settingInt(setting(name, fallback), fallback, min, max)
  }

  function refresh() {
    if (fetchProcess.running) return
    _output = ""
    _error = ""
    refreshing = true
    fetchProcess.command = ["bash", helperPath, String(searchLimit)]
    fetchProcess.running = true
  }

  // Skip the round trip when the data is younger than `maxAgeSec`. Opening the
  // panel calls this so a quick open/close cycle doesn't hammer the API, while
  // a panel left shut all morning still refreshes the moment you look at it.
  function refreshIfStale(maxAgeSec) {
    var age = (Date.now() - lastRefreshMs) / 1000
    if (!everLoaded || age >= Number(maxAgeSec || 60)) refresh()
  }

  function apply(raw) {
    var parsed = Model.parse(raw)
    envelope = parsed
    items = Model.decorate(parsed.prs, parsed.login)
    everLoaded = true
    lastRefreshMs = Date.now()
  }

  function applyFailure(message) {
    var failure = Model.emptyEnvelope()
    failure.error = String(message || "Could not reach GitHub")
    envelope = failure
    items = []
    everLoaded = true
    lastRefreshMs = Date.now()
  }

  function openPr(pr) {
    if (!pr || !pr.url) return
    openUrl(String(pr.url))
  }

  function openDashboard() {
    openUrl("https://github.com/pulls")
  }

  // omarchy-launch-browser resolves the xdg default browser, launches it in a
  // transient systemd scope, and focuses the resulting window.
  function openUrl(url) {
    var target = String(url || "")
    if (target.indexOf("https://") !== 0) return
    Quickshell.execDetached(["omarchy-launch-browser", target])
  }

  Timer {
    id: refreshTimer
    interval: root.refreshIntervalSec * 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // The first poll can land before the network (or the secret service holding
  // the gh token) is up after login. Retry briefly, then leave it to the
  // periodic timer.
  Timer {
    id: startupRamp
    property int ticks: 0
    interval: 5000
    repeat: true
    running: true
    onTriggered: {
      ticks += 1
      if (root.ok || ticks >= 6) startupRamp.running = false
      else root.refresh()
    }
  }

  Process {
    id: fetchProcess
    running: false
    command: []
    stdout: StdioCollector { id: fetchStdout; waitForEnd: true; onStreamFinished: root._output = text }
    stderr: StdioCollector { id: fetchStderr; waitForEnd: true; onStreamFinished: root._error = text }
    onExited: function(exitCode) {
      root.refreshing = false
      var stdout = String(fetchStdout.text || root._output || "")
      var stderr = String(fetchStderr.text || root._error || "")
      // fetch.sh is contracted to exit 0 with a JSON envelope; a non-zero exit
      // means bash itself failed (missing helper, unreadable plugin dir).
      if (exitCode === 0 && stdout.trim() !== "") root.apply(stdout)
      else root.applyFailure(stderr.trim() || ("Pull request helper exited with status " + exitCode))
    }
  }
}
