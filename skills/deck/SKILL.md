---
name: deck
description: Build a presentation as one self-contained HTML file (1920×1080 slides, keyboard navigation, builds, speaker notes, presenter view, print to PDF) on the deckfile engine, with no build step or dependencies. Use when the user asks for a presentation, slide deck, slides, a talk or a keynote and wants an HTML deck, or doesn't name a format and has no slide tool of their own. Not for .pptx or Google Slides.
---

# deck

This skill produces `<slug>/index.html`: one file that opens from `file://`
with no network, apart from an optional Google Fonts stylesheet with local
fallbacks. Its engine is [deckfile](https://github.com/roaldnefs/deckfile):
vanilla JS plus plain CSS, inlined between `data-deck="engine"` tags. The deck
is easy to diff, easy to host anywhere, has a presenter view, and prints to a
PDF with one slide per page.

Bundled files:
- `assets/template.html`: the engine, the default theme, and slides that explain deckfile. **Always start from a copy of it.**
- `references/components.md`: the markup for every slide variant and component. Read it before writing slides.
- `references/theming.md`: tokens, fonts, logos and skins. Read it when the user wants a brand.

## Workflow

### 1. Brief

Collect what you need. Take what the user has already said and ask only about the gaps, in one round:
- **Topic and the one thing the audience should remember.**
- **Audience:** who they are and what they already know.
- **Length** in minutes.
- **Language** of the slides.
- **Event, date, speaker name and role** for the title and closing slides.
- **Brand:** the default theme, or colours, logo SVGs and fonts. Fonts must be openly licensed; see theming.
- **Material:** source documents, data, photos or screenshots to use.

If you can't ask (a non-interactive run) or the user says "just make it", choose sensible defaults, state them in one line, and carry on.

### 2. Outline

Before writing any HTML, propose a slide-by-slide outline. Each line gives the slide number, its variant or layout, the heading, and its point in one line. Group the lines under sections with minutes per section.

Sizing: about 1–2 minutes per content slide, plus a title, an agenda (for talks over 10 minutes), a divider per section and a closing slide. A 20-minute talk is usually 12–18 slides.

Get the user's go-ahead on the outline. Restructuring an outline is cheap; restructuring HTML is not.

### 3. Build

1. Copy `assets/template.html` to `<slug>/index.html`, where `<slug>` is a short kebab-case name for the talk. Do not overwrite an existing deck without asking.
2. Set `<html lang>` and `<title>`.
3. Delete every example `<section>` between `<div id="stage">` and its closing `</div>`. Write the new slides there, using markup from `references/components.md`.
4. Brand (if any): change the tokens in `:root` of `<style data-deck="theme">` and the Google Fonts `<link>`, as described in `references/theming.md`. Deck-specific CSS goes in the last `<style>`, under `/* deck-specific */`.
5. Copy images the user supplied next to `index.html` and reference them by relative path.

**Never edit the `<style data-deck="engine">` or `<script data-deck="engine">` blocks.** They are replaced whole when the engine is updated (`npx github:roaldnefs/deckfile update <slug>/index.html`). If the engine truly can't do something, add CSS under the deck-specific heading. If behaviour is needed, add a separate small `<script>` after the engine's, and say why.

### 4. Speaker notes

Every section ends with `<div class="s-notes">…</div>`. Write what the speaker *says*, in their voice: the opening line, the transition into the next slide, and the one point to stress. Don't restate the slide text. Mark any line meant to be read out word for word as "verbatim".

### 5. Self-check

Before you report the deck as done, check it and fix what fails:
- [ ] Every slide is `<section class="slide …">` inside `#stage` and ends with an `s-notes` div.
- [ ] Every number, chart or quote that isn't from a source the user gave says so on the slide, in a `<p class="small">Illustrative data</p>` line. **Never present an invented figure as fact.**
- [ ] The only external URL in `<head>` is Google Fonts. There are no CDN scripts and no remote images.
- [ ] Images are relative files that exist. Nothing is base64-encoded except small SVG logos.
- [ ] Every font is openly licensed (for example SIL OFL), and no commercial face is named, even as a fallback.
- [ ] The `data-deck="engine"` blocks are unchanged from the template (`npx github:roaldnefs/deckfile update --check <slug>/index.html` exits 0).
- [ ] Nothing overflows the 1920×1080 canvas. As a rule of thumb, at most 6 bullets per slide, terminal panels of 12 lines or fewer, and headings that fit on two lines.
- [ ] The slide count fits the time slot.

If you can run a headless browser, render the deck and look at it: print it to PDF (one page per slide) or take 1920×1080 screenshots, then check for overflow, clipped text and contrast.

### 6. Hand-off

Tell the user:
- The path to the deck, and how to open it (open `index.html` in any browser).
- How to present: `→`/`Space` next, `←` back, `↓`/`↑` whole slide, `F` fullscreen, `P` print to PDF, `S` presenter view in a second window with notes and a timer, `E` edit view to select elements, suggest changes and copy them as one prompt.
- Which content is marked illustrative and needs real numbers.
- Any assumptions you made in the brief.

## House rules

- **One idea per slide.** If a slide needs two headings, it is two slides.
- **Builds are for reveals,** such as a list told point by point or a punchline. They are not decoration. Use `data-auto` for groups that should simply appear, like stat rows.
- **Show, don't list.** Prefer a stat row, terminal panel or photo over a fifth bullet.
- **Headings say the point** ("Most breaches start with a reused password"), not the topic ("Passwords").
- **Kickers are optional, and show the position** (`02 · Section name`). Dividers carry the number only.
- **Use `.dark` slides sparingly,** for section dividers and breathing moments.
- **Use `<img>` for photos, not CSS backgrounds,** because backgrounds can vanish in PDF output.
- **Test offline.** The deck must work with Wi-Fi off. That means nothing loaded from a CDN and every font stack falling back cleanly.
