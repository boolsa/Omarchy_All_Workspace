# Overview: Mission Control for Omarchy

An [Omarchy](https://omarchy.org/) shell plugin that shows the windows of **every** Hyprland workspace at once.
Each workspace appears as a miniature of your screen, with its windows at their real positions.
Click any single window and you land on its workspace with that window focused.

Hyprexpo-style overviews only let you pick a whole workspace.
This one makes every window a target.

## Using it

| Action | Result |
|---|---|
| `SUPER + `` or the grid icon in the bar | open / close |
| Click a window | jump to its workspace and focus it (scratchpad windows open the scratchpad) |
| Click empty space in a card | switch to that workspace (on the scratchpad card: focus its latest window) |
| Click outside the cards, or `Esc` | close without changing anything |
| Arrows or `h j k l` | move the highlight between windows, across workspaces |
| `Tab` / `Shift+Tab` | cycle windows in reading order |
| `Enter` / `Space` | jump to the highlighted window |
| `1`–`9`, `0` | switch straight to workspace 1–9, 10 |

Cards list every workspace that has windows, plus your current one even when it is empty, plus the scratchpad at the end.
A `+N` badge marks a tab group with N hidden tabs.

**About the previews:** Hyprland suspends windows on workspaces you can't see, so most apps stop drawing there.
Those thumbnails show the last frame the app drew before you left that workspace.
The highlighted window refreshes twice a second.
Until a snapshot arrives, a tile shows the app icon and name.

## Install

Requires Omarchy 4 (Quickshell 0.3+, Hyprland 0.55+).
Built and tested with Omarchy's Lua Hyprland config.

```bash
omarchy plugin add https://github.com/boolsa/Omarchy_All_Workspace.git --enable
```

This clones the repo, validates `manifest.json`, and installs it as
`~/.config/omarchy/plugins/boolsa.overview` (the folder name comes from the
manifest `id`, not the repo name). `--enable` places the grid icon in the
bar (default section `left`); you can move it with `omarchy bar move`.

Add the keybinding to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + grave", "Window overview", "omarchy-shell shell toggle boolsa.overview")
```

On a legacy `hyprland.conf`, use `bind = SUPER, grave, exec, omarchy-shell shell toggle boolsa.overview` instead.
The plugin switches to legacy dispatch strings via `Hyprland.usingLua`; that path is unit-tested but not tried live.

Optionally, skip the compositor's layer fade, since the overlay animates itself. Add this to `~/.config/hypr/looknfeel.lua`:

```lua
hl.layer_rule({ match = { namespace = "boolsa-overview" }, no_anim = true, animation = "none" })
```

Then run `hyprctl reload && hyprctl configerrors`.

## Updating

```bash
omarchy plugin update boolsa.overview
omarchy restart shell
```

The restart is needed. The shell keeps the previously loaded overlay code until it restarts, and the bar blinks once when it does.

## Known limitations

* **Previews are snapshots.** Covered above: hidden workspaces show the last
  drawn frame.
* **Privacy.** The overview shows other workspaces' contents on screen, which
  is worth remembering while screen sharing.
* **Mixed-monitor aspect.** The grid sizes every card from the active
  workspace's monitor aspect, so on mixed setups (e.g. landscape + portrait)
  non-active cards keep correct relative window positions but their proportions
  are stretched. Single-monitor setups are pixel-faithful. Multi-monitor input
  never crashes; it just shares one card size.
* **Scrolling layout.** Columns scrolled off-screen appear as a thin, still
  clickable sliver at the card's edge, showing the app icon instead of a preview.
* **Keep the bar icon.** Omarchy treats a third-party plugin as enabled only
  while it appears in `shell.json`. If you remove the grid icon from the bar,
  the overlay and its keybinding stop working. To keep the overlay without the
  icon, add `{ "id": "boolsa.overview" }` to `plugins` in
  `~/.config/omarchy/shell.json`.

## Development

See `CLAUDE.md` for the working agreement and `plan.md` for the design, spike results and verification status.
After changing overlay code in an installed copy, run `omarchy restart shell` to load it.

```bash
node --test
/usr/lib/qt6/bin/qmllint *.qml
omarchy plugin validate .
```

## License

MIT
