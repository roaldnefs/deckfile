// The copies of the engine and theme in this repo must match their sources in src/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = f => readFileSync(path.join(root, f), 'utf8');
const TEMPLATES = ['template.html', 'skills/deck/assets/template.html'];

test('the templates carry the current engine', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'bin/deckfile.mjs'), 'update', '--check', ...TEMPLATES],
    { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('the skill ships the same template', () => {
  assert.equal(read(TEMPLATES[1]), read(TEMPLATES[0]));
});

test('the template theme is src/theme.css', () => {
  const theme = read('template.html').match(/<style data-deck="theme">\n([\s\S]*?)<\/style>/);
  assert.ok(theme, 'no <style data-deck="theme"> block');
  assert.equal(theme[1], read('src/theme.css'));
});

test('the template shows everything in the theme: no class is left without a slide', () => {
  const css = read('src/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set([...css.matchAll(/([^{}]+)\{/g)].flatMap(m => [...m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)].map(c => c[1])));
  const html = read('template.html');
  const slides = html.slice(html.indexOf('<div id="stage">\n'), html.indexOf('<script data-deck="engine">\n'));
  const used = new Set([...slides.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)));
  // the engine sets these itself
  for (const c of ['current', 'on', 'counter']) used.add(c);
  assert.deepEqual([...classes].filter(c => !used.has(c)), []);
});

test('the engine can be inlined: no closing tag or comment opening inside it', () => {
  assert.doesNotMatch(read('src/deck.js'), /<\/script|<!--/i);
  assert.doesNotMatch(read('src/deck.css'), /<\/style/i);
});

test('every version number matches package.json', () => {
  const { version } = JSON.parse(read('package.json'));
  for (const f of ['src/deck.js', 'src/deck.css']) assert.match(read(f), new RegExp(`^/\\*! deckfile v${version.replace(/\./g, '\\.')} `), f);
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, version);
});
