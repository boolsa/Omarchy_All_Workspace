# Omarchy "All Windows" overview plugin (`boolsa.overview`)

## Context

You want a macOS Mission Control-style view that shows the windows from **every** workspace at once, where **each window can be clicked** to jump to its workspace and focus that window.
Your earlier attempt (probably hyprexpo) only let you pick a whole workspace, never a single window.
That is how hyprexpo is built, and it is no longer maintained upstream; it was dropped from hyprland-plugins in May 2026.

So this won't be a compiled Hyprland plugin.
It will be an **Omarchy shell plugin**: QML running inside the Quickshell process `omarchy-shell` that already draws your bar.
Your Todo and UniFi plugins are built the same way.
Compared with a compiled plugin:

- Updating Hyprland can't break it, because nothing needs a `hyprpm` rebuild.
- It uses your theme colors.
- It has direct access to window data and window capture through `Quickshell.Hyprland` and `Quickshell.Wayland.ScreencopyView`.

**Checked on this machine:**
- Hyprland 0.56.2 with Lua config, Quickshell 0.3.1, Omarchy 4.0.4.
- One 1920x1200 monitor (eDP-1).
- 12 windows across workspaces 1–7, plus `special:scratchpad`.
- No Hyprland plugins installed.
- `SUPER + grave` is unbound for every modifier combination.
- Nothing like this exists in Omarchy yet: no overview, and no `ScreencopyView` usage.

## Your decisions

- **Layout:** a workspace grid. Each workspace card is a miniature of the screen, and windows sit at their real relative positions and sizes.
- **How it opens:** `SUPER + `` (backtick) **and** a bar button. Esc, a click outside the cards, or the same trigger again closes it.
- **v1 extras:** keyboard navigation only. Dragging windows, type-to-filter and close-from-overview are out of v1.
- **Which workspaces:** every workspace that has windows, plus the current one even if empty, plus the scratchpad as the last card.

## Behavior spec

- **Click a window:** the overlay closes, Hyprland switches to that window's workspace, and that window gets focus. This works for scratchpad windows too; the scratchpad opens.
- **Click empty space in a card:** switches to that workspace. On the scratchpad card, it focuses the scratchpad's most recent window.
- **Click the scrim, press Esc, or trigger again:** closes the overlay and changes nothing.
- **Hover:** accent border on the window, and its title in a small chip at the bottom of the thumbnail. The current workspace's card gets a `●` and an accent header.
- **Keyboard:**
  - Arrows or `h j k l` move the highlight to the nearest window in that direction, across cards.
  - `Tab` / `Shift+Tab` step through windows in reading order.
  - `Enter` jumps to the highlighted window.
  - `1`–`9` switch straight to that workspace.
  - `Esc` closes.
  - The highlight starts on the active window.
- **Thumbnails:** snapshots.
  - Every window is captured once when the overlay opens. The highlighted window refreshes about every 500 ms.
  - Windows on hidden workspaces show **the last frame the app drew** before it was hidden. Hyprland marks hidden windows as suspended, so most apps stop drawing; they can't be live.
  - Until a snapshot arrives, and for windows that block capture, the tile shows the app icon and title instead.
- **Groups (tabs):** only the visible tab of a group is drawn, with a `+N` badge.
- **Floating and fullscreen windows:** drawn above tiled ones, in focus-history order.

## Project layout

The repo root is the plugin directory, the same convention as `004_Unifi_Plugin` and `boolsa.todo`.

```
./                             (plugin id boolsa.overview)
  manifest.json      kinds ["overlay","bar-widget"], loaded on demand,
                     entryPoints { overlay: "Overview.qml", barWidget: "BarWidget.qml" },
                     barWidget { displayName "Overview", category "Compositor", defaultSection "left" }
  Overview.qml       overlay entry: open()/close()/dismiss()/toggle(), `opened`, data refresh,
                     PanelWindow, keyboard handling, highlight state
  WorkspaceCard.qml  one card: header (number / "scratchpad", ● if current), work-area box,
                     click on empty space switches workspace, Repeater of WindowThumb
  WindowThumb.qml    ScreencopyView snapshot + icon/title fallback, hover and highlight border,
                     title chip, +N group badge, click to jump
  BarWidget.qml      WidgetButton with a grid glyph (Nerd Font nf-md-view_grid);
                     a left click toggles the overlay
  Model.js           all pure logic (.pragma library, ES5 only); tested under node
  tests/             load.mjs, model.test.mjs, source.test.mjs, repo.test.mjs,
                     fixtures/ (hyprctl -j output with titles scrubbed)
  scripts/capture-fixtures.sh   dumps clients/workspaces/monitors -j and scrubs titles
  CLAUDE.md          working agreement (hard rules plus how to verify), modeled on 004's
  plan.md            this design
  README.md, .gitignore
```

**Deploying it:**
- Users install with `omarchy plugin add https://github.com/boolsa/Omarchy_All_Workspace.git --enable`.
  That clones the repo, validates the manifest, and installs it as
  `~/.config/omarchy/plugins/boolsa.overview` (the folder name comes from the
  manifest `id`, not the repo name). Updates go through
  `omarchy plugin update boolsa.overview`.
- Local dev alternative: `git clone <repo-url> ~/.config/omarchy/plugins/boolsa.overview`.
  To update that clone, commit, then `git -C ~/.config/omarchy/plugins/boolsa.overview pull`.
- **Don't use a symlink.** The shell's inotify watcher doesn't follow symlinked plugin folders, so saves wouldn't hot-reload, and `omarchy-plugin-validate` rejects symlinks.

## How it works

### Plugin structure
- Copy the overlay pattern from `/usr/share/omarchy/shell/plugins/emojis/Emojis.qml` (lines 45-62 and 160-178):
  - `property var shell`, `property var manifest`, `property bool opened`.
  - `open(payloadJson)`, `close()`, and `dismiss()`, which calls `shell.hide(manifest.id)`.
  - `PanelWindow { visible: root.opened; anchors all; WlrLayershell.namespace: "boolsa-overview"; layer: WlrLayer.Overlay; keyboardFocus: WlrKeyboardFocus.Exclusive; exclusionMode: ExclusionMode.Ignore }` with a scrim `Rectangle` and a `MouseArea` on the scrim that dismisses.
- **Load on demand, no `keepLoaded`.** The shell creates the overlay on summon and destroys it on hide. So when closed it holds no captures and no memory, and every open builds the model fresh. The component is cached after the first open, so later opens only instantiate the tree.
- **Routing:** because the manifest has both kinds, `omarchy-shell shell toggle boolsa.overview` goes to the overlay loader (`shell.qml:1138-1150`). One command works for both the keybinding and the bar button.
- **Which screen:** the overlay goes on the focused monitor. Pick the entry in `Quickshell.screens` whose name matches `Hyprland.focusedMonitor.name`; the pattern is in `Bar.qml:716-719`.

### Window data (no hyprctl processes)
- **On `open()`:** call `Hyprland.refreshToplevels()`, `refreshWorkspaces()` and `refreshMonitors()`.
- **Building the model:** gather `Hyprland.toplevels.values` into plain objects `{ address, lastIpcObject }`, plus the workspace and monitor `lastIpcObject`s. The fields have the same shape as `hyprctl clients -j`, so the node tests can use hyprctl fixtures.
- **Rebuilding while open:** a 100 ms debounce `Timer` rebuilds the model when a `lastIpcObject` changes, and on `Hyprland.rawEvent` names `openwindow`, `closewindow`, `movewindowv2`, `changefloatingmode` and `fullscreen`.
  - Ignore `screencast` and `screencastv2`. Every capture fires these, and reacting to them causes the refresh storm seen in end-4 issue #3631.
- **Why not hyprctl:** DankMaterialShell's overview takes the same approach. Omarchy's own `Workspaces.qml` reads `Hyprland.workspaces` the same way.

### `Model.js` (pure and tested; `var` and `function` only, same rules as 004's `Model.js`)
- `normalizeAddress(a)` → `"0x…"` in lowercase, or `""` if the value doesn't match `/^(0x)?[0-9a-f]+$/i`.
  - Quickshell's `HyprlandToplevel.address` has no `0x` prefix; hyprctl's does.
  - Every dispatch string is built only from a validated address or a workspace id. Window titles never get into a command.
- `workAreaFor(monitor)`:
  - Returns the logical `{x, y, w, h}`: pixel size ÷ `scale`, width and height swapped for transforms 1, 3, 5 and 7, minus `reserved [l, t, r, b]`.
  - The bar's 30 px is removed this way, so tiles fill the card.
- `relativeRect(client, area)` → the window's `at` and `size` as fractions 0..1 of its monitor's work area, clamped.
- `buildOverview(clients, workspaces, monitors, activeWsId, activeAddr)` → an ordered array of cards. Each card is `{ id, name, label, special, isActive, aspect, windows: [...] }`.
  - **Windows included:** `mapped` windows whose workspace id is not -1. `hidden` ones are counted as group members and not drawn.
  - **Which cards:** occupied workspaces, plus the active one, plus occupied specials last.
  - **Card order:** numbered workspaces ascending, then named workspaces, then specials, labelled without the `special:` prefix.
  - **Z-order within a card:** tiled, then floating, then fullscreen. Within each, windows with a lower `focusHistoryID` (more recently focused) go on top.
- `gridLayout(n, availW, availH, aspect, gap, headerH)` → `{ cols, rows, cardW, cardH }`, with the column count chosen to make cards as large as possible and the last row centered. For example, 8 cards on 1920x1200 gives 3×3.
- `navigate(items, fromIndex, dir)` → the nearest item whose center lies in direction `dir`. Distance along the axis counts, with extra weight on sideways offset. `readingOrder(items)` is used for Tab.
- `focusWindowCmd(addr, usingLua)`:
  - Lua config: `hl.dsp.focus({ window = "address:0x…" })`.
  - Legacy config: `focuswindow address:0x…`.
- `focusWorkspaceCmd(id, usingLua)`:
  - Lua config: `hl.dsp.focus({ workspace = "N" })`, the form Omarchy's `Workspaces.qml:35` uses.
  - Legacy config: `workspace N`.

### Thumbnails (`WindowThumb.qml`)
- **The capture view:** `Loader { active: overview.opened }` wraps `ScreencopyView { captureSource: toplevel ? toplevel.wayland : null; live: false }`.
  - Call `captureFrame()` once it's ready.
  - The overview's 500 ms `Timer` calls `captureFrame()` on the highlighted thumb only.
- **Finding the toplevel:** look it up by normalized address in `Hyprland.toplevels.values`.
- **Fallback while `!hasContent`:** the icon from `Quickshell.iconPath(DesktopEntries.heuristicLookup(class)?.icon ?? class, "application-x-executable")` plus the title.
- **Performance:** no `live: true` captures. Research found that live mode makes the compositor redraw every window at full size every frame, and `constraintSize` doesn't make the capture smaller.

### Jumping to a window or workspace
1. `dismiss()` closes the overlay, which gives up exclusive keyboard focus (`misc:layers_hog_keyboard_focus` is `true`).
2. `Qt.callLater` → `Hyprland.dispatch(Model.focusWindowCmd(addr, Hyprland.usingLua))`.
   - end-4 and DankMaterialShell use `Hyprland.dispatch` with the Lua string.
   - Fallback if needed: `Quickshell.execDetached(["hyprctl", "dispatch", cmd])`, the proven Omarchy pattern from `omarchy-launch-or-focus`.
3. Legacy `hyprctl dispatch focuswindow …` fails on Hyprland 0.55+ in Lua mode, so we always check `Hyprland.usingLua`.

### Look and feel
- **Tokens:** `import qs.Commons` / `qs.Ui`, same as Emojis.
  - Colors: `Color.menu.{background, text, border, scrim, selectedBorder}` and `Color.accent`.
  - Shapes: `Border.surfaceSpec("menu", …)` and `Style.cornerRadius`.
  - Sizes and type: `Style.spacing.*`, `Style.space()`, `Style.font.*`.
  - No hex literals anywhere.
- **Hover:** use `PointerMoveGate` (`/usr/share/omarchy/shell/Ui/PointerMoveGate.qml`) so the window under a still pointer doesn't grab the highlight when the overlay opens.
- **Keys:** handled by a `keyCatcher` Item with `Keys.priority: Keys.BeforeItem`, as in Emojis.
- **Animation:** a 150 ms opacity and scale fade in QML.
  - Turn off the compositor's layer animation, as Omarchy does for its own overlays.
  - Add `hl.layer_rule({ match = { namespace = "boolsa-overview" }, no_anim = true, animation = "none" })` to `~/.config/hypr/looknfeel.lua`.

### Bar button (`BarWidget.qml`)
- A copy of the menu widget pattern (`/usr/share/omarchy/shell/plugins/menu/BarWidget.qml`): a `WidgetButton` whose left click runs `root.bar.run("omarchy-shell shell toggle boolsa.overview")`, with tooltip "All windows".
- Enabling it: `omarchy plugin enable boolsa.overview` puts it in the left section, then `omarchy bar move` places it right after `omarchy.workspaces`.

### Hyprland config (user files only; never edit `/usr/share/omarchy/`)
- `~/.config/hypr/bindings.lua`: `o.bind("SUPER + grave", "Window overview", "omarchy-shell shell toggle boolsa.overview")`.
  - The key is unbound, so no `hl.unbind` is needed.
  - With your `altwin:swap_alt_win`, SUPER is the key in the physical Alt position.
- `~/.config/hypr/looknfeel.lua`: the `no_anim` layer rule above.
- After each edit, run `hyprctl reload`, then `hyprctl configerrors`, which must print nothing.

## Build order

0. **Save the plan.** You asked for this. Save this plan as `plan.md` in the repo root as the first action after approval, then `git init`.
1. **Scaffold and spike.**
   - Build: the manifest and a bare `Overview.qml` that lists every toplevel with a small `ScreencopyView` and its title, plus the deploy clone. Run `omarchy plugin enable` and check the toggle works.
   - Settle the open questions on the real machine:
     - (a) the `HyprlandToplevel.address` format, and whether `lastIpcObject` fills in after refresh;
     - (b) whether windows on hidden workspaces and the scratchpad give `hasContent` with `live: false`;
     - (c) whether `Hyprland.dispatch` with the Lua focus string switches workspace and focuses, for a normal window and a scratchpad window;
     - (d) whether toggle reaches the overlay while the bar widget still draws.
   - Write any surprises into `plan.md` before going on.
2. **Tests and fixtures.** `Model.js` plus `tests/` (reuse the loader approach in 004's `tests/load.mjs`), and `scripts/capture-fixtures.sh`.
   - Real fixtures from this machine.
   - Synthetic fixtures: an overlapping floating window, a fullscreen window, a 3-tab group, an empty active workspace, and two monitors with scale 1.5 and transform 1.
3. **Cards and thumbs.** `WorkspaceCard.qml` and `WindowThumb.qml` drawn from the model, plus click to jump.
4. **Keyboard navigation.** Plus the highlight refresh timer.
5. **Bar and keybinding.** `BarWidget.qml`, the keybinding and the layer rule, then polish: animation and title chip.
6. **Project docs.** `CLAUDE.md`, `README.md` and `plan.md`. Commit, then pull into the deploy clone.

## Spike results (2026-09-25)

Settled on the live machine with the step-1 spike overlay:

- **(a) Address format.** `HyprlandToplevel.address` has no prefix (`5cd959cd1920`). `lastIpcObject.address` has the prefix (`0x5cd959cd1920`). `lastIpcObject` carries all 32 `hyprctl clients -j` fields once `Hyprland.refreshToplevels()` has run.
- **(b) Capture.** Every window returned `hasContent=true` with `live: false` and no explicit `captureFrame()`. That includes windows on hidden workspaces 1 and 3–7 and the scratchpad. `sourceSize` equals the window's logical size.
- **(c) Jump.** `Hyprland.dispatch('hl.dsp.focus({ window = "address:0x…" })')`, sent after `dismiss()` via `Qt.callLater`:
  - Switches workspace 2 → 6 and focuses the target window.
  - For a scratchpad window, opens `special:scratchpad` and focuses it.
  - Focusing a window on a normal workspace again hides the scratchpad, because `binds:hide_special_on_workspace_change` is on.
  - No `hyprctl` fallback is needed.
- **(d) Routing.** `omarchy-shell shell toggle boolsa.overview` reaches the overlay. `omarchy-shell shell call boolsa.overview <method> <arg>` reaches overlay methods, which is useful for scripted checks. `omarchy plugin enable boolsa.overview --section left` placed the bar button right after `omarchy.workspaces`.

- **(e) Overlay hot reload doesn't work.**
  - What happens: after a pull the shell logs "Local plugin changed, reloading", but the next summon still builds the old `Overview.qml` and `Model.js`.
  - Seen first with `keepLoaded: true`, then again without it. `omarchy-shell shell rescanPlugins` doesn't help either.
  - Likely cause: `shell.qml` `reloadPlugins()` relies on `Qt.clearComponentCache()`, which keeps any component still referenced when it runs. The entry-point URL has no cache-busting.
  - Workaround: after pulling overlay changes, run `omarchy restart shell`.
  - `keepLoaded` stays off anyway, because the lifecycle is simpler and nothing lives while the overlay is closed.
- **(f) The first build on open uses old window data.**
  - `open()` rebuilds from `lastIpcObject`s before the refresh replies land. A restarted shell may have none yet, and `Hyprland.activeToplevel` is null until its first event.
  - So the starting highlight is recomputed on every rebuild until the user moves it (`selectionTouched`).
  - The active window comes from `Model.resolveActiveAddress`: the preferred window if it is drawn, otherwise the lowest `focusHistoryID`.

## Verification

```bash
cd <repo-checkout>
node --test                                             # Model.js: layout math, filtering, ordering, nav, cmd builders, address validation
/usr/lib/qt6/bin/qmllint *.qml                          # exit code is the gate; qs.* import warnings are expected
omarchy plugin validate ~/Projects/009_Omarchy_All_Windows
hyprctl reload && hyprctl configerrors                  # after bindings.lua / looknfeel.lua edits; must be empty
omarchy-shell shell toggle boolsa.overview              # open/close from CLI
journalctl --user -o cat _COMM=quickshell -n 50 --no-pager   # no QML errors/warnings from boolsa.overview
hyprctl activewindow -j | jq -r '.address, .workspace.id'    # confirm the jump landed on the clicked window
```

**Checks by hand**
1. Press SUPER+` while on workspace 2. Cards 1–7 plus scratchpad appear, and each window's tile matches its real position.
2. Click a window on workspace 5. You land on workspace 5 with that exact window focused; check with `activewindow`.
3. Click the Chromium window in the scratchpad. The scratchpad opens with it focused.
4. Click empty space in card 3 and you switch to workspace 3. Click the scrim or press Esc and nothing changes.
5. Keyboard: arrows or hjkl cross between cards, Tab cycles, Enter jumps, 4 switches to workspace 4.
6. The bar button toggles the overlay, and so does SUPER+`.
7. **Edge cases:** a floating window over tiled ones, a fullscreen window, a group of tabs, and a window that opens or closes while the overlay is up (the model updates).
8. **Resources:** open and close about 20 times.
   - The journal stays clean.
   - After closing, quickshell's CPU use is back to idle, so no captures are left running.
   - Opening feels instant on the Iris Xe.

## Known limitations and risks
- **Old snapshots:** windows on other workspaces show their last drawn frame, not live content. This is a Hyprland suspension limit, and macOS behaves much the same.
- **Privacy:** the overview puts other workspaces' content on screen, which matters during screen sharing. A hide-previews toggle could come later.
- **Unconfirmed dispatch syntax:** `Hyprland.dispatch` with a Lua string and `hl.dsp.window.move({ window = … })` aren't tested locally yet. Step 1 checks the first; the second is only needed if drag-to-move comes later.
- **Lost bar button disables the overlay:** if the bar widget is removed from the bar, the overlay plugin counts as disabled. If that happens, add `{ "id": "boolsa.overview" }` to `plugins[]` in `shell.json`.
- **Later ideas:** dragging windows between workspaces, type-to-filter, middle-click to close, a 4-finger swipe gesture, and multi-monitor polish (showing every monitor's overlay).
