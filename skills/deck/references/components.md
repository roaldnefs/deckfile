# Slide and component catalogue

Every slide is a `<section>` inside `<div id="stage">`. The stage is a fixed
1920×1080 canvas, scaled to the viewport, so all sizes are in canvas pixels.
The content area runs from 160 px to 1760 px horizontally and from 120 px to
960 px vertically. A heading stays at the top; `.cols`, `.keys`, `.stats`, `.term`
and `ul` centre themselves in the room below it. The logo and counter sit in the
bottom corners.

`assets/template.html` has a working example of everything listed here.

## Slide variants (classes on `<section>`)

| Class | Use | Notes |
|---|---|---|
| `slide` | Standard content slide, dark text on white | Always present |
| `slide title` | Opening card | Centred, icon instead of logo; each time it is shown, the text rises in. Often combined with `dark` |
| `slide divider` | Section break | Centred; `.kicker` holds the section number. Usually combined with `dark` |
| `slide dark` | Dark emphasis slide | Black; re-points `--ink`, `--muted`, `--accent`, `--line` and so on to light-on-dark |
| `slide closing` | Final card | Centred like `title`, icon instead of logo |

Attributes:
- `data-auto="600"` on a section reveals its `.build` elements by themselves, one every N ms, as soon as the slide is shown. `→` and `←` take over.

## Text

```html
<div class="kicker">02 · Section name</div>   <!-- small accent label above the heading -->
<h1>Only on title, divider, closing</h1>
<h2>Slide heading</h2>
<h3>Sub-heading inside a column</h3>
<p class="sub">Large lead sentence (title slide)</p>
<p class="byline">Your Name, Role at Organisation</p>
<p class="small">Footnote or source line</p>   <!-- also "Illustrative data", REQUIRED beside any unsourced number -->
<code>class="build"</code>                     <!-- code within a line -->
```

Use the kicker to show where you are (`02 · What we did`). On dividers it holds only the number (`02`).

## Lists

```html
<ul>                           <!-- large plain lines, without bullets -->
  <li class="build">One sentence each</li>
</ul>

<ol class="agenda">            <!-- 01, 02, 03… large agenda list -->
  <li class="build">Part one</li>
</ol>
```

Keep it to four or five bullets at most, each one line where possible.

## Stats row

```html
<div class="stats">            <!-- 3 equal columns; change grid-template-columns for 2 or 4 -->
  <div class="stat build"><span class="n">42%</span><span class="cap">What it measures · source</span></div>
</div>
```

## Two columns

```html
<div class="cols">             <!-- 1fr 1fr, 80px gap; override inline for other ratios -->
  <div>…</div>
  <div>…</div>
</div>
```

For a different ratio: `<div class="cols" style="grid-template-columns:1.4fr 1fr">`.

## Terminal panel

```html
<div class="term"><span class="b">$</span> <span class="w">command --flag</span>
<span class="d"># dim comment</span>
plain output line
</div>
```

`white-space:pre` applies, so line breaks inside the div are literal: do not indent the contents. It also suits markup and other code. The edit view moves a panel whole and doesn't type in it. A light panel: `.b` accent (prompt, values), `.w` medium weight (typed command), `.d` muted (output, comments). Keep it to 12 lines or fewer.

## Window

```html
<div class="window"><img src="screenshot.png" alt="…"></div>   <!-- or an inline <svg viewBox> -->
```

A screenshot or drawing as a floating, rounded window. Its width comes from the column it sits in.

## Table

```html
<table class="keys"><tr><td>Label</td><td>Value</td></tr></table>
```

`kbd` renders keyboard keys.

## Buttons

```html
<a class="btn" href="…">Read more</a>          <!-- outline button -->
<a class="btn action" href="…">Sign up</a>     <!-- filled accent button -->
```

## Charts and quotes

The theme has no chart or quote styles. Draw a chart as inline SVG in a `.window`, with an `aria-label` that gives the data in words, and write a quote as ordinary text. Put any CSS they need under `/* deck-specific */`.

## Images

Photos and screenshots are ordinary files next to `index.html`, referenced by a
relative path: `<img src="photo.jpg" alt="…">`. Use `<img>`, not a CSS
`background-image`, because backgrounds can go missing when printed to PDF.
Never base64-encode a photo into the HTML.

A common pattern is a photo beside text:

```html
<div class="cols" style="grid-template-columns:1fr 1fr;align-items:center">
  <div><h2>Heading</h2><p>Text.</p></div>
  <img src="photo.jpg" alt="…" style="width:100%;height:700px;object-fit:cover;border-radius:20px">
</div>
```

If a layout repeats more than once, give it a class under `/* deck-specific */` instead of inline styles.

## Layouts for New slide

`<template data-deck="layouts">`, just before `<div id="stage">`, holds what **New slide** offers in the edit view:

```html
<section class="slide" data-layout="Content">   <!-- the name in the menu -->
  <h2>New slide</h2>
  <ul>
    <li>First point</li>
  </ul>
</section>
```

Use placeholder text only, in elements that can be typed in. Leave out terminal panels and images, which can't be filled in from the edit view.

## Speaker notes

```html
<div class="s-notes"><p>What to say, in the speaker's voice.</p></div>
```

Put this as the last child of every section. Notes appear in the presenter view (`S`) and the edit view (`E`), where they can be changed. They never show on the slide or in the PDF.

## Builds

Add `class="build"` to any element to reveal it on the next `→`. Builds go in
document order. `↓` shows the whole slide at once. Advanced: a hidden marker
element with `class="build"` can drive styling through `:has()`, for example
`.slide:has(#step2.on) .diagram .b{opacity:1}`. Put such rules under
`/* deck-specific */`.
