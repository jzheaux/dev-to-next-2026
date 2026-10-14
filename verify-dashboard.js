#!/usr/bin/env node
//
// Checks that a generated dashboard is actually usable before it is published.
//
//   node verify-dashboard.js 2026-09-16.html 2026-09-16
//
// Exits 0 and prints "ok" when the file passes, or exits 1 naming the first
// problem. Run it after generating a day and before using it: a file that exists
// but is broken is worse than no file, because the day opens to a blank page.

'use strict';

const fs = require('fs');
const vm = require('vm');

const [file, expectedDate] = process.argv.slice(2);

if (!file || !expectedDate) {
  console.error('usage: node verify-dashboard.js <file.html> <YYYY-MM-DD>');
  process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

let html;
try {
  html = fs.readFileSync(file, 'utf8');
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}

// 1. The embedded state block must parse and carry today's date. This is what
//    the app restores from on load, so a malformed block is a dead page.
const stateMatch = html.match(
  /<script id="state" type="application\/json">([\s\S]*?)<\/script>/
);
if (!stateMatch) fail('no <script id="state"> block');

let state;
try {
  state = JSON.parse(stateMatch[1]);
} catch (e) {
  fail(`state block is not valid JSON: ${e.message}`);
}
if (state.date !== expectedDate) {
  fail(`state date is "${state.date}", expected "${expectedDate}"`);
}
// A new day starts with its date and no answers. One copied forward with the
// answers of the day before still in it would open already filled in, and pass
// everything below unless the mood happened to be among them.
const answered = Object.keys(state).filter(k => k !== 'date');
if (answered.length) {
  fail(`state block already holds answers (${answered.slice(0, 3).join(', ')}): a new day starts with only its date`);
}

// 2. The main script must be syntactically valid. A template-literal typo in a
//    render function throws at parse time and takes the whole slideshow down.
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) fail('no main <script> block');
try {
  new vm.Script(scriptMatch[1]);
} catch (e) {
  fail(`main script has a syntax error: ${e.message}`);
}

// 3. DATE drives READONLY. If it is stale the day opens frozen as a record,
//    which looks like a working page and silently refuses every input.
if (!html.includes(`const DATE = '${expectedDate}';`)) {
  fail(`const DATE is not set to '${expectedDate}'`);
}

// 4. The date is written in three independent places; the two display ones are
//    easy to miss when copying yesterday's file forward.
const [y, m, d] = expectedDate.split('-').map(Number);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const pretty = `${MONTHS[m - 1]} ${d}, ${y}`;
if (!html.includes(`<title>Daily Dashboard — ${pretty}</title>`)) {
  fail(`<title> does not read "Daily Dashboard — ${pretty}"`);
}
if (!html.includes(`<span class="header-date">${pretty}</span>`)) {
  fail(`header-date does not read "${pretty}"`);
}

// 5. Every live-data block must be present and non-empty. An empty one means a
//    fetch failed and was written out as a stub rather than being reported.
const NAMES = ['VIDEOS', 'WORK_TODOS', 'PERSONAL_TODOS', 'BOOKS', 'READING_PROMPTS'];

let ctx;
try {
  // Only the data declarations, not the whole script — the render functions
  // touch document/window, which do not exist here.
  const decls = scriptMatch[1].match(
    new RegExp(`^const (?:${NAMES.join('|')}) = [\\s\\S]*?^(?:};|\\];)$`, 'gm')
  );
  if (!decls) fail('no data declarations found');
  const found = decls.map(d => d.match(/^const (\w+)/)[1]);
  for (const name of NAMES) {
    if (!found.includes(name)) fail(`missing const ${name}`);
  }
  // A top-level `const` in a vm script is a lexical binding and never becomes a
  // property of the context, so the values have to be handed back explicitly.
  ctx = new vm.Script(`${decls.join('\n')}\n;({${NAMES.join(', ')}})`)
    .runInContext(vm.createContext({}));
} catch (e) {
  fail(`data blocks do not evaluate: ${e.message}`);
}

const checks = [
  ['VIDEOS.meditation',    ctx.VIDEOS && ctx.VIDEOS.meditation],
  ['VIDEOS.body',          ctx.VIDEOS && ctx.VIDEOS.body],
  ['WORK_TODOS.items',     ctx.WORK_TODOS && ctx.WORK_TODOS.items],
  ['PERSONAL_TODOS.items', ctx.PERSONAL_TODOS && ctx.PERSONAL_TODOS.items],
  ['BOOKS.items',          ctx.BOOKS && ctx.BOOKS.items],
  ['READING_PROMPTS', ctx.READING_PROMPTS],
];
for (const [name, value] of checks) {
  if (!Array.isArray(value)) fail(`${name} is missing or not an array`);
}
// The to-do lists and the shelf may each legitimately be empty — an empty list
// or shelf is a real state the slides render a note for. The video lists may
// not be: those slides are nothing without them.
if (ctx.VIDEOS.meditation.length === 0) fail('VIDEOS.meditation is empty');
if (ctx.VIDEOS.body.length === 0) fail('VIDEOS.body is empty');

const ids = [...ctx.VIDEOS.meditation, ...ctx.VIDEOS.body].map(v => v.id);
if (ids.some(id => !id)) fail('a video entry has no id');
if (new Set(ids).size !== ids.length) {
  fail('the same video is used for two categories on the same day');
}

if (ctx.BOOKS.stale) {
  // Not a failure: the spec says a stale shelf renders a visible warning. Worth
  // saying out loud in the log so a source that broke weeks ago is not news.
  console.log(`note: BOOKS is stale (fetched ${ctx.BOOKS.fetchedAt}) — the shelf slide will show a carried-forward warning`);
} else if (ctx.BOOKS.fetchedAt !== expectedDate) {
  // Yesterday's block left in a day copied forward: another day's data, unlabelled.
  fail(`BOOKS was fetched ${ctx.BOOKS.fetchedAt}, not ${expectedDate}, and is not marked stale`);
}

// A day copied forward keeps yesterday's blocks until each is replaced. The comment
// above each one says when it was fetched, so one that was missed still names
// another day.
for (const name of ['VIDEOS', 'WORK_TODOS', 'PERSONAL_TODOS']) {
  if (ctx[name].stale) {
    // As with the shelf: lists carried forward are not a failure if they say so.
    if (!ctx[name].fetchedAt) fail(`${name} is marked stale but does not say when it was fetched`);
    console.log(`note: ${name} is stale (fetched ${ctx[name].fetchedAt}) — its slide will show a carried-forward warning`);
    continue;
  }
  const at = scriptMatch[1].match(new RegExp('^// [^\\n]*fetched (\\d{4}-\\d{2}-\\d{2})[^\\n]*\\n(?://[^\\n]*\\n)*const ' + name + ' =', 'm'));
  if (!at) fail(`${name} does not say when it was fetched`);
  if (at[1] !== expectedDate) fail(`${name} was fetched ${at[1]}, not ${expectedDate}`);
}

// 6. Behavior. Everything above checks that the file is well formed; this checks
//    that it works. Each test opens the page in a simulated browser with a fixed
//    clock, stands in for the server and localStorage, and uses it the way a person
//    would. The tests rely only on what other code depends on: the state block,
//    POST /save/<date>, the saved-answer keys, the Next button (#btnNext), and the
//    mood quadrants and words (.mood-q, .mood-chip). Everything else about how the
//    page is built is free to change.
//
//    When a change to the page alters behavior, add a test here for it.

const { JSDOM, VirtualConsole } = require('jsdom');
const { embedState, openDate, isStateFor, bookTitles, csvCell } = require('./server.js');

const day = new Date(y, m - 1, d);
const at = (dayOffset, h, min = 0) => new Date(y, m - 1, d + dayOffset, h, min);
const TODAY = at(0, 9);              // mid-morning on the day itself
const AFTER_MIDNIGHT = at(1, 3, 59); // still inside the 4am grace
const NEXT_DAY = at(1, 4, 1);        // the grace is over; the day is a record
const LS_KEY = `dashboard-${expectedDate}`;
const SLIDES = 12;

function openPage(source, { now, local = {} }) {
  const page = { errors: [], posts: [], beacons: [], timers: [] };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => page.errors.push(e.message));
  const dom = new JSDOM(source, {
    url: `http://localhost/${expectedDate}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(win) {
      for (const [k, v] of Object.entries(local)) win.localStorage.setItem(k, v);
      const RealDate = win.Date;
      let fixed = now.getTime();
      // Moves the page's clock, for a page that stays open while time passes.
      page.setNow = date => { fixed = date.getTime(); };
      win.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
      // The autosave runs on an interval; capture it so a test can fire it.
      win.setInterval = fn => page.timers.push(fn);
      win.clearInterval = id => { if (id) page.timers[id - 1] = () => {}; };
      win.setTimeout = () => 0;
      win.fetch = async (url, opts = {}) => {
        page.posts.push({ url, body: opts.body });
        return { ok: true };
      };
      win.Blob = class { constructor(parts) { this.text = parts.join(''); } };
      win.navigator.sendBeacon = (url, blob) => { page.beacons.push({ url, body: blob.text }); return true; };
      win.HTMLElement.prototype.scrollIntoView = () => {};
      win.AudioContext = inert();
      win.addEventListener('error', e => page.errors.push(e.message));
    },
  });
  // A browser's inline handlers (oninput="state.x=...") see the page's top-level
  // `let state`. jsdom's don't: they fall through to window.state, which is the
  // <script id="state"> element, so answers would land on that element instead.
  // Pointing window.state at the variable gives the handlers what a browser does.
  dom.window.eval(`Object.defineProperty(window, 'state', {
    get() { return state; }, set(v) { state = v; }, configurable: true })`);
  page.win = dom.window;
  page.doc = dom.window.document;
  page.local = () => {
    try { return JSON.parse(page.win.localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  };
  page.next = () => page.doc.getElementById('btnNext').click();
  page.fields = () => [...page.doc.querySelectorAll(
    'input[type=text], input[type=number], input:not([type]), textarea')];
  page.autosave = async () => { page.timers.forEach(fn => fn()); await settle(); };
  // Visit every slide in order, from the first, running fn on each.
  page.eachSlide = async fn => {
    for (let i = 0; i < SLIDES; i++) {
      await fn(i);
      if (i < SLIDES - 1) page.next();
    }
  };
  return page;
}

const settle = () => new Promise(r => setImmediate(r));
// Stands in for Web Audio: any property, call or construction returns another stand-in.
const inert = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert()),
  apply: () => inert(),
  construct: () => inert(),
});
const type = (page, node, text) => {
  node.value = text;
  node.dispatchEvent(new page.win.Event('input', { bubbles: true }));
};
const leaks = text => ['undefined', 'NaN', '[object Object]'].filter(w => text.includes(w));

const behaviors = [];
const behavior = (name, fn) => behaviors.push({ name, fn });

behavior('every slide renders without errors, and Next reaches all of them', async () => {
  const page = openPage(html, { now: TODAY });
  const seen = new Set();
  await page.eachSlide(() => {
    const text = page.doc.body.textContent;
    const bad = leaks(text);
    if (bad.length) throw new Error(`a slide shows "${bad[0]}"`);
    seen.add(text);
  });
  if (page.errors.length) throw new Error(page.errors[0]);
  if (seen.size !== SLIDES) throw new Error(`Next showed ${seen.size} distinct slides, expected ${SLIDES}`);
});

behavior('typing an answer saves it locally, and the autosave sends it to the server', async () => {
  const page = openPage(html, { now: TODAY });
  const tokens = [];
  await page.eachSlide(i => page.fields().forEach(node => {
    // Number fields only take digits; 90210+n doesn't occur elsewhere in the state.
    const token = node.type === 'number' ? String(90210 + tokens.length) : `answer-${tokens.length}`;
    type(page, node, token);
    tokens.push(token);
  }));
  const local = JSON.stringify(page.local());
  const saved = tokens.filter(t => local.includes(t));
  // The Slide 8 scratch note is the one field that is not part of the day's answers.
  if (saved.length < tokens.length - 1) {
    throw new Error(`only ${saved.length} of ${tokens.length} typed answers reached the day's saved state`);
  }
  await page.autosave();
  const post = page.posts.find(p => p.url === `/save/${expectedDate}`);
  if (!post) throw new Error(`the autosave did not POST to /save/${expectedDate}`);
  const missing = saved.filter(t => !post.body.includes(t));
  if (missing.length) throw new Error(`the autosave left out "${missing[0]}"`);
});

behavior('completing a slide is recorded', async () => {
  const page = openPage(html, { now: TODAY });
  const doneCount = () => Object.entries(page.local())
    .filter(([k, v]) => k.endsWith('_done') && v === true).length;
  await page.eachSlide(() => {
    // The slide's own completion button: not navigation, Save, a pitch or the timer.
    const button = [...page.doc.querySelectorAll('.slide-body button')]
      .filter(b => !/^[A-G]\d$|timer|reset|previous|next step|finish warmup/i.test(b.textContent.trim()))
      .pop();
    if (button) button.click();
  });
  if (doneCount() < 8) throw new Error(`completing every slide recorded only ${doneCount()} as done`);
});

behavior('closing the page sends unsaved answers', async () => {
  const page = openPage(html, { now: TODAY });
  let field;
  await page.eachSlide(() => { field = field || page.fields()[0]; });
  if (!field) throw new Error('no answer fields found');
  type(page, field, 'typed-just-before-closing');
  page.win.dispatchEvent(new page.win.Event('pagehide'));
  const beacon = page.beacons.find(b => b.url === `/save/${expectedDate}`);
  if (!beacon || !beacon.body.includes('typed-just-before-closing')) {
    throw new Error('closing the page did not send the unsaved answer');
  }
});

// A phone that is locked or switched to another app hides the page without closing
// it, and may discard it there: no pagehide, no beforeunload, and no more autosaves.
const show = (page, to) => {
  Object.defineProperty(page.doc, 'visibilityState', { value: to, configurable: true });
  page.doc.dispatchEvent(new page.win.Event('visibilitychange'));
};

behavior('hiding the page sends unsaved answers', async () => {
  const page = openPage(html, { now: TODAY });
  type(page, firstField(page), 'typed-just-before-locking-the-phone');
  const turn = to => show(page, to);
  turn('hidden');
  const beacon = page.beacons.find(b => b.url === `/save/${expectedDate}`);
  if (!beacon || !beacon.body.includes('typed-just-before-locking-the-phone')) {
    throw new Error('hiding the page did not send the unsaved answer');
  }
  // Coming back is not a reason to save, and nothing has changed since.
  turn('visible');
  turn('hidden');
  if (page.beacons.length !== 1) throw new Error('showing and hiding the page again sent ' + page.beacons.length + ' saves for one change');
});

// The save sent as the page is hidden is a beacon, and a beacon is taken by the
// browser whether or not the server can be reached: away from the server it goes nowhere.
behavior('a save sent as the page was hidden is sent again if the server never got it', async () => {
  const page = openPage(html, { now: TODAY });
  type(page, firstField(page), 'typed-away-from-home');
  const reach = page.win.fetch;
  page.win.fetch = async () => { throw new Error('unreachable'); };
  show(page, 'hidden');
  show(page, 'visible');
  await settle();
  // Home again, with the page still open and nothing more typed.
  page.win.fetch = reach;
  await page.autosave();
  if (!page.posts.some(p => p.url === `/save/${expectedDate}` && p.body.includes('typed-away-from-home'))) {
    throw new Error('an answer whose only save was a beacon the server never got was not sent again');
  }
});

// A phone suspends the page's audio when the page goes to the background or the
// screen locks, and may leave it that way when the page comes back.
behavior('a pitch button sounds after the page\'s audio has been suspended', async () => {
  const page = openPage(html, { now: TODAY });
  const audio = { state: 'running', resumed: 0 };
  page.win.AudioContext = function () {
    return new Proxy({}, { get: (t, k) => {
      if (k === 'state') return audio.state;
      if (k === 'resume') return () => { audio.resumed++; audio.state = 'running'; return Promise.resolve(); };
      return k === 'currentTime' ? 0 : inert();
    } });
  };
  let found = false;
  await page.eachSlide(() => {
    const pitch = [...page.doc.querySelectorAll('.slide-body button')].find(b => /^[A-G]\d$/.test(b.textContent.trim()));
    if (!pitch || found) return;
    found = true;
    pitch.click();
    audio.state = 'suspended';
    pitch.click();
    if (!audio.resumed) throw new Error('a pitch button played into suspended audio without starting it again');
  });
  if (!found) throw new Error('no pitch buttons found');
  if (page.errors.length) throw new Error(page.errors[0]);
});

behavior('a newer local copy wins over a fresh page, and is sent back at once', async () => {
  const local = { [LS_KEY]: JSON.stringify({ date: expectedDate, slide5_g1: 'kept-while-offline', _ts: TODAY.getTime() - 60000 }) };
  const page = openPage(html, { now: TODAY, local });
  await settle();
  let shown = false;
  await page.eachSlide(() => {
    shown = shown || page.fields().some(f => f.value === 'kept-while-offline');
  });
  if (!shown) throw new Error('the answer saved only in localStorage was not restored');
  const post = page.posts.find(p => p.url === `/save/${expectedDate}`);
  if (!post || !post.body.includes('kept-while-offline')) {
    throw new Error('the restored answer was not sent back to the server on load');
  }
});

behavior('the day stays open until 4am the next morning', async () => {
  const page = openPage(html, { now: AFTER_MIDNIGHT });
  let fields = 0;
  await page.eachSlide(() => { fields += page.fields().length; });
  if (!fields) throw new Error('at 3:59am the day is already read-only');
});

behavior('after 4am the day is a read-only record that never saves', async () => {
  const recorded = embedState(html, { date: expectedDate, slide5_g1: 'a recorded answer' });
  const local = { [LS_KEY]: JSON.stringify({ date: expectedDate, slide5_g1: 'a stale local copy', _ts: NEXT_DAY.getTime() }) };
  const page = openPage(recorded, { now: NEXT_DAY, local });
  let shown = false;
  await page.eachSlide(() => {
    if (page.fields().length) throw new Error('a past day still has editable fields');
    shown = shown || page.doc.body.textContent.includes('a recorded answer');
    if (page.doc.body.textContent.includes('a stale local copy')) {
      throw new Error('a stale localStorage copy rewrote a closed record');
    }
    page.doc.querySelectorAll('.slide-body [onclick], .slide-body button').forEach(el => el.click());
  });
  if (!shown) throw new Error('a past day does not show its recorded answer');
  await page.autosave();
  page.win.dispatchEvent(new page.win.Event('pagehide'));
  if (page.posts.length || page.beacons.length) throw new Error('a past day sent a save to the server');
  if (page.errors.length) throw new Error(page.errors[0]);
});

behavior('the mood records an emotion picked from the selected quadrant', async () => {
  const page = openPage(html, { now: TODAY });
  await page.eachSlide(() => {});                 // ends on the mood slide
  const quadrants = () => [...page.doc.querySelectorAll('.mood-q')];
  if (quadrants().length !== 4) throw new Error(`the mood slide shows ${quadrants().length} quadrants, expected 4`);
  if (page.doc.querySelector('.mood-chip')) throw new Error('emotion words are offered before a quadrant is chosen');
  quadrants()[1].click();
  const words = [...page.doc.querySelectorAll('.mood-chip')];
  if (!words.length) throw new Error('choosing a quadrant offers no emotion words');
  if (!words.every(w => quadrants()[1].contains(w))) throw new Error('the words offered are not the chosen quadrant\'s');
  const word = words[2].textContent.trim();
  words[2].click();
  const picked = page.local();
  if (!picked.mood || picked.mood_emotion !== word) {
    throw new Error(`picking "${word}" saved mood=${picked.mood}, mood_emotion=${picked.mood_emotion}`);
  }
  quadrants()[3].click();
  if (page.local().mood_emotion !== null) throw new Error('switching quadrants kept an emotion from the old quadrant');

  const recorded = embedState(html, { date: expectedDate, mood: picked.mood, mood_emotion: word });
  const past = openPage(recorded, { now: NEXT_DAY });
  await past.eachSlide(() => {});
  if (!past.doc.body.textContent.includes(word)) throw new Error('a past day does not show the recorded emotion');
});

behavior('a hostile answer is saved as text and never runs', async () => {
  const hostile = '</script><img src=x onerror="window.__ran=1"><script>window.__ran=1</script>';
  const saved = embedState(html, { date: expectedDate, slide5_g1: hostile });
  const block = saved.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/);
  let restored;
  try { restored = JSON.parse(block[1]); } catch { throw new Error('saving a hostile answer broke the state block'); }
  if (restored.slide5_g1 !== hostile) throw new Error('a hostile answer did not round-trip through the server unchanged');
  const page = openPage(saved, { now: TODAY });
  await page.eachSlide(() => {});
  if (page.win.__ran) throw new Error('a saved answer ran as script');
});

// Swaps one of the page's data blocks for another value, to stand in for a fetch
// that came back with something other than what the page expects.
const withData = (source, name, value) => {
  const re = new RegExp('^const ' + name + ' = [\\s\\S]*?^(?:};|\\];)$', 'm');
  if (!re.test(source)) throw new Error('no const ' + name + ' to replace');
  return source.replace(re, () => 'const ' + name + ' = ' + JSON.stringify(value) + ';');
};
const card = page => page.doc.querySelector('.slide-body').parentElement;

behavior('fetched data is shown as text and links, and never runs', async () => {
  const markup = n => '\'"><b id="injected-' + n + '"></b>';
  const code = "x');window.__ran=1;//";
  const link = 'javascript:window.__ran=1';
  let hostile = withData(html, 'VIDEOS', {
    stale: true, fetchedAt: markup(20),
    meditation: [{ style: markup(1), id: code, title: markup(2), channel: markup(3) },
                 { style: 'Other', id: markup(4), title: 't', channel: 'c' }],
    body: [{ style: markup(5), id: code + '2', title: markup(6), channel: markup(7) },
           { style: 'Other', id: markup(8), title: 't', channel: 'c' }],
  });
  hostile = withData(hostile, 'WORK_TODOS', { listUrl: link, items: [{ title: markup(9), url: link, source: markup(10) }] });
  hostile = withData(hostile, 'PERSONAL_TODOS', { listUrl: link, items: [{ title: markup(14), url: link }] });
  hostile = withData(hostile, 'BOOKS', {
    stale: true, fetchedAt: markup(15), shelfUrl: link,
    items: [{ title: markup(16), authors: [markup(17)], percent: '1%"><b id="injected-18"></b>', cover: link, url: link, key: code },
            { title: 'Other', authors: [], percent: null, cover: null, url: null, key: markup(19) }],
  });
  const page = openPage(hostile, { now: TODAY });
  await page.eachSlide(() => {
    // Twice, so a video that was clicked open is rendered as well.
    for (let pass = 0; pass < 2; pass++) {
      const injected = page.doc.querySelector('[id^="injected-"]');
      if (injected) throw new Error('fetched data was parsed as markup (' + injected.id + ')');
      const bad = [...page.doc.querySelectorAll('[href], [src]')]
        .find(el => /^\s*javascript:/i.test(el.getAttribute('href') || el.getAttribute('src')));
      if (bad) throw new Error('a fetched javascript: link was rendered as a live link');
      page.fields().forEach((node, i) => type(page, node, 'typed-' + i));
      const clickable = [...page.doc.querySelectorAll('.slide-body [onclick]')].filter(el => el.tagName !== 'A');
      if (clickable[pass]) clickable[pass].click();
    }
  });
  if (page.win.__ran) throw new Error('fetched data ran as script');
});

behavior('a saved video that is not one of the day\'s videos is not played', async () => {
  const hostile = '"></iframe><b id="injected-video"></b>';
  const saved = embedState(html, { date: expectedDate, slide3_video: hostile, slide10_video: hostile });
  const page = openPage(saved, { now: TODAY });
  await page.eachSlide(() => {
    if (page.doc.querySelector('[id^="injected-"]')) throw new Error('a saved video id was parsed as markup');
    if (page.doc.querySelector('.slide-body iframe')) throw new Error('a video that is not in the day\'s list was embedded');
  });
});

behavior('the reading prompt is the one for the day of the year, whatever the timezone', async () => {
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const prompts = ctx.READING_PROMPTS;
  const expected = prompts[dayOfYear % prompts.length];
  const page = openPage(html, { now: TODAY });
  let shown = false;
  await page.eachSlide(() => {
    const text = card(page).textContent;
    const others = prompts.filter(p => p !== expected && text.includes(p));
    if (others.length) throw new Error('the reading slide shows "' + others[0] + '", expected "' + expected + '"');
    shown = shown || text.includes(expected);
  });
  if (!shown) throw new Error('no slide shows the day\'s reading prompt, "' + expected + '"');
});

// Steps through the singing warmup to its end, on whichever slide has it.
const finishWarmup = page => {
  for (let i = 0; i < 10; i++) {
    const step = [...page.doc.querySelectorAll('.slide-body button')]
      .find(b => /next step|finish warmup/i.test(b.textContent));
    if (!step) return i > 0;
    step.click();
  }
  return true;
};

behavior('stepping through the warmup on a past day does not mark it completed', async () => {
  const recorded = embedState(html, { date: expectedDate, slide11_done: false });
  const page = openPage(recorded, { now: NEXT_DAY });
  let found = false;
  await page.eachSlide(() => {
    if (!finishWarmup(page)) return;
    found = true;
    if (card(page).textContent.includes('✓ Completed')) {
      throw new Error('a warmup that was not done is shown as completed on the record');
    }
  });
  if (!found) throw new Error('no warmup steps found');
});

behavior('on a past day the end of a warmup that was not done does not call it complete', async () => {
  const end = async done => {
    const page = openPage(embedState(html, { date: expectedDate, slide11_done: done }), { now: NEXT_DAY });
    let text;
    await page.eachSlide(() => { if (finishWarmup(page)) text = card(page).textContent; });
    if (!text) throw new Error('no warmup steps found');
    return text;
  };
  const notDone = await end(false);
  if (/complete!|✓/i.test(notDone)) throw new Error('a warmup that was not done ends with "' + notDone.match(/[^\n]*(?:complete!|✓)[^\n]*/i)[0].trim() + '"');
  if (!notDone.includes('Not completed')) throw new Error('a warmup that was not done does not read "Not completed"');
  if (!/complete!/i.test(await end(true))) throw new Error('a warmup that was done no longer ends by saying so');
});

behavior('a warmup recorded as done still shows as done after a reload', async () => {
  const recorded = embedState(html, { date: expectedDate, slide11_done: true });
  const page = openPage(recorded, { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    if (![...page.doc.querySelectorAll('.slide-body button')].some(b => /next step/i.test(b.textContent))) return;
    found = true;
    if (!card(page).textContent.includes('✓')) throw new Error('the warmup slide shows no sign that it was completed');
  });
  if (!found) throw new Error('no warmup steps found');
});

behavior('an answer typed while a save is in flight is still saved', async () => {
  const page = openPage(html, { now: TODAY });
  let field;
  await page.eachSlide(() => { field = field || page.fields()[0]; });
  if (!field) throw new Error('no answer fields found');
  type(page, field, 'typed-before-the-save');
  const respond = page.win.fetch;
  // The clock is fixed, so move it on: the later answer is a later change.
  page.win.Date.now = () => TODAY.getTime() + 5000;
  page.win.fetch = async (url, opts) => {
    type(page, field, 'typed-during-the-save');
    return respond(url, opts);
  };
  await page.autosave();
  page.win.fetch = respond;
  await page.autosave();
  if (!page.posts.some(p => p.body.includes('typed-during-the-save'))) {
    throw new Error('an answer typed during a save was never sent to the server');
  }
});

const INJECTED = '<b id="injected-answer"></b><img src=x onerror="window.__ran=1">';

behavior('every kind of saved answer is shown as text, today and on the record', async () => {
  // A real quadrant, so the mood slide has an emotion to show.
  const first = openPage(html, { now: TODAY });
  await first.eachSlide(() => {});
  first.doc.querySelector('.mood-q').click();
  const hostile = { date: expectedDate, mood: first.local().mood, mood_emotion: INJECTED };
  for (const key of ['slide2_exercise', 'slide2_notes', 'slide3_video', 'slide5_g1', 'slide5_g2', 'slide5_g3',
                     'slide6_sleep', 'slide6_water', 'slide6_meal', 'slide7_contact', 'slide9_learning', 'slide10_video']) {
    hostile[key] = INJECTED;
  }
  hostile.slide4_reviewed = { [INJECTED]: true };
  hostile.slide9_books = Object.fromEntries([INJECTED, ...ctx.BOOKS.items.map(b => b.key)].map(k => [k, INJECTED]));
  for (const now of [TODAY, NEXT_DAY]) {
    const page = openPage(embedState(html, hostile), { now });
    await page.eachSlide(() => {
      const injected = page.doc.querySelector('[id^="injected-"]');
      if (injected) throw new Error('a saved answer was parsed as markup');
    });
    if (page.win.__ran) throw new Error('a saved answer ran as script');
    if (page.errors.length) throw new Error(page.errors[0]);
  }
});

behavior('a local copy that cannot be read does not hide the day\'s saved answers', async () => {
  const recorded = embedState(html, { date: expectedDate, slide5_g1: 'saved-on-the-server', _ts: TODAY.getTime() - 60000 });
  for (const broken of ['{"date":"' + expectedDate + '","slide5_g1":"cut off', 'null', '[]']) {
    const page = openPage(recorded, { now: TODAY, local: { [LS_KEY]: broken } });
    let shown = false;
    await page.eachSlide(() => {
      shown = shown || page.fields().some(f => f.value === 'saved-on-the-server');
    });
    if (!shown) throw new Error('with the local copy ' + broken + ' the day opened without its saved answer');
  }
});

// Goes forward to the first slide that has an answer field, and stays there.
const firstField = page => {
  for (let i = 0; i < SLIDES && !page.fields().length; i++) page.next();
  if (!page.fields().length) throw new Error('no answer fields found');
  return page.fields()[0];
};
const sentBodies = page => [...page.posts, ...page.beacons].map(p => p.body || '');

behavior('a page left open past 4am becomes the record, and takes no more answers', async () => {
  const page = openPage(html, { now: TODAY });
  type(page, firstField(page), 'typed-before-4am');
  page.setNow(NEXT_DAY);
  type(page, firstField(page), 'typed-after-4am');
  if (page.fields().length) throw new Error('after 4am the page left open still has editable fields');
  const text = page.doc.body.textContent;
  if (text.includes('typed-after-4am')) throw new Error('an answer typed after 4am is shown on the record');
  if (!text.includes('typed-before-4am')) throw new Error('the answer typed before 4am is not on the record');
  page.doc.querySelectorAll('.slide-body [onclick], .slide-body button').forEach(el => el.click());
  await page.autosave();
  page.win.dispatchEvent(new page.win.Event('pagehide'));
  if (!sentBodies(page).some(b => b.includes('typed-before-4am'))) {
    throw new Error('the answer typed before 4am was never sent to the server');
  }
  if (sentBodies(page).some(b => b.includes('typed-after-4am'))) {
    throw new Error('an answer typed after 4am was sent to the server');
  }
  if (JSON.stringify(page.local()).includes('typed-after-4am')) {
    throw new Error('an answer typed after 4am was kept in the local copy');
  }

  // Nobody touching it: the page closes itself.
  const idle = openPage(html, { now: TODAY });
  firstField(idle);
  idle.setNow(NEXT_DAY);
  await idle.autosave();
  if (idle.fields().length) throw new Error('an idle page left open past 4am is still a form');
  if (idle.errors.length) throw new Error(idle.errors[0]);
});

const buttonNamed = (page, re) => [...page.doc.querySelectorAll('.slide-body button')]
  .find(b => re.test(b.textContent));

behavior('every note name in the warmup is a pitch button', async () => {
  const page = openPage(html, { now: TODAY });
  let steps = 0;
  await page.eachSlide(() => {
    for (let i = 0; i < 10 && buttonNamed(page, /next step|finish warmup/i); i++) {
      steps++;
      const body = page.doc.querySelector('.slide-body').cloneNode(true);
      body.querySelectorAll('button').forEach(b => b.remove());
      const plain = body.textContent.match(/\b[A-G][2-6]\b/);
      if (plain) throw new Error('warmup step ' + (i + 1) + ' names ' + plain[0] + ' as plain text');
      buttonNamed(page, /next step|finish warmup/i).click();
    }
  });
  if (!steps) throw new Error('no warmup steps found');
});

behavior('pausing the warmup timer offers to start it again', async () => {
  const page = openPage(html, { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    const start = buttonNamed(page, /start timer/i);
    if (!start) return;
    found = true;
    start.click();
    const pause = buttonNamed(page, /pause/i);
    if (!pause) throw new Error('a running timer has no Pause button');
    pause.click();
    if (buttonNamed(page, /pause/i)) throw new Error('a paused timer still reads "Pause"');
  });
  if (!found) throw new Error('no warmup timer found');
});

behavior('a warmup timer that has run out stops, and can be started again', async () => {
  const page = openPage(html, { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    if (!buttonNamed(page, /start timer/i)) return;
    found = true;
    const shown = () => page.doc.querySelector('.slide-body').textContent.match(/\d\d:\d\d/)[0];
    buttonNamed(page, /start timer/i).click();
    // The timer keeps time by the clock, so each tick is a second later.
    for (let i = 0; i < 1000 && shown() !== '00:00'; i++) {
      page.setNow(new Date(TODAY.getTime() + (i + 1) * 1000));
      page.timers.forEach(fn => fn());
    }
    if (shown() !== '00:00') throw new Error('the timer never reached 00:00');
    if (!buttonNamed(page, /start timer/i)) throw new Error('a timer that ran out does not offer to start again');
    buttonNamed(page, /start timer/i).click();
    page.timers.forEach(fn => fn());
    if (shown() === '00:00') throw new Error('starting a timer that ran out left it at 00:00');
    if (!buttonNamed(page, /pause/i)) throw new Error('a restarted timer has no Pause button');
    buttonNamed(page, /pause/i).click();
  });
  if (!found) throw new Error('no warmup timer found');
});

// A browser slows or stops the ticks of a page in the background or behind a locked
// screen, which is where a phone ends up partway through a four-minute step.
behavior('the warmup timer keeps time while its ticks are held back', async () => {
  const page = openPage(html, { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    if (!buttonNamed(page, /start timer/i)) return;
    found = true;
    const left = () => {
      const [mm, ss] = page.doc.querySelector('.slide-body').textContent.match(/\d\d:\d\d/)[0].split(':').map(Number);
      return mm * 60 + ss;
    };
    const full = left();
    buttonNamed(page, /start timer/i).click();
    page.setNow(new Date(TODAY.getTime() + 60000));
    page.timers.forEach(fn => fn());
    if (full - left() !== 60) throw new Error('a minute after it was started the timer had counted ' + (full - left()) + ' seconds');
    buttonNamed(page, /pause/i).click();
    page.setNow(new Date(TODAY.getTime() + 120000));
    page.timers.forEach(fn => fn());
    if (full - left() !== 60) throw new Error('a paused timer went on counting');
  });
  if (!found) throw new Error('no warmup timer found');
});

// The work list is taller than its box. Checking an item redraws the slide, and the
// redrawn list has to be where it was scrolled to, not back at its top.
behavior('checking an item far down the work list leaves the list where it was scrolled to', async () => {
  const items = Array.from({ length: 20 }, (_, i) => (
    { title: 'Item ' + i, url: 'https://example.com/work/' + (i + 1), source: 'example' }));
  const last = items[items.length - 1].url;
  const page = openPage(withData(html, 'WORK_TODOS', { listUrl: 'https://example.com/work', items }), { now: TODAY });
  const find = () => [...page.doc.querySelectorAll('.slide-body a')].find(a => a.getAttribute('href') === last);
  // The boxes around an item that belong to the slide, which is what gets redrawn.
  const above = node => {
    const up = [];
    for (let el = node.parentElement; el && el !== card(page); el = el.parentElement) up.push(el);
    return up;
  };
  let found = false;
  await page.eachSlide(() => {
    if (!find()) return;
    found = true;
    // jsdom lays nothing out, so every box around the item is "scrolled" and any one will do.
    above(find()).forEach(el => { el.scrollTop = 150; });
    find().parentElement.closest('[onclick]').click();
    if (!Object.keys(page.local().slide4_reviewed || {}).includes(last)) throw new Error('clicking a work item did not check it');
    if (!above(find()).some(el => el.scrollTop === 150)) throw new Error('checking an item sent the list back to its top');
  });
  if (!found) throw new Error('no work list found');
});

behavior('on a past day the links still open', async () => {
  const page = openPage(embedState(html, { date: expectedDate }), { now: NEXT_DAY });
  let links = 0;
  await page.eachSlide(() => {
    for (const a of page.doc.querySelectorAll('.slide-body a[href^="https://"]')) {
      links++;
      if (page.win.getComputedStyle(a).pointerEvents === 'none') {
        throw new Error('on a past day the link to ' + a.getAttribute('href') + ' cannot be clicked');
      }
    }
  });
  if (!links) throw new Error('no links found');
});

behavior('/today is the open day until 4am, then the new one', async () => {
  if (typeof openDate !== 'function') throw new Error('server.js does not say which day /today serves');
  const iso = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  if (openDate(TODAY) !== expectedDate) throw new Error('at 9am /today serves ' + openDate(TODAY));
  if (openDate(AFTER_MIDNIGHT) !== expectedDate) throw new Error('at 3:59am the next morning /today serves ' + openDate(AFTER_MIDNIGHT) + ', not the day still open');
  if (openDate(NEXT_DAY) !== iso(NEXT_DAY)) throw new Error('at 4:01am the next morning /today serves ' + openDate(NEXT_DAY));
});

// A slide's text as a person sees it: without what the page has hidden.
const visibleText = page => {
  const body = card(page).cloneNode(true);
  body.querySelectorAll('[style*="display:none"]').forEach(el => el.remove());
  return body.textContent;
};
const count = (text, word) => text.split(word).length - 1;

behavior('on a past day the exercise answer is written out, or "Not recorded"', async () => {
  const blank = openPage(embedState(html, { date: expectedDate }), { now: NEXT_DAY });
  let found = false;
  await blank.eachSlide(() => {
    if (!visibleText(blank).includes('Strength training')) return;
    found = true;
    if (!visibleText(blank).includes('Not recorded')) throw new Error('an exercise that was never answered does not read "Not recorded"');
  });
  if (!found) throw new Error('no exercise slide found');
  const ran = openPage(embedState(html, { date: expectedDate, slide2_exercise: 'B' }), { now: NEXT_DAY });
  await ran.eachSlide(() => {
    const text = visibleText(ran);
    if (!text.includes('Strength training')) return;
    if (count(text, 'Running') < 2) throw new Error('a recorded run is shown only by highlighting its option');
    if (text.includes('Not recorded')) throw new Error('a recorded run reads "Not recorded"');
  });
});

behavior('on a past day a meal that was never answered reads "Not recorded", not "No"', async () => {
  const mealSlide = async state => {
    const page = openPage(embedState(html, state), { now: NEXT_DAY });
    let text;
    await page.eachSlide(() => { if (/real meal/i.test(visibleText(page))) text = text || visibleText(page); });
    if (!text) throw new Error('no body check-in slide found');
    return text;
  };
  // Sleep, water and the meal: three questions, none answered.
  const blank = await mealSlide({ date: expectedDate });
  if (count(blank, 'Not recorded') < 3) throw new Error('an unanswered meal is not shown as "Not recorded"');
  const no = await mealSlide({ date: expectedDate, slide6_sleep: '7', slide6_water: '2', slide6_meal: false, slide6_done: true });
  if (no.includes('Not recorded')) throw new Error('a check-in saved without a meal reads "Not recorded"');
});

behavior('a video plays when it is clicked, not when its slide is opened or redrawn', async () => {
  const saved = embedState(html, { date: expectedDate, slide3_video: ctx.VIDEOS.meditation[0].id, slide10_video: ctx.VIDEOS.body[0].id });
  const page = openPage(saved, { now: TODAY });
  const playing = () => [...page.doc.querySelectorAll('.slide-body iframe')].some(f => /autoplay=1/.test(f.src));
  let players = 0, clicked = 0;
  await page.eachSlide(() => {
    const thumbs = [...page.doc.querySelectorAll('.slide-body img[src*="img.youtube.com"]')];
    if (!thumbs.length) return;
    players += page.doc.querySelectorAll('.slide-body iframe').length;
    if (playing()) throw new Error('a saved video starts playing when its slide is opened');
    thumbs[1].click();
    clicked++;
    if (!playing()) throw new Error('clicking a video does not start it');
    const done = buttonNamed(page, /complete/i);
    if (!done) throw new Error('no completion button on a video slide');
    // A player that is rebuilt starts its video over, whether or not it autoplays:
    // the one that was playing has to be the one still there.
    const player = () => page.doc.querySelector('.slide-body iframe');
    const started = player();
    done.click();
    if (player() !== started) throw new Error('marking the slide complete stops the video that was playing');
    if (!Object.entries(page.local()).some(([k, v]) => /^slide(3|10)_done$/.test(k) && v === true)) {
      throw new Error('marking a video slide complete was not recorded');
    }
    if (!/✓/.test(buttonNamed(page, /complete/i)?.textContent || '')) throw new Error('a video slide marked complete does not show it');
    // Picking another video is a new player, and closing it takes the player away.
    thumbs.length = 0;
    thumbs.push(...page.doc.querySelectorAll('.slide-body img[src*="img.youtube.com"]'));
    thumbs[2].click();
    if (player() === started || !playing()) throw new Error('clicking another video does not start it');
    thumbs.length = 0;
    thumbs.push(...page.doc.querySelectorAll('.slide-body img[src*="img.youtube.com"]'));
    thumbs[2].click();
    if (player()) throw new Error('clicking the playing video again does not close it');
  });
  if (players !== 2 || clicked !== 2) throw new Error('expected a saved video on two slides, found ' + players);
});

behavior('the server only writes a day\'s own state into it', async () => {
  if (typeof isStateFor !== 'function') throw new Error('server.js does not check what POST /save is given');
  for (const [what, body] of [['an array', [{ date: expectedDate }]], ['a state for another day', { date: '2000-01-01' }],
                              ['a state with no date', {}], ['null', null], ['a string', expectedDate]]) {
    if (isStateFor(expectedDate, body)) throw new Error('POST /save would write ' + what + ' into the day');
  }
  // What the page itself sends has to get through.
  const page = openPage(html, { now: TODAY });
  type(page, firstField(page), 'an answer');
  await page.autosave();
  page.win.dispatchEvent(new page.win.Event('pagehide'));
  const bodies = sentBodies(page);
  if (!bodies.length) throw new Error('the page sent nothing');
  for (const body of bodies) {
    if (!isStateFor(expectedDate, JSON.parse(body))) throw new Error('POST /save would refuse what the page sends: ' + body.slice(0, 80));
  }
  const local = { [LS_KEY]: JSON.stringify({ date: '2000-01-01', slide5_g1: 'kept-while-offline', _ts: TODAY.getTime() - 60000 }) };
  const restored = openPage(html, { now: TODAY, local });
  await settle();
  for (const body of sentBodies(restored)) {
    if (!isStateFor(expectedDate, JSON.parse(body))) throw new Error('POST /save would refuse a restored local copy');
  }
});

// GET /csv reads each day's book titles out of its page, where fetched text sits in
// the blocks before the shelf. A video's title and channel name stand in for it here.
behavior('the export reads book titles as data, and runs nothing a fetch brought in', async () => {
  if (typeof bookTitles !== 'function') throw new Error('server.js evaluates the BOOKS block to read its titles');
  const titles = bookTitles(html);
  for (const b of ctx.BOOKS.items) {
    if (titles[b.key] !== b.title) throw new Error('the export does not find the title of book ' + b.key);
  }
  const video = { style: 'Body Scan', id: 'x', title: 'const BOOKS = {a:(globalThis.__exportRan=1),b:/*', channel: '*/1});({x:[//' };
  const line = v => '    ' + JSON.stringify(v) + ',';
  const block = ['// Videos — fetched ' + expectedDate + '.', 'const VIDEOS = {',
    '  meditation: [', ...ctx.VIDEOS.meditation.map(line), '  ],',
    '  body: [', line(video), '  ],', '};'].join('\n');
  const re = /^\/\/ Videos [^\n]*\nconst VIDEOS = [\s\S]*?^};$/m;
  if (!re.test(html)) throw new Error('no const VIDEOS to replace');
  const posed = bookTitles(html.replace(re, () => block));
  if (globalThis.__exportRan) throw new Error('a video title ran as code in the export');
  if (JSON.stringify(posed) !== JSON.stringify(titles)) throw new Error('a video title posing as the shelf changed the titles the export reads');
});

// When the day's video search fails, the last lists are carried forward in a block
// marked stale. The slides have to say so.
behavior('videos carried forward from an earlier day say so on both video slides', async () => {
  const since = '1999-12-31';
  const onVideoSlides = async source => {
    const page = openPage(source, { now: TODAY });
    const texts = [];
    await page.eachSlide(() => {
      if (page.doc.querySelector('.slide-body img[src*="img.youtube.com"]')) texts.push(card(page).textContent);
    });
    if (texts.length !== 2) throw new Error('expected two video slides, found ' + texts.length);
    return texts;
  };
  const carried = await onVideoSlides(withData(html, 'VIDEOS',
    { stale: true, fetchedAt: since, meditation: ctx.VIDEOS.meditation, body: ctx.VIDEOS.body }));
  if (!carried.every(t => t.includes(since))) throw new Error('a video slide shows lists from ' + since + ' without saying so');
  const fresh = await onVideoSlides(withData(html, 'VIDEOS', { meditation: ctx.VIDEOS.meditation, body: ctx.VIDEOS.body }));
  if (fresh.some(t => /carried forward/i.test(t))) throw new Error('a video slide calls lists fetched today carried forward');
});

// The end of the warmup replaced its steps, and nothing brought them back but a reload.
behavior('after the warmup ends, its pitch buttons and timer can be brought back', async () => {
  const pitch = page => buttonNamed(page, /^\s*[A-G]\d\s*$/);
  for (const now of [TODAY, NEXT_DAY]) {
    const page = openPage(embedState(html, { date: expectedDate, slide11_done: true }), { now });
    let found = false;
    await page.eachSlide(() => {
      if (!pitch(page) || !finishWarmup(page)) return;
      found = true;
      // Whatever the end offers: try each button until the steps are back.
      const offered = page.doc.querySelectorAll('.slide-body button').length;
      for (let i = 0; i < offered && !pitch(page); i++) page.doc.querySelectorAll('.slide-body button')[i]?.click();
      if (!pitch(page) || !buttonNamed(page, /start timer/i)) {
        throw new Error('once the warmup has ended its pitch buttons and timer are gone until the page is reloaded');
      }
      if (!card(page).textContent.includes('✓')) throw new Error('going through the warmup again undid its completion');
    });
    if (!found) throw new Error('no warmup steps found');
  }
});

// An empty shelf used to be shown as one that had never been set up: "No
// currently-reading shelf yet", and to fetch the shelf, which had just been fetched.
behavior('a shelf with no books says so, and still takes the day\'s reading', async () => {
  const since = '1999-12-31';
  const empty = withData(html, 'BOOKS', { stale: false, fetchedAt: since, shelfUrl: 'https://example.com/someone/shelf', items: [] });
  const page = openPage(empty, { now: TODAY });
  let text, fields = 0, shelf = false;
  await page.eachSlide(() => {
    if (!ctx.READING_PROMPTS.some(p => card(page).textContent.includes(p))) return;
    text = card(page).textContent;
    fields = page.fields().length;
    shelf = !!page.doc.querySelector('.slide-body a[href="https://example.com/someone/shelf"]');
  });
  if (!text) throw new Error('no reading slide found');
  if (/npm run|regenerate|shelf yet/i.test(text)) throw new Error('an empty shelf is shown as one that was never set up');
  if (!/\b(no|nothing)\b/i.test(text) || !text.includes(since)) throw new Error('an empty shelf does not say it was empty, or as of when');
  if (!fields) throw new Error('with an empty shelf there is nowhere to write what was read');
  if (!shelf) throw new Error('with an empty shelf there is no link to the shelf');
});

// The Slide 8 scratch note is one note kept in the browser, shared by every day. A
// past day showed whatever it held now as that day's, or "Not recorded" when blank.
behavior('a past day does not show the browser\'s scratch note as part of its record', async () => {
  const note = 'a-note-written-on-some-other-day';
  const local = { 'dashboard-personal-todos': note };
  const past = openPage(embedState(html, { date: expectedDate }), { now: NEXT_DAY, local });
  await past.eachSlide(() => {
    if (card(past).textContent.includes(note)) throw new Error('a past day shows the current scratch note as if the day had recorded it');
  });
  if (past.win.localStorage.getItem('dashboard-personal-todos') !== note) throw new Error('opening a past day changed the scratch note');
  // Today it is still there to write in, and what is written is kept.
  const page = openPage(html, { now: TODAY, local });
  let field;
  await page.eachSlide(() => {
    const found = page.fields().find(f => f.value === note);
    if (!found) return;
    field = found;
    type(page, field, 'a-note-written-today');
  });
  if (!field) throw new Error('today\'s page does not show the scratch note');
  if (page.win.localStorage.getItem('dashboard-personal-todos') !== 'a-note-written-today') throw new Error('the scratch note is not kept in the browser');
});

// An empty work list was an empty box under "0 of 0 reviewed".
behavior('a work list with nothing in it says so, and can still be marked reviewed', async () => {
  const listUrl = 'https://example.com/some-work-list';
  const page = openPage(withData(html, 'WORK_TODOS', { listUrl, items: [] }), { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    if (!page.doc.querySelector('.slide-body a[href="' + listUrl + '"]')) return;
    found = true;
    const text = card(page).textContent;
    if (/\b0 of 0\b/.test(text)) throw new Error('an empty work list is counted as "0 of 0 reviewed"');
    if (!/\b(no items|nothing|empty)\b/i.test(text)) throw new Error('an empty work list does not say that it is empty');
    const done = buttonNamed(page, /review/i);
    if (!done) throw new Error('an empty work list cannot be marked reviewed');
    done.click();
    if (page.local().slide4_done !== true) throw new Error('marking an empty work list reviewed was not recorded');
  });
  if (!found) throw new Error('no work list found');
  if (page.errors.length) throw new Error(page.errors[0]);
});

// The work-list checks and the book notes are written into objects in the saved
// state. A saved copy holding anything else there made the click or the keystroke
// throw, or (an array) took the answer and dropped it when the state was saved.
behavior('a saved state with the wrong shape for the work checks or book notes still takes answers', async () => {
  const item = { title: 'An item', url: 'https://example.com/work/1', source: 'example' };
  const book = { title: 'A book', authors: ['Someone'], percent: null, cover: null, url: 'https://example.com/books/a-book', key: '4242' };
  const source = withData(withData(html, 'WORK_TODOS', { listUrl: 'https://example.com/work', items: [item] }), 'BOOKS',
    { stale: false, fetchedAt: expectedDate, shelfUrl: 'https://example.com/shelf', items: [book] });
  const saved = bad => ({ date: expectedDate, slide4_reviewed: bad, slide9_books: bad, _ts: TODAY.getTime() - 60000 });
  const use = async (page, bad, where) => {
    const said = JSON.stringify(bad) + ' ' + where;
    await page.eachSlide(() => {
      const link = [...page.doc.querySelectorAll('.slide-body a')].find(a => a.getAttribute('href') === item.url);
      if (link) {
        if (/\b[1-9]\d* of 1\b/.test(card(page).textContent)) throw new Error('with ' + said + ' an unchecked work item is counted as reviewed');
        link.parentElement.closest('[onclick]').click();
      }
      if ([...page.doc.querySelectorAll('.slide-body a')].some(a => a.getAttribute('href') === book.url)) {
        page.fields().forEach((node, i) => type(page, node, 'a-book-note-' + i));
      }
    });
    await page.autosave();
    const sent = page.posts.map(p => JSON.parse(p.body)).pop() || {};
    for (const [where, state] of [['the local copy', page.local()], ['what is sent to the server', sent]]) {
      if (!state.slide4_reviewed || state.slide4_reviewed[item.url] !== true) {
        throw new Error('with ' + said + ' a checked work item is not in ' + where);
      }
      if (!/^a-book-note-/.test((state.slide9_books || {})[book.key] || '')) {
        throw new Error('with ' + said + ' a book note is not in ' + where);
      }
    }
  };
  for (const bad of ['x', 7, true, ['a']]) {
    await use(openPage(embedState(source, saved(bad)), { now: TODAY }), bad, 'in the file');
    const newer = { [LS_KEY]: JSON.stringify({ ...saved(bad), _ts: TODAY.getTime() - 1000 }) };
    await use(openPage(source, { now: TODAY, local: newer }), bad, 'in a newer local copy');
    // The record of a day saved that way shows no checks, and does not throw.
    const past = openPage(embedState(source, saved(bad)), { now: NEXT_DAY });
    await past.eachSlide(() => {
      if (/\b[1-9]\d* of 1\b/.test(card(past).textContent)) throw new Error('with ' + JSON.stringify(bad) + ' the record counts an unchecked work item as reviewed');
    });
    if (past.errors.length) throw new Error(past.errors[0]);
  }
});

// The fetched blocks each say when they were fetched, and the checks above catch one
// left over from the day before. Slides 1 and 7 are written, not fetched, and carry no
// date: a day copied forward with them untouched passed everything, and celebrated
// yesterday. Each is compared with the same slide of the newest earlier day beside
// this file, when there is one.
behavior('the celebrations and the conversation starter are not the previous day\'s', async () => {
  const path = require('path');
  const dir = path.dirname(path.resolve(file));
  const earlier = fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f) && f.slice(0, 10) < expectedDate).sort().pop();
  if (!earlier) return;
  const [py, pm, pd] = earlier.slice(0, 10).split('-').map(Number);
  const slides = async (source, now) => {
    const page = openPage(source, { now });
    const texts = [];
    await page.eachSlide(() => texts.push(card(page).textContent.replace(/\s+/g, ' ').trim()));
    return texts;
  };
  const mine = await slides(html, TODAY);
  // Opened on its own morning, so it is the form it was and not the record of it.
  const theirs = await slides(fs.readFileSync(path.join(dir, earlier), 'utf8'), new Date(py, pm - 1, pd, 9));
  for (const [i, what] of [[0, 'Slide 1 (celebrations)'], [6, 'Slide 7 (conversation starter)']]) {
    if (mine[i] && mine[i] === theirs[i]) throw new Error(`${what} is the same as in ${earlier}: it is written fresh each day`);
  }
});

// The spec says a source that can't be reached is carried forward, marked stale, and
// said so on its slide. The to-do lists had no way to be marked stale: their slides
// said nothing, and this file failed any list whose comment named an earlier day.
behavior('to-do lists carried forward from an earlier day say so on their slides', async () => {
  const since = '1999-12-31';
  const work = { listUrl: 'https://example.com/carried-work', items: [{ title: 'Carried', url: 'https://example.com/work/1', source: 'x' }] };
  const personal = { listUrl: 'https://example.com/carried-personal', items: [{ title: 'Carried', url: 'https://example.com/personal/1' }] };
  const onListSlides = async (w, p) => {
    const page = openPage(withData(withData(html, 'WORK_TODOS', w), 'PERSONAL_TODOS', p), { now: TODAY });
    const texts = {};
    await page.eachSlide(() => {
      for (const url of [w.listUrl, p.listUrl]) {
        if (page.doc.querySelector('.slide-body a[href="' + url + '"]')) texts[url] = card(page).textContent;
      }
    });
    if (Object.keys(texts).length !== 2) throw new Error('expected two to-do slides, found ' + Object.keys(texts).length);
    if (page.errors.length) throw new Error(page.errors[0]);
    return Object.values(texts);
  };
  const carried = await onListSlides({ ...work, stale: true, fetchedAt: since }, { ...personal, stale: true, fetchedAt: since });
  if (!carried.every(t => t.includes(since))) throw new Error('a to-do slide shows a list from ' + since + ' without saying so');
  const fresh = await onListSlides(work, personal);
  if (fresh.some(t => /carried forward/i.test(t))) throw new Error('a to-do slide calls a list fetched today carried forward');
});

// The counter counted every saved check, including ones for items not on the day's
// list, so a hand-edited or hostile state read "1 of 4 reviewed" with nothing checked.
behavior('the work list counts only checks on its own items', async () => {
  const saved = embedState(html, { date: expectedDate, slide4_reviewed: { 'https://example.com/not-on-the-list': true } });
  const page = openPage(saved, { now: TODAY });
  let found = false;
  await page.eachSlide(() => {
    const m = card(page).textContent.match(/(\d+) of (\d+) reviewed/);
    if (!m) return;
    found = true;
    if (m[1] !== '0') throw new Error('with no item on the list checked, the work list reads "' + m[0] + '"');
  });
  if (!found && ctx.WORK_TODOS.items.length) throw new Error('no work list counter found');
});

// GET /csv is opened in a spreadsheet, which runs a cell that starts with = + - or @
// as a formula: a typed answer like =HYPERLINK(...) would run there.
behavior('the export writes answers so a spreadsheet does not run them as formulas', async () => {
  if (typeof csvCell !== 'function') throw new Error('server.js does not say how it writes a CSV cell');
  for (const v of ['=HYPERLINK("https://example.com","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
    const cell = csvCell(v).replace(/^"/, '');
    if (/^[=+\-@\t\r]/.test(cell)) throw new Error('the export writes ' + JSON.stringify(v) + ' as a cell a spreadsheet would run');
  }
  for (const [v, want] of [['7', '7'], ['a, b', '"a, b"'], ['say "hi"', '"say ""hi"""'], ['', ''], [undefined, '']]) {
    if (csvCell(v) !== want) throw new Error('the export writes ' + JSON.stringify(v) + ' as ' + csvCell(v) + ', expected ' + want);
  }
});

// With no state block to replace, the server added one with String.replace, which
// reads $& $' and $` in what it inserts: an answer holding them came back changed.
behavior('the server adds a state block to a day without one, whatever the answers hold', async () => {
  const bare = html.replace(/<script id="state" type="application\/json">[\s\S]*?<\/script>\n?/, '');
  const answer = "costs $5 $& $' $` $$ tops";
  const saved = embedState(bare, { date: expectedDate, slide5_g1: answer });
  const block = saved.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/);
  let restored;
  try { restored = block && JSON.parse(block[1]); } catch { throw new Error('the added state block is not valid JSON'); }
  if (!restored || restored.slide5_g1 !== answer) throw new Error('an answer holding $ patterns did not round-trip into a day without a state block');
});

(async () => {
  const failed = [];
  for (const { name, fn } of behaviors) {
    try { await fn(); } catch (e) { failed.push(`behavior: ${name}: ${e.message}`); }
  }
  if (failed.length) fail(failed.join('\n'));
  console.log('ok');
})();
