import QtQuick
import qs.Ui

// Bar entry point: a single grid glyph that toggles the overview overlay.
// Because the manifest declares both kinds, `shell toggle boolsa.overview`
// routes to the overlay loader, so the bar and the keybinding share one path.
BarWidget {
  id: root
  moduleName: "boolsa.overview"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // nf-md-view_grid (U+F0570)
    text: "󰕰"
    tooltipText: "All windows"
    horizontalMargin: 7.5
    onPressed: function(buttonCode) {
      if (!root.bar) return
      if (buttonCode === Qt.LeftButton) root.bar.run("omarchy-shell shell toggle boolsa.overview")
    }
  }
}
