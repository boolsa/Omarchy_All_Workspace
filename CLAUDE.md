# Overview (boolsa.overview): project context

Read `plan.md` first. It has the design, the spike results, and the verification checklist.
This file is the working agreement for anyone, human or agent, touching the code.

## What this is

Mission Control for Hyprland on Omarchy.
`SUPER + `` or the bar button opens a fullscreen overlay that shows every workspace as a miniature of the screen.
Each window sits at its real position and is individually clickable.
Clicking a window closes the overlay and jumps to that workspace with that window focused.
Originally built for one laptop (1920x1200), but multi-monitor input must not crash it.

## Layout (flat; repo root = plugin dir)

```
manifest.json      id boolsa.overview · kinds [overlay, bar-widget] · loaded on demand (no keepLoaded)
Overview.qml       overlay entry: open/close/dismiss/toggle, Hyprland wiring, keys, PanelWindow
WorkspaceCard.qml  one workspace: header + miniature box; lifts when focused; empty-space click activates the card
WindowThumb.qml    one window: ScreencopyView snapshot, icon fallback, title chip, pop-out, click to jump
BarWidget.qml      grid glyph in the bar; runs `omarchy-shell shell toggle boolsa.overview`
Model.js           pure layout/order/navigation/dispatch logic; node-testable; `.pragma library`
tests/             node:test files + fixtures/ (hyprctl -j output, titles scrubbed) + synthetic-*
scripts/           capture-fixtures.sh (re-captures real fixtures, scrubbing titles)
```

## Hard rules

- **Never edit `/usr/share/omarchy/`.** Read it freely for reference:
  - `shell/plugins/emojis/Emojis.qml` is the overlay pattern.
  - `shell/plugins/menu/BarWidget.qml` is the bar button.
  - `shell/Ui/*.qml` and `shell/Commons/{Style,Color,Border,Util}.qml` are the components and theme tokens.
- **Logic lives in `Model.js`,** not QML. If it parses, orders, lays out, navigates or builds a command, it goes in the `.js` and gets a test.
- **Write `Model.js` as JS for the QML engine.**
  - It starts with `.pragma library` and uses only `var` and `function`.
  - No `const`, `let`, arrow functions, template literals, optional chaining, `??`, or spread.
  - Node runs the same file in the tests.
- **Build dispatch strings only in `Model.js`, only from validated input.**
  - Allowed inputs are addresses normalized to `0x[0-9a-f]+` and integer workspace ids.
  - Titles and classes never reach a command.
  - Check `Hyprland.usingLua`: in Lua mode, Hyprland 0.55+ rejects legacy `hyprctl dispatch focuswindow …`.
- **Captures only while open.**
  - Use `ScreencopyView { live: false }` inside a `Loader` gated on `opened`. Only the selected thumb refreshes, every 500 ms.
  - Never use `live: true`. It makes the compositor redraw every window at full size every frame, and the laptop has an integrated GPU.
- **Never refresh on `screencast`/`screencastv2` events.** Every capture emits them, so refreshing on them causes a refresh storm.
- **Theme colors only.**
  - Use `Color.menu.*`, `Color.accent`, and `Util.alpha(...)` variants.
  - No hex or named color literals in QML; `tests/source.test.mjs` enforces this.
- **Two-space indent** in QML and JS.

## Verification

```bash
node --test                                              # Model.js + source + repo rules (bare: Node 26 rejects a dir arg)
/usr/lib/qt6/bin/qmllint *.qml                           # exit code is the gate; qs.* import warnings are expected
omarchy plugin validate .
omarchy-shell shell toggle boolsa.overview               # open/close from the CLI
omarchy-shell shell call boolsa.overview jump <address>  # scripted jump (address with or without 0x)
hyprctl activewindow -j | jq -r '.address, .workspace.id'
```

**Live loading.**
- Users install via `omarchy plugin add https://github.com/boolsa/Omarchy_All_Workspace.git --enable`,
  which lands in `~/.config/omarchy/plugins/boolsa.overview` (folder name from the manifest `id`).
  Updates go through `omarchy plugin update boolsa.overview`.
- **Overlay code does not hot-reload.** The shell notices the change ("Local plugin changed, reloading"), but the next summon still builds the old cached `Overview.qml`/`Model.js`. This happens with or without `keepLoaded`, and `rescanPlugins` doesn't help. After pulling overlay changes, run `omarchy restart shell` (the bar blinks once).
- Don't symlink the project into the plugins directory. The watcher doesn't follow symlinks, and `omarchy plugin validate` rejects them.
- Shell warnings and errors go to the journal: `journalctl --user -o cat _COMM=quickshell -n 50 --no-pager`.

**User config this plugin relies on.** It lives outside the repo, so re-check it after `omarchy refresh hyprland`:
- `~/.config/hypr/bindings.lua`: `o.bind("SUPER + grave", "Window overview", "omarchy-shell shell toggle boolsa.overview")`
- `~/.config/hypr/looknfeel.lua`: `hl.layer_rule({ match = { namespace = "boolsa-overview" }, no_anim = true, animation = "none" })`
- `~/.config/omarchy/shell.json`: `boolsa.overview` in `bar.layout.left`, right after `omarchy.workspaces`.

## Commits

Use imperative, unprefixed, outcome-oriented subjects: `Jump to scratchpad windows`, not `feat(model): scratchpad`.
The remote is the private repo `github.com/boolsa/Omarchy_All_Workspace` (`origin`, branch `master`).

## Testing input without a keyboard

- `wtype` sends keys through a virtual keyboard with its own keymap.
  - Keys delivered to the open overlay arrive correctly (arrows, Enter, digits, Esc all verified).
  - Hyprland resolves **binds** against the physical keymap, so `wtype -M logo -k grave` fired SUPER+Escape (the system menu) instead of this plugin's bind. Test the binding by hand.
- The pointer can't be scripted here: `hyprctl dispatch 'hl.dsp.cursor.move({ x = …, y = … })'` warps the cursor but sends no motion to the overlay, and there is no virtual-pointer tool installed. Test hover and pop-out by hand.
- Only send keys after confirming the overlay has focus: `hyprctl layers -j | grep -q '"boolsa-overview"'`. Otherwise the keys go to whatever terminal is focused.
