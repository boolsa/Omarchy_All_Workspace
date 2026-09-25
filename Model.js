.pragma library
// Pure logic for the boolsa.overview overlay: address/workspace helpers, work
// area math, the card/window model, grid layout, keyboard navigation, and the
// Hyprland dispatch strings. Runs inside the QML JS engine, so: var + function
// only. Node runs the same file in tests (tests/load.mjs strips the pragma line).
//
// Inputs are Quickshell `lastIpcObject`s, which have the same shape as
// `hyprctl -j clients|workspaces|monitors`. Before the first refresh they can
// be `{}`, so every function here tolerates null, undefined and partial objects.

// ---- generic helpers -------------------------------------------------------

var ADDRESS_RE = /^(0x)?[0-9a-f]+$/i;
var SPECIAL_PREFIX = "special:";
// Smallest window size, as a fraction of the card, so tiny windows stay clickable.
var MIN_FRACTION = 0.02;
// Sort key for windows with no usable focus history: behind everything else.
var NO_FOCUS_HISTORY = 1e6;
// Card aspect used when the monitor is unknown (16:10).
var DEFAULT_ASPECT = 1.6;
// Hyprland workspace ids are int32; the cap keeps String(id) plain digits.
var MAX_WORKSPACE_ID = 2147483647;

function isObj(value) {
  return value !== null && typeof value === "object";
}

function isNum(value) {
  return typeof value === "number" && isFinite(value);
}

function isInt(value) {
  return isNum(value) && Math.floor(value) === value;
}

function num(value, fallback) {
  return isNum(value) ? value : fallback;
}

function clamp(value, lo, hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

// Arrays pass through; QML list/sequence wrappers are array-like, so copy
// them by index. Anything else is an empty list.
function asList(value) {
  if (Array.isArray(value)) return value;
  var out = [];
  if (isObj(value) && isNum(value.length)) {
    for (var i = 0; i < value.length; i++) out.push(value[i]);
  }
  return out;
}

function findById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (isObj(list[i]) && list[i].id === id) return list[i];
  }
  return null;
}

// ---- addresses and workspaces ---------------------------------------------

// Quickshell's HyprlandToplevel.address has no "0x"; hyprctl's has. Both map
// to lowercase "0x…". Anything that is not pure hex becomes "", which is what
// keeps titles and other free text out of dispatch strings.
function normalizeAddress(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  var s = String(value).trim();
  if (!ADDRESS_RE.test(s)) return "";
  return "0x" + s.replace(/^0x/i, "").toLowerCase();
}

// Named workspaces can have negative ids too, so the name prefix is the only
// reliable marker of a special workspace.
function isSpecialWorkspace(ws) {
  return !!ws && typeof ws.name === "string" && ws.name.indexOf(SPECIAL_PREFIX) === 0;
}

function hasName(ws) {
  return typeof ws.name === "string" && ws.name !== "";
}

// A plain numbered workspace: positive integer id whose name is just that id
// (or no name at all). Only these can be targeted with `workspace N`.
function isNumberedWorkspace(ws) {
  if (!isObj(ws) || isSpecialWorkspace(ws)) return false;
  if (!isInt(ws.id) || ws.id <= 0) return false;
  return !hasName(ws) || ws.name === String(ws.id);
}

// A numbered workspace's name already equals String(id), so "name, else id"
// covers it; specials drop the prefix ("special:" alone reads "special").
function workspaceLabel(ws) {
  if (!isObj(ws)) return "";
  if (isSpecialWorkspace(ws)) {
    var bare = ws.name.substring(SPECIAL_PREFIX.length);
    return bare !== "" ? bare : "special";
  }
  if (hasName(ws)) return ws.name;
  return isNum(ws.id) ? String(ws.id) : "";
}

// ---- geometry --------------------------------------------------------------

// Logical work area of a monitor: physical pixels / scale, width and height
// swapped for the 90/270 degree transforms (odd values), minus reserved
// [left, top, right, bottom] (the bar's strip). Client `at` coordinates live
// in the same logical layout space.
function workAreaFor(monitor) {
  if (!isObj(monitor)) return null;
  var pw = num(monitor.width, 0);
  var ph = num(monitor.height, 0);
  if (pw <= 0 || ph <= 0) return null;
  var scale = num(monitor.scale, 1);
  if (scale <= 0) scale = 1;
  var lw = pw / scale;
  var lh = ph / scale;
  if (num(monitor.transform, 0) % 2 === 1) {
    var t = lw;
    lw = lh;
    lh = t;
  }
  var reserved = asList(monitor.reserved);
  var left = num(reserved[0], 0);
  var top = num(reserved[1], 0);
  var right = num(reserved[2], 0);
  var bottom = num(reserved[3], 0);
  return {
    x: num(monitor.x, 0) + left,
    y: num(monitor.y, 0) + top,
    w: Math.max(1, lw - left - right),
    h: Math.max(1, lh - top - bottom)
  };
}

// A window's box as fractions of its work area. Windows can hang off the
// area (fullscreen covers the bar strip, scrolling layouts park windows
// off-screen), so the result is pulled back inside [0, 1].
function relativeRect(client, area) {
  var full = {x: 0, y: 0, w: 1, h: 1};
  if (!isObj(client) || !isObj(area)) return full;
  var at = asList(client.at);
  var size = asList(client.size);
  if (!isNum(at[0]) || !isNum(at[1]) || !isNum(size[0]) || !isNum(size[1])) return full;
  if (!isNum(area.x) || !isNum(area.y) || !isNum(area.w) || !isNum(area.h)) return full;
  if (area.w <= 0 || area.h <= 0) return full;
  var x = clamp((at[0] - area.x) / area.w, 0, 1 - MIN_FRACTION);
  var y = clamp((at[1] - area.y) / area.h, 0, 1 - MIN_FRACTION);
  return {
    x: x,
    y: y,
    w: clamp(size[0] / area.w, MIN_FRACTION, 1 - x),
    h: clamp(size[1] / area.h, MIN_FRACTION, 1 - y)
  };
}

// ---- buildOverview ---------------------------------------------------------

function isValidWorkspaceId(id) {
  return isInt(id) && id !== -1;
}

// Hidden clients are inactive group tabs; they surface only through the
// visible member's `grouped` array.
function isDrawable(client) {
  if (!isObj(client)) return false;
  if (client.mapped === false || client.hidden === true) return false;
  if (normalizeAddress(client.address) === "") return false;
  return isObj(client.workspace) && isValidWorkspaceId(client.workspace.id);
}

// Maximized (1) keeps its tiled/floating tier; only real fullscreen (2, or
// 3 = maximized + fullscreen) is drawn above everything.
function isFullscreen(client) {
  return client.fullscreen === true || (isNum(client.fullscreen) && client.fullscreen >= 2);
}

function windowTier(win) {
  if (win.fullscreen) return 2;
  return win.floating ? 1 : 0;
}

// Hyprland reports a negative focusHistoryID for windows that are not in the
// focus history, so those sort as least recent instead of "more recent than 0".
function focusHistoryOf(client) {
  var id = client.focusHistoryID;
  return (isNum(id) && id >= 0) ? id : NO_FOCUS_HISTORY;
}

function textOf(value) {
  return (typeof value === "string") ? value : "";
}

function makeWindow(client, address, activeAddress, area) {
  var grouped = Array.isArray(client.grouped) ? client.grouped.length : 0;
  return {
    address: address,
    className: textOf(client["class"]) || textOf(client.initialClass),
    title: textOf(client.title),
    floating: !!client.floating,
    fullscreen: isFullscreen(client),
    pinned: !!client.pinned,
    groupSize: grouped,
    extraTabs: Math.max(0, grouped - 1),
    isActive: activeAddress !== "" && address === activeAddress,
    focusHistoryID: focusHistoryOf(client),
    rect: relativeRect(client, area)
  };
}

// Render order, bottom -> top: tier, then least recently focused first so
// the most recent (lowest focusHistoryID) is drawn last. The address
// tie-break makes the order total, so engine sort stability never matters.
function compareRenderOrder(a, b) {
  var ta = windowTier(a);
  var tb = windowTier(b);
  if (ta !== tb) return ta - tb;
  if (a.focusHistoryID !== b.focusHistoryID) return b.focusHistoryID - a.focusHistoryID;
  if (a.address === b.address) return 0;
  return a.address < b.address ? -1 : 1;
}

// 0 numbered, 1 named, 2 special.
function cardGroup(card) {
  if (card.special) return 2;
  return isNumberedWorkspace(card) ? 0 : 1;
}

function compareCards(a, b) {
  var ga = cardGroup(a);
  var gb = cardGroup(b);
  if (ga !== gb) return ga - gb;
  if (ga !== 0 && a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id - b.id;
}

// Card monitor: the workspace's own monitorID, else where its first window
// sits, else the focused monitor, else the first one, else 0.
function cardMonitorId(ws, firstClient, monitors) {
  if (isObj(ws) && isInt(ws.monitorID) && ws.monitorID >= 0) return ws.monitorID;
  if (isObj(firstClient) && isInt(firstClient.monitor) && firstClient.monitor >= 0) return firstClient.monitor;
  for (var i = 0; i < monitors.length; i++) {
    if (isObj(monitors[i]) && monitors[i].focused === true && isInt(monitors[i].id)) return monitors[i].id;
  }
  if (isObj(monitors[0]) && isInt(monitors[0].id)) return monitors[0].id;
  return 0;
}

function makeCard(id, ws, firstClient, monitors, activeWorkspaceId) {
  var name = (isObj(ws) && hasName(ws)) ? ws.name : String(id);
  var info = {id: id, name: name};
  var monitorId = cardMonitorId(ws, firstClient, monitors);
  var area = workAreaFor(findById(monitors, monitorId));
  return {
    id: id,
    name: name,
    label: workspaceLabel(info),
    special: isSpecialWorkspace(info),
    isActive: id === activeWorkspaceId,
    monitorId: monitorId,
    area: area,
    aspect: area ? area.w / area.h : DEFAULT_ASPECT,
    windows: []
  };
}

// One card per occupied workspace plus the active one (even if empty), in
// the order numbered -> named -> special. Each card's windows are in render
// order (bottom -> top) with rects relative to their own monitor's work area.
function buildOverview(clients, workspaces, monitors, opts) {
  var clientList = asList(clients);
  var wsList = asList(workspaces);
  var monList = asList(monitors);
  var o = isObj(opts) ? opts : {};
  var activeWorkspaceId = isNum(o.activeWorkspaceId) ? o.activeWorkspaceId : null;
  var activeAddress = normalizeAddress(o.activeAddress);

  var cards = [];
  var byId = {};
  var seen = {};
  var areaCache = {};

  function areaOfMonitor(id) {
    if (!isInt(id)) return null;
    var key = String(id);
    if (!(key in areaCache)) areaCache[key] = workAreaFor(findById(monList, id));
    return areaCache[key];
  }

  for (var i = 0; i < clientList.length; i++) {
    var c = clientList[i];
    if (!isDrawable(c)) continue;
    var address = normalizeAddress(c.address);
    // A duplicate address would draw the same window twice; first one wins.
    if (seen[address]) continue;
    seen[address] = true;
    var wsId = c.workspace.id;
    var key = String(wsId);
    var card = byId[key];
    if (!card) {
      card = makeCard(wsId, findById(wsList, wsId) || c.workspace, c, monList, activeWorkspaceId);
      byId[key] = card;
      cards.push(card);
    }
    card.windows.push(makeWindow(c, address, activeAddress, areaOfMonitor(c.monitor) || card.area));
  }

  if (isValidWorkspaceId(activeWorkspaceId) && !byId[String(activeWorkspaceId)]) {
    var activeWs = findById(wsList, activeWorkspaceId);
    if (!isSpecialWorkspace(activeWs)) {
      cards.push(makeCard(activeWorkspaceId, activeWs || {id: activeWorkspaceId, name: String(activeWorkspaceId)},
        null, monList, activeWorkspaceId));
    }
  }

  for (var j = 0; j < cards.length; j++) cards[j].windows.sort(compareRenderOrder);
  cards.sort(compareCards);
  return cards;
}

// ---- gridLayout ------------------------------------------------------------

function emptyGrid() {
  return {cols: 0, rows: 0, cardW: 0, boxH: 0, cardH: 0, cells: []};
}

// Each card is a header strip (headerH) above a box of cardW x cardW/aspect.
// Every column count is tried and the one giving the widest card wins. The
// comparison uses whole pixels; on a tie the layout with fewer rows wins, and
// among equal rows the fewer-column (more balanced) layout found first stays.
function gridLayout(count, availW, availH, aspect, gap, headerH) {
  if (!isNum(count) || !isNum(availW) || !isNum(availH) || !isNum(aspect)) return emptyGrid();
  var n = Math.floor(count);
  if (n <= 0 || availW <= 0 || availH <= 0 || aspect <= 0) return emptyGrid();
  var g = Math.max(0, num(gap, 0));
  var header = Math.max(0, num(headerH, 0));

  var bestCols = 0;
  var bestRows = 0;
  var bestW = 0;
  for (var cols = 1; cols <= n; cols++) {
    var rows = Math.ceil(n / cols);
    var byWidth = (availW - g * (cols - 1)) / cols;
    var byHeight = ((availH - g * (rows - 1)) / rows - header) * aspect;
    var w = Math.floor(Math.min(byWidth, byHeight));
    if (w > bestW || (w === bestW && bestCols > 0 && rows < bestRows)) {
      bestW = w;
      bestCols = cols;
      bestRows = rows;
    }
  }
  // No column count leaves room for even a 1 px card.
  if (bestCols === 0 || bestW < 1) return emptyGrid();

  var boxH = Math.floor(bestW / aspect);
  var cardH = Math.floor(header + boxH);
  var gridH = bestRows * cardH + (bestRows - 1) * g;
  var top = Math.max(0, Math.floor((availH - gridH) / 2));
  var cells = [];
  for (var i = 0; i < n; i++) {
    var row = Math.floor(i / bestCols);
    var col = i % bestCols;
    // The last row may be short; center it on its own.
    var inRow = (row === bestRows - 1) ? n - bestCols * (bestRows - 1) : bestCols;
    var rowW = inRow * bestW + (inRow - 1) * g;
    var left = Math.max(0, Math.floor((availW - rowW) / 2));
    cells.push({x: left + col * (bestW + g), y: top + row * (cardH + g)});
  }
  return {cols: bestCols, rows: bestRows, cardW: bestW, boxH: boxH, cardH: cardH, cells: cells};
}

// ---- keyboard navigation ---------------------------------------------------

function rectOf(win) {
  var r = (isObj(win) && isObj(win.rect)) ? win.rect : {};
  return {x: num(r.x, 0), y: num(r.y, 0)};
}

// Every window across all cards in reading order (for Tab): cards in array
// order, and within a card top-to-bottom then left-to-right. `win` indexes
// card.windows, which is in render order, not reading order.
function flattenWindows(cards) {
  var out = [];
  var list = asList(cards);
  for (var ci = 0; ci < list.length; ci++) {
    var wins = isObj(list[ci]) ? asList(list[ci].windows) : [];
    var entries = [];
    for (var wi = 0; wi < wins.length; wi++) {
      var address = isObj(wins[wi]) ? normalizeAddress(wins[wi].address) : "";
      if (address === "") continue;
      var r = rectOf(wins[wi]);
      entries.push({win: wi, address: address, x: r.x, y: r.y});
    }
    entries.sort(function (a, b) {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      if (a.address === b.address) return a.win - b.win;
      return a.address < b.address ? -1 : 1;
    });
    for (var k = 0; k < entries.length; k++) {
      out.push({card: ci, win: entries[k].win, address: entries[k].address});
    }
  }
  return out;
}

function initialIndex(flat, activeAddress) {
  var list = asList(flat);
  if (list.length === 0) return -1;
  var target = normalizeAddress(activeAddress);
  if (target === "") return 0;
  for (var i = 0; i < list.length; i++) {
    if (isObj(list[i]) && normalizeAddress(list[i].address) === target) return i;
  }
  return 0;
}

// Nearest point strictly in `dir` (more than 1 px away along that axis).
// Sideways offset counts double, so a window straight ahead beats a closer
// one off to the side. Ties go to the lower index; no candidate stays put.
function navigate(points, fromIndex, dir) {
  var list = asList(points);
  if (list.length === 0) return -1;
  if (!isInt(fromIndex) || fromIndex < 0 || fromIndex >= list.length) return 0;
  var from = list[fromIndex];
  if (!isObj(from) || !isNum(from.x) || !isNum(from.y)) return fromIndex;
  var best = -1;
  var bestScore = Infinity;
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (i === fromIndex || !isObj(p) || !isNum(p.x) || !isNum(p.y)) continue;
    var dx = p.x - from.x;
    var dy = p.y - from.y;
    var primary;
    var secondary;
    if (dir === "left" && dx < -1) { primary = dx; secondary = dy; }
    else if (dir === "right" && dx > 1) { primary = dx; secondary = dy; }
    else if (dir === "up" && dy < -1) { primary = dy; secondary = dx; }
    else if (dir === "down" && dy > 1) { primary = dy; secondary = dx; }
    else continue;
    var score = Math.abs(primary) + 2 * Math.abs(secondary);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best === -1 ? fromIndex : best;
}

// Tab / Shift+Tab: wraps around. With nothing highlighted (-1 or out of
// range) forward starts at the first item and backward at the last; a zero
// step then lands on the first, so any count > 0 yields a valid index.
function stepIndex(count, fromIndex, delta) {
  if (!isNum(count) || count < 1) return -1;
  var n = Math.floor(count);
  var d = num(delta, 0);
  d = d < 0 ? Math.ceil(d) : Math.floor(d);
  if (!isInt(fromIndex) || fromIndex < 0 || fromIndex >= n) return d < 0 ? n - 1 : 0;
  return (((fromIndex + d) % n) + n) % n;
}

// ---- dispatch strings ------------------------------------------------------
// Built only from a normalized hex address or an integer id, never from a
// title or class, so nothing a window controls can reach the compositor.

function focusWindowCmd(address, usingLua) {
  var a = normalizeAddress(address);
  if (a === "") return "";
  return usingLua ? "hl.dsp.focus({ window = \"address:" + a + "\" })" : "focuswindow address:" + a;
}

function focusWorkspaceCmd(id, usingLua) {
  if (!isInt(id) || id < 1 || id > MAX_WORKSPACE_ID) return "";
  var n = String(id);
  return usingLua ? "hl.dsp.focus({ workspace = \"" + n + "\" })" : "workspace " + n;
}

function mostRecentWindow(card) {
  var wins = isObj(card) ? asList(card.windows) : [];
  var best = null;
  var bestId = Infinity;
  for (var i = 0; i < wins.length; i++) {
    if (!isObj(wins[i])) continue;
    var id = num(wins[i].focusHistoryID, NO_FOCUS_HISTORY);
    if (best === null || id < bestId) {
      best = wins[i];
      bestId = id;
    }
  }
  return best;
}

// Click on a card's empty space. Numbered workspaces switch by id; special
// and named ones focus their most recent window instead (focusing a
// scratchpad window is what opens the scratchpad).
function cardActivationCmd(card, usingLua) {
  if (!isObj(card)) return "";
  if (!card.special && isNumberedWorkspace(card)) return focusWorkspaceCmd(card.id, usingLua);
  var win = mostRecentWindow(card);
  return win ? focusWindowCmd(win.address, usingLua) : "";
}
