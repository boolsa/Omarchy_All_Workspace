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
| Click empty space in a card | switch to that workspace |
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

Requires Omarchy 4 (Quickshell 0.3+, Hyprland 0.55+ with the Lua config).
Legacy (non-Lua) Hyprland configs work too; the plugin picks the dispatch
syntax via `Hyprland.usingLua`.

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

Optionally, skip the compositor's layer fade, since the overlay animates itself. Add this to `~/.config/hypr/looknfeel.lua`:

```lua
hl.layer_rule({ match = { namespace = "boolsa-overview" }, no_anim = true, animation = "none" })
```

Then run `hyprctl reload && hyprctl configerrors`.

## Known limitations

* **Previews are snapshots.** Covered above: hidden workspaces show the last
  drawn frame.
* **Mixed-monitor aspect.** The grid sizes every card from the active
  workspace's monitor aspect, so on mixed setups (e.g. landscape + portrait)
  non-active cards keep correct relative window positions but their proportions
  are stretched. Single-monitor setups are pixel-faithful. Multi-monitor input
  never crashes; it just shares one card size.

## Development

See `CLAUDE.md` for the working agreement and `plan.md` for the design.

```bash
node --test
/usr/lib/qt6/bin/qmllint *.qml
omarchy plugin validate .
```

## License

MIT
