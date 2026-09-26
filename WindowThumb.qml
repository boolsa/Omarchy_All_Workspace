pragma ComponentBehavior: Bound

import Quickshell
import Quickshell.Wayland
import QtQuick
import qs.Commons
import "Model.js" as Model

// One window: a one-shot ScreencopyView snapshot of its toplevel, refreshed
// only while selected. Windows on hidden workspaces show the last frame the
// app drew before Hyprland suspended it. Until a frame lands (or when the
// window refuses capture) the app icon and class stand in.
//
// Once the user has moved, the selected window on the focused card pops out
// (Model.popoutTransform). Only `visual` grows: the hover area stays the
// tile's real size, so a popped window never hides its neighbours from the
// pointer. The capture keeps the window's full-resolution buffer, so the
// popped image shows more detail rather than a blown-up thumbnail.
Item {
  id: thumb

  required property var modelData
  property var overview: null
  property var workspace: null

  readonly property string address: modelData.address
  readonly property var toplevel: overview && overview.toplevels ? (overview.toplevels[address] || null) : null
  readonly property bool selected: overview !== null && overview.selectedAddress === address
  readonly property bool hasFrame: capture.item !== null && capture.item.hasContent === true
  readonly property string title: toplevel && toplevel.title ? toplevel.title : modelData.title
  readonly property bool popped: selected && overview.selectionTouched
    && workspace !== null && workspace.lifted === true
  // Tile and card in grid coordinates (the card sits at its cell, the box
  // below its header).
  readonly property var pop: popped
    ? Model.popoutTransform(
      { x: workspace.x + x, y: workspace.y + overview.headerHeight + y, w: width, h: height },
      overview.popBounds,
      workspace.width,
      overview.cardLift,
      { x: workspace.x + workspace.width / 2, y: workspace.y + workspace.height / 2 })
    : null

  // Popped on top; while shrinking back, still above the flat tiles.
  z: popped ? 2 : (visual.scale !== 1 ? 1 : 0)

  function iconSource(className) {
    var entry = className ? DesktopEntries.heuristicLookup(className) : null
    var name = entry && entry.icon ? String(entry.icon) : String(className || "")
    if (name.charAt(0) === "/") return Util.fileUrl(name)
    var themed = name ? Quickshell.iconPath(name, true) : ""
    return themed.length > 0 ? themed : Quickshell.iconPath("application-x-executable", true)
  }

  Item {
    id: visual
    width: thumb.width
    height: thumb.height
    x: thumb.pop ? thumb.pop.x : 0
    y: thumb.pop ? thumb.pop.y : 0
    scale: thumb.pop ? thumb.pop.scale : 1

    Behavior on x {
      NumberAnimation { duration: thumb.overview.popDuration; easing.type: Easing.OutCubic }
    }
    Behavior on y {
      NumberAnimation { duration: thumb.overview.popDuration; easing.type: Easing.OutCubic }
    }
    Behavior on scale {
      NumberAnimation { duration: thumb.overview.popDuration; easing.type: Easing.OutCubic }
    }

    Rectangle {
      id: frame
      anchors.fill: parent
      color: thumb.overview.surface
      border.width: thumb.selected ? 2 : 1
      border.color: thumb.selected ? thumb.overview.accent : Util.alpha(thumb.overview.foreground, 0.25)
      clip: true

      Loader {
        id: capture
        anchors.fill: parent
        anchors.margins: frame.border.width
        active: thumb.overview.opened && thumb.toplevel !== null
        sourceComponent: ScreencopyView {
          captureSource: thumb.toplevel ? thumb.toplevel.wayland : null
          live: false
        }
      }

      Column {
        anchors.centerIn: parent
        width: parent.width - Style.spacing.lg * 2
        spacing: Style.spacing.sm
        visible: !thumb.hasFrame

        Image {
          anchors.horizontalCenter: parent.horizontalCenter
          width: Math.max(16, Math.min(Style.space(48), frame.height * 0.4))
          height: width
          sourceSize.width: width
          sourceSize.height: height
          fillMode: Image.PreserveAspectFit
          source: thumb.iconSource(thumb.modelData.className)
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: thumb.modelData.className
          color: Util.alpha(thumb.overview.foreground, 0.7)
          elide: Text.ElideMiddle
          font.family: thumb.overview.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    // Group (tabbed) windows draw only their visible tab; say how many hide
    // behind it.
    Rectangle {
      visible: thumb.modelData.extraTabs > 0
      anchors.top: parent.top
      anchors.right: parent.right
      anchors.margins: Style.spacing.sm
      width: tabs.implicitWidth + Style.spacing.md * 2
      height: tabs.implicitHeight + Style.spacing.xs * 2
      color: thumb.overview.surface
      border.width: 1
      border.color: Util.alpha(thumb.overview.foreground, 0.35)

      Text {
        id: tabs
        anchors.centerIn: parent
        text: "+" + thumb.modelData.extraTabs
        color: thumb.overview.foreground
        font.family: thumb.overview.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Rectangle {
      visible: thumb.selected
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.bottom: parent.bottom
      anchors.margins: frame.border.width
      height: chip.implicitHeight + Style.spacing.sm * 2
      color: Util.alpha(thumb.overview.surface, 0.92)

      Text {
        id: chip
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.leftMargin: Style.spacing.md
        anchors.rightMargin: Style.spacing.md
        text: thumb.title || thumb.modelData.className
        color: thumb.overview.foreground
        elide: Text.ElideRight
        font.family: thumb.overview.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    // Clicks on the part of a popped window that reaches past its tile.
    // No hover here, so the neighbours' hover areas underneath still work.
    MouseArea {
      anchors.fill: parent
      enabled: thumb.popped
      acceptedButtons: Qt.LeftButton
      onClicked: thumb.overview.jump(thumb.address)
    }
  }

  // Only the selected window keeps refreshing; everything else stays a
  // single snapshot to spare the integrated GPU.
  Timer {
    interval: 500
    repeat: true
    running: thumb.selected && thumb.overview.opened && capture.item !== null
    onTriggered: capture.item.captureFrame()
  }

  // Hover and click at the tile's real size, above the visual.
  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton
    onPositionChanged: function(mouse) {
      if (thumb.overview.pointerGate.moved(thumb, mouse)) thumb.overview.selectAddress(thumb.address)
    }
    onClicked: thumb.overview.jump(thumb.address)
  }
}
