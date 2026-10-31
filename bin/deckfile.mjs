#!/usr/bin/env node
// deckfile update [--check] <deck.html>...
// Replaces the engine blocks of each deck, <style data-deck="engine"> and <script data-deck="engine">, with this
// version's src/deck.css and src/deck.js. Nothing else in the deck changes: the theme and the slides are yours.
// Exit status: 0 when every deck is (now) up to date, 1 when --check found one out of date, 2 on an error.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = name => readFileSync(fileURLToPath(new URL('../src/' + name, import.meta.url)), 'utf8');
// each pattern also matches HTML comments, which are kept as they are: a comment may well mention the tags
const BLOCKS = [
  { tag: '<style data-deck="engine">', re: /<!--[\s\S]*?-->|(<style\b[^>]*\bdata-deck="engine"[^>]*>)[\s\S]*?(<\/style>)/g, body: src('deck.css') },
  { tag: '<script data-deck="engine">', re: /<!--[\s\S]*?-->|(<script\b[^>]*\bdata-deck="engine"[^>]*>)[\s\S]*?(<\/script>)/g, body: src('deck.js') },
];

const [cmd, ...rest] = process.argv.slice(2);
const check = rest.includes('--check');
const files = rest.filter(a => a !== '--check');
if (cmd !== 'update' || !files.length) {
  console.error('Usage: deckfile update [--check] <deck.html>...\n\n' +
    'Puts this version of the engine into each deck, between its <style data-deck="engine"> and\n' +
    '<script data-deck="engine"> tags. With --check, writes nothing and exits 1 if a deck is out of date.');
  process.exit(2);
}

let stale = 0, failed = 0;
for (const file of files) {
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`${file}: ${e.message}`);
    failed++;
    continue;
  }
  let out = html;
  const missing = [];
  for (const { tag, re, body } of BLOCKS) {
    let found = false;
    // a function, so a $ in the engine is not read as a replacement pattern
    out = out.replace(re, (all, open, close) => {
      if (!open) return all;
      found = true;
      return open + '\n' + body + close;
    });
    if (!found) missing.push(tag);
  }
  if (missing.length) {
    console.error(`${file}: no ${missing.join(' or ')} block; see "Updating" in the deckfile README`);
    failed++;
  } else if (out === html) {
    console.log(`${file}: up to date`);
  } else if (check) {
    console.log(`${file}: out of date`);
    stale++;
  } else {
    writeFileSync(file, out);
    console.log(`${file}: updated`);
  }
}
process.exit(failed ? 2 : stale ? 1 : 0);
