const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
// Loopback unless told otherwise, so a plain `node server.js` is not reachable
// from the network. Set HOST=0.0.0.0 to serve it to other machines.
const HOST = process.env.HOST || '127.0.0.1';
// Where the YYYY-MM-DD.html dashboards live. Defaults to the repo itself; point
// it elsewhere to keep the days and their saved answers apart from the code.
const DIR = process.env.DATA_DIR || __dirname;

app.use(express.json());

// GET /today — serve today's dashboard
app.get('/today', (req, res) => {
  const date = openDate();
  const file = path.join(DIR, `${date}.html`);
  if (!fs.existsSync(file)) {
    return res.status(404).send(`No dashboard generated for ${date} yet.`);
  }
  res.sendFile(file);
});

// GET /csv — export all dashboards as CSV
app.get('/csv', (req, res) => {
  const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
  const allData = {};
  const allBooks = {};
  for (const f of files) {
    const date = f.replace('.html', '');
    const state = extractState(path.join(DIR, f));
    if (state) allData[date] = state;
    allBooks[date] = extractBooks(path.join(DIR, f));
  }
  const dates = Object.keys(allData).sort();
  if (!dates.length) return res.status(404).send('No data yet.');
  const headers = ['date','mood','mood_emotion','slide1_done','slide2_exercise','slide2_notes','slide3_done','slide4_done','slide5_g1','slide5_g2','slide5_g3','slide6_sleep','slide6_water','slide6_meal','slide7_done','slide7_contact','slide8_done','slide9_done','slide9_learning','slide9_books','slide10_done','slide11_done'];
  const rows = [headers.join(',')];
  for (const d of dates) {
    const s = allData[d] || {};
    rows.push(headers.map(h => {
      const raw = h === 'slide9_books' ? formatBookNotes(s.slide9_books, allBooks[d]) : s[h];
      return csvCell(raw);
    }).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="daily-dashboard.csv"');
  res.send(rows.join('\n'));
});

// One CSV cell. The export is opened in a spreadsheet, which runs a cell starting
// with = + - or @ (or a tab or carriage return before one) as a formula, so a typed
// answer like =HYPERLINK(...) would run there. A leading ' makes it plain text.
function csvCell(raw) {
  let v = String(raw ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  v = v.replace(/"/g, '""');
  return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
}

// POST /save/:date — persist state into the HTML file
app.post('/save/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).send('Invalid date format.');
  }
  const file = path.join(DIR, `${date}.html`);
  if (!fs.existsSync(file)) {
    return res.status(404).send(`No dashboard for ${date}.`);
  }
  // A past day is a closed record. Refuse writes to it, or a stale localStorage
  // copy or a late unload beacon could silently rewrite history.
  //
  // The grace here is deliberately much wider than the client's. This clock lives
  // in a container, and a container that loses TZ runs on UTC — which, from Denver,
  // is already tomorrow from 6pm onward. A tight boundary here would 409 every save
  // of an evening session while the browser still showed an editable form, losing
  // the day's entries silently. The UI boundary is the client's job; this check is
  // only a backstop against rewriting genuinely old records, so it errs open.
  if (date < graceDate()) {
    return res.status(409).send(`${date} is a closed record and cannot be modified.`);
  }
  const state = req.body;
  if (!isStateFor(date, state)) {
    return res.status(400).send('Invalid state.');
  }

  const html = embedState(fs.readFileSync(file, 'utf8'), state);
  fs.writeFileSync(file, html, 'utf8');
  res.json({ ok: true });
});

// The state is written into a <script> block, and the HTML parser ends that block
// at the first "</script" it sees, whatever JSON says. JSON.stringify leaves "<"
// alone, so an answer containing "</script><img onerror=...>" would end the block
// early and run as markup on every later open of the day. Escaping <, > and & as
// \u003c etc. keeps the same JSON while making that sequence impossible; U+2028
// and U+2029 are escaped because older JavaScript parsers treat them as newlines.
function serializeState(state) {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// What POST /save will write into a day: that day's own answers. An array, or a
// state that names another day, would replace the record with something the page
// cannot restore from, and the page never sends either.
function isStateFor(date, state) {
  return !!state && typeof state === 'object' && !Array.isArray(state) && state.date === date;
}

// Writes state into a day's HTML, replacing the existing state block or adding one.
function embedState(html, state) {
  const tag = '<script id="state" type="application/json">';
  const closeTag = '</script>';
  const json = serializeState(state);
  const start = html.indexOf(tag);
  if (start === -1) {
    // No embedded state block yet — inject one before </head>. A function, because a
    // replacement string reads $& $' and $` in the answers as patterns.
    return html.replace('</head>', () => `${tag}${json}${closeTag}\n</head>`);
  }
  const contentStart = start + tag.length;
  const end = html.indexOf(closeTag, contentStart);
  return html.slice(0, contentStart) + json + html.slice(end);
}

// GET /:date — serve a specific day's dashboard
app.get('/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).send('Invalid date format.');
  }
  const file = path.join(DIR, `${date}.html`);
  if (!fs.existsSync(file)) {
    return res.status(404).send(`No dashboard for ${date}.`);
  }
  res.sendFile(file);
});

// Today's date in the server machine's local timezone. Using toISOString() here
// would report the UTC date, which rolls over to tomorrow during the evening in
// any timezone behind UTC.
// How far past a day's end the server still accepts writes to it. Wide on purpose:
// see the note in POST /save/:date. Override with FREEZE_GRACE_HOURS.
const FREEZE_GRACE_HOURS = Number(process.env.FREEZE_GRACE_HOURS ?? 24);

function graceDate(now = new Date()) {
  return localDate(new Date(now.getTime() - FREEZE_GRACE_HOURS * 3600000));
}

// The day /today serves. The page keeps a day open until 4am the next morning, and
// the new day is not generated until after that, so until 4am "today" is still the
// day before: a reload at 12:30am gets the open day back, not a 404.
const DAY_OPEN_HOURS = 4;

function openDate(now = new Date()) {
  return localDate(new Date(now.getTime() - DAY_OPEN_HOURS * 3600000));
}

function localDate(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Slide 9's journal entries are keyed by book id, and the titles those
// ids stand for live in the same file's BOOKS block — so the export reads both and
// renders "Title: note" pairs rather than opaque numeric keys.
function extractBooks(file) {
  try { return bookTitles(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// The block is read as data and never run. It used to be evaluated, and it was found
// by the first "const BOOKS = {" anywhere in the file, so a video's title and channel
// name, which sit in an earlier block, could pose as the shelf and run here as code.
// Each book is written as one line of JSON, and no fetched text contains a
// raw line break, so the block is only taken from the start of a line.
function bookTitles(html) {
  const m = html.match(/^const BOOKS = \{\n([\s\S]*?)\n\};$/m);
  if (!m) return {};
  const books = [];
  for (const line of m[1].split('\n')) {
    const text = line.trim().replace(/,$/, '');
    if (!text.startsWith('{')) continue;
    try { books.push(JSON.parse(text)); } catch { /* not a book line */ }
  }
  return Object.fromEntries(books.map(b => [String(b.key), b.title]));
}

function formatBookNotes(notes, titles) {
  if (!notes) return '';
  return Object.entries(notes)
    .filter(([, note]) => String(note || '').trim())
    .map(([key, note]) => `${(titles && titles[key]) || key}: ${note}`)
    .join(' | ');
}

function extractState(file) {
  try {
    const html = fs.readFileSync(file, 'utf8');
    const tag = '<script id="state" type="application/json">';
    const start = html.indexOf(tag);
    if (start === -1) return null;
    const contentStart = start + tag.length;
    const end = html.indexOf('</script>', contentStart);
    return JSON.parse(html.slice(contentStart, end));
  } catch { return null; }
}

module.exports = { app, embedState, serializeState, openDate, isStateFor, bookTitles, csvCell };

// Listen only when run directly, so verify-dashboard.js can load embedState.
if (require.main === module) app.listen(PORT, HOST, () => {
  console.log(`Dashboard server running at http://localhost:${PORT}`);
  console.log(`Bookmark: http://localhost:${PORT}/today`);

  // Say the timezone out loud. Every date bug this server has had traces back to
  // a container running on UTC, and it is invisible until a day rolls over early.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'unknown';
  const offsetMin = -new Date().getTimezoneOffset();
  const offset = (offsetMin < 0 ? '-' : '+') +
    String(Math.floor(Math.abs(offsetMin)/60)).padStart(2,'0') + ':' +
    String(Math.abs(offsetMin)%60).padStart(2,'0');
  console.log(`Timezone: ${tz} (UTC${offset}) — today is ${localDate()}, writes open back to ${graceDate()}`);
  if (offsetMin === 0 && !process.env.TZ) {
    console.warn('WARNING: running on UTC with no TZ set. /today will roll over early ' +
                 'in any timezone behind UTC. Set TZ to your timezone.');
  }
});
