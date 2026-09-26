pragma ComponentBehavior: Bound

import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQml
import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Mission Control for Hyprland: every workspace as a miniature of its
// monitor, every window a clickable snapshot. The shell loads this as an
// overlay (keepLoaded) and toggles it with
// `omarchy-shell shell toggle boolsa.overview`. Layout, ordering, navigation
// and dispatch strings all come from Model.js; this file only wires Hyprland
// state in and user intent out.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property var targetScreen: null

  // Model state. `cards` is Model.buildOverview output, `flat` the reading
  // order used by keyboard navigation, and `toplevels` maps normalized
  // addresses to HyprlandToplevel objects for capture and live titles.
  property var cards: []
  property var flat: []
  property var toplevels: ({})
  property string cardsKey: ""
  property string selectedAddress: ""
  property string openedActiveAddress: ""
  // Until the user moves the highlight, every rebuild re-derives it: the
  // first build on open runs on lastIpcObjects from before the refresh reply.
  property bool selectionTouched: false
  readonly property int selectedIndex: indexOfAddress(selectedAddress)
  // The card the user is on: it lifts, and only there does the selected
  // window pop out. -1 (nothing lifted) until the pointer or keys move, so
  // the grid opens flat.
  property int focusCard: -1

  // The menu scrim is tuned for a small card; a full-screen grid of
  // thumbnails needs the desktop behind it dimmed much further to read.
  property color scrim: Util.alpha(Color.menu.scrim, Math.max(Color.menu.scrim.a, 0.85))
  // Otherwise shares the [menu] surface tokens with the first-party overlays
  // so themes that style the menu also style the overview.
  property color surface: Color.menu.background
  property color foreground: Color.menu.text
  property color accent: Color.accent
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  readonly property int outerMargin: Style.space(40)
  readonly property int cardGap: Style.spacing.panelGap * 2
  readonly property int headerHeight: Style.font.subtitle + Style.spacing.md * 2
  readonly property real gridAspect: activeAspect()
  readonly property var grid: Model.gridLayout(cards.length, gridArea.width, gridArea.height, gridAspect, cardGap, headerHeight)
  readonly property QtObject pointerGate: gate
  // Hover pop-out: the focused card grows by cardLift, and its selected
  // window by Model.popoutTransform, kept inside popBounds (grid coordinates).
  readonly property real cardLift: 1.05
  readonly property int popDuration: 140
  readonly property var popBounds: ({ x: 0, y: 0, w: gridArea.width, h: gridArea.height })

  // Events that change what the overview shows. screencast/screencastv2 are
  // deliberately absent: every ScreencopyView capture emits them, and
  // refreshing on them loops into a refresh storm (end-4 dots #3631).
  readonly property var refreshEvents: [
    "openwindow", "closewindow", "movewindow", "movewindowv2",
    "changefloatingmode", "fullscreen", "createworkspacev2",
    "destroyworkspacev2", "moveworkspacev2"
  ]

  function screenForFocusedMonitor() {
    var name = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : ""
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) {
      if (screens[i].name === name) return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  function open(payloadJson) {
    root.targetScreen = root.screenForFocusedMonitor()
    root.openedActiveAddress = Hyprland.activeToplevel
      ? Model.normalizeAddress(Hyprland.activeToplevel.address) : ""
    root.selectedAddress = ""
    root.selectionTouched = false
    root.focusCard = -1
    Hyprland.refreshMonitors()
    Hyprland.refreshWorkspaces()
    Hyprland.refreshToplevels()
    root.rebuild()
    gate.reset()
    root.opened = true
    openAnimation.restart()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.focusCard = -1
    root.cards = []
    root.flat = []
    root.cardsKey = ""
  }

  function dismiss() {
    root.close()
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "boolsa.overview")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function ipcObjects(model) {
    var out = []
    var values = model ? model.values : []
    for (var i = 0; i < values.length; i++) {
      var ipc = values[i] ? values[i].lastIpcObject : null
      if (ipc) out.push(ipc)
    }
    return out
  }

  function rebuild() {
    var monitor = Hyprland.focusedMonitor
    var activeWorkspaceId = monitor && monitor.activeWorkspace ? monitor.activeWorkspace.id : -1

    var map = {}
    var values = Hyprland.toplevels.values
    for (var i = 0; i < values.length; i++) {
      var address = Model.normalizeAddress(values[i].address)
      if (address) map[address] = values[i]
    }

    var clients = root.ipcObjects(Hyprland.toplevels)
    var activeAddress = Model.resolveActiveAddress(clients, root.openedActiveAddress)

    var cards = Model.buildOverview(
      clients,
      root.ipcObjects(Hyprland.workspaces),
      root.ipcObjects(Hyprland.monitors),
      { activeWorkspaceId: activeWorkspaceId, activeAddress: activeAddress })

    // Refresh replies re-emit lastIpcObject even when nothing moved; keep the
    // delegates (and their captured frames) unless the model really changed.
    var key = JSON.stringify(cards)
    root.toplevels = map
    if (key !== root.cardsKey) {
      root.cardsKey = key
      root.cards = cards
      root.flat = Model.flattenWindows(cards)
      if (root.focusCard >= cards.length) root.focusCard = -1
    }

    if (!root.selectionTouched || root.indexOfAddress(root.selectedAddress) < 0) {
      var start = Model.initialIndex(root.flat, activeAddress)
      root.selectedAddress = start >= 0 ? root.flat[start].address : ""
    }
    // Cards can reorder; once the user has moved, stay on the selection's card.
    if (root.selectionTouched) root.focusSelectionCard()
  }

  function activeAspect() {
    for (var i = 0; i < root.cards.length; i++) {
      if (root.cards[i].isActive) return root.cards[i].aspect
    }
    return root.cards.length > 0 ? root.cards[0].aspect : 1.6
  }

  function indexOfAddress(address) {
    if (!address) return -1
    for (var i = 0; i < root.flat.length; i++) {
      if (root.flat[i].address === address) return i
    }
    return -1
  }

  // Thumbnail centers in grid coordinates, derived from the model rather than
  // from delegates so navigation works before anything has painted.
  function thumbCenters() {
    var points = []
    var g = root.grid
    for (var i = 0; i < root.flat.length; i++) {
      var entry = root.flat[i]
      var cell = g.cells[entry.card]
      var card = root.cards[entry.card]
      var win = card ? card.windows[entry.win] : null
      if (!cell || !win) {
        points.push({ x: 0, y: 0 })
        continue
      }
      points.push({
        x: cell.x + (win.rect.x + win.rect.w / 2) * g.cardW,
        y: cell.y + root.headerHeight + (win.rect.y + win.rect.h / 2) * g.boxH
      })
    }
    return points
  }

  function focusSelectionCard() {
    var index = root.indexOfAddress(root.selectedAddress)
    if (index >= 0) root.focusCard = root.flat[index].card
  }

  function selectIndex(index) {
    if (index < 0 || index >= root.flat.length) return
    root.selectedAddress = root.flat[index].address
    root.selectionTouched = true
    root.focusSelectionCard()
    gate.reset()
  }

  function selectAddress(address) {
    root.selectedAddress = address
    root.selectionTouched = true
    root.focusSelectionCard()
  }

  // Pointer over a card's empty space (or header): lift it without moving
  // the selection, so an empty workspace can lift too.
  function hoverCard(index) {
    if (index >= 0 && index < root.cards.length) root.focusCard = index
  }

  function moveSelection(dir) {
    root.selectIndex(Model.navigate(root.thumbCenters(), root.selectedIndex, dir))
  }

  function stepSelection(delta) {
    root.selectIndex(Model.stepIndex(root.flat.length, root.selectedIndex, delta))
  }

  // Close first so the layer gives up exclusive keyboard focus, then let
  // Hyprland switch workspace and focus the target.
  function run(cmd) {
    if (!cmd) return
    root.dismiss()
    Qt.callLater(function() { Hyprland.dispatch(cmd) })
  }

  function jump(address) {
    root.run(Model.focusWindowCmd(address, Hyprland.usingLua))
  }

  function activateSelection() {
    if (root.selectedAddress) root.jump(root.selectedAddress)
  }

  function activateCard(index) {
    var cmd = Model.cardActivationCmd(root.cards[index], Hyprland.usingLua)
    if (cmd) root.run(cmd)
    else root.dismiss()
  }

  function activateWorkspace(id) {
    root.run(Model.focusWorkspaceCmd(id, Hyprland.usingLua))
  }

  function handleKey(event) {
    var key = event.key
    var handled = true
    if (key === Qt.Key_Escape) root.dismiss()
    else if (key === Qt.Key_Left || key === Qt.Key_H) root.moveSelection("left")
    else if (key === Qt.Key_Right || key === Qt.Key_L) root.moveSelection("right")
    else if (key === Qt.Key_Up || key === Qt.Key_K) root.moveSelection("up")
    else if (key === Qt.Key_Down || key === Qt.Key_J) root.moveSelection("down")
    else if (key === Qt.Key_Backtab) root.stepSelection(-1)
    else if (key === Qt.Key_Tab) root.stepSelection((event.modifiers & Qt.ShiftModifier) ? -1 : 1)
    else if (key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space) root.activateSelection()
    else if (key >= Qt.Key_1 && key <= Qt.Key_9) root.activateWorkspace(key - Qt.Key_0)
    else if (key === Qt.Key_0) root.activateWorkspace(10)
    else handled = false
    event.accepted = handled
  }

  // Measured against the unscaled backdrop: `content` scales during the open
  // animation and cards lift on focus, so in their coordinates a still
  // pointer would look like it moved and grab the selection.
  PointerMoveGate {
    id: gate
    referenceItem: backdrop
  }

  Timer {
    id: rebuildTimer
    interval: 60
    onTriggered: if (root.opened) root.rebuild()
  }

  Timer {
    id: refreshTimer
    interval: 100
    onTriggered: {
      Hyprland.refreshWorkspaces()
      Hyprland.refreshToplevels()
    }
  }

  Connections {
    target: Hyprland
    enabled: root.opened
    function onRawEvent(event) {
      var name = event ? event.name : ""
      if (name === "screencast" || name === "screencastv2") return
      if (root.refreshEvents.indexOf(name) >= 0) refreshTimer.restart()
    }
  }

  // lastIpcObject only changes when a refresh reply lands, so rebuild when
  // any of them does (debounced), and when toplevels come or go.
  Instantiator {
    active: root.opened
    model: Hyprland.toplevels
    onObjectAdded: rebuildTimer.restart()
    onObjectRemoved: rebuildTimer.restart()
    delegate: Connections {
      required property var modelData
      target: modelData
      function onLastIpcObjectChanged() { rebuildTimer.restart() }
    }
  }

  Instantiator {
    active: root.opened
    model: Hyprland.workspaces
    delegate: Connections {
      required property var modelData
      target: modelData
      function onLastIpcObjectChanged() { rebuildTimer.restart() }
    }
  }

  Instantiator {
    active: root.opened
    model: Hyprland.monitors
    delegate: Connections {
      required property var modelData
      target: modelData
      function onLastIpcObjectChanged() { rebuildTimer.restart() }
    }
  }

  ParallelAnimation {
    id: openAnimation
    NumberAnimation { target: content; property: "opacity"; from: 0; to: 1; duration: 140; easing.type: Easing.OutCubic }
    NumberAnimation { target: content; property: "scale"; from: 0.97; to: 1; duration: 140; easing.type: Easing.OutCubic }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "boolsa-overview"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      id: backdrop
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    Item {
      id: content
      anchors.fill: parent
      anchors.margins: root.outerMargin

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) { root.handleKey(event) }

        Item {
          id: gridArea
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: parent.top
          anchors.bottom: hint.top
          anchors.bottomMargin: Style.spacing.xxl

          Repeater {
            model: root.cards

            WorkspaceCard {
              overview: root
              x: root.grid.cells[index] ? root.grid.cells[index].x : 0
              y: root.grid.cells[index] ? root.grid.cells[index].y : 0
              width: root.grid.cardW
              height: root.grid.cardH
            }
          }
        }

        Text {
          id: hint
          anchors.bottom: parent.bottom
          anchors.horizontalCenter: parent.horizontalCenter
          text: "←↑↓→ / hjkl move · Tab cycle · Enter open · 1–9 workspace · Esc close"
          color: Util.alpha(root.foreground, 0.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
