// End-to-end tests for the engine, run against a deck opened from file://.
// The deck is template.html unless DECK names another one, so the same suite can check any deck built on the engine.
// Every test runs offline: requests that are not file:// are aborted, as on a laptop without Wi-Fi.
import { test as base, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const deck = path.resolve(process.env.DECK || 'template.html');
const url = pathToFileURL(deck).href;
// the name the edit prompt gives the deck
const fileName = path.basename(deck) === 'index.html' ? path.basename(path.dirname(deck)) + '/index.html' : path.basename(deck);

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/^https?:/, r => r.abort());
    await page.goto(url);
    await use(page);
    expect(errors).toEqual([]);
  },
});

const current = page => page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex(s => s.classList.contains('current')));
const builtOn = page => page.locator('.slide.current .build.on').count();
// the slides, and the first slides that exercise manual builds, timed builds and a layout of their own
async function info(page) {
  const slides = await page.evaluate(() => [...document.querySelectorAll('.slide')].map(s => ({
    builds: s.querySelectorAll('.build').length,
    auto: s.dataset.auto === undefined ? null : +s.dataset.auto || 500,
    divider: s.classList.contains('divider'),
  })));
  const manual = slides.findIndex((s, k) => k > 0 && s.builds >= 2 && s.auto === null && slides[k + 1] && slides[k + 1].auto === null);
  const auto = slides.findIndex(s => s.builds >= 2 && s.auto !== null);
  return { slides, n: slides.length, manual, auto, divider: slides.findIndex(s => s.divider) };
}
async function centre(page, selector) {
  const b = await page.locator(selector).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
// open slide n as a reload lands on it: the engine keeps the current slide in sessionStorage
async function goTo(page, n) {
  await page.evaluate(n => sessionStorage.setItem('deck:' + location.pathname, n), n);
  await page.reload();
  expect(await current(page)).toBe(n);
}

test('opens on the first slide, numbered', async ({ page }) => {
  const { n } = await info(page);
  expect(await current(page)).toBe(0);
  await expect(page.locator('.slide.current .counter')).toHaveText(`1 / ${n}`);
});

test('→ reveals the builds one at a time, then moves to the next slide', async ({ page }) => {
  const { slides, manual } = await info(page);
  expect(manual).toBeGreaterThan(0);
  await goTo(page, manual);
  expect(await builtOn(page)).toBe(0);
  for (let k = 1; k <= slides[manual].builds; k++) {
    await page.keyboard.press('ArrowRight');
    expect(await builtOn(page)).toBe(k);
  }
  await page.keyboard.press('Space');
  expect(await current(page)).toBe(manual + 1);
});

test('← undoes builds, then goes back to the previous slide fully built', async ({ page }) => {
  const { slides, manual } = await info(page);
  await goTo(page, manual);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  expect(await builtOn(page)).toBe(1);
  await goTo(page, manual + 1);
  await page.keyboard.press('ArrowLeft');
  expect(await current(page)).toBe(manual);
  expect(await builtOn(page)).toBe(slides[manual].builds);
});

test('↓ and ↑ skip whole slides with every build shown; Home and End jump to the ends', async ({ page }) => {
  const { slides, n, manual } = await info(page);
  await goTo(page, manual - 1);
  await page.keyboard.press('ArrowDown');
  expect(await current(page)).toBe(manual);
  expect(await builtOn(page)).toBe(slides[manual].builds);
  await page.keyboard.press('ArrowUp');
  expect(await current(page)).toBe(manual - 1);
  await page.keyboard.press('End');
  expect(await current(page)).toBe(n - 1);
  await page.keyboard.press('Home');
  expect(await current(page)).toBe(0);
});

test('data-auto reveals the builds by themselves, and a key takes over', async ({ page }) => {
  const { slides, auto } = await info(page);
  expect(auto).toBeGreaterThanOrEqual(0);
  const { builds, auto: delay } = slides[auto];
  await page.clock.install();
  await goTo(page, auto);
  expect(await builtOn(page)).toBe(0);
  await page.clock.runFor(delay);
  expect(await builtOn(page)).toBe(1);
  await page.clock.runFor(delay * (builds - 1));
  expect(await builtOn(page)).toBe(builds);

  await goTo(page, auto);
  await page.clock.runFor(delay);
  await page.keyboard.press('ArrowLeft');
  expect(await builtOn(page)).toBe(0);
  await page.clock.runFor(delay * builds * 2);
  expect(await builtOn(page)).toBe(0);
});

test('a reload lands on the same slide', async ({ page }) => {
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.reload();
  expect(await current(page)).toBe(2);
});

test('only the current slide shows, each in its own layout', async ({ page }) => {
  const { n, divider } = await info(page);
  for (let k = 0; k < n; k++) {
    const shown = await page.evaluate(() => [...document.querySelectorAll('.slide')]
      .map((s, k) => getComputedStyle(s).display !== 'none' ? k : -1).filter(k => k >= 0));
    expect(shown).toEqual([k]);
    if (k === divider) expect(await page.locator('.slide.current').evaluate(s => getComputedStyle(s).display)).toBe('flex');
    await page.keyboard.press('ArrowDown');
  }
});

test('the slide view has no notes or timer of its own: those are in the presenter view', async ({ page }) => {
  await expect(page.locator('#notes')).toBeHidden();
  await expect(page.locator('#timer')).toHaveCount(0);
  for (const key of ['n', 'N', 't', 'T', 'Escape']) {
    await page.keyboard.press(key);
    await expect(page.locator('#notes')).toBeHidden();
    await expect(page.locator('#timer')).toHaveCount(0);
    expect(await current(page)).toBe(0);
  }
});

test('keys leave the notes and timer of the presenter view in place', async ({ page }) => {
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-count')).toBeVisible();
  for (const key of ['Escape', 'n', 't', 'T']) {
    await pv.keyboard.press(key);
    await expect(pv.locator('#notes')).toBeVisible();
    await expect(pv.locator('#timer')).toBeVisible();
  }
  await expect(pv.locator('#timer')).toHaveText('00:00');
  const own = await page.locator('.slide.current .s-notes').evaluate(n => n.textContent.trim().slice(0, 40));
  await expect(pv.locator('#notes')).toContainText(own);
});

test('a click on the right goes forward, on the left back', async ({ page }) => {
  const vw = page.viewportSize().width;
  await page.mouse.click(vw * 0.9, 200);
  expect(await current(page)).toBe(1);
  await page.mouse.click(vw * 0.1, 200);
  expect(await current(page)).toBe(0);
});

test('print shows every slide with all builds, one page per slide', async ({ page }) => {
  const { n } = await info(page);
  await page.emulateMedia({ media: 'print' });
  const state = await page.evaluate(() => ({
    hidden: [...document.querySelectorAll('.slide')].filter(s => getComputedStyle(s).display === 'none').length,
    faint: [...document.querySelectorAll('.build')].filter(b => getComputedStyle(b).opacity !== '1').length,
  }));
  expect(state).toEqual({ hidden: 0, faint: 0 });
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
  expect(pdf.match(/\/Type\s*\/Page\b(?!s)/g)).toHaveLength(n);
});

test('the only network request is the Google Fonts stylesheet', async ({ page }) => {
  const remote = [];
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) remote.push(new URL(r.url()).host); });
  await page.reload();
  await page.keyboard.press('End');
  expect([...new Set(remote)].filter(h => h !== 'fonts.googleapis.com')).toEqual([]);
});

test('S opens the presenter view, which mirrors and steers the deck', async ({ page }) => {
  const { slides, n, manual } = await info(page);
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  expect(pv.url()).toContain('?presenter');
  await expect(pv.locator('.p-count')).toHaveText(`Slide 1 of ${n}`);
  await expect(pv.locator('.p-link')).toBeHidden();
  await expect(pv.locator('.p-label')).toHaveText('Next slide');
  for (let k = 0; k < manual; k++) await pv.keyboard.press('ArrowDown');
  await expect(pv.locator('.p-count')).toHaveText(`Slide ${manual + 1} of ${n}`);
  expect(await current(page)).toBe(manual);
  await pv.keyboard.press('ArrowLeft');
  await expect(pv.locator('.p-label')).toHaveText('Next build');
  await expect(pv.locator('.p-left')).toHaveText('1 build left on this slide');
  expect(await builtOn(page)).toBe(slides[manual].builds - 1);
  await expect(pv.locator('#notes')).toBeVisible();
});

test('the presenter view is laid out like PowerPoint, and its buttons steer the deck', async ({ page }) => {
  const { n, manual } = await info(page);
  await goTo(page, manual + 1);
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-count')).toHaveText(`Slide ${manual + 2} of ${n}`);

  // the current slide on the left; the next slide and the notes on the right, one above the other
  const cur = await pv.locator('.p-slide').boundingBox();
  const next = await pv.locator('.p-next').boundingBox();
  const note = await pv.locator('#notes').boundingBox();
  expect(next.x).toBeGreaterThanOrEqual(cur.x + cur.width);
  expect(note.x).toBeGreaterThanOrEqual(cur.x + cur.width);
  expect(note.y).toBeGreaterThanOrEqual(next.y + next.height);
  const size = await pv.viewportSize();
  expect(note.y + note.height).toBeLessThanOrEqual(size.height);

  // slides keep 16:9 inside their panes
  const frame = await pv.locator('.p-slide iframe').boundingBox();
  expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(.02);

  await pv.locator('.p-back').click();
  await expect.poll(() => current(page)).toBe(manual);
  await pv.keyboard.press('ArrowUp');  // the button took no focus: the keys still steer
  await expect.poll(() => current(page)).toBe(manual - 1);
  await pv.keyboard.press('ArrowDown');
  await expect.poll(() => current(page)).toBe(manual);
  const on = await builtOn(page);
  await pv.keyboard.press('ArrowLeft');
  await expect.poll(() => builtOn(page)).toBe(on - 1);
  await pv.locator('.p-fwd').click();
  await expect.poll(() => builtOn(page)).toBe(on);
  await expect(pv.locator('.p-link')).toBeHidden();
});

test('the bars between the presenter panes resize them, and a double-click resets', async ({ page }) => {
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-count')).toBeVisible();
  const drag = async (selector, dx, dy) => {
    const c = await centre(pv, selector);
    await pv.mouse.move(c.x, c.y);
    await pv.mouse.down();
    await pv.mouse.move(c.x + dx, c.y + dy, { steps: 3 });
    await pv.mouse.up();
  };
  const height = async () => (await pv.locator('.p-next').boundingBox()).height;
  const width = async () => (await pv.locator('.p-slide').boundingBox()).width;

  const h = await height();
  await drag('.p-hbar', 0, 100);
  expect(Math.abs(await height() - h - 100)).toBeLessThan(4);  // the bar follows the pointer
  await expect(pv.locator('#notes')).toBeVisible();
  const frame = await pv.locator('.p-next iframe').boundingBox();
  expect(Math.abs(frame.width / frame.height - 16 / 9)).toBeLessThan(.02);
  await pv.locator('.p-hbar').dblclick();
  expect(Math.abs(await height() - h)).toBeLessThan(2);

  const w = await width();
  await drag('.p-vbar', -100, 0);
  expect(Math.abs(await width() - w + 100)).toBeLessThan(4);
  await pv.locator('.p-vbar').dblclick();
  expect(Math.abs(await width() - w)).toBeLessThan(2);
});

test('the presenter timer pauses, resumes and resets', async ({ page }) => {
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  const timer = pv.locator('#timer');
  await expect(timer).toHaveText('00:00');
  await pv.locator('.p-pause').click();  // not started yet: this starts it
  await expect(timer).toHaveText('00:01', { timeout: 3000 });
  await pv.locator('.p-pause').click();
  const held = await timer.textContent();
  await pv.waitForTimeout(1600);
  await expect(timer).toHaveText(held);
  await pv.locator('.p-pause').click();
  await expect(timer).not.toHaveText(held, { timeout: 3000 });
  await pv.locator('.p-reset').click();
  await expect(timer).toHaveText('00:00');
});

// a point on the background of the current slide, in window coordinates
const emptySpot = page => page.evaluate(() => {
  const slide = document.querySelector('.slide.current'), r = slide.getBoundingClientRect();
  for (let y = r.top + 4; y < r.bottom; y += 16) for (let x = r.left + 4; x < r.right; x += 16)
    if (document.elementsFromPoint(x, y).find(e => slide.contains(e)) === slide) return { x, y };
});
const HEADING = '.slide.current :is(h1, h2)';
// the edit view, in the mode where a click on the slide suggests a change
async function openSuggest(page) {
  await page.keyboard.press('e');
  await page.locator('.e-mode-suggest').click();
}

test('E selects elements, pins and boxes suggestions, keeps them, and copies them as one prompt', async ({ page }) => {
  await openSuggest(page);
  await expect(page.locator('#edit')).toBeVisible();
  const layer = page.locator('#edit-layer');
  const tag = await page.locator(HEADING).first().evaluate(h => h.tagName.toLowerCase());

  // a click on an element selects it, and the box that opens names it
  const c = await centre(page, HEADING);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#edit-ask')).toBeVisible();
  await expect(page.locator('.e-ask-path')).toContainText(`Slide 1`);
  await expect(page.locator('.e-ask-path')).toContainText(`› ${tag}`);
  await page.keyboard.type('Make the heading shorter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#edit-ask')).toBeHidden();

  // a click on the background pins that spot
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await expect(page.locator('.e-ask-path')).toContainText('› point');
  await page.keyboard.type('Add a logo here');
  await page.keyboard.press('Enter');

  const box = await layer.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.type('Tighten this area');
  await page.keyboard.press('Enter');
  await expect(page.locator('.e-item .e-note')).toHaveCount(3);
  await expect(page.locator('.e-item .e-note')).toContainText(['Make the heading shorter', 'Add a logo here', 'Tighten this area']);
  await expect(page.locator('.e-go')).toHaveText([/^Slide 1 · /]);

  // an empty suggestion is dropped when its box closes
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
  await expect(page.locator('.e-item')).toHaveCount(3);

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: t => { window.copied = t; return Promise.resolve(); } },
  }));
  await page.locator('.e-copy').click();
  await expect(page.locator('.e-copy')).toHaveText('Copied');
  const prompt = await page.evaluate(() => window.copied);
  expect(prompt).toContain('`' + fileName + '`');
  expect(prompt).toContain('## 1. Slide 1');
  expect(prompt).toContain('Suggestion: Make the heading shorter');
  expect(prompt).toMatch(new RegExp('Where: box x \\d+-\\d+, y \\d+-\\d+, on `' + tag));
  expect(prompt).toMatch(/Where: point x \d+, y \d+/);
  expect(prompt).not.toContain('```');  // the selector and the text find it; no copy of its HTML
  expect(prompt).not.toMatch(/e-hover|e-mark|edit-layer/);

  await page.reload();
  await expect(page.locator('.e-item')).toHaveCount(3);
  await page.keyboard.press('e');
  await expect(page.locator('#edit')).toBeHidden();
});

test('in edit mode the cursor outlines the element under it, in orange', async ({ page }) => {
  await openSuggest(page);
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));  // the title card has risen in
  const hover = page.locator('.e-hover');
  await expect(hover).toBeHidden();

  // on an element: the outline sits on that element
  const h = page.locator(HEADING).first();
  const c = await centre(page, HEADING);
  await page.mouse.move(c.x, c.y);
  await expect(hover).toBeVisible();
  const a = await hover.boundingBox(), b = await h.boundingBox();
  for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(a[k] - b[k])).toBeLessThan(2);
  expect(await hover.evaluate(e => getComputedStyle(e).borderTopColor)).toBe('rgb(255, 149, 0)');
  // the deck's own element is left untouched
  expect(await h.evaluate(e => e.className + (e.getAttribute('style') || ''))).not.toMatch(/e-/);

  // on the background: none
  const spot = await emptySpot(page);
  await page.mouse.move(spot.x, spot.y);
  await expect(hover).toBeHidden();

  // none while the box is open, and the selection keeps its outline
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('#edit-ask')).toBeVisible();
  await page.mouse.move(c.x + 5, c.y);
  await expect(hover).toBeHidden();
  await expect(page.locator('.e-marks .e-box')).toHaveCount(1);
});

test('the edit view has PowerPoint panes: thumbnails, slide, notes, status', async ({ page }) => {
  const { n } = await info(page);
  await page.keyboard.press('e');
  await expect(page.locator('#edit-bar')).toBeVisible();
  await expect(page.locator('#edit-rail')).toBeVisible();
  await expect(page.locator('.e-thumb')).toHaveCount(n);
  await expect(page.locator('.e-thumb.e-cur')).toHaveCount(1);
  await expect(page.locator('#edit-status')).toContainText(`Slide 1 of ${n}`);

  // a thumbnail shows its own slide, fully built, and a click goes there
  await page.locator('.e-thumb').nth(1).scrollIntoViewIfNeeded();
  const thumb = page.frameLocator('.e-thumb:nth-child(2) iframe');
  await expect.poll(() => thumb.locator('.slide.current .counter').textContent()).toBe(`2 / ${n}`);
  await page.locator('.e-thumb').nth(1).click();
  expect(await current(page)).toBe(1);
  await expect(page.locator('.e-thumb').nth(1)).toHaveClass(/e-cur/);
  await expect(page.locator('#edit-status')).toContainText(`Slide 2 of ${n}`);

  // the notes pane shows this slide's notes, and N or its button folds it
  const text = await page.evaluate(() => document.querySelector('.slide.current .s-notes')?.textContent.trim().slice(0, 20) || 'No notes');
  await expect(page.locator('#notes')).toBeVisible();
  await expect(page.locator('#notes')).toContainText(text);
  const before = await centre(page, '#stage');
  await page.keyboard.press('n');
  await expect(page.locator('#notes')).toBeHidden();
  expect((await centre(page, '#stage')).y).toBeGreaterThan(before.y);  // the slide takes the room the notes left
  await page.locator('.e-notes').click();
  await expect(page.locator('#notes')).toBeVisible();

  // leaving restores the slideshow: no chrome, the slide fills the window again
  await page.locator('.e-show').click();
  for (const id of ['#edit', '#edit-bar', '#edit-rail', '#edit-status', '#edit-layer', '#notes'])
    await expect(page.locator(id)).toBeHidden();
  const size = page.viewportSize(), s = await page.locator('#stage').boundingBox();
  expect(Math.abs(s.x + s.width / 2 - size.width / 2)).toBeLessThan(2);
  expect(Math.abs(s.y + s.height / 2 - size.height / 2)).toBeLessThan(2);
  expect(Math.max(s.width / size.width, s.height / size.height)).toBeCloseTo(1, 2);
});

test('in edit mode the slide fits between the panes at 1024x768', async ({ page }) => {
  const width = 1024, height = 768;
  await page.setViewportSize({ width, height });
  await page.keyboard.press('e');
  const box = sel => page.locator(sel).boundingBox();
  const check = async () => {
    const [s, rail, pane, bar, status] = await Promise.all(['#stage', '#edit-rail', '#edit', '#edit-bar', '#edit-status'].map(box));
    const bottom = await page.locator('#notes').isVisible() ? (await box('#notes')).y : status.y;
    expect(s.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(s.x + s.width).toBeLessThanOrEqual(pane.x);
    expect(s.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(s.y + s.height).toBeLessThanOrEqual(bottom);
    expect(Math.abs(s.width / s.height - 16 / 9)).toBeLessThan(.01);
  };
  await check();
  await page.keyboard.press('n');
  await check();
});

// the buttons of a part of the chrome that lack an icon or a name; A− / A+, the slide labels and the levels are text by design
const unmarked = (page, selector) => page.locator(selector).evaluateAll(all => all
  .filter(b => !b.matches('.p-size button, .e-go, .e-crumb') && !(b.querySelector('svg') && (b.getAttribute('aria-label') || b.textContent.trim())))
  .map(b => b.outerHTML.slice(0, 80)));

test('every button of the edit and presenter views has an icon and a name', async ({ page }) => {
  await openSuggest(page);
  const c = await centre(page, HEADING);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('A suggestion, so that its row has a button too');
  await page.keyboard.press('Enter');
  await expect(page.locator('.e-del')).toHaveCount(1);
  expect(await unmarked(page, '#edit-bar button, #edit-status button, #edit button, #edit-ask button')).toEqual([]);
  await expect(page.locator('.e-show svg')).toBeVisible();

  const [pv] = await Promise.all([page.waitForEvent('popup'), page.locator('.e-present').click()]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-fwd svg')).toBeVisible();
  expect(await unmarked(pv, '#presenter button')).toEqual([]);
});

test('near the bottom-left corner, the slide view shows buttons with the pencil in the middle', async ({ page }) => {
  const size = page.viewportSize();
  const controls = page.locator('#deck-controls');
  await expect(controls).toHaveCSS('opacity', '0');
  await expect(controls).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect(controls).toHaveCSS('opacity', '0');

  // close to the corner they appear, in this order, as icons with names
  await page.mouse.move(120, size.height - 60);
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(controls.locator('button')).toHaveCount(5);
  await expect(controls.locator('button svg')).toHaveCount(5);
  expect(await controls.locator('button').evaluateAll(all => all.map(b => b.getAttribute('aria-label')))).toEqual(['Back', 'Presenter view', 'Edit view', 'Keyboard shortcuts', 'Forward']);

  // forward and back step like the arrow keys, and leave the slide click alone
  const { slides, manual } = await info(page);
  await goTo(page, manual);
  await page.mouse.move(120, size.height - 60);
  await controls.locator('.c-fwd').click();
  expect(await builtOn(page)).toBe(1);
  expect(await current(page)).toBe(manual);
  await controls.locator('.c-back').click();
  expect(await builtOn(page)).toBe(0);
  expect(slides[manual].builds).toBeGreaterThan(1);
  await page.keyboard.press('ArrowRight');  // the buttons took no focus: the keys still steer
  expect(await builtOn(page)).toBe(1);

  // moving away hides them again
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect(controls).toHaveCSS('opacity', '0');

  // the pencil opens the edit view, where they are gone; leaving brings them back
  await page.mouse.move(120, size.height - 60);
  await controls.locator('.c-edit').click();
  await expect(page.locator('#edit')).toBeVisible();
  await expect(controls).toBeHidden();
  await page.keyboard.press('e');
  await expect(controls).toHaveCSS('opacity', '1');

  // the presenter button opens the presenter view
  const [pv] = await Promise.all([page.waitForEvent('popup'), controls.locator('.c-present').click()]);
  expect(pv.url()).toContain('?presenter');
});

test('the help button shows the shortcuts until they are dismissed', async ({ page }) => {
  const size = page.viewportSize();
  const controls = page.locator('#deck-controls'), help = page.locator('#deck-help'), button = page.locator('.c-help');
  await expect(help).toBeHidden();
  await page.mouse.move(120, size.height - 60);
  await button.click();
  await expect(help).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  for (const text of ['Next', 'Previous', 'Fullscreen', 'Print to PDF', 'Presenter view', 'Edit view'])
    await expect(help).toContainText(text);
  await expect(help).not.toContainText('Timer');
  await expect(help).not.toContainText('Speaker notes');
  // it fits in the window, and the theme's styling of keys and lists stays out of it
  const b = await help.boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(size.width);

  // it stays when the pointer moves away, and so do the buttons
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect(help).toBeVisible();
  await expect(controls).toHaveCSS('opacity', '1');

  // a click elsewhere only dismisses it: the deck does not advance
  await page.mouse.click(size.width * .9, 200);
  await expect(help).toBeHidden();
  expect(await current(page)).toBe(0);
  await expect(controls).toHaveCSS('opacity', '0');

  // the button toggles it, Esc closes it, and a click on it leaves it open
  await page.mouse.move(120, size.height - 60);
  await button.click();
  await help.click();
  await expect(help).toBeVisible();
  await button.click();
  await expect(help).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  // the arrows still steer with it open; the edit view closes it
  await button.click();
  await page.keyboard.press('ArrowDown');
  expect(await current(page)).toBe(1);
  await page.locator('.c-edit').click();
  await expect(help).toBeHidden();
  await page.keyboard.press('e');
  await expect(help).toBeHidden();
});

test('the corner buttons are only in the slide view: not in the presenter, its panes or print', async ({ page }) => {
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('s')]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-fwd')).toBeVisible();
  await expect(pv.locator('#deck-controls')).toHaveCount(0);
  await expect(pv.frameLocator('.p-slide iframe').locator('#deck-controls')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#deck-controls')).toBeHidden();
});

// suggest a change to the element under a selector of the current slide
async function suggest(page, selector, note) {
  const c = await centre(page, selector);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type(note);
  await page.keyboard.press('Enter');
}
const copied = async page => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: t => { window.copied = t; return Promise.resolve(); } },
  }));
  await page.locator('.e-copy').click();
  return page.evaluate(() => window.copied);
};
// reopen the saved suggestions on a changed copy of the deck, as after an agent has edited it
async function reopenChanged(page, change, edit = s => s) {
  const saved = await page.evaluate(() => localStorage.getItem('deck:edit:' + location.pathname));
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deck-')), path.basename(deck));
  writeFileSync(file, change(readFileSync(deck, 'utf8')));
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(s => localStorage.setItem('deck:edit:' + location.pathname, s), JSON.stringify(edit(JSON.parse(saved))));
  await page.reload();
  await openSuggest(page);
}
const near = (a, b) => { for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(a[k] - b[k])).toBeLessThan(2); };
const firstSlide = (html, section) => html.replace(/<div id="stage">\s*\n/, m => m + section);

test('the levels in the suggestion box widen and narrow the selection', async ({ page }) => {
  const { slides } = await info(page);
  const stats = await page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex(s => s.querySelector('.stat .n')));
  test.skip(stats < 0, 'this deck has no stat panels');
  await goTo(page, stats);
  await openSuggest(page);
  const c = await centre(page, '.slide.current .stat:first-child .n');
  await page.mouse.click(c.x, c.y);
  const crumbs = page.locator('.e-crumb'), at = page.locator('.e-crumb.e-at');
  await expect(at).toHaveText('span.n');
  await expect(crumbs).toHaveText([`Slide ${stats + 1}`, 'div.stats', 'div.stat', 'span.n']);

  // ↑ widens and ↓ narrows while the box is empty
  await page.keyboard.press('ArrowUp');
  await expect(at).toHaveText('div.stat');
  const mark = page.locator('.e-marks .e-box');
  near(await mark.boundingBox(), await page.locator('.slide.current .stat').first().boundingBox());
  await page.keyboard.press('ArrowDown');
  await expect(at).toHaveText('span.n');
  await expect(page.locator('#edit-ask textarea')).toBeFocused();

  // a click on a level selects it and leaves the note and the focus alone
  await page.keyboard.type('Make it bigger');
  await crumbs.filter({ hasText: /^div\.stat$/ }).click();
  await expect(page.locator('#edit-ask textarea')).toHaveValue('Make it bigger');
  await expect(page.locator('#edit-ask textarea')).toBeFocused();

  // once something is typed, ↑ moves the caret and the selection stays
  await page.keyboard.press('ArrowUp');
  await expect(at).toHaveText('div.stat');
  await page.keyboard.press('Enter');
  const prompt = await copied(page);
  expect(prompt).toContain('on `div.stat');
  expect(prompt).toContain('Suggestion: Make it bigger');
  await expect(page.locator('.e-item')).toHaveCount(1);

  // the slide itself is a level too
  await page.locator('.e-item').click();
  await crumbs.first().click();
  near(await mark.boundingBox(), await page.locator('#stage').boundingBox());
  expect(slides.length).toBeGreaterThan(stats);
});

test('a suggestion names its element with a selector that finds it', async ({ page }) => {
  await openSuggest(page);
  await suggest(page, HEADING, 'Shorter');
  const prompt = await copied(page);
  const selector = prompt.match(/Element: `([^`]+)`/)[1];
  expect(await page.evaluate(s => document.querySelector(s).tagName.toLowerCase(), selector)).toBe('h1');
  expect(selector).toMatch(/^#stage > section:nth-child\(1\) > /);
  expect(selector).not.toMatch(/current|\.on|e-/);
});

test('suggestions follow their element when the deck changes', async ({ page }) => {
  await openSuggest(page);
  await suggest(page, HEADING, 'Shorter');

  // a new slide in front: same element, one slide on
  await reopenChanged(page, html => firstSlide(html, '<section class="slide"><p>A new first slide</p></section>\n'));
  await expect(page.locator('.e-go')).toHaveText([/^Slide 2/]);
  await expect(page.locator('.e-changed')).toHaveCount(0);
  await page.locator('.e-go').click();
  near(await page.locator('.e-marks .e-box').boundingBox(), await page.locator(HEADING).first().boundingBox());
  expect((await copied(page))).toContain('section:nth-child(2)');

  // and something new above it on its slide: the outline stays on the element
  await reopenChanged(page, html => html.replace(/<h1>/, '<p>Above it</p><p>And more</p><h1>'));
  await expect(page.locator('.e-changed')).toHaveCount(0);
  near(await page.locator('.e-marks .e-box').boundingBox(), await page.locator(HEADING).first().boundingBox());
});

test('a suggestion whose element changed is flagged, not guessed', async ({ page }) => {
  await openSuggest(page);
  await suggest(page, HEADING, 'Shorter');

  // the text is gone: flagged, kept, and the prompt says so
  await reopenChanged(page, html => html.replace(/<h1>[\s\S]*?<\/h1>/, '<h1>Something else</h1>'));
  await expect(page.locator('.e-changed')).toHaveCount(1);
  await expect(page.locator('.e-marks .e-stale')).toHaveCount(1);
  await expect(page.locator('.e-item .e-n')).toHaveCSS('background-image', 'none');
  expect(await copied(page)).toContain('has changed since the suggestion was made');
  await page.locator('.e-item').click();
  await expect(page.locator('.e-crumb')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.e-item')).toHaveCount(1);
});

test('two elements that both match are flagged, not guessed', async ({ page }) => {
  await openSuggest(page);
  await suggest(page, HEADING, 'Shorter');
  await reopenChanged(page, html => firstSlide(html, `<section class="slide"><p>A copy</p>${html.match(/<h1>[\s\S]*?<\/h1>/)[0]}</section>\n`));
  await expect(page.locator('.e-changed')).toHaveCount(1);
});

test('outlines are right at once on a slide with builds', async ({ page }) => {
  const { manual } = await info(page);
  await goTo(page, manual);
  await openSuggest(page);
  const b = await page.locator('.slide.current .build').first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.type('Reword');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  // read straight away: a build still sliding in would be off by its 14 px
  const [mark, now] = await page.evaluate(([x, y]) => {
    const slide = document.querySelector('.slide.current');
    return [document.querySelector('.e-marks .e-box'), document.elementsFromPoint(x, y).find(e => slide.contains(e))]
      .map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  near(mark, now);
});

test('thumbnails count the suggestions of their slide', async ({ page }) => {
  await openSuggest(page);
  const count = page.locator('.e-thumb').first().locator('.e-thumb-count');
  await expect(count).toBeHidden();
  await suggest(page, HEADING, 'One');
  await expect(count).toHaveText('1');
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type('Two');
  await page.keyboard.press('Enter');
  await expect(count).toHaveText('2');
  await expect(page.locator('.e-thumb').nth(1).locator('.e-thumb-count')).toBeHidden();
  await page.locator('.e-item').first().hover();
  await page.locator('.e-del').first().click();
  await expect(count).toHaveText('1');
});

test('a deleted suggestion can be brought back', async ({ page }) => {
  await openSuggest(page);
  const undo = page.locator('.e-undo'), note = page.locator('.e-item .e-note');
  await suggest(page, HEADING, 'Keep me');
  await expect(undo).toBeHidden();

  // the × of a row
  await page.locator('.e-item').hover();
  await page.locator('.e-del').click();
  await expect(note).toHaveCount(0);
  await undo.click();
  await expect(note).toHaveText(['Keep me']);
  await expect(page.locator('.e-marks .e-box')).toHaveCount(1);
  await expect(undo).toBeHidden();

  // the bin in the box
  await page.locator('.e-item').click();
  await page.locator('.e-ask-del').click();
  await expect(note).toHaveCount(0);
  await undo.click();
  await expect(note).toHaveText(['Keep me']);

  // Clear, and the reload keeps what came back
  await page.locator('.e-clear').click();
  await page.locator('.e-clear').click();
  await expect(note).toHaveCount(0);
  await undo.click();
  await expect(note).toHaveText(['Keep me']);
  await page.reload();
  await expect(note).toHaveText(['Keep me']);

  // nothing to bring back when a new one is dropped empty
  const c = await centre(page, HEADING);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
  await expect(undo).toBeHidden();

  // and the offer goes away by itself
  await page.locator('.e-item').hover();
  await page.locator('.e-del').click();
  await expect(undo).toBeVisible();
  await expect(undo).toBeHidden({ timeout: 8000 });
});

test('the side panes fold away and give the slide their room at 1024x768', async ({ page }) => {
  const width = 1024, height = 768;
  await page.setViewportSize({ width, height });
  await openSuggest(page);
  const box = sel => page.locator(sel).boundingBox();
  const widths = [(await box('#stage')).width];

  await page.locator('.e-toggle-rail').click();
  await expect(page.locator('#edit-rail')).toBeHidden();
  await expect(page.locator('.e-toggle-rail')).toHaveAttribute('aria-pressed', 'false');
  let s = await box('#stage');
  widths.push(s.width);
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual((await box('#edit')).x);

  await page.locator('.e-toggle-pane').click();
  await expect(page.locator('#edit')).toBeHidden();
  s = await box('#stage');
  widths.push(s.width);
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(width);
  expect(widths[1]).toBeGreaterThan(widths[0]);
  expect(widths[2]).toBeGreaterThanOrEqual(widths[1]);  // the height may be what limits it by now

  // the notes span the room, and the box stays in the window
  const n = await box('#notes');
  expect(n.x).toBe(0);
  expect(n.width).toBe(width);
  const c = await centre(page, HEADING);
  await page.mouse.click(c.x, c.y);
  const a = await box('#edit-ask');
  expect(a.x).toBeGreaterThanOrEqual(0);
  expect(a.x + a.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');

  // and they come back
  await page.locator('.e-toggle-rail').click();
  await page.locator('.e-toggle-pane').click();
  await expect(page.locator('#edit-rail')).toBeVisible();
  await expect(page.locator('#edit')).toBeVisible();
  expect(Math.abs((await box('#stage')).width - widths[0])).toBeLessThan(1);
});

test('the lines of a table revealed row by row appear with their rows', async ({ page }) => {
  const { manual } = await info(page);
  await goTo(page, manual);
  const table = page.locator('.slide.current table');
  test.skip(!await table.locator('tr.build').count(), 'this deck has no table built row by row');
  // before the first press, the slide looks exactly as it does without the table
  const before = await page.screenshot();
  await table.evaluate(t => { t.style.visibility = 'hidden'; });
  expect(before.equals(await page.screenshot())).toBe(true);
});

test('the dark title card animates, except in the edit view, for reduced motion and in print', async ({ page }) => {
  const title = page.locator('.slide.dark.title');
  test.skip(!await title.count(), 'this deck has no dark title card');
  const name = () => title.evaluate(s => getComputedStyle(s).animationName);
  await expect.poll(name).toBe('drift');
  await page.keyboard.press('e');
  await expect.poll(name).toBe('none');
  await page.keyboard.press('e');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(name).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference', media: 'print' });
  await expect.poll(name).toBe('none');
});

test('a refresh in the edit view stays in the edit view, until you leave it', async ({ page }) => {
  await goTo(page, 1);
  await openSuggest(page);
  await suggest(page, HEADING, 'Keep me');
  await page.reload();
  await expect(page.locator('#edit')).toBeVisible();
  expect(await current(page)).toBe(1);
  await expect(page.locator('.e-item .e-note')).toHaveText(['Keep me']);

  // a presenter view opened from here is still a presenter view
  const [pv] = await Promise.all([page.waitForEvent('popup'), page.locator('.e-present').click()]);
  await pv.route(/^https?:/, r => r.abort());
  await expect(pv.locator('.p-count')).toBeVisible();
  await expect(pv.locator('#edit')).toHaveCount(0);
  await pv.close();

  await page.keyboard.press('e');
  await expect(page.locator('#edit')).toBeHidden();
  await page.reload();
  await expect(page.locator('#edit-bar')).toHaveCount(0);
  expect(await current(page)).toBe(1);
});

test('edit mode leaves no chrome in print', async ({ page }) => {
  const { n } = await info(page);
  await page.keyboard.press('e');
  await page.emulateMedia({ media: 'print' });
  for (const id of ['#edit', '#edit-bar', '#edit-rail', '#edit-status', '#edit-layer', '#edit-ask', '#notes'])
    await expect(page.locator(id)).toBeHidden();
  expect(await page.locator('.slide:visible').count()).toBe(n);
});

// Edit: changing the deck itself. A deck of known slides put in front of the deck under test
const KNOWN = `<section class="slide">
  <h2>Heading here</h2>
  <p class="t">Some <code>inline</code> text
    over two lines</p>
  <ul>
    <li>One</li>
    <li>Two</li>
    <li>Three</li>
  </ul>
  <div class="term">$ <span class="b">make</span> deck</div>
  <div class="cols"><div class="stat"><span class="n">42</span><span class="l">Things</span></div></div>
  <div class="s-notes"><p>Say this</p></div>
</section>
<section class="slide">
  <h2>No notes yet</h2>
</section>
`;
const tempFile = html => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deck-')), path.basename(deck));
  writeFileSync(file, html);
  return file;
};
async function openKnown(page) {
  await page.goto(pathToFileURL(tempFile(firstSlide(readFileSync(deck, 'utf8'), KNOWN))).href);
  await page.keyboard.press('e');
  await expect(page.locator('#edit')).toBeVisible();
}
const clickOn = async (page, selector) => { const c = await centre(page, selector); await page.mouse.click(c.x, c.y); };
const typeIn = async (page, selector) => {
  const c = await centre(page, selector);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.locator(selector)).toHaveAttribute('contenteditable', 'plaintext-only');
};
const CUR = '.slide.current';
const items = page => page.locator(`${CUR} li`).allTextContents();
const undoKey = page => page.keyboard.press('ControlOrMeta+z');
// a stand-in for the browser's file dialog: what is written ends up in window.saved
async function fakeDialog(page) {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => {
      window.asked = (window.asked || 0) + 1;
      return { createWritable: async () => ({ write: async t => { window.saved = t; }, close: async () => {} }) };
    };
  });
  await page.reload();
}
async function save(page) {
  await page.locator('.e-save').click();
  await expect(page.locator('.e-save')).toHaveText('Saved');
  await expect(page.locator('.e-save')).toHaveText('Save', { timeout: 4000 });
  return page.evaluate(() => window.saved);
}
const parsed = (page, html) => page.evaluate(h => new DOMParser().parseFromString(h, 'text/html').documentElement.outerHTML.replace(/\s*<\/body>/, '</body>'), html);

test('Edit is the mode the edit view opens in, and a refresh keeps the mode', async ({ page }) => {
  await page.keyboard.press('e');
  await expect(page.locator('.e-mode-edit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.e-mode-suggest')).toHaveAttribute('aria-pressed', 'false');
  await clickOn(page, HEADING);
  await expect(page.locator('#edit-ask')).toBeHidden();
  await expect(page.locator('.e-sel')).toBeVisible();

  await page.locator('.e-mode-suggest').click();
  await expect(page.locator('.e-sel')).toBeHidden();
  await expect(page.locator('#notes')).toHaveAttribute('contenteditable', 'false');
  await page.reload();
  await expect(page.locator('.e-mode-suggest')).toHaveAttribute('aria-pressed', 'true');
  await clickOn(page, HEADING);
  await expect(page.locator('#edit-ask')).toBeVisible();
  await expect(page.locator('.e-sel')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('.e-mode-edit').click();
  await page.reload();
  await expect(page.locator('.e-mode-edit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#notes')).toHaveAttribute('contenteditable', 'true');
});

test('a double-click types in the text: keys are text, Enter keeps it, Esc takes it back', async ({ page }) => {
  await openKnown(page);
  const h = page.locator(`${CUR} h2`);
  await typeIn(page, `${CUR} h2`);
  await expect(page.locator('#edit-layer')).toBeHidden();
  await page.keyboard.press('End');
  await page.keyboard.type(' espnf');  // the keys of the deck, and Space
  await expect(page.locator('#edit')).toBeVisible();
  await expect(page.locator('#notes')).toBeVisible();
  expect(await current(page)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(h).toHaveText('Heading here espnf');
  await expect(h).not.toHaveAttribute('contenteditable');
  await expect(page.locator('#edit-layer')).toBeVisible();

  // Esc puts back the source exactly, and stays in the view with the element selected; then it drops that, then leaves
  const source = await page.locator(`${CUR} p.t`).evaluate(p => p.innerHTML);
  expect(source).toContain('\n');
  await typeIn(page, `${CUR} p.t`);
  await page.keyboard.type('xx');
  await page.keyboard.press('Escape');
  expect(await page.locator(`${CUR} p.t`).evaluate(p => p.innerHTML)).toBe(source);
  await expect(page.locator('.e-sel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.e-sel')).toBeHidden();
  await expect(page.locator('#edit')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit')).toBeHidden();
});

test('typing keeps the inline elements and line breaks, and the layout does not jump', async ({ page }) => {
  await openKnown(page);
  const p = page.locator(`${CUR} p.t`);
  const tall = (await p.boundingBox()).height;
  const source = await p.evaluate(e => e.innerHTML);

  // the caret lands where the double-click was, under the slide's scale, and nothing moves
  await typeIn(page, `${CUR} p.t`);
  expect((await p.boundingBox()).height).toBe(tall);
  const caret = await page.evaluate(() => { const s = getSelection(); return s.isCollapsed && document.querySelector('.slide.current p.t').contains(s.anchorNode); });
  expect(caret).toBe(true);
  // nothing typed: the source stays as written, and there is nothing to undo
  await page.keyboard.press('Enter');
  expect(await p.evaluate(e => e.innerHTML)).toBe(source);
  await expect(page.locator('.e-do-undo')).toBeDisabled();

  await typeIn(page, `${CUR} p.t`);
  await page.keyboard.press('End');
  await page.keyboard.type('A');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('B');
  await page.keyboard.press('Enter');
  const html = await p.evaluate(e => e.innerHTML);
  expect(html).toContain('<code>inline</code>');
  expect(html).toMatch(/A<br>B$/);
  expect(html).not.toContain('\n');
  expect(await p.evaluate(e => e.parentElement.scrollTop)).toBe(0);
  await expect(page.locator('.e-do-undo')).toBeEnabled();
  await undoKey(page);
  expect(await page.locator(`${CUR} p.t`).evaluate(e => e.innerHTML)).toBe(source);
});

test('a press elsewhere keeps what was typed; emptied text goes, and comes back with Undo', async ({ page }) => {
  await openKnown(page);
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await clickOn(page, `${CUR} li:nth-child(2)`);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
  await expect(page.locator(`${CUR} h2`)).not.toHaveAttribute('contenteditable');

  // going to another slide keeps it too
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('?');
  await page.locator('.e-thumb').nth(1).click();
  expect(await current(page)).toBe(1);
  await page.locator('.e-thumb').nth(0).click();
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!?');

  await typeIn(page, `${CUR} li:nth-child(2)`);
  await page.keyboard.press('End');
  for (let n = 0; n < 3; n++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  expect(await items(page)).toEqual(['One', 'Three']);
  await undoKey(page);
  expect(await items(page)).toEqual(['One', 'Two', 'Three']);
});

test('only blocks of text can be typed in: not code panels, drawings or layout', async ({ page }) => {
  await openKnown(page);
  const typing = page.locator(`${CUR} [contenteditable]`);
  // a click inside a code panel selects the panel, and a double-click leaves it alone
  const span = await centre(page, `${CUR} .term .b`);
  await page.mouse.dblclick(span.x, span.y);
  await expect(typing).toHaveCount(0);
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} .term`).boundingBox());
  // and a code panel moves like anything else
  await page.locator('.e-do-earlier').click();
  await expect(page.locator(`${CUR} .term + ul`)).toHaveCount(1);
  // an inline element types with its block
  await page.keyboard.press('Escape');
  const code = await centre(page, `${CUR} p.t code`);
  await page.mouse.dblclick(code.x, code.y);
  await expect(page.locator(`${CUR} p.t`)).toHaveAttribute('contenteditable', 'plaintext-only');
  await page.keyboard.press('Escape');
  // a panel of two labels is layout, its labels are text
  const stat = await page.locator(`${CUR} .stat`).boundingBox();
  await page.mouse.dblclick(stat.x + 2, stat.y + 2);
  await expect(typing).toHaveCount(0);
  await typeIn(page, `${CUR} .stat .n`);
  await page.keyboard.press('Escape');
});

test('a selected element can be moved, duplicated, deleted and widened, and Undo takes each back', async ({ page }) => {
  await openKnown(page);
  const tools = page.locator('.e-tools');
  const list = () => page.locator(`${CUR} ul`).evaluate(u => u.innerHTML);
  const source = await list();
  await expect(tools).toBeHidden();
  await expect(page.locator('.e-do-undo')).toBeDisabled();

  await clickOn(page, `${CUR} li:nth-child(2)`);
  await expect(tools).toBeVisible();
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} li:nth-child(2)`).boundingBox());
  // in blue, and the orange of the cursor does not cover it; it does outline the next element
  await expect(page.locator('.e-sel')).toHaveCSS('border-top-color', 'rgb(0, 122, 255)');
  await expect(page.locator('.e-hover')).toBeHidden();
  const other = await centre(page, `${CUR} li:nth-child(3)`), same = await centre(page, `${CUR} li:nth-child(2)`);
  await page.mouse.move(same.x + 3, same.y);
  await expect(page.locator('.e-hover')).toBeHidden();
  await page.mouse.move(other.x, other.y);
  await expect(page.locator('.e-hover')).toBeVisible();

  // moving swaps it with its neighbour; the white space of the source stays put, the outline goes along
  await page.locator('.e-do-earlier').click();
  expect(await items(page)).toEqual(['Two', 'One', 'Three']);
  expect(await list()).toBe(source.replace('One', '#').replace('Two', 'One').replace('#', 'Two'));
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} li:nth-child(1)`).boundingBox());
  await expect(page.locator('.e-do-earlier')).toBeDisabled();
  await page.locator('.e-do-later').click();
  await page.locator('.e-do-later').click();
  expect(await items(page)).toEqual(['One', 'Three', 'Two']);
  await expect(page.locator('.e-do-later')).toBeDisabled();

  await page.locator('.e-do-duplicate').click();
  expect(await items(page)).toEqual(['One', 'Three', 'Two', 'Two']);
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} li:nth-child(4)`).boundingBox());
  expect(await list()).toMatch(/<\/li>\n    <li>Two<\/li>\n    <li>Two<\/li>/);

  await page.locator('.e-do-delete').click();
  expect(await items(page)).toEqual(['One', 'Three', 'Two']);
  await expect(tools).toBeHidden();
  await clickOn(page, `${CUR} li:nth-child(1)`);
  await page.keyboard.press('Delete');
  expect(await items(page)).toEqual(['Three', 'Two']);

  // widen to the list, which is as far as it goes: the slide itself stays
  await clickOn(page, `${CUR} li:nth-child(1)`);
  await expect(page.locator('.e-do-parent')).toBeEnabled();
  await page.locator('.e-do-parent').click();
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} ul`).boundingBox());
  await expect(page.locator('.e-do-parent')).toBeDisabled();

  // the background drops the selection
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await expect(tools).toBeHidden();

  // Undo, by button and by key, step by step back to the source
  await page.locator('.e-do-undo').click();
  expect(await items(page)).toEqual(['One', 'Three', 'Two']);
  await undoKey(page);
  expect(await items(page)).toEqual(['One', 'Three', 'Two', 'Two']);
  for (let n = 0; n < 4; n++) await undoKey(page);
  expect(await list()).toBe(source);
  await expect(page.locator('.e-do-undo')).toBeDisabled();
  await undoKey(page);
  expect(await list()).toBe(source);
});

test('the last element stops before the notes and the counter', async ({ page }) => {
  await openKnown(page);
  await clickOn(page, `${CUR} .stat .n`);
  await page.locator('.e-do-parent').click();
  await page.locator('.e-do-parent').click();
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} .cols`).boundingBox());
  await expect(page.locator('.e-do-later')).toBeDisabled();
  await expect(page.locator('.e-do-parent')).toBeDisabled();
  await page.locator('.e-do-delete').click();
  expect(await page.locator(CUR).evaluate(s => s.lastElementChild.className)).toBe('counter');
  await expect(page.locator(`${CUR} .s-notes`)).toHaveCount(1);
});

test('the notes can be typed in, on a slide with or without them, as one step to undo', async ({ page }) => {
  await openKnown(page);
  const notes = page.locator('#notes');
  await notes.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' espn');  // the keys of the deck are text here too
  await expect(notes).toContainText('Say this espn');
  await expect(page.locator(`${CUR} .s-notes`)).toContainText('Say this');
  await expect(page.locator('#edit')).toBeVisible();
  // Esc only leaves the text, which then is on the slide
  await page.keyboard.press('Escape');
  await expect(page.locator(`${CUR} .s-notes`)).toContainText('Say this espn');
  await expect(page.locator('#edit')).toBeVisible();

  // a slide without notes gets them, before the counter; the words of the placeholder are not kept
  await page.locator('.e-thumb').nth(1).click();
  await expect(notes).toContainText('No notes for this slide');
  await notes.click();
  await expect(notes).not.toContainText('No notes');
  await page.keyboard.type('First line');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.locator('.e-thumb').nth(0).click();
  expect(await page.locator('.slide').nth(1).evaluate(s => [s.querySelector('.s-notes').textContent, s.lastElementChild.className])).toEqual(['First lineSecond', 'counter']);
  await page.locator('.e-thumb').nth(1).click();
  await expect(notes).toContainText('First line');

  // pasted text comes without its formatting
  await notes.click();
  await page.keyboard.press('ControlOrMeta+End');
  await notes.evaluate(n => {
    const data = new DataTransfer();
    data.setData('text/html', '<h1>Big</h1>');
    data.setData('text/plain', 'Plain');
    n.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(notes).toContainText('Plain');
  await expect(notes.locator('h1')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Undo takes back the paste, then the notes, and goes to their slide
  await undoKey(page);
  await undoKey(page);
  expect(await page.locator('.slide').nth(1).locator('.s-notes').count()).toBe(0);
  await expect(notes).toContainText('No notes for this slide');

  // and the first change, on the first slide; just looking at the notes adds nothing to undo, and emptied notes are gone
  await undoKey(page);
  expect(await current(page)).toBe(0);
  await expect(page.locator(`${CUR} .s-notes`).evaluate(n => n.textContent.trim())).resolves.toBe('Say this');
  await page.locator('.e-thumb').nth(1).click();
  await expect(page.locator('.e-do-undo')).toBeDisabled();
  await notes.click();
  await page.keyboard.press('Escape');
  await expect(notes).toContainText('No notes for this slide');
  await expect(page.locator('.e-do-undo')).toBeDisabled();
  await page.locator('.e-thumb').nth(0).click();
  await notes.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.locator(`${CUR} .s-notes`)).toHaveCount(0);
});

test('a thumbnail follows what happens to its slide', async ({ page }) => {
  await openKnown(page);
  const thumb = page.frameLocator('.e-thumb:nth-child(1) iframe').locator('.slide.current h2');
  await expect(thumb).toHaveText('Heading here');
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await expect(thumb).toHaveText('Heading here!');
  await undoKey(page);
  await expect(thumb).toHaveText('Heading here');

  // one that loads later starts from the deck as it is now
  await page.locator('.e-thumb').nth(1).click();
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await page.locator('.e-thumb:nth-child(2) iframe').evaluate(f => { f.src = f.src; });
  await expect(page.frameLocator('.e-thumb:nth-child(2) iframe').locator('.slide.current h2')).toHaveText('No notes yet!');
});

test('a suggestion follows a direct change: flagged when its element changed, and back with Undo', async ({ page }) => {
  await openKnown(page);
  await page.locator('.e-mode-suggest').click();
  await suggest(page, `${CUR} h2`, 'Shorter');
  await suggest(page, `${CUR} li:nth-child(3)`, 'Fine');
  await page.locator('.e-mode-edit').click();
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await expect(page.locator('.e-changed')).toHaveCount(1);
  await clickOn(page, `${CUR} li:nth-child(2)`);
  await page.locator('.e-do-delete').click();
  await expect(page.locator('.e-changed')).toHaveCount(1);  // the third item moved up: it is still that item
  near(await page.locator('.e-marks .e-box').nth(1).boundingBox(), await page.locator(`${CUR} li:nth-child(2)`).boundingBox());
  await undoKey(page);
  // Undo works from Suggest too, so changes are not stranded there
  await page.locator('.e-mode-suggest').click();
  await page.locator('.e-do-undo').click();
  await expect(page.locator('.e-changed')).toHaveCount(0);
  await page.locator('.e-item').first().click();
  await expect(page.locator('#edit-ask')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('saving without changes writes the deck as it was, and again the same', async ({ page }) => {
  await fakeDialog(page);
  await page.keyboard.press('e');
  const source = readFileSync(deck, 'utf8');
  const first = await save(page);
  expect(await parsed(page, first)).toBe(await parsed(page, source));
  expect(first).toMatch(/^<!doctype html>\n<html[^>]*>\n<head>/i);
  expect(first).toMatch(/\n<\/body>\n<\/html>\n$/);
  // the second press does not ask again
  await save(page);
  expect(await page.evaluate(() => window.asked)).toBe(1);

  const file = tempFile(first);
  await page.goto(pathToFileURL(file).href);
  await page.keyboard.press('e');
  expect(await save(page)).toBe(first);

  // the update command still finds the engine in it
  const check = f => spawnSync(process.execPath, [path.resolve('bin/deckfile.mjs'), 'update', '--check', f], { encoding: 'utf8' }).status;
  expect(check(file)).toBe(check(deck));
});

test('a saved deck opens with the changes in it and nothing of the edit view', async ({ page }) => {
  await fakeDialog(page);
  await openKnown(page);
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await clickOn(page, `${CUR} li:nth-child(2)`);
  await page.locator('.e-do-delete').click();
  await page.locator('#notes').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' now');
  // Cmd/Ctrl+S keeps what is being typed, and saves
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.e-save')).toHaveText('Saved');
  const saved = await page.evaluate(() => window.saved);

  const left = await page.evaluate(h => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    return { chrome: d.querySelectorAll('#notes, #deck-controls, #edit-css, #edit-bar, #edit-rail, #edit-status, #edit, #edit-ask, #edit-layer').length,
      engine: d.querySelectorAll('.counter, .slide.current, .build.on, [contenteditable]').length,
      root: [...d.documentElement.attributes].map(a => a.name).filter(n => n !== 'lang') };
  }, saved);
  expect(left).toEqual({ chrome: 0, engine: 0, root: [] });

  await page.goto(pathToFileURL(tempFile(saved)).href);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
  expect(await items(page)).toEqual(['One', 'Three']);
  await expect(page.locator(`${CUR} .s-notes`)).toContainText('Say this now');
  await expect(page.locator(`${CUR} .counter`)).toHaveCount(1);
  await page.keyboard.press('e');
  await expect(page.locator('#edit')).toBeVisible();
});

test('a cancelled or failed dialog saves nothing and keeps the warning; without one the deck downloads', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
  await page.keyboard.press('e');
  await clickOn(page, HEADING);
  await page.locator('.e-do-duplicate').click();

  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('no', 'AbortError'); }; });
  await page.locator('.e-save').click();
  await expect(page.locator('.e-save')).toHaveText('Save');
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('no', 'NotAllowedError'); }; });
  await page.locator('.e-save').click();
  await expect(page.locator('.e-save')).toHaveText('Save failed');

  await page.evaluate(() => { delete window.showSaveFilePicker; });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.e-save').click()]);
  expect(download.suggestedFilename()).toBe(path.basename(deck));
  expect(readFileSync(await download.path(), 'utf8')).toMatch(/^<!doctype html>/i);
  await expect(page.locator('.e-save')).toHaveText('Downloaded');
  // saved: the page can go without asking
  await page.reload();
  expect(dialogs).toEqual([]);
});

test('Copy prompt is in the suggestions, and the side pane follows the mode', async ({ page }) => {
  await page.keyboard.press('e');
  await expect(page.locator('#edit .e-edits')).toBeVisible();
  await expect(page.locator('#edit .e-suggestions')).toBeHidden();
  await expect(page.locator('.e-copy')).toBeHidden();
  await expect(page.locator('#edit-bar .e-copy')).toHaveCount(0);
  await page.locator('.e-mode-suggest').click();
  await expect(page.locator('#edit .e-edits')).toBeHidden();
  await expect(page.locator('#edit .e-suggestions .e-foot .e-copy')).toBeVisible();
  await expect(page.locator('.e-copy')).toBeDisabled();
  await suggest(page, HEADING, 'Shorter');
  await expect(page.locator('.e-copy')).toBeEnabled();
  expect(await copied(page)).toContain('Suggestion: Shorter');
  await expect(page.locator('.e-copy')).toHaveText('Copied');
  // the footer holds it, Undo and Clear in one row
  await page.locator('.e-item').hover();
  await page.locator('.e-del').click();
  const y = async s => (await page.locator(s).boundingBox()).y;
  expect(await y('.e-undo')).toBe(await y('.e-copy'));
  expect(await y('.e-clear')).toBe(await y('.e-copy'));
  const foot = await page.locator('.e-suggestions .e-foot').boundingBox(), clear = await page.locator('.e-clear').boundingBox();
  expect(clear.x + clear.width).toBeLessThanOrEqual(foot.x + foot.width);
});

test('in Suggest the top bar has buttons for the open suggestion, as Edit has for the selection', async ({ page }) => {
  await openKnown(page);
  const tools = page.locator('.e-ask-tools'), ta = page.locator('#edit-ask textarea'), at = page.locator('.e-crumb.e-at');
  const parent = page.locator('.e-ask-parent'), child = page.locator('.e-ask-child'), save = page.locator('.e-ask-save');
  await expect(tools).toBeHidden();
  await clickOn(page, `${CUR} li:nth-child(2)`);  // in Edit it selects, with Edit's buttons
  await expect(page.locator('.e-tools')).toBeVisible();
  await expect(tools).toBeHidden();

  await page.locator('.e-mode-suggest').click();
  await expect(page.locator('.e-tools')).toBeHidden();
  await expect(tools).toBeHidden();
  await clickOn(page, `${CUR} li:nth-child(2)`);
  await expect(tools).toBeVisible();
  await expect(page.locator('.e-tools')).toBeHidden();
  await expect(at).toHaveText('li');
  await expect(child).toBeDisabled();
  await expect(save).toBeDisabled();

  // widen and narrow: the box stays open with its note and the focus, and the mark goes along
  await page.keyboard.type('Reword');
  await expect(save).toBeEnabled();
  await parent.click();
  await expect(at).toHaveText('ul');
  await expect(ta).toHaveValue('Reword');
  await expect(ta).toBeFocused();
  near(await page.locator('.e-marks .e-box').boundingBox(), await page.locator(`${CUR} ul`).boundingBox());
  await parent.click();
  await expect(at).toHaveText('Slide 1');
  await expect(parent).toBeDisabled();
  await child.click();
  await expect(at).toHaveText('ul');
  await child.click();
  await expect(at).toHaveText('li');
  await expect(child).toBeDisabled();
  await expect(save).toBeEnabled();

  // save closes it, and the buttons go with it
  await save.click();
  await expect(page.locator('#edit-ask')).toBeHidden();
  await expect(tools).toBeHidden();
  await expect(page.locator('.e-item .e-note')).toHaveText(['Reword']);

  // a press elsewhere closes it as ever; a pin on the background has nothing to widen to
  await page.locator('.e-item').click();
  await expect(tools).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(tools).toBeHidden();
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await expect(parent).toBeDisabled();
  await expect(child).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(tools).toBeHidden();

  // delete takes the suggestion off, and Undo under the list brings it back
  await page.locator('.e-item').click();
  await page.locator('.e-ask-remove').click();
  await expect(page.locator('.e-item')).toHaveCount(0);
  await expect(tools).toBeHidden();
  await page.locator('.e-undo').click();
  await expect(page.locator('.e-item')).toHaveCount(1);
  expect(await page.locator('#edit-bar').evaluate(b => b.scrollWidth - b.clientWidth)).toBe(0);
});

test('the side pane lists every unsaved edit, and Undo and Save take them off', async ({ page }) => {
  await fakeDialog(page);
  await openKnown(page);
  const rows = page.locator('.e-change'), what = page.locator('.e-change .e-note');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.e-edits-empty')).toBeVisible();

  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');
  await expect(page.locator('.e-edits-empty')).toBeHidden();
  await expect(rows.first()).toContainText('Changed text');
  await expect(rows.first()).toContainText('"Heading here" → "Heading here!"');

  await clickOn(page, `${CUR} li:nth-child(2)`);
  await page.locator('.e-do-later').click();
  await page.locator('.e-do-duplicate').click();
  await page.keyboard.press('Delete');
  await page.locator('#notes').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' now');
  await page.locator('.e-thumb').nth(1).click();
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');

  // by slide, each slide's in the order made, with its element; nothing typed and nothing moved adds a row
  await expect(what).toHaveText(['Changed text', 'Moved later', 'Duplicated', 'Deleted', 'Changed notes', 'Changed text']);
  await expect(rows.nth(1).locator('.e-el')).toHaveText('"Two"');
  await expect(rows.nth(4).locator('.e-el')).toContainText('Say this now');
  await expect(page.locator('.e-slide')).toHaveText([/^Slide 1 · Heading here!/, /^Slide 2 · No notes yet!/]);
  await expect(page.locator('.e-slide').nth(1)).toHaveClass(/e-cur/);
  await typeIn(page, `${CUR} h2`);
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(6);

  // a click goes to the slide and selects the element while it is there; a deleted one only goes to the slide
  await rows.nth(1).click();
  expect(await current(page)).toBe(0);
  await expect(page.locator('.e-sel')).toBeVisible();
  near(await page.locator('.e-sel').boundingBox(), await page.locator(`${CUR} li`, { hasText: 'Two' }).boundingBox());
  await page.locator('.e-thumb').nth(1).click();
  await rows.nth(3).click();
  expect(await current(page)).toBe(0);
  await expect(page.locator('.e-sel')).toBeHidden();

  // Undo takes the last off
  await undoKey(page);
  expect(await current(page)).toBe(1);
  await expect(what).toHaveText(['Changed text', 'Moved later', 'Duplicated', 'Deleted', 'Changed notes']);

  // Save empties the list; taking back what was saved is an unsaved edit again, and Save empties that too
  await save(page);
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.e-edits-empty')).toBeVisible();
  await undoKey(page);
  await expect(what).toHaveText(['Undid: Changed notes']);
  await save(page);
  await expect(rows).toHaveCount(0);
});

test('an unsaved edit can be removed: the slide goes back, with later edits on it, and other slides stay', async ({ page }) => {
  await fakeDialog(page);
  await openKnown(page);
  const what = page.locator('.e-change .e-note'), warn = page.locator('.e-change-warn');
  const remove = async n => { await page.locator('.e-change').nth(n).hover(); await page.locator('.e-change-del').nth(n).click(); };
  const addBang = async sel => {
    await typeIn(page, sel);
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
  };
  const source = await page.locator(CUR).evaluate(s => s.innerHTML);
  await addBang(`${CUR} h2`);
  await clickOn(page, `${CUR} li:nth-child(1)`);
  await page.locator('.e-do-later').click();
  await page.keyboard.press('Delete');
  await page.locator('.e-thumb').nth(1).click();
  await addBang(`${CUR} h2`);
  await expect(what).toHaveText(['Changed text', 'Moved later', 'Deleted', 'Changed text']);
  expect(await current(page)).toBe(1);

  // the last on its slide goes at once, its thumbnail follows, and the other slide stays as it is
  await remove(2);
  await expect(what).toHaveText(['Changed text', 'Moved later', 'Changed text']);
  expect(await current(page)).toBe(0);
  expect(await items(page)).toEqual(['Two', 'One', 'Three']);
  await expect(page.frameLocator('.e-thumb:nth-child(1) iframe').locator('.slide.current li').first()).toHaveText('Two');
  await expect(page.locator('.slide').nth(1).locator('h2')).toHaveText('No notes yet!');

  // one with later edits says so, and removes nothing until the second click
  await remove(0);
  await expect(warn).toHaveText('Also removes 1 later edit on this slide. Click × again.');
  await expect(what).toHaveCount(3);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
  // the warning goes away by itself, and then it asks again
  await expect(warn).toHaveCount(0, { timeout: 4000 });
  await remove(0);
  await expect(warn).toHaveCount(1);
  await remove(0);
  await expect(what).toHaveText(['Changed text']);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here');
  expect(await items(page)).toEqual(['One', 'Two', 'Three']);
  // to the letter what it was
  expect(await page.locator(CUR).evaluate(s => s.innerHTML)).toBe(source);

  // what is left can still be undone, and nothing is left to warn about
  await undoKey(page);
  await expect(what).toHaveCount(0);
  await expect(page.locator('.slide').nth(1).locator('h2')).toHaveText('No notes yet');
  await expect(page.locator('.e-do-undo')).toBeDisabled();

  // an Undid row goes back to before the undo, and the saved edit can be undone again
  await page.locator('.e-thumb').nth(0).click();
  await addBang(`${CUR} h2`);
  await save(page);
  await undoKey(page);
  await expect(what).toHaveText(['Undid: Changed text']);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here');
  await remove(0);
  await expect(what).toHaveCount(0);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
  await undoKey(page);
  await expect(what).toHaveText(['Undid: Changed text']);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here');
});

test('Clear takes back every unsaved edit, on a second click, and stays on the slide', async ({ page }) => {
  await fakeDialog(page);
  await openKnown(page);
  const clear = page.locator('.e-clear-edits'), rows = page.locator('.e-change');
  const html = n => page.locator('.slide').nth(n).evaluate(s => s.innerHTML);
  const addBang = async () => {
    await typeIn(page, `${CUR} h2`);
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
  };
  // at the bottom of the pane, with nothing to clear yet; it is not the Clear of the suggestions
  await expect(clear).toBeVisible();
  await expect(clear).toBeDisabled();
  const box = await clear.boundingBox(), pane = await page.locator('#edit').boundingBox();
  expect(box.y + box.height).toBeGreaterThan(pane.y + pane.height - 24);
  await expect(page.locator('.e-clear')).toBeHidden();

  const sources = [await html(0), await html(1)];
  await addBang();
  await clickOn(page, `${CUR} li:nth-child(2)`);
  await page.keyboard.press('Delete');
  await page.locator('.e-thumb').nth(1).click();
  await addBang();
  await page.locator('.e-thumb').nth(0).click();
  await expect(rows).toHaveCount(3);
  await expect(clear).toBeEnabled();

  // the first click only asks, and the question goes away by itself
  await clear.click();
  await expect(clear).toHaveText('Click again');
  await expect(rows).toHaveCount(3);
  await expect(clear).toHaveText('Clear', { timeout: 4000 });
  await expect(rows).toHaveCount(3);

  await clear.click();
  await clear.click();
  await expect(rows).toHaveCount(0);
  await expect(clear).toHaveText('Clear');
  await expect(clear).toBeDisabled();
  await expect(page.locator('.e-edits-empty')).toBeVisible();
  expect(await current(page)).toBe(0);
  expect(await html(0)).toBe(sources[0]);
  expect(await html(1)).toBe(sources[1]);
  await expect(page.locator('.e-do-undo')).toBeDisabled();
  await expect(page.frameLocator('.e-thumb:nth-child(1) iframe').locator('.slide.current h2')).toHaveText('Heading here');

  // what was saved stays saved, and can still be undone; only what came after it goes
  await addBang();
  await save(page);
  await clickOn(page, `${CUR} li:nth-child(1)`);
  await page.keyboard.press('Delete');
  await clear.click();
  await clear.click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
  expect(await items(page)).toEqual(['One', 'Two', 'Three']);
  await undoKey(page);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here');
  await expect(rows.locator('.e-note')).toHaveText(['Undid: Changed text']);
  // Clear also takes back that undo
  await clear.click();
  await clear.click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator(`${CUR} h2`)).toHaveText('Heading here!');
});

test('with every edit removed there is nothing to warn about when leaving', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
  await page.keyboard.press('e');
  await clickOn(page, HEADING);
  await page.locator('.e-do-duplicate').click();
  await page.locator('.e-change').hover();
  await page.locator('.e-change-del').click();
  await page.reload();
  expect(dialogs).toEqual([]);
});

test('leaving asks only while something is unsaved, and that includes text being typed', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
  await page.keyboard.press('e');
  await clickOn(page, HEADING);
  await page.locator('.e-do-duplicate').click();
  await undoKey(page);
  await expect(page.locator('.e-change')).toHaveCount(0);
  await page.reload();
  expect(dialogs).toEqual([]);

  await typeIn(page, HEADING);
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.reload();
  expect(dialogs).toEqual(['beforeunload']);
});

test('leaving the page with unsaved changes asks first', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
  await page.keyboard.press('e');
  await page.reload();
  expect(dialogs).toEqual([]);
  await clickOn(page, HEADING);
  await page.locator('.e-do-duplicate').click();
  await page.reload();
  expect(dialogs).toEqual(['beforeunload']);
});
