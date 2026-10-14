= Daily Dashboard

This is a specification for an HTML slideshow that takes a person through their daily introspection routine. Each slide, it should be possible to move back and forth between each slide, and the user may click each slide to indicate that they are done. When clicked, this event is written into the HTML file itself (see Saving), allowing long-term tracking of which parts of the routine were done.

== Generating a day

Each day, in order: copy the previous day, review it, fill in today's data, verify, commit.

Generate today's `YYYY-MM-DD.html` in this directory. If it already exists, stop: it may already hold the day's answers.

Start from the previous day's HTML if there is one: copy it to today's date, clear its answers, and replace its data with today's. Keep its saved-answer keys, because past days and the export depend on them. A new kind of answer gets a new key; never rename or reuse one.

Today's data:

1. Celebrations and conversation starter (Slides 1 and 7): written fresh each day by a model. Tie at least one Slide 1 suggestion to today's to-do items or books. A fun observance is welcome as balance when the day has one.

2. Videos (Slides 3 and 10): search YouTube for each style the slide names, for example with a web search restricted to youtube.com. Confirm that each pick exists and can be embedded (YouTube's oEmbed endpoint, `https://www.youtube.com/oembed?url=<watch url>`, answers for it and gives its title and channel), and check its length. If nothing fits a style closely, take the closest and say so in the commit.

3. Work to-do (Slide 4): sample data. Write a new, plausible set each day.

4. Personal to-do (Slide 8): sample data. Write a new, plausible set each day.

5. Books (Slide 9): sample data. Carry the same books forward and advance their progress.

To use real data, replace "sample data" with where the data lives and how to read it: a CLI, an API, or a file.

Each data block says, in the comment above it, the date it was fetched. If a source can't be reached, carry the previous day's data forward, mark it stale (`stale: true` and `fetchedAt: "<the date it was fetched>"` on the block), and make the slide say so. Never carry another day's data forward silently.

Every link written into the page must open. Check each new one, and replace any that doesn't.

== Reviewing the previous day

Treat the previous day like a retro. Before building on it, review its HTML and the project's code (`server.js` and `verify-dashboard.js`) for:

- bugs;
- security problems, especially anything a typed answer or fetched data could inject;
- places where the page no longer does what this spec says.

Then improve by small steps:

- Fix what the review finds, in today's file or in the code it belongs to. Change only what the review found; don't restyle or restructure what works.
- For every fix that changes behavior, add a test to `verify-dashboard.js` that fails without the fix.
- If a finding is too big or too uncertain to fix today, leave it and say why in the commit.
- A change to `server.js` only takes effect when the server is restarted, which this process doesn't do. Say so in the commit.

== Verifying and committing

Run `node verify-dashboard.js <file> <date>`. It checks the file's shape, then opens the page in a simulated browser and checks its behavior. Its tests rely on the state block, `POST /save/<date>`, the saved-answer keys, the Next button (`#btnNext`), and the names and shapes of the data blocks (`VIDEOS`, `WORK_TODOS`, `PERSONAL_TODOS`, `BOOKS`, `READING_PROMPTS`), so keep those. If it fails and you can't fix the cause, leave the file for inspection and don't commit it.

The verifier checks the day being generated. Past days are records of the code they were made with, and needn't pass a newer verifier; don't edit them to make them pass.

Commit each day to git (don't push): the new day's file, plus any code and test changes. The commit message lists what the review found, what changed, and what was left and why.

== Slides

Slide 0. This is always the last slide, and is the only exception to the natural ordering rule that Slide n-1 comes before Slide n. This slide is a slide that asks me what my mood is using the four color feelings quadrant, like this image https://www.cghjournal.org/cms/10.1016/j.cgh.2024.02.019/asset/31d4280e-9977-4677-b80f-141b252819f1/main.assets/gr1_lrg.jpg. I should enter which emotion I feel and that should be saved to the document. Choosing a quadrant offers that quadrant's emotions to pick from; record both the quadrant and the emotion.

Slide 1. Show 1-3 officially-recognized reasons that people are celebrating today. For example, International Women's Day, Arbor Day, Lasagna Day, Grammar Day. It should also list 2-3 ways that the day could be embraced. In the document, this is a checkbox. Suggestions should be rich text: if a suggestion involves a recipe, include a link to one; if it suggests reading an article, include a link to a specific article. Instead of "Read a short article about animal intelligence", prefer "Read [a short article about animal intelligence](https://link) about animal intelligence."

Slide 2. Report Daily Exercise. Option A is strength training. Option B is running. Option C is free response. Option D is that I did not exercise.

Slide 3. Meditate. At generation time, search YouTube for a ~15-minute guided session for each of these styles: Kirtan, Lovingkindness, Vipassana, Inner-Child Work, Healing Parental Trauma, Healing Religious Trauma, Healing Relationship Trauma. Embed the video IDs, thumbnails, and titles directly in the HTML as a clickable grid. Clicking a thumbnail embeds the YouTube player (youtube-nocookie.com) inline. In the document, this is a checkbox.

Slide 4. I need to check my Work To-Do list, only ensuring that it is accurate, adding and removing things as necessary but performing no work otherwise. At generation time, fetch the list's items (see Generating a day) and render them as an interactive checklist with per-item checkboxes and a link to each item. Include a link to the full list. In the document, this is a checkbox for whether the list was reviewed overall.

Slide 5. Gratitude Practice. Prompt me to log 2-3 things I'm grateful for today. Each entry is a free-response text field. All entries are saved to the document.

Slide 6. Body Check-In. Three quick fields: hours slept last night (number), glasses of water consumed so far today (number), and whether I ate a real meal today (yes/no checkbox). All saved to the document.

Slide 7. Social Connection. Prompt me to reach out to one person today — a friend, family member, or colleague. Show a brief suggested prompt or conversation starter to make it easier. In the document, record a checkbox for whether I did it and optionally who I reached out to.

Slide 8. Personal To-Do. At generation time, fetch today's personal to-do items (see Generating a day). Embed them in the HTML, rendering each item as a link to it and showing the item count. Show a link to the full list. Include a local scratch-note textarea (persists in localStorage across sessions). In the document, this is a checkbox for whether the list was reviewed.

Slide 9. Learning / Reading. The point of this slide is to spend a few minutes thinking
and journaling about what is currently being read — the book list is a memory jog, not
the payload, so the writing surface is what matters.

At generation time, embed the currently-reading shelf (see Generating a day).
Render each book as a card with its cover, title (linked to the book), authors, and a
progress bar where a percentage is known. Every book gets **its own journal textarea**,
keyed by the book's stable id, so entries stay attached to the right book as
the shelf changes and can be read back over time rather than collapsing into one blob.

Show a **rotating daily prompt** as the placeholder in each book's textarea and in a
highlighted box above the list — one prompt per day, indexed by day-of-year, so the
prompt is stable for a given date but differs from the day before ("What surprised you?",
"What would you argue with the author about?", "Whose voice is missing from this?", …).
The blank box is the thing that stops this slide from happening; the prompt is the fix.

Also include a general free-response field for anything read or learned outside the
books, and a link to the shelf. If the shelf is stale or empty, say so on the slide.
In the document, record a checkbox, the per-book entries, and the free-response entry.

Slide 10. Body Scan / Stretching. Walk me through a short 2-5 minute guided body-awareness or stretching exercise. At generation time, search YouTube for four options: Body Scan, Morning Stretch, Yoga for Tension, and Breathwork. Embed the video IDs and thumbnails directly in the HTML. Clicking a thumbnail embeds the YouTube player inline. This complements the meditation on Slide 3. In the document, this is a checkbox.

Slide 11. Singing Warmup. Walk me through a structured ~12-15 minute vocal warmup targeted at stabilizing G4→C5, building a usable mix voice, and developing falsetto as a bridge rather than a dead end. The routine should follow this order and structure:

1. Reset / Effort → Air (2 min): "Sighing oo" exercise. Start around C4, slide down to G3 and back up on "oo" (as in "food"). Very soft, no gripping — warm air on glass.

2. Falsetto Rehab (3 min): "Breathy hoo" on G4→C5 range. Light, airy onset like an owl sound — air leads, not cord closure. Then repeat with slightly reduced breathiness. Goal: make falsetto something I can choose, not something that stops me cold.

3. Mix Builder / Bridge (4 min): "Gee" (like "geese") on a 5-note scale starting around E4→A4 and moving up. Focus on G4→B4 with forward placement, speech-like and light. If it feels like pushing, reset lighter.

4. Target Work — A4→C5 (4-6 min):
   - "Nay" (bratty tone) in short bursts on A4→B4→C5 to access mix without weight
   - Open vowel shaping: "ah" modified toward "uh" blend as pitch rises — not "AHHH" on B4, more "UH/AH blend"
   - "Touch-and-go" C5: tap it and back off, don't try to hold or prove it

All note names (G3, C4, E4, G4, A4, B4, C5) should be rendered as clickable buttons that play the corresponding pitch using the Web Audio API (OscillatorNode, sine wave, ~1.8s decay). The slide walks through the four steps interactively with a countdown timer per step. In the document, record a checkbox for completion.

== Saving

The page saves to `server.js` (`npm start`), which serves the days from this directory.

- The day's answers live in the file, in a `<script id="state" type="application/json">` block. Start it with today's date and no answers; on load, read it to restore the day.
- Save by POSTing the whole state as JSON to `/save/YYYY-MM-DD`. Do it every 30 seconds when something changed, when the page is closed, and from a Save button in the header.
- Keep a copy in localStorage on every change. If it's newer than the file's copy (the server was unreachable), use it and save it back.
- The server escapes the state as it writes it into the file, so the page sends plain JSON.

== Past days

A day other than today is a record, not a form. Show every answer as plain text ("Not recorded" if empty), make every control that changes an answer inert, and don't save. Videos, pitch buttons and the timer still work. The day stays open until 4am the next morning, by the browser's clock.
