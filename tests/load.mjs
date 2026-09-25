// Loads Model.js the way the QML engine would (minus the `.pragma library`
// directive, which is not JavaScript) and returns the vm context so tests can
// call the exported functions directly.
import fs from 'node:fs';
import vm from 'node:vm';

export const modelPath = new URL('../Model.js', import.meta.url);

export function readSource() {
  return fs.readFileSync(modelPath, 'utf8');
}

export function loadModel() {
  const source = readSource();
  const body = source.replace(/^\.pragma library[^\n]*\n/, '');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(body, ctx, {filename: 'Model.js'});
  return ctx;
}

export function fixture(name) {
  return fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
}

export function fixtureJson(name) {
  return JSON.parse(fixture(name));
}
