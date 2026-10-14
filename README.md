# Built For Today

Slides and companion code for *Built For Today: A Java Developer's Experiment with Disposable Software* at Dev2Next 2026.

- `presentation.md` holds the slides, and `presentation.html` is the exported deck.
- The rest of this repository is the **Daily Dashboard**, the disposable app described in the talk.

## The Daily Dashboard

The Daily Dashboard is a slideshow that walks you through a morning introspection routine: mood, exercise, meditation, gratitude, reading, a vocal warmup, and more.

Each day is one self-contained HTML file named `YYYY-MM-DD.html`. Your answers are saved back into that same file, so the folder of days is also the history.

The app has no template or build step. Each morning a coding agent copies yesterday's file forward, reviews it, refreshes its data, and checks it. Three pieces make that work:

| Piece | File | Role |
|---|---|---|
| **Spec** | [`DASHBOARD.md`](DASHBOARD.md) | What the app is, and the daily steps for making the next day. It is the real source of the app. |
| **Tests** | [`verify-dashboard.js`](verify-dashboard.js) | Opens a day in a simulated browser and checks that it behaves as the spec says. Every bug a daily review fixes adds a test here, so the tests hold what the process has learned. |
| **Example** | [`2026-10-13.html`](2026-10-13.html) | One generated day. The next day is a copy of this one, reviewed and refreshed. |

[`server.js`](server.js) is a small Express server that serves the days and writes answers back into them.

This is a cleaned-up copy of a personal app. In the original, the spec points at the author's own GitHub project, Trello board, and Hardcover shelf, with scripts to fetch each one. Here those sources are replaced by sample data. The videos are real YouTube videos, and the book covers and links come from [Open Library](https://openlibrary.org).

### Running it

Requires Node.js 18 or later.

```sh
npm install
npm start
```

Then open:

- `http://localhost:3000/2026-10-13` for the example day.
- `http://localhost:3000/today` for today's day, once you've generated one. Until 4am, this still serves the previous day.
- `http://localhost:3000/csv` to export every day's answers as CSV.

Use the arrows or the **Next** button to move between slides. Click a slide to mark it done.

Answers are saved every 30 seconds, when you press **Save**, and when you close the page. They are also kept in `localStorage`, so nothing is lost if the server is briefly unreachable.

Any day other than today opens as a read-only record. Since October 13 has passed, the example day opens that way: answers are shown as text and can't be changed, but the videos, pitch buttons, and timer still work. To try the day as a form, generate today's day (below).

Settings (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind; set `0.0.0.0` to reach it from other machines |
| `DATA_DIR` | this directory | Where the `YYYY-MM-DD.html` files live |
| `FREEZE_GRACE_HOURS` | `24` | How long after a day ends the server still accepts saves to it |
| `TZ` | system | The server's timezone, which decides what "today" is |

### Generating a new day

Ask a coding agent, such as Claude Code, to follow the spec:

```sh
claude "Generate today's dashboard following DASHBOARD.md"
```

The agent works through these steps:

1. Copy the newest day to today's date and clear its answers.
2. Review the previous day and the code like a retro, fixing what it finds and adding a test for each fix.
3. Write the day's celebrations and conversation starter, find the videos, and refresh the sample to-dos and books.
4. Run the verifier.
5. Commit the new day.

To check a day yourself:

```sh
npm run verify -- 2026-10-14.html 2026-10-14
```

It prints `ok`, or exits 1 and names what failed. The verifier expects a freshly generated day, so it rejects a file that already holds answers.

### Making it yours

Edit `DASHBOARD.md`. To use your own data, find the "Today's data" list and replace "sample data" with where yours lives: a CLI such as `gh`, an API, or a file. You can also add, drop, or change slides. The next day the agent generates will follow your changes, and the verifier will check them.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
