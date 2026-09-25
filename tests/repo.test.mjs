import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// Repo-wide regressions that don't belong to any one module: the manifest
// contract the Omarchy shell loads us by, the deploy rules (no symlinks), and
// the privacy gate on fixtures (window titles are scrubbed by
// scripts/capture-fixtures.sh; this test keeps them that way).

const root = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    out.push({ full, entry });
    if (entry.isDirectory()) walk(full, out);
  }
  return out;
}

function readManifest() {
  const file = path.join(root, 'manifest.json');
  assert.ok(fs.existsSync(file), 'manifest.json missing');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('manifest.json parses and declares schemaVersion 1', () => {
  const m = readManifest();
  assert.equal(m.schemaVersion, 1);
});

test('manifest id is a valid third-party plugin id', () => {
  const m = readManifest();
  assert.equal(m.id, 'boolsa.overview');
  assert.match(m.id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.equal(/^omarchy\./i.test(m.id), false, 'the omarchy.* namespace is reserved for first-party plugins');
});

test('manifest declares the overlay and bar-widget kinds and stays loaded', () => {
  const m = readManifest();
  assert.ok(Array.isArray(m.kinds), 'kinds is an array');
  assert.ok(m.kinds.includes('overlay'), 'kinds includes overlay');
  assert.ok(m.kinds.includes('bar-widget'), 'kinds includes bar-widget');
  // Load on demand: a keepLoaded overlay survives hot reload as a stale cached
  // component, so saved changes never appear (see plan.md).
  assert.notEqual(m.keepLoaded, true);
});

test('manifest entry points are relative paths to files that exist', () => {
  const m = readManifest();
  assert.ok(m.entryPoints && typeof m.entryPoints === 'object', 'entryPoints object');
  for (const key of ['overlay', 'barWidget']) {
    const rel = m.entryPoints[key];
    assert.equal(typeof rel, 'string', 'entryPoints.' + key);
    assert.ok(rel.length > 0, 'entryPoints.' + key + ' is non-empty');
    assert.equal(path.isAbsolute(rel), false, 'entryPoints.' + key + ' must be relative');
    assert.equal(rel.split(/[\\/]/).includes('..'), false, 'entryPoints.' + key + ' must not climb out with ..');
    assert.ok(fs.existsSync(path.join(root, rel)), 'entryPoints.' + key + ' -> ' + rel + ' exists');
  }
});

test('no symlinks anywhere in the repo', () => {
  // The shell's inotify watcher doesn't follow symlinks and
  // omarchy-plugin-validate rejects them.
  const links = walk(root).filter(({ entry }) => entry.isSymbolicLink()).map(({ full }) => path.relative(root, full));
  assert.deepEqual(links, []);
});

test('.gitignore is present and ignores local-only files', () => {
  const file = path.join(root, '.gitignore');
  assert.ok(fs.existsSync(file), '.gitignore missing');
  const lines = fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim());
  for (const pattern of ['node_modules/', '*.log', '.claude/settings.local.json']) {
    assert.ok(lines.includes(pattern), '.gitignore lists ' + pattern);
  }
});

test('capture-fixtures.sh exists and is executable', () => {
  const file = path.join(root, 'scripts', 'capture-fixtures.sh');
  assert.ok(fs.existsSync(file), 'scripts/capture-fixtures.sh missing');
  assert.ok(fs.statSync(file).mode & 0o111, 'scripts/capture-fixtures.sh is not executable');
});

// ---- fixture privacy -------------------------------------------------------

const fixtureDir = path.join(root, 'tests', 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('real fixtures exist', () => {
  for (const name of ['clients.json', 'workspaces.json', 'monitors.json']) {
    assert.ok(fs.existsSync(path.join(fixtureDir, name)), name + ' missing; run scripts/capture-fixtures.sh');
    assert.ok(Array.isArray(loadFixture(name)), name + ' is a hyprctl -j array');
  }
});

test('client fixtures carry no real titles, pids or xdg/tag metadata', () => {
  const files = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const doc = loadFixture(f);
    const clients = Array.isArray(doc) ? (f === 'clients.json' ? doc : []) : (doc.clients || []);
    for (const c of clients) {
      if (!c || typeof c !== 'object') continue;
      const cls = c.class || 'app';
      for (const key of ['title', 'initialTitle']) {
        if (key in c) assert.equal(c[key], cls + ' window', f + ': ' + key + ' of ' + c.address + ' is not scrubbed');
      }
      for (const key of ['pid', 'xdgTag', 'xdgDescription', 'tags']) {
        assert.equal(key in c, false, f + ': ' + c.address + ' still has ' + key);
      }
    }
  }
});

test('workspace fixtures carry no last-window titles', () => {
  const files = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const doc = loadFixture(f);
    const workspaces = Array.isArray(doc) ? (f === 'workspaces.json' ? doc : []) : (doc.workspaces || []);
    for (const ws of workspaces) {
      if (!ws || typeof ws !== 'object' || !('lastwindowtitle' in ws)) continue;
      assert.equal(ws.lastwindowtitle, '', f + ': workspace ' + ws.id + ' leaks its last window title');
    }
  }
});
