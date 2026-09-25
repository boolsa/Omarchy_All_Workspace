#!/usr/bin/env bash
# Capture scrubbed Hyprland snapshots for the Model.js unit tests.
# Window titles carry private content (mail subjects, chat names, URLs), so
# every title becomes "<class> window"; pid and xdg/tag metadata are dropped,
# and the workspace "last window title" is blanked. Read-only: this only runs
# `hyprctl -j` queries, never a dispatch.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tests/fixtures
mkdir -p "$OUT"
command -v hyprctl >/dev/null || { echo "hyprctl not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 1; }

# Write to a temp dir first so a failed query never leaves a truncated fixture.
RAW="$(mktemp -d)"
trap 'rm -rf "$RAW"' EXIT

hyprctl -j clients | jq '
  [ .[]
    | ((.class // "") | if . == "" then "app" else . end) as $cls
    | .title = ($cls + " window")
    | .initialTitle = ($cls + " window")
    | del(.xdgDescription, .xdgTag, .tags, .pid) ]' > "$RAW/clients.json"

hyprctl -j workspaces | jq '[ .[] | .lastwindowtitle = "" ]' > "$RAW/workspaces.json"

# Monitor serials are hardware identifiers; nothing in Model.js reads them.
hyprctl -j monitors | jq '[ .[] | if has("serial") then .serial = "" else . end ]' > "$RAW/monitors.json"

mv "$RAW/clients.json" "$RAW/workspaces.json" "$RAW/monitors.json" "$OUT/"
ls -la "$OUT"
