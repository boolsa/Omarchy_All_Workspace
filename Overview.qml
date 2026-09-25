import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import QtQuick
import qs.Commons

// SPIKE: flat list of every toplevel with a one-shot snapshot, used to
// settle the open questions in plan.md step 1 before the real UI lands.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false
  property var targetScreen: null

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
    Hyprland.refreshToplevels()
    Hyprland.refreshWorkspaces()
    Hyprland.refreshMonitors()
    root.opened = true
    diagTimer.restart()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "boolsa.overview")
  }

  function jump(address) {
    var addr = String(address || "").replace(/^0x/i, "")
    if (!/^[0-9a-fA-F]+$/.test(addr)) return
    var cmd = Hyprland.usingLua
      ? "hl.dsp.focus({ window = \"address:0x" + addr.toLowerCase() + "\" })"
      : "focuswindow address:0x" + addr.toLowerCase()
    root.dismiss()
    Qt.callLater(function() {
      console.log("[boolsa.overview] dispatch " + cmd)
      Hyprland.dispatch(cmd)
    })
  }

  Timer {
    id: diagTimer
    interval: 600
    onTriggered: {
      var values = Hyprland.toplevels.values
      console.log("[boolsa.overview] usingLua=" + Hyprland.usingLua + " toplevels=" + values.length)
      for (var i = 0; i < values.length; i++) {
        var t = values[i]
        var ipc = t.lastIpcObject || {}
        console.log("[boolsa.overview] address=" + t.address
          + " ipcKeys=" + Object.keys(ipc).length
          + " ipcAddress=" + ipc.address
          + " ws=" + (t.workspace ? t.workspace.id : "null")
          + " at=" + JSON.stringify(ipc.at) + " size=" + JSON.stringify(ipc.size)
          + " wayland=" + (t.wayland ? "yes" : "no"))
      }
      for (var j = 0; j < thumbs.count; j++) {
        var it = thumbs.itemAt(j)
        if (it) console.log("[boolsa.overview] thumb " + it.addr + " hasContent=" + it.hasContent + " source=" + it.sourceW + "x" + it.sourceH)
      }
    }
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
      anchors.fill: parent
      color: Color.menu.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.dismiss()
          event.accepted = true
        }
      }

      Flow {
        anchors.fill: parent
        anchors.margins: Style.spacing.panelPadding
        spacing: Style.spacing.lg

        Repeater {
          id: thumbs
          model: root.opened ? Hyprland.toplevels.values : []

          Rectangle {
            id: tile
            required property var modelData
            readonly property string addr: modelData.address
            readonly property bool hasContent: view.hasContent
            readonly property int sourceW: view.sourceSize.width
            readonly property int sourceH: view.sourceSize.height

            width: 320
            height: 220
            color: Color.menu.background
            border.color: Color.menu.border
            border.width: 1

            ScreencopyView {
              id: view
              anchors.fill: parent
              anchors.margins: 4
              anchors.bottomMargin: 40
              captureSource: root.opened && tile.modelData ? tile.modelData.wayland : null
              live: false
            }

            Text {
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.bottom: parent.bottom
              anchors.margins: 4
              color: Color.menu.text
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
              wrapMode: Text.NoWrap
              maximumLineCount: 2
              text: "ws " + (tile.modelData.workspace ? tile.modelData.workspace.id : "?")
                + " | " + tile.addr + " | content " + view.hasContent
                + "\n" + tile.modelData.title
            }

            MouseArea {
              anchors.fill: parent
              onClicked: root.jump(tile.addr)
            }
          }
        }
      }
    }
  }
}
