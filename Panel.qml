pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Agents.js" as Agents

// Bar widget: a pull-request glyph with the number of pull requests waiting on
// you, and a popup that lists them a page at a time. Clicking a row opens it in
// the default browser; the row's send button (or `a`) hands the pull request to
// the coding agents installed on this machine for a review.
Panel {
  id: root
  moduleName: "io.github.haydenksmith.pull-requests"
  ipcTarget: "io.github.haydenksmith.pull-requests"
  manageIpc: false

  property int page: 0
  property int rowIndex: 0
  property string focusSection: "header"   // header | rows | pager
  property bool cursorActive: false
  property double nowMs: Date.now()

  // The panel is either listing pull requests or picking agents for one of
  // them. Two modes in one panel rather than a nested popup: the picker wants
  // the same j/k/Enter handling the list already has, and a popup inside a
  // popup is a second surface to keep anchored, themed, and dismissable.
  property string mode: "list"             // list | agents
  property var pendingPr: null
  property int agentIndex: 0

  // The tick marks are derived rather than assigned when the picker opens:
  // discovery is a subprocess, so the agent list can land after the picker is
  // already on screen, and a value computed once against an empty list would
  // leave everything unticked. `agentSelection` only means anything once you
  // have actually touched it.
  property var agentSelection: []
  property bool selectionTouched: false
  // PanelKeyCatcher fires returnRequested() before activateRequested() for
  // Enter, and only activateRequested() for Space. That difference is what
  // lets Space toggle an agent while Enter sends.
  property bool returnPending: false

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property bool vertical: bar ? bar.vertical : false

  readonly property int pageSize: Model.settingInt(setting("pageSize", 10), 10, 3, 25)
  readonly property string countMode: Model.settingChoice(setting("countMode", "actionable"), ["actionable", "all"], "actionable")
  readonly property bool hideWhenEmpty: Model.settingBool(setting("hideWhenEmpty", false), false)

  readonly property int badgeCount: countMode === "all" ? prs.totalCount : prs.actionableCount
  readonly property int pageCount: Model.pageCount(prs.totalCount, pageSize)
  readonly property var visiblePrs: Model.pageSlice(prs.items, page, pageSize)
  readonly property bool showPager: prs.totalCount > pageSize
  readonly property bool hasRows: visiblePrs.length > 0

  // A widget that vanishes is only ever opt-in: the default is to sit there
  // dimmed so the bar layout stays stable and the panel stays reachable.
  readonly property bool hidden: hideWhenEmpty && prs.everLoaded && prs.ok && badgeCount === 0

  readonly property string barGlyph: "\uF407"
  readonly property string alertGlyph: "\uF071"
  readonly property string sendGlyph: "\uF1D8"
  readonly property string checkedGlyph: "\uF14A"
  readonly property string uncheckedGlyph: "\uF096"

  readonly property var agentList: prs.agents
  readonly property bool hasAgents: agentList.length > 0
  readonly property var effectiveSelection: selectionTouched
    ? agentSelection
    : Agents.initialSelection(setting("reviewAgents", []), agentList, prs.defaultAgent)
  readonly property var readySelection: Agents.normalizeSelection(effectiveSelection, agentList)
  readonly property bool canSend: readySelection.length > 0 && !prs.sending
  readonly property string barLabel: {
    if (prs.failed) return alertGlyph
    if (badgeCount <= 0) return barGlyph
    return vertical ? barGlyph + "\n" + badgeCount : barGlyph + " " + badgeCount
  }

  function selectedPr() {
    if (visiblePrs.length === 0) return null
    return visiblePrs[Math.max(0, Math.min(rowIndex, visiblePrs.length - 1))]
  }

  function clampPage() {
    var last = pageCount - 1
    if (page > last) page = Math.max(0, last)
    if (page < 0) page = 0
  }

  function goToPage(next, landOnLastRow) {
    var last = pageCount - 1
    var target = Math.max(0, Math.min(last, next))
    if (target === page) return false
    page = target
    cursorActive = true
    focusSection = "rows"
    rowIndex = landOnLastRow === true ? Math.max(0, visiblePrs.length - 1) : 0
    if (panelFlick) panelFlick.contentY = 0
    return true
  }

  function ensureCursor() {
    clampPage()
    if (!hasRows) {
      focusSection = "header"
      rowIndex = 0
      return
    }
    if (focusSection === "rows") {
      if (rowIndex >= visiblePrs.length) rowIndex = visiblePrs.length - 1
      if (rowIndex < 0) rowIndex = 0
    }
  }

  function moveCursor(dx, dy) {
    cursorActive = true
    ensureCursor()

    // Left/right always page, from anywhere in the panel.
    if (dx !== 0) {
      goToPage(page + (dx > 0 ? 1 : -1), dx < 0)
      return
    }
    if (dy === 0) return

    if (focusSection === "header") {
      if (dy > 0 && hasRows) {
        focusSection = "rows"
        rowIndex = 0
        scrollCursorIntoView()
      }
      return
    }

    if (focusSection === "rows") {
      var next = rowIndex + dy
      if (next < 0) {
        setHeaderCursor()
        return
      }
      if (next >= visiblePrs.length) {
        // Falling off the bottom rolls onto the next page rather than sticking.
        if (!goToPage(page + 1)) rowIndex = visiblePrs.length - 1
        return
      }
      rowIndex = next
      scrollCursorIntoView()
    }
  }

  function setHeaderCursor() {
    cursorActive = true
    focusSection = "header"
    if (panelFlick) panelFlick.contentY = 0
  }

  function setRowCursor(index) {
    cursorActive = true
    focusSection = "rows"
    rowIndex = index
  }

  function activateCursor() {
    ensureCursor()
    if (focusSection === "rows") openPr(selectedPr())
    else prs.refresh()
  }

  function openPr(pr) {
    if (!pr) return
    prs.openPr(pr)
    close()
  }

  // Agent picker ------------------------------------------------------------

  function openPicker(pr) {
    if (!pr) return
    pendingPr = pr
    mode = "agents"
    cursorActive = true
    agentIndex = 0
    agentSelection = []
    selectionTouched = false
    prs.dispatchText = ""
    prs.loadAgents(false)
    if (panelFlick) panelFlick.contentY = 0
  }

  function closePicker() {
    mode = "list"
    pendingPr = null
    focusSection = hasRows ? "rows" : "header"
  }

  function moveAgentCursor(dy) {
    if (!hasAgents) return
    var next = agentIndex + dy
    if (next < 0) next = 0
    if (next > agentList.length - 1) next = agentList.length - 1
    agentIndex = next
  }

  function agentAt(index) {
    if (!hasAgents) return null
    return agentList[Math.max(0, Math.min(index, agentList.length - 1))]
  }

  function toggleAgent(name) {
    var target = name
    if (target === undefined) {
      var agent = agentAt(agentIndex)
      if (!agent) return
      target = agent.name
    }
    agentSelection = Agents.toggle(effectiveSelection, target)
    selectionTouched = true
  }

  // One key for both directions: everything on, unless everything already is.
  function toggleAllAgents() {
    var all = Agents.allNames(agentList)
    agentSelection = readySelection.length === all.length ? [] : all
    selectionTouched = true
  }

  function sendReview() {
    if (!canSend) return
    if (prs.sendReview(pendingPr, readySelection)) closePicker()
  }

  // The `review` IPC call: no panel and no picker, so the agents come straight
  // from the setting, falling back to whichever agent `omarchy agent` launches.
  function reviewTopPr() {
    if (prs.items.length === 0) return "nothing to review"
    if (!prs.agentsLoaded) {
      prs.loadAgents(false)
      return "still looking for agents, try again"
    }
    var pr = prs.items[0]
    var selection = Agents.initialSelection(setting("reviewAgents", []), agentList, prs.defaultAgent)
    if (!prs.sendReview(pr, selection)) return "no agents to send to"
    return "sent " + String(pr.repo || "") + " #" + String(pr.number)
  }

  function scrollItemIntoView(item) {
    if (!panelFlick || !item) return
    Qt.callLater(function() {
      if (!item) return
      var margin = Style.space(6)
      var point = item.mapToItem(panelFlick.contentItem, 0, 0)
      var top = point.y
      var bottom = top + item.height
      var viewTop = panelFlick.contentY
      var viewBottom = viewTop + panelFlick.height
      var maxY = Math.max(0, panelFlick.contentHeight - panelFlick.height)
      if (top < viewTop + margin) panelFlick.contentY = Math.max(0, top - margin)
      else if (bottom > viewBottom - margin) panelFlick.contentY = Math.min(maxY, bottom + margin - panelFlick.height)
    })
  }

  function scrollCursorIntoView() {
    if (focusSection === "rows" && rowColumn && rowIndex >= 0 && rowIndex < rowColumn.children.length) {
      scrollItemIntoView(rowColumn.children[rowIndex])
    }
  }

  visible: !hidden
  implicitWidth: hidden ? 0 : button.implicitWidth
  implicitHeight: hidden ? 0 : button.implicitHeight

  onOpenedChanged: if (opened) {
    cursorActive = false
    page = 0
    rowIndex = 0
    focusSection = "header"
    mode = "list"
    pendingPr = null
    returnPending = false
    selectionTouched = false
    nowMs = Date.now()
    if (panelFlick) panelFlick.contentY = 0
    prs.refreshIfStale(60)
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }
  onRowIndexChanged: scrollCursorIntoView()

  Service {
    id: prs
    settings: root.settings
  }

  Connections {
    target: prs
    function onItemsChanged() { root.ensureCursor() }
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { prs.refresh(); return "ok" }
    function count(): string { return String(root.badgeCount) }
    function status(): string { return Model.summaryText(prs.envelope, prs.items, root.countMode) }
    // Sends the pull request at the top of the list to the configured agents,
    // so a keybinding can review the thing waiting on you without the panel.
    function review(): string { return root.reviewTopPr() }
  }

  // Keeps "2h ago" honest while the panel is on screen without waking the
  // process every minute for a popup nobody has open.
  Timer {
    interval: 30000
    repeat: true
    running: root.opened
    onTriggered: root.nowMs = Date.now()
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barLabel
    fontSize: Style.bar.iconFont
    active: root.badgeCount > 0 || prs.failed
    activeColor: root.bar ? root.bar.urgent : Color.urgent
    foreground: root.badgeCount > 0 ? root.barForeground : Qt.darker(root.barForeground, 1.55)
    tooltipText: Model.summaryText(prs.envelope, prs.items, root.countMode)
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) prs.refresh()
      else if (buttonCode === Qt.MiddleButton) prs.openDashboard()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(
      root.mode === "agents"
        ? agentView.implicitHeight
        : column.implicitHeight + (root.showPager ? pager.implicitHeight + Style.space(19) : 0),
      Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (root.mode === "agents") {
          root.cursorActive = true
          root.moveAgentCursor(dy)
          return
        }
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dx, dy)
      }
      onReturnRequested: root.returnPending = true
      onActivateRequested: {
        var viaReturn = root.returnPending
        root.returnPending = false
        if (root.mode === "agents") {
          if (viaReturn) root.sendReview()
          else root.toggleAgent()
          return
        }
        if (root.cursorActive) root.activateCursor()
      }
      onCloseRequested: {
        if (root.mode === "agents") root.closePicker()
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (root.mode === "agents") {
          if (t === "a" || t === "A") root.toggleAllAgents()
          return
        }
        if (t === "r" || t === "R") prs.refresh()
        else if (t === "g" || t === "G") prs.openDashboard()
        else if (t === "a" || t === "A") root.openPicker(root.selectedPr())
      }

      Flickable {
        id: panelFlick
        visible: root.mode === "list"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        // The pager is pinned below, so the list gets whatever is left over.
        anchors.bottom: pager.visible ? pager.top : parent.bottom
        anchors.bottomMargin: pager.visible ? Style.space(19) : 0
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(12)

          Item {
            id: header
            width: parent.width
            implicitHeight: hero.implicitHeight
            // The hero's trailingControl resolves `root` to PanelHero, so panel
            // state has to be reached through this wrapper.
            readonly property bool ringVisible: root.cursorActive && root.focusSection === "header"
            function focusHero() { root.setHeaderCursor() }

            PanelHero {
              id: hero
              width: parent.width
              title: "Pull requests"
              meta: Model.heroMeta(prs.envelope, prs.items)
              detail: prs.urgentCount > 0 ? String(prs.urgentCount) + " urgent" : ""
              foreground: root.foreground
              fontFamily: root.fontFamily
              iconComponent: Component {
                Text {
                  text: root.barGlyph
                  color: root.badgeCount > 0 ? root.urgent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.display
                }
              }

              trailingControl: Component {
                PanelActionButton {
                  id: refreshButton
                  iconText: "\uF021"
                  tooltipText: "Refresh (r)"
                  foreground: hero.foreground
                  fontFamily: hero.fontFamily
                  enabled: !prs.busy
                  hasCursor: header.ringVisible
                  onHovered: function(on) { if (on) header.focusHero() }
                  onClicked: prs.refresh()

                  RotationAnimation on rotation {
                    running: prs.busy
                    from: 0
                    to: 360
                    duration: 900
                    loops: Animation.Infinite
                    onRunningChanged: if (!running) refreshButton.rotation = 0
                  }
                }
              }
            }
          }

          Text {
            visible: text !== ""
            width: parent.width
            text: {
              if (prs.needsAuth) return "Not signed in to GitHub. Run: gh auth login"
              if (prs.errorText !== "") return prs.errorText
              if (prs.truncated) return "More pull requests exist than were fetched — raise “Max pull requests fetched per search”."
              return ""
            }
            color: prs.ok && !prs.needsAuth ? root.dim : root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // What came of the last send, since the agent windows open on
          // whatever workspace has focus and may not be the one you are on.
          Text {
            visible: prs.dispatchText !== ""
            width: parent.width
            text: prs.dispatchText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          PanelSeparator { foreground: root.foreground }

          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: root.countMode === "all" ? "OPEN PULL REQUESTS" : "WAITING ON YOU"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Text {
              visible: !root.hasRows
              width: parent.width
              text: {
                if (!prs.everLoaded) return "Checking GitHub…"
                if (prs.needsAuth) return "Sign in with gh to see your pull requests."
                if (!prs.ok) return "Could not reach GitHub."
                return "No open pull requests involve you."
              }
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              horizontalAlignment: Text.AlignHCenter
            }

            Column {
              id: rowColumn
              visible: root.hasRows
              width: parent.width
              spacing: Style.space(6)

              Repeater {
                model: root.visiblePrs
                PrRow {
                  required property var modelData
                  required property int index
                  width: rowColumn.width
                  pr: modelData
                  rowPosition: index
                }
              }
            }
          }
        }
      }

      // Marks where the scrolling list stops and the pinned pager begins.
      PanelSeparator {
        visible: pager.visible
        foreground: root.foreground
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: pager.top
        anchors.bottomMargin: Style.space(8)
      }

      RowLayout {
        id: pager
        visible: root.showPager && root.mode === "list"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        spacing: Style.space(8)

        PanelActionButton {
          iconText: "\uF053"
          tooltipText: "Previous page (\u2190)"
          foreground: root.foreground
          fontFamily: root.fontFamily
          enabled: root.page > 0
          Layout.alignment: Qt.AlignVCenter
          onClicked: root.goToPage(root.page - 1)
        }

        Text {
          Layout.fillWidth: true
          text: Model.pageLabel(prs.totalCount, root.page, root.pageSize)
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          horizontalAlignment: Text.AlignHCenter
        }

        PanelActionButton {
          iconText: "\uF054"
          tooltipText: "Next page (\u2192)"
          foreground: root.foreground
          fontFamily: root.fontFamily
          enabled: root.page < root.pageCount - 1
          Layout.alignment: Qt.AlignVCenter
          onClicked: root.goToPage(root.page + 1)
        }
      }

      // The picker replaces the list rather than floating over it, so the one
      // key catcher above stays in charge of both.
      Column {
        id: agentView
        visible: root.mode === "agents"
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        PanelHero {
          width: parent.width
          title: "Send review to"
          meta: root.pendingPr ? Model.rowMeta(root.pendingPr) : ""
          detail: prs.sending ? "Sending…" : ""
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              text: root.sendGlyph
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        // Which pull request is about to be handed over, in full: the hero's
        // meta line carries the repository, not the subject.
        Text {
          visible: text !== ""
          width: parent.width
          text: root.pendingPr ? String(root.pendingPr.title || "") : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        PanelSeparator { foreground: root.foreground }

        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: "CODING AGENTS"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          Text {
            visible: !root.hasAgents
            width: parent.width
            text: Agents.emptyReason(prs.agentsEnvelope)
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            id: agentColumn
            visible: root.hasAgents
            width: parent.width
            spacing: Style.space(6)

            Repeater {
              model: root.agentList
              AgentRow {
                required property var modelData
                required property int index
                width: agentColumn.width
                agent: modelData
                rowPosition: index
              }
            }
          }
        }

        PanelSeparator { foreground: root.foreground }

        RowLayout {
          width: parent.width
          spacing: Style.space(8)

          PanelActionButton {
            iconText: "\uF060"
            tooltipText: "Back (Esc)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            Layout.alignment: Qt.AlignVCenter
            onClicked: root.closePicker()
          }

          Text {
            Layout.fillWidth: true
            text: Agents.selectionSummary(root.effectiveSelection, root.agentList)
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
          }

          PanelActionButton {
            iconText: root.checkedGlyph
            tooltipText: "Select all (a)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            enabled: root.hasAgents
            Layout.alignment: Qt.AlignVCenter
            onClicked: root.toggleAllAgents()
          }

          PanelActionButton {
            iconText: root.sendGlyph
            tooltipText: "Send (\u23CE)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            enabled: root.canSend
            Layout.alignment: Qt.AlignVCenter
            onClicked: root.sendReview()
          }
        }
      }
    }
  }

  component AgentRow: CursorSurface {
    id: agentRow
    property var agent: null
    property int rowPosition: 0

    readonly property string agentName: agent ? String(agent.name) : ""
    readonly property bool checked: agentName !== "" && Agents.includes(root.effectiveSelection, agentName)

    hasCursor: root.cursorActive && root.mode === "agents" && root.agentIndex === agentRow.rowPosition
    foreground: root.foreground

    implicitHeight: agentBody.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: {
        root.cursorActive = true
        root.agentIndex = agentRow.rowPosition
      }
      onClicked: root.toggleAgent(agentRow.agentName)
    }

    RowLayout {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(9)

      Text {
        text: agentRow.checked ? root.checkedGlyph : root.uncheckedGlyph
        color: agentRow.checked ? root.foreground : root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
        Layout.alignment: Qt.AlignVCenter
      }

      ColumnLayout {
        id: agentBody
        Layout.fillWidth: true
        spacing: Style.space(2)

        Text {
          Layout.fillWidth: true
          text: agentRow.agent ? String(agentRow.agent.label || "") : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          Layout.fillWidth: true
          text: {
            if (!agentRow.agent) return ""
            return agentRow.agentName + (agentRow.agent.isDefault ? " · Omarchy default" : "")
          }
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }

  component PrRow: CursorSurface {
    id: prRow
    property var pr: null
    property int rowPosition: 0

    readonly property var meta: pr && pr.category ? pr.category : null
    readonly property color accentColor: meta && meta.urgent ? root.urgent : root.foreground

    hasCursor: root.cursorActive && root.focusSection === "rows" && root.rowIndex === prRow.rowPosition
    foreground: root.foreground

    implicitHeight: rowBody.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: root.setRowCursor(prRow.rowPosition)
      onClicked: root.openPr(prRow.pr)
    }

    RowLayout {
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(9)

      Text {
        text: prRow.meta ? prRow.meta.glyph : ""
        color: prRow.accentColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
        Layout.alignment: Qt.AlignVCenter
      }

      ColumnLayout {
        id: rowBody
        Layout.fillWidth: true
        spacing: Style.space(2)

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.space(8)

          Text {
            Layout.fillWidth: true
            text: prRow.pr ? String(prRow.pr.title || "Untitled") : ""
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }

          Text {
            text: prRow.pr ? Model.relativeTime(prRow.pr.updatedAt, root.nowMs) : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            Layout.alignment: Qt.AlignVCenter
          }

          // Sits above the row's own MouseArea, so a click here picks agents
          // instead of opening the pull request in the browser.
          PanelActionButton {
            iconText: root.sendGlyph
            tooltipText: "Send to coding agents (a)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.caption
            Layout.alignment: Qt.AlignVCenter
            onHovered: function(on) { if (on) root.setRowCursor(prRow.rowPosition) }
            onClicked: root.openPicker(prRow.pr)
          }
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.space(6)

          Text {
            text: prRow.meta ? prRow.meta.label : ""
            color: prRow.accentColor
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
          }

          Text {
            Layout.fillWidth: true
            text: prRow.pr ? "· " + Model.rowMeta(prRow.pr) : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }
      }
    }
  }
}
