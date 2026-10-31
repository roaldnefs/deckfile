# ![deckfile: presentations as one self-contained HTML file](docs/header.svg)

Presentations as one self-contained HTML file. No build step, no bundler, no
dependencies: the slides, the engine and the theme live in a single
`index.html` that opens straight from disk, without a network, and works the
same from any static host.

- 1920×1080 slides, scaled to any screen
- builds, one step at a time or timed
- a presenter view in a second window, with speaker notes and a timer
- print to PDF with one page per slide
- an edit view like PowerPoint's: select an element, suggest a change, and copy
  the suggestions as one prompt for a coding agent
- about 1,000 lines of plain JavaScript and 50 of CSS, readable in the file itself

<p>
  <img src="docs/presenter-view.png" width="49%" alt="The presenter view: timer on top, the current slide on the left, the next slide above the speaker notes on the right">
  <img src="docs/edit-view.png" width="49%" alt="The edit view: thumbnails on the left, a slide with one element outlined in orange and a suggestion box beside it, speaker notes below, suggestions on the right">
</p>

## Quick start

1. Copy [`template.html`](template.html) to `my-talk/index.html`.
2. Open it in a browser. Press `→` to step through it.
3. Replace the example slides with your own, and change the theme tokens to
   your brand.

The template explains deckfile, and shows every slide type and component of the
default theme. They are listed in
[`skills/deck/references/components.md`](skills/deck/references/components.md).
The template's header comment is a short reference to the markup.

## Presenting

1. Set the laptop to extend the display to the projector, not mirror it.
2. Open the deck and press `S`. A second window opens with the presenter view.
   If nothing opens, allow pop-ups for the page.
3. Drag the deck window to the projector and press `F` there for fullscreen.
   Keep the presenter view on the laptop screen.
4. Steer from either window with the arrow keys, Space or a clicker. Both
   windows stay in step.

The presenter view is laid out like PowerPoint's. The current slide is on the
left, with previous and next buttons, the slide count and the builds left on
the slide below it. On the right is what the next press shows (the next build,
or the next slide as it first appears), above the speaker notes, with A− / A+
to resize them. Along the top are the clock and the elapsed timer, which starts
when the deck first moves and has pause and reset buttons. A red "Not
linked" badge shows when the deck window is closed or stops answering; if the
deck window reloads, the two link up again by themselves within a few seconds.
Drag the bars between the panes to resize them, and double-click a bar to reset
it. The layout and the notes size are remembered in that browser.

The deck window, the presenter view and its two slide previews are all the same
file: `?presenter` is the presenter view and `?view` a read-only slide. They
talk with `postMessage`, which also works between pages opened from `file://`.

## Keys

| Key | Action |
|---|---|
| `→` `Space` `PgDn` | next build step, then next slide |
| `←` `PgUp` | undo build step, then previous slide |
| `↓` / `↑` | skip a whole slide forward / back, all builds shown |
| `Home` / `End` | first / last slide |
| `F` | fullscreen |
| `P` | print to PDF, one page per slide, all builds shown |
| `S` | presenter view in a second window |
| `E` | edit view, see [Suggesting edits](#suggesting-edits) |
| `N` / `Esc` | in the edit view: fold the notes pane / leave the view |
| click / tap / swipe | left 30 % of the screen back, the rest forward; swipe left / right on touch |
| pointer near the bottom-left corner | buttons for back, the presenter view, the edit view, the shortcuts and forward |

Add `?print` to the URL to open the print dialog as soon as the deck has
loaded, for a "Print to PDF" link. The current slide is kept in
`sessionStorage`, so a reload during a talk lands on the same slide.

## Writing slides

The engine needs very little markup:

```html
<div id="stage">
  <section class="slide">
    <h2>One idea per slide</h2>
    <ul>
      <li class="build">Revealed on the first →</li>
      <li class="build">and this one on the second</li>
    </ul>
    <div class="s-notes"><p>What to say here.</p></div>
  </section>
</div>
```

| Markup | Meaning |
|---|---|
| `<div id="stage">` | holds the slides, a fixed 1920×1080 canvas |
| `<section class="slide">` | one slide, in document order |
| `class="build"` on any element | revealed one at a time with `→` |
| `data-auto="600"` on a section | its builds reveal by themselves, one every 600 ms, as soon as the slide shows; `→` and `←` take over |
| `<div class="s-notes">` inside a slide | speaker notes, for the presenter and edit views |

The engine sets `.current` on the slide shown and `.on` on each build it
reveals, and adds a `<span class="counter">` with the slide number to every
slide. Style against those classes: `.slide.current .diagram{animation:…}`
starts an animation each time a slide shows, and `.slide:has(#step2.on)`
changes a slide as a build lands.

Everything else, such as title cards, dividers, dark slides, stat rows, code
panels and windows, comes from the theme. Its components are listed in
[`skills/deck/references/components.md`](skills/deck/references/components.md).

Photographs live beside the deck as ordinary files and are referenced by
relative path. Inline small things such as logos and icons as SVG; don't
base64 large images into the HTML.

## Suggesting edits

Press `E` for the edit view, laid out like PowerPoint's: slide thumbnails on the
left, the slide with its speaker notes below it, and the suggestions on the
right. Every slide shows with all its builds, so you mark what will be there.
The play button in the toolbar or `E` goes back to the slides. Nothing in the view changes the
deck itself: it collects suggestions for whoever edits the file.

- Move the cursor over the slide and the element under it is outlined in orange.
  Click to select it, click the background to pin a spot, or drag to draw a box
  around an area. Type the suggestion in the box that opens and press `Enter`
  (`Shift+Enter` for a new line). A suggestion left empty is dropped.
- To select what surrounds an element, such as the card around a line of text,
  click a level in the top line of that box, or press `↑` and `↓` while the box
  is empty.
- Each suggestion records its slide and heading, its place in the 1920×1080
  frame, and the element it is on, with a selector and its text.
- When the deck has changed, a suggestion follows its element to where it is now.
  If that element has changed or no single match exists, the suggestion is
  labelled **Changed**, and the prompt says so.
- **Copy prompt** puts every suggestion on the clipboard as one Markdown
  prompt that names the deck file, ready to paste into Claude Code or another
  coding agent working on the deck.
- Click a suggestion, or its mark, to change it. Hover one for × to delete it,
  or click **Clear** twice to delete them all; **Undo** brings them back for a
  few seconds.
- Each thumbnail shows how many suggestions its slide has. The buttons in the
  status bar fold the thumbnails, notes and suggestions away to give the slide
  more room.

A refresh stays in the edit view. Suggestions are kept per deck in that browser
(`localStorage`). They are not shared; send the copied prompt instead.

## Theming

A deck has three `<style>` blocks:

```html
<style data-deck="engine">…</style>   <!-- the engine: don't edit -->
<style data-deck="theme">…</style>    <!-- the theme: yours to change -->
<style>/* deck-specific */</style>    <!-- CSS for this deck alone -->
```

The default theme has white slides with large, quiet type and one accent colour,
and black `.dark` slides for emphasis. To
brand it, change the tokens in its `:root`: colours, three font stacks, and
logo slots that take an SVG data URI. Anything bigger, such as square panels
or a different title card, goes in the theme block or the deck-specific block.
The tokens are listed in
[`skills/deck/references/theming.md`](skills/deck/references/theming.md).

Use only fonts whose license permits it, such as SIL Open Font License faces
from Google Fonts, and fall back to generic families (`system-ui`, `serif`,
`monospace`) so the deck still reads well offline. The default theme uses Inter
and JetBrains Mono, the same on every platform when online.

## Updating the engine

The engine lives in a deck between two pairs of tags:
`<style data-deck="engine">` in the head and `<script data-deck="engine">` at
the end of the body. To bring a deck up to the current version:

```sh
npx github:roaldnefs/deckfile update my-talk/index.html
```

This replaces only what is inside the engine tags. The theme, the slides and
your own scripts stay as they are. `update --check` writes nothing and exits 1
when a deck is out of date, for use in CI. From a clone, run
`node bin/deckfile.mjs update …` instead.

If you'd rather not inline the engine, link it. A plain script works from
`file://`:

```html
<link rel="stylesheet" href="deckfile/src/deck.css">
<link rel="stylesheet" href="deckfile/src/theme.css">
…
<script src="deckfile/src/deck.js"></script>
```

## Extending

Don't edit the engine. Put behaviour a deck needs in a small `<script>` of its
own after the engine's, and watch the `.current` class. For example, to play a
video while its slide is shown:

```html
<script>
(() => {
  const video = document.querySelector('.slide video');
  const slide = video.closest('.slide');
  const sync = () => slide.classList.contains('current') ? video.play().catch(() => {}) : video.pause();
  new MutationObserver(sync).observe(slide, { attributes: true, attributeFilter: ['class'] });
})();
</script>
```

## With Claude Code

This repository is also a Claude Code plugin with a `deck` skill. The skill
writes a deck from a brief: an outline first, then the slides, speaker notes
and a self-check.

```
/plugin marketplace add roaldnefs/deckfile
/plugin install deckfile@deckfile
```

Or copy or symlink [`skills/deck`](skills/deck) into `~/.claude/skills/`.

## Browsers and limits

The automated tests run in Chromium. Firefox and Safari are not tested yet.

- Speaker notes and the timer are in the presenter view, which needs a second
  window. Allow pop-ups for the page. A phone or tablet that can't open one gets
  no notes.
- Suggestions stay in the browser that made them. To share them, send the copied
  prompt.
- The edit view's side panes have a fixed width. In a small window, fold them away
  with the buttons in its status bar.
- Photos sit beside the file, so a deck with photos travels as a folder.

## Development

```sh
npm install
npx playwright install chromium
npm test
```

`npm test` runs the CLI tests and an end-to-end suite in Chromium against
`template.html`, opened from `file://` with the network blocked. Set `DECK` to
run the suite against another deck: `DECK=path/to/index.html npx playwright test`.

The engine sources are `src/deck.js`, `src/deck.css` and the default theme
`src/theme.css`. After changing them, run
`node bin/deckfile.mjs update template.html skills/deck/assets/template.html`;
the tests fail while a copy is out of date.

## License

[MIT](LICENSE)
