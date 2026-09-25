pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// One workspace: a header strip over a miniature of its monitor's work area.
// Windows sit at their real relative positions. Clicking empty space switches
// to the workspace, or for scratchpad and named cards focuses its latest
// window (Model.cardActivationCmd).
Item {
  id: card

  required property var modelData
  required property int index
  property var overview: null

  readonly property bool current: modelData.isActive === true
  readonly property int windowCount: modelData.windows ? modelData.windows.length : 0

  MouseArea {
    anchors.fill: parent
    onClicked: card.overview.activateCard(card.index)
  }

  Item {
    id: header
    width: parent.width
    height: card.overview.headerHeight

    Text {
      anchors.left: parent.left
      anchors.right: count.left
      anchors.rightMargin: Style.spacing.md
      anchors.verticalCenter: parent.verticalCenter
      text: card.modelData.label + (card.current ? "  ●" : "")
      color: card.current ? card.overview.accent : card.overview.foreground
      elide: Text.ElideRight
      font.family: card.overview.fontFamily
      font.pixelSize: Style.font.subtitle
      font.bold: card.current
    }

    Text {
      id: count
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: card.windowCount === 0 ? "empty"
        : card.windowCount === 1 ? "1 window" : card.windowCount + " windows"
      color: Util.alpha(card.overview.foreground, 0.55)
      font.family: card.overview.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Rectangle {
    id: box
    y: header.height
    width: parent.width
    height: card.overview.grid.boxH
    radius: card.overview.cornerRadius
    color: Util.alpha(card.overview.foreground, 0.05)
    border.width: card.current ? 2 : 1
    border.color: card.current ? card.overview.accent : Util.alpha(card.overview.foreground, 0.18)
    clip: true

    Repeater {
      model: card.modelData.windows

      WindowThumb {
        overview: card.overview
        x: Math.round(modelData.rect.x * box.width)
        y: Math.round(modelData.rect.y * box.height)
        width: Math.max(1, Math.round(modelData.rect.w * box.width))
        height: Math.max(1, Math.round(modelData.rect.h * box.height))
      }
    }
  }
}
