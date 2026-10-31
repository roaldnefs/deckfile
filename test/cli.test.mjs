// Tests for `deckfile update`: it swaps the engine blocks of a deck for src/ and leaves everything else alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const css = readFileSync(path.join(root, 'src/deck.css'), 'utf8');
const js = readFileSync(path.join(root, 'src/deck.js'), 'utf8');
const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/deckfile.mjs'), ...args], { encoding: 'utf8' });

const OLD = `<!doctype html>
<html><head>
<!-- the engine lives in <style data-deck="engine"> and <script data-deck="engine">; see </style> and </script> -->
<style data-deck="engine">
/* an old engine */
</style>
<style data-deck="theme">:root{--primary:#123456}</style>
</head><body>
<div id="stage"><section class="slide">One</section></div>
<script data-deck="engine">
/* an old engine */
</script>
<script>/* the deck's own */ document.title = '$& $1';</script>
</body></html>
`;
function deck(html = OLD) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deckfile-')), 'deck.html');
  writeFileSync(file, html);
  return file;
}
// the engine as update writes it, between the tags
const updated = OLD
  .replace('<style data-deck="engine">\n/* an old engine */\n</style>', `<style data-deck="engine">\n${css}</style>`)
  .replace('<script data-deck="engine">\n/* an old engine */\n</script>', `<script data-deck="engine">\n${js}</script>`);

test('update puts this engine in the engine blocks and leaves the rest alone', () => {
  const file = deck();
  const r = run('update', file);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /updated/);
  assert.equal(readFileSync(file, 'utf8'), updated);
});

test('update is idempotent', () => {
  const file = deck(updated);
  const r = run('update', file);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /up to date/);
  assert.equal(readFileSync(file, 'utf8'), updated);
});

test('--check writes nothing and exits 1 for a deck that is out of date', () => {
  const file = deck();
  const r = run('update', '--check', file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /out of date/);
  assert.equal(readFileSync(file, 'utf8'), OLD);
  assert.equal(run('update', '--check', deck(updated)).status, 0);
});

test('a deck without engine blocks is an error, and stays as it was', () => {
  const html = OLD.replace('<script data-deck="engine">\n', '<script>\n');
  const file = deck(html);
  const r = run('update', file);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no <script data-deck="engine"> block/);
  assert.equal(readFileSync(file, 'utf8'), html);
});

test('other decks are still updated when one fails', () => {
  const good = deck(), bad = deck('<p>not a deck</p>');
  const r = run('update', good, bad, path.join(path.dirname(good), 'missing.html'));
  assert.equal(r.status, 2);
  assert.equal(readFileSync(good, 'utf8'), updated);
});

test('without a command or a file it prints the usage', () => {
  for (const args of [[], ['update'], ['upgrade', 'deck.html']]) {
    const r = run(...args);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^Usage: deckfile update/);
  }
});
