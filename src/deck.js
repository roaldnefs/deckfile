/*! deckfile v0.1.0 · engine · MIT License · https://github.com/roaldnefs/deckfile
  A presentation as one self-contained HTML file: no build step, no dependencies, opens offline from file://.

  Keys:  → / Space / PgDn  next build or slide     ← / PgUp  previous
         ↓ next slide, all builds shown            ↑ previous slide, all builds shown
         F fullscreen   P print to PDF
         S presenter view: a second window with current slide, next build or slide, notes (A− / A+), timer (pause, reset)
           and clock; steer from either window; drag the bars between the panes to resize them
         E edit view: thumbnails, slide, notes and suggestions; click an element to outline it and suggest a change, its
           levels in the box (or ↑ ↓ while it is empty) to widen that, the background to pin a spot, or drag to box an area,
           then Copy prompt for all of them. Suggestions follow their element when the deck changes, or get flagged
         Home / End first / last slide             Esc leave the edit view
         click / tap: left 30 % of the screen back, the rest forward · swipe left / right on touch
         pointer near the bottom-left corner: buttons for back, the presenter view, the edit view, the shortcuts and forward

  Markup:
    <div id="stage"> holding one <section class="slide"> per slide, in order
    <div class="s-notes"> inside a slide   speaker notes, shown in the presenter and edit views
    class="build" on any element        revealed one at a time with →
    data-auto="500" on a section       its builds reveal by themselves, one every 500 ms
  The engine sets .current on the slide shown, .on on each build revealed, and adds a <span class="counter"> to every slide.
  URL: ?print opens the print dialog once loaded; ?presenter and ?view are the presenter window and its slide panes.
*/
(() => {
  const slides = [...document.querySelectorAll('.slide')];
  // the speaker notes and the timer: the presenter and edit views place the notes, the presenter view the timer
  const notes = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'notes', hidden: true });
  const timer = Object.assign(document.createElement('div'), { id: 'timer', textContent: '00:00' });
  // ?presenter is the speaker window that S opens, ?view is one read-only slide inside it; anything else is the deck
  const params = new URLSearchParams(location.search);
  const mode = params.has('presenter') ? 'presenter' : params.has('view') ? 'view' : 'deck';
  const here = location.href.split(/[?#]/)[0];
  const KEY = 'deck:' + location.pathname;
  const EDIT_KEY = KEY + ':edit';
  const store = {
    get: (key = KEY) => { try { return sessionStorage.getItem(key); } catch { return null; } },
    set: (v, key = KEY) => { try { sessionStorage.setItem(key, v); } catch {} }
  };
  const builds = s => [...s.querySelectorAll('.build')];
  let i = Math.min(+store.get() || 0, slides.length - 1);
  let autoTimer = null;
  let presenterWin = null;  // deck: the presenter window, once it has said hello
  let pv = null;            // presenter: its panes and labels
  let editing = false;      // deck: edit mode (E) is on
  let ed = null;            // deck: the edit panel, overlay and suggestions, built the first time E is pressed
  // the edit view's panes around the slide, in px
  const RAIL_W = 216, PANE_W = 320, BAR_H = 52, STATUS_H = 32, NOTES_H = 160, GAP = 24;
  let railOn = true, paneOn = true;  // the side panes of the edit view are showing

  slides.forEach((s, k) => {
    const c = document.createElement('span');
    c.className = 'counter';
    c.textContent = `${k + 1} / ${slides.length}`;
    s.appendChild(c);
  });

  function show(n, built = false) {
    built ||= editing;  // edit mode shows every slide fully built, so you mark what will be there
    clearTimeout(autoTimer);
    i = Math.max(0, Math.min(n, slides.length - 1));
    slides.forEach((s, k) => s.classList.toggle('current', k === i));
    builds(slides[i]).forEach(b => b.classList.toggle('on', built));
    if (mode === 'deck') store.set(i);
    notes.innerHTML = slides[i].querySelector('.s-notes')?.innerHTML || '<em>No notes for this slide.</em>';
    if (mode === 'deck' && !built && slides[i].dataset.auto !== undefined) autoBuild(+slides[i].dataset.auto || 500);
    if (editing) drawEdit();
    sync();
  }
  function autoBuild(delay) {
    const step = () => {
      const b = builds(slides[i]).find(x => !x.classList.contains('on'));
      if (!b) return;
      b.classList.add('on');
      sync();
      autoTimer = setTimeout(step, delay);
    };
    autoTimer = setTimeout(step, delay);
  }
  function next() {
    clearTimeout(autoTimer);
    const b = builds(slides[i]).find(x => !x.classList.contains('on'));
    b ? b.classList.add('on') : show(i + 1);
    sync();
  }
  function prev() {
    clearTimeout(autoTimer);
    const on = builds(slides[i]).filter(x => x.classList.contains('on'));
    on.length ? on.pop().classList.remove('on') : show(i - 1, true);
    sync();
  }
  // show slide n with its first k builds on, or all of them when k < 0 (presenter and view windows)
  function apply(n, k) {
    show(n, k < 0);
    builds(slides[i]).slice(0, Math.max(k, 0)).forEach(b => b.classList.add('on'));
  }
  // deck: tell an open presenter window where we are, slide i with k builds on
  function sync() {
    if (mode !== 'deck' || !presenterWin || presenterWin.closed) return;
    const k = builds(slides[i]).filter(b => b.classList.contains('on')).length;
    presenterWin.postMessage({ deck: 'state', i, k }, '*');
  }
  // presenter: mirror the deck's state into the current and next panes, notes and labels
  function render(n, k) {
    if (pv.last && (pv.last[0] !== n || pv.last[1] !== k)) startTimer();  // the talk starts when the deck first moves
    pv.last = [n, k];
    apply(n, k);
    const left = builds(slides[i]).length - k;
    // the next press shows another build of this slide, unless it builds by itself;
    // otherwise the next slide as it first appears (data-auto slides fully built, since that is where they end up)
    const nextBuild = left > 0 && slides[i].dataset.auto === undefined;
    const after = slides[i + 1];
    pv.cur.contentWindow.postMessage({ deck: 'view', i, k }, '*');
    pv.next.contentWindow.postMessage(nextBuild ? { deck: 'view', i, k: k + 1 }
      : { deck: 'view', i: i + 1, k: after?.dataset.auto !== undefined ? -1 : 0 }, '*');
    pv.label.textContent = nextBuild ? 'Next build' : 'Next slide';
    pv.end.hidden = nextBuild || i < slides.length - 1;
    pv.count.textContent = `Slide ${i + 1} of ${slides.length}`;
    pv.left.textContent = left > 0 ? `${left} build${left > 1 ? 's' : ''} left on this slide` : '';
  }

  let t0 = null;
  let paused = null;  // when the timer was paused, or null while it runs
  const pad = n => String(n).padStart(2, '0');
  // the icons of the edit and presenter views, drawn on a 16 px grid
  const ICONS = {
    play: 'M5 3.2v9.6L12.8 8z', pause: 'M5.5 3.5v9M10.5 3.5v9', reset: 'M3 8a5 5 0 1 0 1.5-3.5L3 6V2.5M3 6h3.5',
    back: 'M10 3 5 8l5 5', forward: 'm6 3 5 5-5 5', up: 'M8 13V3M3.5 7.5 8 3l4.5 4.5', close: 'M4 4l8 8M12 4l-8 8',
    display: 'M2.5 3h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11.5V14M5.5 14h5',
    copy: 'M6 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1zM11 5.5V3a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1H5',
    notes: 'M3.5 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
    paneLeft: 'M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM6 3v10',
    paneRight: 'M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 3v10',
    trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4', pencil: 'M10.5 3 13 5.5 5.5 13H3v-2.5zM9 4.5 11.5 7',
    help: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 1 1 2.8 1.7c-.6.3-1 .8-1 1.4M8 11.6v.1',
    bubble: 'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H8L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z'
  };
  const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  function tick() {
    if (t0 === null) return;
    const s = Math.floor(((paused ?? Date.now()) - t0) / 1000);
    timer.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    pv?.pause.setAttribute('d', ICONS[paused === null ? 'pause' : 'play']);
  }
  setInterval(tick, 500);
  function startTimer() { if (t0 === null) t0 = Date.now(); tick(); }
  function resetTimer() { t0 = Date.now(); paused &&= t0; tick(); }
  // pause or resume; a timer not running yet starts
  function pauseTimer() {
    if (t0 === null) return startTimer();
    if (paused === null) paused = Date.now();
    else { t0 += Date.now() - paused; paused = null; }
    tick();
  }

  const NAV = ['ArrowRight', ' ', 'PageDown', 'ArrowLeft', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
  function act(key) {
    // the presenter window steers the deck window, which answers with its new state
    if (mode === 'presenter' && NAV.includes(key)) {
      opener?.postMessage({ deck: 'key', key }, '*');
      return true;
    }
    switch (key) {
      case 'ArrowRight': case ' ': case 'PageDown': next(); break;
      case 'ArrowLeft': case 'PageUp': editing ? show(i - 1, true) : prev(); break;
      case 'ArrowDown': show(i + 1, true); break;
      case 'ArrowUp': show(i - 1, true); break;
      case 'Home': show(0); break;
      case 'End': show(slides.length - 1, true); break;
      case 'n': case 'N':
        if (!editing) return false;
        notes.hidden = !notes.hidden;
        fit();
        break;
      case 'f': case 'F':
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        break;
      case 'p': case 'P': print(); break;
      case 's': case 'S':
        if (mode === 'deck') presenterWin = open(here + '?presenter', 'deck-presenter', 'popup,width=1280,height=800');
        break;
      case 'e': case 'E': if (mode === 'deck') edit(!editing); break;
      case 'Escape':
        if (!editing) return false;
        edit(false);
        break;
      default: return false;
    }
    return true;
  }
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // typing a suggestion: keys are text, Esc only leaves the text box
    if (e.target.closest('textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (act(e.key)) e.preventDefault();
  });

  // file:// pages all have origin "null", so messages go to '*' and are checked by who sent them
  addEventListener('message', e => {
    const m = e.data || {};
    if (mode === 'deck' && (m.deck === 'hello' || m.deck === 'key') && (e.source === presenterWin || e.source?.opener === window)) {
      presenterWin = e.source;
      m.deck === 'key' && NAV.includes(m.key) ? act(m.key) : sync();
    } else if (mode === 'presenter' && m.deck === 'state' && e.source === opener) {
      pv.seen = Date.now();
      pv.link.hidden = true;
      // the heartbeat repeats the state every 2 s; only redraw when it changed
      if (!pv.last || pv.last[0] !== m.i || pv.last[1] !== m.k) render(m.i, m.k);
    } else if (mode === 'view' && m.deck === 'view' && e.source === parent) {
      apply(m.i, m.k);
    }
  });

  // click or tap: the left 30 % of the viewport goes back, the rest forward; links and buttons keep working;
  // in edit mode a click marks the slide instead
  const stage = document.getElementById('stage');
  let swiped = false, tx = 0, ty = 0;
  stage.addEventListener('click', e => {
    if (swiped || editing || e.target.closest('a, button')) return;
    (e.clientX < innerWidth * 0.3 ? prev : next)();
  });
  // swipe on touch: left is forward, right is back; a swipe suppresses the click that follows it
  addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (editing || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    swiped = true; setTimeout(() => { swiped = false; }, 300);
    act(dx < 0 ? 'ArrowRight' : 'ArrowLeft');
  }, { passive: true });

  // slide view: buttons for back, the presenter view, the edit view, the shortcuts and forward, shown while the pointer
  // is near the bottom-left corner. They never take focus, so Space and the arrows keep steering the deck
  if (mode === 'deck') {
    const box = document.createElement('div');
    box.id = 'deck-controls';
    const button = (cls, label, title, name) =>
      `<button type="button" class="${cls}" tabindex="-1" aria-label="${label}" title="${title}">${icon(name)}</button>`;
    const KEYS = [['→ Space', 'Next'], ['←', 'Previous'], ['↓ ↑', 'Whole slide forward / back'], ['Home End', 'First / last slide'],
      ['F', 'Fullscreen'], ['P', 'Print to PDF'],
      ['S', 'Presenter view'], ['E', 'Edit view'], ['Esc', 'Close']];
    box.innerHTML = '<div id="deck-help" hidden>' + KEYS.map(([keys, what]) =>
      `<div class="c-keys">${keys.split(' ').map(k => `<span>${k}</span>`).join('')}</div><div>${what}</div>`).join('') + '</div>' +
      button('c-back', 'Back', 'Back (←)', 'back') + button('c-present', 'Presenter view', 'Presenter view (S)', 'display') +
      button('c-edit', 'Edit view', 'Edit view (E)', 'pencil') + button('c-help', 'Keyboard shortcuts', 'Keyboard shortcuts', 'help') +
      button('c-fwd', 'Forward', 'Forward (→)', 'forward');
    const help = box.firstChild, helpButton = box.querySelector('.c-help');
    // the shortcuts stay up, with the buttons, until dismissed
    const showHelp = on => {
      help.hidden = !on;
      box.classList.toggle('open', on);
      helpButton.setAttribute('aria-expanded', on);
    };
    showHelp(false);
    box.addEventListener('mousedown', e => e.preventDefault());
    helpButton.addEventListener('click', () => showHelp(help.hidden));
    box.querySelector('.c-back').addEventListener('click', () => act('ArrowLeft'));
    box.querySelector('.c-edit').addEventListener('click', () => { showHelp(false); act('e'); });
    box.querySelector('.c-fwd').addEventListener('click', () => act('ArrowRight'));
    box.querySelector('.c-present').addEventListener('click', () => { showHelp(false); act('s'); });
    // a click elsewhere only dismisses them: seen first, so the slide does not advance as well
    addEventListener('click', e => {
      if (help.hidden || box.contains(e.target)) return;
      showHelp(false);
      e.stopPropagation();
    }, true);
    addEventListener('keydown', e => { if (['Escape', 'e', 'E'].includes(e.key)) showHelp(false); });
    document.body.append(box);
    addEventListener('pointermove', e => box.classList.toggle('near', e.clientX < 320 && e.clientY > innerHeight - 140));
    document.documentElement.addEventListener('mouseleave', () => box.classList.remove('near'));
  }

  // fit the slide to the window, or in the edit view to the room between its panes
  function fit() {
    const root = document.documentElement.style;
    // a ?view pane is always 16:9, so it fills its frame: no sub-pixel bar of the page behind the slide
    if (!editing) return root.setProperty('--scale', Math[mode === 'view' ? 'max' : 'min'](innerWidth / 1920, innerHeight / 1080));
    const rail = railOn ? RAIL_W : 0, pane = paneOn ? PANE_W : 0;
    const w = innerWidth - rail - pane - 2 * GAP, h = innerHeight - BAR_H - STATUS_H - (notes.hidden ? 0 : NOTES_H) - 2 * GAP;
    root.setProperty('--scale', Math.max(.05, Math.min(w / 1920, h / 1080)));
    root.setProperty('--edit-rail', rail + 'px');
    root.setProperty('--edit-pane', pane + 'px');
    root.setProperty('--edit-x', rail + GAP + w / 2 + 'px');
    root.setProperty('--edit-y', BAR_H + GAP + h / 2 + 'px');
  }
  addEventListener('resize', fit);
  fit();
  show(i);
  // opened as index.html?print (the landing page's Print button): print once images and fonts are in
  if (params.has('print')) addEventListener('load', () => document.fonts.ready.then(() => print()));

  // presenter window: current slide, next slide, notes and timer; both slides are this file opened as ?view
  if (mode === 'presenter') {
    const css = document.createElement('style');
    css.textContent = `
      @media screen{
        html.presenter,html.presenter body{background:#1C1C1E}
        html.presenter #stage{display:none}
        /* PowerPoint's Presenter View in the manner of macOS: timer on top, current slide left, next slide above the notes right */
        #presenter{position:fixed;inset:0;box-sizing:border-box;padding:12px 20px 16px;display:grid;row-gap:12px;
          grid-template:"top top top" auto "cur vbar side" minmax(0,1fr) / minmax(0,var(--cur-w,62%)) 20px minmax(0,1fr);
          color:#F5F5F7;font:400 15px/1.4 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        #presenter [hidden]{display:none!important}
        .p-top{grid-area:top;display:flex;align-items:center;gap:8px}
        html.presenter #timer{position:static;padding:0 8px 0 0;background:none;border:0;color:#F5F5F7;
          font:500 28px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
        .p-link{padding:5px 12px;border-radius:999px;background:rgba(255,69,58,.18);color:#FF6961;font-size:13px;font-weight:500}
        .p-clock{margin-left:auto;color:#98989D;font:500 20px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
        #presenter button{display:grid;place-items:center;padding:0;border:0;background:rgba(255,255,255,.1);color:#F5F5F7;cursor:pointer}
        #presenter button:hover{background:rgba(255,255,255,.18)}
        .p-pause,.p-reset{width:30px;height:30px;border-radius:50%}
        .p-pause svg{fill:currentColor}
        .p-vbar{grid-area:vbar;cursor:col-resize}
        .p-hbar{flex:none;height:20px;cursor:row-resize}
        .p-vbar,.p-hbar{position:relative;touch-action:none}
        /* a hairline that thickens under the pointer */
        .p-vbar::after,.p-hbar::after{content:"";position:absolute;border-radius:2px;background:rgba(255,255,255,.12)}
        .p-vbar::after{top:0;bottom:0;left:9.5px;width:1px}
        .p-hbar::after{left:0;right:0;top:9.5px;height:1px}
        .p-vbar:hover::after,.p-vbar.p-drag::after{left:8px;width:4px;background:rgba(255,255,255,.35)}
        .p-hbar:hover::after,.p-hbar.p-drag::after{top:8px;height:4px;background:rgba(255,255,255,.35)}
        /* a slide pane holds the largest 16:9 slide that fits */
        .p-slide,.p-next{container-type:size;display:grid;place-items:center}
        #presenter iframe{display:block;width:min(100cqw,calc(100cqh * 16 / 9));aspect-ratio:16/9;border:0;border-radius:10px;background:#000;pointer-events:none}
        .p-cur{grid-area:cur;display:flex;flex-direction:column;gap:12px;min-height:0}
        .p-slide{flex:1;min-height:0}
        .p-nav{flex:none;display:flex;align-items:center;justify-content:center;gap:16px}
        /* previous, the count and next in one capsule */
        .p-ctl{display:flex;align-items:center;gap:8px;padding:4px;border-radius:999px;background:#2C2C2E}
        #presenter .p-ctl button{width:36px;height:36px;border-radius:50%;background:none}
        #presenter .p-ctl button:hover{background:rgba(255,255,255,.12)}
        .p-count{font-size:14px;font-weight:500;font-variant-numeric:tabular-nums}
        .p-left{color:#98989D;font-size:13px}
        .p-side{grid-area:side;display:flex;flex-direction:column;min-width:0;min-height:0}
        .p-label{flex:none;margin-bottom:8px;font-size:13px;font-weight:500;color:#98989D}
        .p-next{position:relative;flex:none;width:100%;aspect-ratio:16/9}
        #presenter.sized .p-next{flex:0 1 var(--next-h);min-height:80px;aspect-ratio:auto}
        .p-end{position:absolute;inset:0;display:grid;place-items:center;border-radius:10px;background:#000;color:#98989D}
        .p-notes{flex:1;position:relative;min-height:80px}
        html.presenter #notes{position:absolute;inset:0;max-height:none;overflow:auto;padding:16px 20px;border:0;border-radius:10px;
          background:#2C2C2E;color:#F5F5F7;font:400 24px/1.5 system-ui,sans-serif}
        html.presenter #notes::before{margin-bottom:10px;font:500 13px/1 system-ui,sans-serif;letter-spacing:0;text-transform:none;color:#98989D}
        .p-size{position:absolute;top:10px;right:12px;z-index:11;display:flex;gap:4px}
        #presenter .p-size button{padding:5px 9px;border-radius:7px;font:500 13px/1 system-ui,sans-serif}
      }
      @media print{#presenter{display:none}}`;
    document.head.append(css);
    document.documentElement.classList.add('presenter');
    document.title = 'Presenter: ' + document.title;
    const ui = document.createElement('div');
    ui.id = 'presenter';
    ui.innerHTML =
      `<div class="p-top"><button type="button" class="p-pause" aria-label="Pause or resume the timer" title="Pause or resume the timer">${icon('play')}</button>` +
      `<button type="button" class="p-reset" aria-label="Reset the timer" title="Reset the timer">${icon('reset')}</button>` +
      '<div class="p-link" hidden>Not linked: press S in the deck window</div><span class="p-clock"></span></div>' +
      '<div class="p-cur"><div class="p-slide"><iframe tabindex="-1" title="Current slide"></iframe></div>' +
      `<div class="p-nav"><div class="p-ctl"><button type="button" class="p-back" aria-label="Previous" title="Previous">${icon('back', 18)}</button>` +
      `<div class="p-count"></div><button type="button" class="p-fwd" aria-label="Next" title="Next">${icon('forward', 18)}</button></div>` +
      '<div class="p-left"></div></div></div>' +
      '<div class="p-vbar" title="Drag to resize, double-click to reset"></div>' +
      '<div class="p-side"><div class="p-label">Next slide</div>' +
      '<div class="p-next"><iframe tabindex="-1" title="Next slide or build"></iframe><div class="p-end" hidden>End of deck</div></div>' +
      '<div class="p-hbar" title="Drag to resize, double-click to reset"></div>' +
      '<div class="p-notes"><div class="p-size">' +
      '<button type="button" aria-label="Smaller notes">A−</button><button type="button" aria-label="Larger notes">A+</button></div></div></div>';
    const $ = s => ui.querySelector(s);
    pv = { cur: $('.p-cur iframe'), next: $('.p-next iframe'), label: $('.p-label'), end: $('.p-end'), count: $('.p-count'),
      left: $('.p-left'), clock: $('.p-clock'), link: $('.p-link'), pause: $('.p-pause path'), last: null, seen: 0 };
    // a pane that finishes loading after the last update gets that update again
    [pv.cur, pv.next].forEach(f => {
      f.addEventListener('load', () => pv.last && render(...pv.last));
      f.src = here + '?view';
    });
    $('.p-top').prepend(timer);
    $('.p-notes').prepend(notes);
    notes.hidden = false;

    // the buttons never take focus, so Space and the arrows keep steering the deck
    ui.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    $('.p-back').addEventListener('click', () => act('ArrowLeft'));
    $('.p-fwd').addEventListener('click', () => act('ArrowRight'));
    $('.p-pause').addEventListener('click', pauseTimer);
    $('.p-reset').addEventListener('click', resetTimer);

    // notes size, remembered in this browser
    const SIZES = [16, 18, 20, 24, 28, 32, 40];
    let size = SIZES.indexOf(24);
    try { const s = SIZES.indexOf(+localStorage.getItem('deck:presenter-notes-size')); if (s >= 0) size = s; } catch {}
    const resize = d => {
      size = Math.max(0, Math.min(SIZES.length - 1, size + d));
      notes.style.fontSize = SIZES[size] + 'px';
      try { localStorage.setItem('deck:presenter-notes-size', SIZES[size]); } catch {}
    };
    ui.querySelectorAll('.p-size button').forEach((b, n) => b.addEventListener('click', () => resize(n ? 1 : -1)));
    resize(0);

    // drag the bars between the panes to resize them, double-click a bar to reset it; remembered like the notes size
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    let layout = { w: 62, h: 0 };  // current slide: % of the width; next slide: vh, 0 = as tall as 16:9 needs
    try { const l = JSON.parse(localStorage.getItem('deck:presenter-layout')) || {}; layout = { w: clamp(+l.w || 62, 25, 80), h: +l.h ? clamp(+l.h, 15, 75) : 0 }; } catch {}
    const relayout = () => {
      ui.style.setProperty('--cur-w', layout.w + '%');
      ui.style.setProperty('--next-h', layout.h + 'vh');
      ui.classList.toggle('sized', layout.h > 0);
      try { localStorage.setItem('deck:presenter-layout', JSON.stringify(layout)); } catch {}
    };
    const bar = (el, move, reset) => {
      el.addEventListener('pointerdown', e => {
        e.preventDefault();  // no focus, no text selection: the keys keep steering the deck
        el.setPointerCapture(e.pointerId);
        el.classList.add('p-drag');
        const onMove = ev => { move(ev); relayout(); };
        const done = () => {
          el.classList.remove('p-drag');
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', done);
          el.removeEventListener('pointercancel', done);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', done);
        el.addEventListener('pointercancel', done);
      });
      el.addEventListener('dblclick', () => { reset(); relayout(); });
    };
    // the pointer stays on the middle of the 20 px bar, past the 20 px padding
    bar($('.p-vbar'), ev => { layout.w = clamp((ev.clientX - 30) / (ui.clientWidth - 40) * 100, 25, 80); }, () => { layout.w = 62; });
    bar($('.p-hbar'), ev => { layout.h = clamp((ev.clientY - 10 - pv.next.parentElement.getBoundingClientRect().top) / innerHeight * 100, 15, 75); }, () => { layout.h = 0; });
    relayout();
    document.body.append(ui);

    // heartbeat: the deck answers every hello with its state, which also re-links after the deck window reloads
    const hello = () => opener?.postMessage({ deck: 'hello' }, '*');
    setInterval(hello, 2000);
    hello();
    // clock, and the badge when there is no deck window or nothing came from it for 5 s
    const status = () => {
      pv.clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      pv.link.hidden = !!opener && !opener.closed && Date.now() - pv.seen < 5000;
    };
    setInterval(status, 1000);
    status();
  }

  // edit view (E, deck window only), laid out like PowerPoint's Normal view: thumbnails left, the slide with its notes below,
  // suggestions right. The cursor outlines the element under it; click it, or click the background to pin a spot, or drag
  // to box an area, and type the suggestion in the box that opens beside it. Copy prompt puts them all on the clipboard as
  // one prompt. Kept per deck in this browser.
  function edit(on) {
    if (!ed) buildEdit();
    editing = on;
    store.set(on ? '1' : '', EDIT_KEY);
    document.documentElement.classList.toggle('editing', on);
    notes.hidden = !on;
    fit();
    if (on) show(i, true);
    else closeAsk();
  }
  function buildEdit() {
    const css = document.createElement('style');
    css.textContent = `
      @media screen{
        #edit,#edit-bar,#edit-rail,#edit-status,#edit-layer{display:none}
        html.editing,html.editing body{background:#F5F5F7}
        html.editing #stage{left:var(--edit-x);top:var(--edit-y);box-shadow:0 calc(4px / var(--scale)) calc(30px / var(--scale)) rgba(0,0,0,.14)}
        /* nothing moves here: outlines are measured from what is on the slide */
        html.editing .build{transition:none}
        html.editing .slide,html.editing .slide *{animation:none!important}
        html.editing #edit-layer{display:block;position:absolute;inset:0;z-index:5;cursor:default;touch-action:none}
        /* marks sit in the scaled slide; dividing by --scale keeps their lines and numbers one size on screen.
           A thin dark edge keeps the orange visible on any slide */
        .e-mark{position:absolute;pointer-events:none}
        .e-mark span{position:absolute;left:0;bottom:100%;width:30px;height:30px;display:grid;place-items:center;
          border-radius:50% 50% 50% 0;background:radial-gradient(circle,#fff 0 11px,#007AFF 11.5px);color:#1D1D1F;
          font:600 11px/1 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);transform:scale(calc(1 / var(--scale)));
          transform-origin:0 100%;pointer-events:auto;cursor:pointer}
        .e-box,.e-hover{box-sizing:border-box;border:calc(2px / var(--scale)) solid #FF9500;border-radius:calc(4px / var(--scale));
          box-shadow:0 0 0 calc(1px / var(--scale)) rgba(0,0,0,.25)}
        #edit-layer>.e-box{border-style:dashed}
        .e-mark.e-lit{box-shadow:0 0 0 calc(4px / var(--scale)) rgba(0,122,255,.45)}
        .e-mark.e-lit span{transform:scale(calc(1.2 / var(--scale)))}
        /* its element is gone or changed */
        .e-box.e-stale{border-style:dashed;border-color:#8E8E93}
        .e-mark.e-stale span{background:radial-gradient(circle,#fff 0 11px,#8E8E93 11.5px)}
        /* the panes: light, hairlines and borderless controls in the manner of macOS, in the system's font whatever the deck's fonts are */
        html.editing #edit-bar,html.editing #edit-rail,html.editing #edit,html.editing #edit-status{position:fixed;z-index:20;box-sizing:border-box;
          color:#1D1D1F;font:400 13px/1.4 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        html.editing #edit-bar{top:0;left:0;right:0;height:${BAR_H}px;display:flex;align-items:center;gap:4px;padding:0 12px 0 16px;
          background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
          border-bottom:1px solid rgba(0,0,0,.1)}
        .e-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
        #edit-bar button,.e-foot button,#edit-status button{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;min-width:30px;
          padding:0 7px;border:0;border-radius:8px;background:none;color:#1D1D1F;font:500 13px/1 system-ui,sans-serif;cursor:pointer}
        #edit-bar button:hover,.e-foot button:hover,#edit-status button:hover{background:rgba(0,0,0,.06)}
        .e-show svg{fill:currentColor}
        #edit-bar .e-copy{margin-left:8px;padding:0 12px;background:#007AFF;color:#fff}
        #edit-bar .e-copy:hover{background:#0068D9}
        #edit-bar button:disabled,.e-foot button:disabled{opacity:.4;pointer-events:none}
        html.editing #edit-rail{display:block;top:${BAR_H}px;left:0;bottom:${STATUS_H}px;width:${RAIL_W}px;overflow:auto;padding:12px 14px 12px 6px;
          background:#FBFBFD;border-right:1px solid rgba(0,0,0,.1)}
        .e-thumb{position:relative;display:grid;grid-template-columns:22px 1fr;align-items:start;margin-bottom:12px;cursor:pointer}
        .e-thumb-count{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;box-sizing:border-box;padding:0 5px;border-radius:9px;background:#007AFF;
          color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
        .e-thumb-n{padding:1px 7px 0 0;color:#6E6E73;font-size:11px;font-variant-numeric:tabular-nums;text-align:right}
        .e-thumb-frame{display:block;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.1)}
        .e-thumb:hover .e-thumb-frame{box-shadow:0 0 0 1px rgba(0,0,0,.25)}
        .e-thumb.e-cur .e-thumb-frame{box-shadow:0 0 0 2.5px #007AFF}
        .e-thumb.e-cur .e-thumb-n{color:#1D1D1F;font-weight:600}
        .e-thumb iframe{display:block;width:100%;height:100%;border:0;pointer-events:none}
        html.editing #notes{position:fixed;z-index:10;left:var(--edit-rail);right:var(--edit-pane);bottom:${STATUS_H}px;height:${NOTES_H}px;max-height:none;box-sizing:border-box;
          padding:12px 20px;background:#fff;color:#1D1D1F;border-top:1px solid rgba(0,0,0,.1);font:400 13px/1.5 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        html.editing #notes::before{margin-bottom:8px;font:600 12px/1 system-ui,sans-serif;letter-spacing:0;text-transform:none;color:#6E6E73}
        html.editing #edit-status{left:0;right:0;bottom:0;height:${STATUS_H}px;display:flex;align-items:center;justify-content:space-between;
          padding:0 6px 0 16px;background:#F5F5F7;border-top:1px solid rgba(0,0,0,.1);color:#6E6E73;font-size:12px}
        #edit-status button{height:24px;min-width:24px;padding:0 4px;color:#6E6E73}
        #edit-status button[aria-pressed=false]{color:#AEAEB2}
        .e-status-buttons{display:flex;gap:2px}
        html.editing #edit{top:${BAR_H}px;right:0;bottom:${STATUS_H}px;width:${PANE_W}px;display:flex;flex-direction:column;
          background:#FBFBFD;border-left:1px solid rgba(0,0,0,.1)}
        .e-head{flex:none;display:flex;align-items:center;gap:6px;padding:14px 16px 10px;font-weight:600}
        .e-head svg{color:#6E6E73}
        .e-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 28px;color:#6E6E73;text-align:center}
        .e-list{flex:1;min-height:0;overflow:auto;padding-bottom:8px}
        /* one label per slide, then its suggestions as rows: click one to edit it, remove on hover */
        .e-go{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:10px 16px 4px;border:0;border-top:1px solid rgba(0,0,0,.08);
          background:none;color:#6E6E73;font:600 12px/1.4 system-ui,sans-serif;text-align:left;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;cursor:pointer}
        .e-go:first-child{margin-top:0;border-top:0}
        .e-go:hover,.e-go.e-cur{color:#1D1D1F}
        .e-item{position:relative;display:grid;grid-template-columns:26px 1fr;margin:0 8px;padding:8px 32px 8px 8px;border-radius:8px;cursor:pointer}
        .e-item:hover,.e-item.e-lit{background:rgba(0,0,0,.05)}
        .e-n{grid-row:1/3;font:600 12px/1.6 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#AEAEB2}
        .e-cur .e-n{color:#007AFF}
        .e-note{white-space:pre-wrap;overflow-wrap:anywhere}
        .e-note:empty::before{content:"Describe the change";color:#6E6E73}
        .e-el{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6E6E73;font-size:12px}
        .e-del{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:none;
          color:#6E6E73;cursor:pointer;opacity:0}
        .e-item:hover .e-del{opacity:1}
        .e-del:hover{background:rgba(0,0,0,.08);color:#1D1D1F}
        .e-changed{margin-right:6px;padding:1px 6px;border-radius:999px;background:rgba(0,0,0,.07);color:#3A3A3C;font-weight:500}
        .e-foot{flex:none;display:flex;padding:8px 10px;border-top:1px solid rgba(0,0,0,.1)}
        .e-foot .e-clear{margin-left:auto}
        /* the box that opens beside a selection: what it is about, the field, delete and save */
        #edit-ask{position:fixed;z-index:30;width:380px;box-sizing:border-box;padding:12px 14px 10px;border-radius:14px;background:rgba(255,255,255,.9);
          -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);color:#1D1D1F;
          box-shadow:0 0 0 .5px rgba(0,0,0,.15),0 16px 48px rgba(0,0,0,.28);font:400 14px/1.45 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        .e-ask-path{overflow:hidden;white-space:pre;text-overflow:ellipsis;color:#6E6E73;font-size:12px}
        .e-crumb{padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
        .e-crumb:hover{color:#007AFF}
        .e-crumb.e-at{color:#1D1D1F;font-weight:600}
        #edit-ask textarea{display:block;width:100%;max-height:180px;box-sizing:border-box;margin:8px 0 6px;padding:2px 0;border:0;outline:none;
          background:none;color:#1D1D1F;font:inherit;resize:none}
        #edit-ask textarea::placeholder{color:#6E6E73}
        .e-ask-foot{display:flex;justify-content:flex-end;align-items:center;gap:6px}
        .e-ask-foot button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:50%;cursor:pointer}
        .e-ask-del{background:none;color:#6E6E73}
        .e-ask-del:hover{background:rgba(0,0,0,.06);color:#1D1D1F}
        .e-ask-send{background:#007AFF;color:#fff}
        #edit-ask .e-ask-send:disabled{background:#D1D1D6;cursor:default}
      }
      @media print{#edit,#edit-bar,#edit-rail,#edit-status,#edit-layer,#edit-ask{display:none}}`;
    document.head.append(css);
    const layer = document.createElement('div');
    layer.id = 'edit-layer';
    layer.innerHTML = '<div class="e-marks"></div><div class="e-mark e-box" hidden></div><div class="e-mark e-hover" hidden></div>';
    const bar = document.createElement('div');
    bar.id = 'edit-bar';
    bar.innerHTML = `<span class="e-name"></span><button type="button" class="e-show" aria-label="Slide Show" title="Slide Show">${icon('play')}</button>` +
      `<button type="button" class="e-present" aria-label="Presenter View" title="Presenter View">${icon('display')}</button>` +
      `<button type="button" class="e-copy">${icon('copy')}<span>Copy prompt</span></button>`;
    bar.firstChild.textContent = document.title;
    // the thumbnails are this file opened as ?view, like the presenter's panes, loaded as they scroll into sight
    const rail = document.createElement('div');
    rail.id = 'edit-rail';
    const thumbs = slides.map((_, n) => {
      const t = document.createElement('div');
      t.className = 'e-thumb';
      t.innerHTML = `<span class="e-thumb-n">${n + 1}</span><span class="e-thumb-frame"><iframe tabindex="-1" loading="lazy" title="Slide ${n + 1}"></iframe></span>` +
        '<span class="e-thumb-count" hidden></span>';
      const f = t.querySelector('iframe');
      f.addEventListener('load', () => f.contentWindow.postMessage({ deck: 'view', i: n, k: -1 }, '*'));
      f.src = here + '?view';
      t.addEventListener('click', () => show(n, true));
      return t;
    });
    rail.append(...thumbs);
    const status = document.createElement('div');
    status.id = 'edit-status';
    status.innerHTML = '<span class="e-where"></span><div class="e-status-buttons">' +
      `<button type="button" class="e-toggle-rail" aria-label="Thumbnails" aria-pressed="true" title="Show or hide the thumbnails">${icon('paneLeft')}</button>` +
      `<button type="button" class="e-notes" aria-label="Notes" title="Show or hide the notes">${icon('notes')}</button>` +
      `<button type="button" class="e-toggle-pane" aria-label="Suggestions" aria-pressed="true" title="Show or hide the suggestions">${icon('paneRight')}</button></div>`;
    const panel = document.createElement('div');
    panel.id = 'edit';
    panel.innerHTML =
      `<div class="e-head">${icon('bubble')}Suggestions</div>` +
      `<div class="e-empty">${icon('bubble', 28)}Click an element on the slide to suggest a change. Click the background to pin a spot, or drag to box an area.</div>` +
      `<div class="e-list"></div><div class="e-foot"><button type="button" class="e-undo" hidden>${icon('reset')}<span>Undo</span></button>` +
      `<button type="button" class="e-clear">${icon('trash')}<span>Clear</span></button></div>`;
    const ask = document.createElement('div');
    ask.id = 'edit-ask';
    ask.hidden = true;
    ask.innerHTML = '<div class="e-ask-path"></div><textarea rows="1" placeholder="Describe the change"></textarea><div class="e-ask-foot">' +
      `<button type="button" class="e-ask-del" aria-label="Delete suggestion" title="Delete suggestion">${icon('trash')}</button>` +
      `<button type="button" class="e-ask-send" aria-label="Save suggestion" title="Save suggestion">${icon('up')}</button></div>`;
    const $ = s => panel.querySelector(s);
    ed = { layer, marks: layer.firstChild, draft: layer.children[1], hover: layer.lastChild, list: $('.e-list'), empty: $('.e-empty'), copy: bar.querySelector('.e-copy'),
      clear: $('.e-clear'), undo: $('.e-undo'), thumbs, where: status.firstChild, ask, ta: ask.querySelector('textarea'), path: ask.firstChild,
      send: ask.querySelector('.e-ask-send'), open: null, key: 'deck:edit:' + location.pathname, items: [] };
    // a suggestion still empty when the page went away is not kept
    try { ed.items = (JSON.parse(localStorage.getItem(ed.key)) || []).filter(s => s.note.trim()); } catch {}
    // the deck may have changed since they were made
    ed.items.forEach(locate);
    ed.items.sort((x, y) => x.slide - y.slide);
    saveEdit();

    // the composer: typing saves as you go, Enter (or the round button) closes it, Shift+Enter is a new line, Esc closes it
    ed.ta.addEventListener('input', () => {
      ed.open.note = ed.ta.value;
      saveEdit();
      ed.list.querySelectorAll('.e-note')[ed.items.indexOf(ed.open)].textContent = ed.ta.value;
      ed.send.disabled = !ed.ta.value.trim();
      ed.copy.disabled = !ed.items.some(s => s.note.trim());
      drawCounts();
      placeAsk();
    });
    ed.ta.addEventListener('keydown', e => {
      // while the box is empty, ↑ and ↓ widen and narrow what is selected
      const step = !ed.ta.value && { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (step) {
        e.preventDefault();
        if (ed.chain[ed.level + step]) reselect(ed.level + step);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || e.key === 'Escape') {
        e.preventDefault();
        if (closeAsk()) drawEdit();
      }
    });
    ed.send.addEventListener('click', () => { if (closeAsk()) drawEdit(); });
    ask.querySelector('.e-ask-del').addEventListener('click', () => {
      if (ed.open.note.trim()) offerUndo();
      ed.open.note = '';
      drawEdit();
    });
    // a press on a level changes what is selected, and the box keeps the focus
    ed.path.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    // a press anywhere else closes it too
    addEventListener('pointerdown', e => { if (ed.open && !ask.contains(e.target) && closeAsk()) drawEdit(); }, true);
    addEventListener('resize', () => { if (ed.open) placeAsk(); });

    // the cursor outlines the element under it, unless a drag or the composer is under way
    layer.addEventListener('pointermove', e => {
      const el = !e.buttons && !ed.open && pick(e.clientX, e.clientY);
      ed.hover.hidden = !el;
      if (el) outline(ed.hover, frame(el));
    });
    layer.addEventListener('pointerleave', () => { ed.hover.hidden = true; });

    // press, drag and let go on the slide: over 8 slide px of movement is a box, less is a click, which selects the
    // element there, or pins the spot on the background
    layer.addEventListener('pointerdown', e => {
      if (e.button) return;
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      const a = at(e);
      let b = a;
      const big = () => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) >= 8;
      const rect = () => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
      const move = ev => {
        b = at(ev);
        ed.draft.hidden = !big();
        outline(ed.draft, rect());
      };
      const done = ev => {
        layer.removeEventListener('pointermove', move);
        layer.removeEventListener('pointerup', done);
        layer.removeEventListener('pointercancel', done);
        ed.draft.hidden = true;
        if (ev.type !== 'pointerup') return;
        b = at(ev);
        const el = !big() && pick(ev.clientX, ev.clientY);
        if (big()) addSuggestion('box', rect());
        else if (el) addSuggestion('box', measure(el), el);
        else addSuggestion('pin', { x: a.x, y: a.y, w: 0, h: 0 });
      };
      layer.addEventListener('pointermove', move);
      layer.addEventListener('pointerup', done);
      layer.addEventListener('pointercancel', done);
    });
    // the buttons never take focus, so Space and the arrows keep steering the deck
    for (const p of [bar, panel, status]) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    bar.querySelector('.e-show').addEventListener('click', () => edit(false));
    bar.querySelector('.e-present').addEventListener('click', () => act('s'));
    status.querySelector('.e-notes').addEventListener('click', () => act('n'));
    // a side pane folds away, and the slide takes its room; for this visit only
    const togglePane = (button, pane, set) => button.addEventListener('click', () => {
      pane.hidden = !pane.hidden;
      button.setAttribute('aria-pressed', !pane.hidden);
      set(!pane.hidden);
      fit();
    });
    togglePane(status.querySelector('.e-toggle-rail'), rail, on => { railOn = on; });
    togglePane(status.querySelector('.e-toggle-pane'), panel, on => { paneOn = on; });
    ed.undo.addEventListener('click', () => {
      ed.items = ed.saved;
      ed.undo.hidden = true;
      saveEdit();
      drawEdit();
    });
    ed.copy.addEventListener('click', () => copyText(editPrompt()).then(ok => {
      ed.copy.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { ed.copy.lastChild.textContent = 'Copy prompt'; }, 2000);
    }));
    // Clear wants a second click within 3 s
    ed.clear.addEventListener('click', () => {
      if (ed.clear.textContent === 'Clear') {
        ed.clear.lastChild.textContent = 'Click again';
        setTimeout(() => { ed.clear.lastChild.textContent = 'Clear'; }, 3000);
        return;
      }
      offerUndo();
      ed.items = [];
      ed.clear.lastChild.textContent = 'Clear';
      saveEdit();
      drawEdit();
    });
    stage.append(layer);
    document.body.append(bar, rail, status, panel, ask);
  }
  function saveEdit() { try { localStorage.setItem(ed.key, JSON.stringify(ed.items)); } catch {} }
  // before deleting: remember the suggestions, and offer them back for a few seconds
  function offerUndo() {
    ed.saved = ed.items.filter(s => s.note.trim()).map(s => ({ ...s }));
    ed.undo.hidden = false;
    clearTimeout(ed.undoTimer);
    ed.undoTimer = setTimeout(() => { ed.undo.hidden = true; }, 6000);
  }
  // the pointer, and an element's box, in the slide's 1920x1080 frame
  function at(e) {
    const L = ed.layer.getBoundingClientRect(), k = L.width / 1920;
    return { x: Math.round(Math.max(0, Math.min(1920, (e.clientX - L.left) / k))),
      y: Math.round(Math.max(0, Math.min(1080, (e.clientY - L.top) / k))) };
  }
  function frame(el) {
    const L = ed.layer.getBoundingClientRect(), k = L.width / 1920, q = el.getBoundingClientRect();
    return { x: (q.left - L.left) / k, y: (q.top - L.top) / k, w: q.width / k, h: q.height / k };
  }
  function measure(el) {
    const f = frame(el);
    return { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) };
  }
  // place a mark on the slide
  function outline(m, r) { m.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; }
  // the deepest element of the current slide at a point of the window, or nothing on its background; a drawing counts as one
  function pick(x, y) {
    const el = document.elementsFromPoint(x, y).find(e => slides[i].contains(e) && !e.closest('.counter, .s-notes'));
    return el === slides[i] ? null : el?.closest('svg') || el;
  }
  // text as written in the deck, not as styled: its text nodes joined by spaces, without the notes and the slide counter
  function textOf(el) {
    const c = el.cloneNode(true), w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), t = [];
    c.querySelectorAll('.s-notes, .counter').forEach(n => n.remove());
    while (w.nextNode()) t.push(w.currentNode.data);
    return t.join(' ').replace(/\s+/g, ' ').trim();
  }
  const clip = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // a selector for an element in the deck as it is now
  function pathOf(el) {
    const steps = [];
    for (; el.id !== 'stage'; el = el.parentElement) steps.unshift(`${el.localName}:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`);
    return '#stage > ' + steps.join(' > ');
  }
  const slideOf = el => slides.find(x => x.contains(el));
  function headingOf(slide) {
    const h = slide.querySelector('h1, h2, h3, blockquote');
    return h ? clip(textOf(h), 60) : '';
  }
  // what a suggestion records about its element: how the deck writes it, and where to find it again
  function describe(el) {
    // its HTML as written in the deck: without the slide counter and the classes the engine adds
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.counter').forEach(c => c.remove());
    [clone, ...clone.querySelectorAll('.on, .current')].forEach(c => c.classList.remove('on', 'current'));
    return { heading: headingOf(slideOf(el)), whole: slides.includes(el), path: pathOf(el),
      el: el.localName + [...el.classList].filter(c => c !== 'on' && c !== 'current').map(c => '.' + c).join(''),
      text: clip(textOf(el), 80), html: clip(clone.outerHTML.replace(/ class=""/g, ''), 800) };
  }
  // is this element, or slide, still what the suggestion was about?
  function same(el, s) {
    if (s.whole) return headingOf(el) === s.heading;
    return el.localName === s.el.split('.')[0] && (s.text ? clip(textOf(el), 80) === s.text : describe(el).html === s.html);
  }
  // find a suggestion's element in the deck as it is now: where it was, or else the one element anywhere that matches.
  // Two that match is no answer. Suggestions saved before they had a path are left as they are
  function locate(s) {
    if (!s.path) return;
    let at = null;
    try { at = document.querySelector(s.path); } catch {}
    const inDeck = at && slideOf(at) && !at.closest('.counter, .s-notes') && same(at, s);
    const found = inDeck ? [at] : (s.whole ? slides : slides.flatMap(x => [...x.querySelectorAll('*')]))
      .filter(el => !el.closest('.counter, .s-notes') && same(el, s));
    s.stale = found.length !== 1;
    if (s.stale) s.slide = Math.min(s.slide, slides.length - 1);
    else Object.assign(s, describe(found[0]), { slide: slides.indexOf(slideOf(found[0])) });
  }
  // a suggestion's element, or nothing when that is gone or was never recorded
  const elementOf = s => s.path && !s.stale ? document.querySelector(s.path) : null;
  // select another level of what the open suggestion is about; its note stays
  function reselect(n) {
    const s = ed.open, el = ed.chain[n];
    ed.level = n;
    Object.assign(s, describe(el), measure(el), { kind: 'box', picked: true });
    saveEdit();
    ed.open = null;  // so that drawing does not drop it while it is still empty
    drawEdit();
    openAsk(s, true);
  }
  function addSuggestion(kind, r, el) {
    const slide = slides[i], picked = !!el;
    // what it is about: the element picked, or the one under the point (of a box: its centre), widened until it covers
    // 85 % of the box, so a box drawn a little loose still lands on the element it was drawn around
    const L = ed.layer.getBoundingClientRect(), k = L.width / 1920;
    el ||= pick(L.left + (r.x + r.w / 2) * k, L.top + (r.y + r.h / 2) * k) || slide;
    const cover = q => Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x)) *
      Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y)) / (r.w * r.h);
    while (r.w && r.h && el !== slide && cover(frame(el)) < .85) el = el.parentElement;
    const s = { slide: i, kind, ...r, ...describe(el), picked, note: '' };
    ed.items.push(s);
    ed.items.sort((x, y) => x.slide - y.slide);
    saveEdit();
    drawEdit();
    openAsk(s);
  }
  // open the composer for a suggestion, under what it is about (above it when there is no room), left of the panel
  function openAsk(s, sameLevels) {
    if (!sameLevels) {
      ed.chain = [];
      ed.level = 0;
      // from the element up to its slide; a pin only has the slide
      for (let el = elementOf(s); el && el.id !== 'stage'; el = el.parentElement) ed.chain.push(el);
    }
    ed.open = s;
    ed.ask.hidden = false;
    ed.ta.value = s.note;
    ed.send.disabled = !s.note.trim();
    ed.hover.hidden = true;
    drawLevels(s);
    placeAsk();
    ed.ta.focus();
  }
  // the top line of the composer: the slide, then the levels that can be selected, the three nearest the current one
  function drawLevels(s) {
    const last = ed.chain.length - 1, from = Math.max(0, Math.min(ed.level - 1, last - 3));
    const crumb = n => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'e-crumb' + (n === ed.level && s.kind !== 'pin' ? ' e-at' : '');
      const el = ed.chain[n], cls = [...el.classList].find(c => c !== 'on' && c !== 'current');
      b.textContent = n === last ? `Slide ${s.slide + 1}` : el.localName + (cls ? '.' + cls : '');
      b.addEventListener('click', () => reselect(n));
      return b;
    };
    const tail = s.kind === 'pin' ? 'point' : s.el + (s.text ? ` "${s.text}"` : '');
    const after = !ed.chain.length || s.kind === 'pin' ? tail : ed.level < last && s.text ? `"${s.text}"` : '';
    const parts = last < 0 ? [`Slide ${s.slide + 1}`] : [crumb(last)];
    if (from + 3 < last) parts.push('…');
    if (s.kind !== 'pin') for (let n = Math.min(from + 2, last - 1); n >= from; n--) parts.push(crumb(n));
    ed.path.replaceChildren(...parts.flatMap((p, n) => n ? [' › ', p] : [p]));
    if (after) ed.path.append((s.kind === 'pin' || !ed.chain.length ? ' › ' : ' ') + after);
  }
  function placeAsk() {
    const s = ed.open, a = ed.ask, L = ed.layer.getBoundingClientRect(), k = L.width / 1920;
    ed.ta.style.height = 'auto';
    ed.ta.style.height = ed.ta.scrollHeight + 'px';
    let top = L.top + (s.y + s.h) * k + 12;
    // above leaves room for the mark's number, 30 px on screen
    if (top + a.offsetHeight > innerHeight - 8) top = Math.max(BAR_H + 8, L.top + s.y * k - 30 - 12 - a.offsetHeight);
    const rail = railOn ? RAIL_W : 0, pane = paneOn ? PANE_W : 0;
    a.style.left = Math.max(rail + 8, Math.min(innerWidth - pane - a.offsetWidth - 8, L.left + s.x * k)) + 'px';
    a.style.top = top + 'px';
  }
  // close the composer; a suggestion left empty goes with it, and then the list needs drawing again
  function closeAsk() {
    const s = ed.open;
    ed.open = null;
    ed.ask.hidden = true;
    ed.ta.blur();  // at once: the next key steers the deck, it does not go to the box that was hidden
    if (!s || s.note.trim() || !ed.items.includes(s)) return false;
    ed.items.splice(ed.items.indexOf(s), 1);
    saveEdit();
    return true;
  }
  // how many suggestions each thumbnail's slide has
  function drawCounts() {
    ed.thumbs.forEach((t, n) => {
      const c = t.querySelector('.e-thumb-count'), count = ed.items.filter(s => s.slide === n && s.note.trim()).length;
      c.hidden = !count;
      c.textContent = count;
    });
  }
  // the list in the panel, one label per slide, and the marks on the current slide, numbered alike; closes the composer
  function drawEdit() {
    closeAsk();
    ed.hover.hidden = true;
    ed.where.textContent = `Slide ${i + 1} of ${slides.length}`;
    ed.thumbs.forEach((t, n) => t.classList.toggle('e-cur', n === i));
    ed.thumbs[i].scrollIntoView({ block: 'nearest' });
    drawCounts();
    ed.marks.replaceChildren();
    ed.list.replaceChildren();
    let moved = false;
    ed.items.forEach((s, n) => {
      const cur = s.slide === i ? ' e-cur' : '';
      // an element selected on this slide may have moved: its outline goes with it
      const live = s.picked && s.slide === i && elementOf(s);
      if (live) {
        const r = measure(live);
        if (r.w && r.h) moved = Object.assign(s, r);
      }
      if (s.slide !== ed.items[n - 1]?.slide) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'e-go' + cur;
        go.textContent = `Slide ${s.slide + 1}${s.heading ? ' · ' + s.heading : ''}`;
        go.addEventListener('click', () => show(s.slide, true));
        ed.list.append(go);
      }
      const item = document.createElement('div');
      item.className = 'e-item' + cur + (s.stale ? ' e-stale' : '');
      item.innerHTML =
        `<span class="e-n">${pad(n + 1)}</span><div class="e-note">${esc(s.note)}</div>` +
        `<div class="e-el">${s.stale ? '<span class="e-changed">Changed</span>' : ''}${esc(s.text ? '"' + s.text + '"' : s.el)}</div>` +
        `<button type="button" class="e-del" aria-label="Remove suggestion" title="Remove suggestion">${icon('close', 12)}</button>`;
      item.addEventListener('click', e => {
        if (e.target.closest('.e-del')) return;
        show(s.slide, true);
        openAsk(s);
      });
      item.querySelector('.e-del').addEventListener('click', () => { offerUndo(); ed.items.splice(n, 1); saveEdit(); drawEdit(); });
      ed.list.append(item);
      if (s.slide !== i) return;
      const m = document.createElement('div');
      m.className = 'e-mark e-' + s.kind + (s.stale ? ' e-stale' : '');
      outline(m, s);
      m.innerHTML = `<span>${pad(n + 1)}</span>`;
      // the outside-press handler has already closed any other composer; this one may have gone with it if it was empty
      m.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (ed.items.includes(s)) openAsk(s); });
      // the row and the mark light up together
      const light = (from, to) => {
        from.addEventListener('mouseenter', () => to.classList.add('e-lit'));
        from.addEventListener('mouseleave', () => to.classList.remove('e-lit'));
      };
      light(item, m);
      light(m.firstChild, item);
      ed.marks.append(m);
    });
    if (moved) saveEdit();
    ed.copy.disabled = !ed.items.some(s => s.note.trim());
    ed.clear.disabled = !ed.items.length;
    ed.empty.hidden = !!ed.items.length;
  }
  // Markdown for an agent working on the deck: its file, then per suggestion its slide, place, element and note
  function editPrompt() {
    // the file name, or its folder for an index.html, which is how such a deck is usually known
    const parts = decodeURIComponent(location.pathname).split('/');
    const last = parts.pop() || 'index.html';
    const file = last === 'index.html' ? [parts.filter(Boolean).pop(), last].filter(Boolean).join('/') : last;
    return `Improve the deck \`${file}\` with the suggestions below. Slides are the \`<section class="slide">\` elements, ` +
      'numbered from 1 in document order. Positions are in the 1920×1080 slide frame, origin top left. ' +
      'Each Element is a CSS selector for it in the deck as it was when suggested. ' +
      "Keep to the deck's existing conventions.\n\n" +
      ed.items.filter(s => s.note.trim()).map((s, n) =>
        `## ${n + 1}. Slide ${s.slide + 1}${s.heading ? ': ' + s.heading : ''}\n\n` +
        `Where: ${s.kind === 'pin' ? `point x ${s.x}, y ${s.y}` : `box x ${s.x}-${s.x + s.w}, y ${s.y}-${s.y + s.h}`}, ` +
        `on \`${s.el}\`${s.text ? ` "${s.text}"` : ''}\n\n` +
        (s.path ? `Element: \`${s.path}\`\n\n` : '') +
        (s.stale ? 'This element has changed since the suggestion was made, so it may already be done.\n\n' : '') +
        `Suggestion: ${s.note.trim()}`).join('\n\n') + '\n';
  }
  // the clipboard API, or the older execCommand where a browser refuses it
  function copyText(text) {
    const old = () => {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.append(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    };
    return navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, old) : Promise.resolve(old());
  }

  // a refresh stays in the edit view; here at the end, because that view uses everything above
  if (mode === 'deck' && store.get(EDIT_KEY)) edit(true);
})();
