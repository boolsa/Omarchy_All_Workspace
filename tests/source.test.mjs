import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readSource} from './load.mjs';

const root = new URL('..', import.meta.url).pathname;

// Blank out comments and string literals so the syntax rules below only see
// code: a comment that says "don't use `const`" must not trip them.
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g,
    m => (m[0] === '/' ? '' : '""'));
}

// Model.js is executed by the QML JS engine, so it must stay in the
// conservative dialect: `.pragma library` first, `var` + `function` only.
test('Model.js starts with .pragma library', () => {
  const firstLine = readSource().split('\n')[0];
  assert.equal(firstLine, '.pragma library');
});

test('Model.js avoids modern syntax the QML engine may reject', () => {
  const code = codeOnly(readSource());
  const banned = {
    'const': /\bconst\s/,
    'let': /\blet\s/,
    'arrow function': /=>/,
    'template literal': /`/,
    'optional chaining': /\?\.(?!\d)/,
    'nullish coalescing': /\?\?/,
    'spread/rest': /\.\.\./,
    'class': /\bclass\s/,
    'for...of': /\bfor\s*\([^)]*\sof\s/,
    'destructuring': /\bvar\s*[[{]/,
    'default parameter': /\bfunction\s*\w*\s*\([^)]*=/,
  };
  for (const [name, re] of Object.entries(banned)) {
    const hit = code.match(re);
    assert.equal(hit, null, 'Model.js uses ' + name + (hit ? ': ' + JSON.stringify(hit[0]) : ''));
  }
});

test('Model.js uses two-space indentation', () => {
  const lines = readSource().split('\n');
  lines.forEach((line, i) => {
    assert.ok(!/^\t/.test(line), 'tab indent on line ' + (i + 1));
    const indent = line.match(/^ */)[0].length;
    assert.equal(indent % 2, 0, 'odd indent on line ' + (i + 1));
  });
});

// ---- QML rules (skip while the QML does not exist yet) ---------------------

const qmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.qml')).map(f => path.join(root, f));
const noQml = qmlFiles.length === 0 ? 'no .qml files yet' : false;

function qmlSource(f) {
  // Comments may mention colors or commands; only code counts.
  return fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const NAMED_COLORS = ['red', 'green', 'blue', 'white', 'black', 'gray', 'grey', 'yellow', 'orange', 'purple',
  'pink', 'cyan', 'magenta', 'lime', 'navy', 'teal', 'maroon', 'olive', 'silver', 'gold', 'brown'];

test('QML has no hex color literals', {skip: noQml}, () => {
  for (const f of qmlFiles) {
    const hex = qmlSource(f).match(/["']#[0-9a-fA-F]{3,8}["']/g) || [];
    assert.deepEqual(hex, [], path.basename(f) + ' hardcodes colors; use Color.* tokens');
  }
});

test('QML has no named color literals', {skip: noQml}, () => {
  const re = new RegExp('["\'](' + NAMED_COLORS.join('|') + ')["\']', 'gi');
  for (const f of qmlFiles) {
    const named = qmlSource(f).match(re) || [];
    assert.deepEqual(named, [], path.basename(f) + ' hardcodes named colors; use Color.* tokens');
  }
});

test('QML never uses the legacy-only hyprctl focuswindow dispatch', {skip: noQml}, () => {
  // `hyprctl dispatch focuswindow …` fails on Hyprland 0.55+ in Lua mode;
  // dispatch strings come from Model.focusWindowCmd(…, Hyprland.usingLua).
  for (const f of qmlFiles) {
    const src = qmlSource(f);
    assert.equal(/hyprctl["',\s]+dispatch["',\s]+focuswindow/.test(src), false,
      path.basename(f) + ' uses the legacy hyprctl focuswindow dispatch');
  }
});

const overviewPath = path.join(root, 'Overview.qml');
const noOverview = fs.existsSync(overviewPath) ? false : 'Overview.qml does not exist yet';

test('Overview.qml explicitly ignores screencast events if it listens to rawEvent', {skip: noOverview}, () => {
  // Every capture fires screencast/screencastv2; rebuilding on them loops
  // into a refresh storm (end-4 dots #3631).
  const src = qmlSource(overviewPath);
  if (!src.includes('rawEvent')) return;
  assert.ok(src.includes('screencast'), 'Overview.qml handles rawEvent but never mentions screencast');
});
