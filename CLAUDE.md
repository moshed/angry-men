# Angry Men Rankings — "The Board"

A single static page where the WhatsApp group **"The Angry Men Not Dead Yet"** ranks
each other for humour. Each man has a private link, drags all 14 into order and locks
it in; the boards roll up into a consensus table and a sortable positions pivot.
**Ballots are secret from the group** — the men see aggregates only. The runner
sees everything via an admin link.

- **Live:** https://moshed.github.io/angry-men/
- **Repo:** `moshed/angry-men` (public — GitHub Pages on a free account requires it)
- **Local source:** `/Users/moshe/Apps/Angry Men Rankings/`
- **Backend:** Supabase — see [CLAUDE-supabase.md](CLAUDE-supabase.md)

## Structure

Four files, no build step, no dependencies, no framework. Pages serves the repo root.

| File | Job |
|---|---|
| `index.html` | Markup + three tab panels (Your board / Consensus / Positions) |
| `style.css` | All styling and design tokens |
| `data.js` | The roster: nickname, real name, 2020 seed average |
| `app.js` | Drag reorder, Supabase read/write, tally math, pivot rendering |
| `supabase/functions/angry-submit/` | The edge function that validates tokens and writes boards |

`data.js` loads before `app.js` and exposes `ROSTER`, `NAME_BY_NICK`, `DEFAULT_BOARD`
as globals. Deliberately plain script tags — no modules, so it works off `file://`
too, which makes local testing trivial.

## The roster and where it came from

The 2020 rankings came from `/Users/moshe/Documents/Fantasy/12AM Humor.xlsx`
(Sheet1, cols A–D: Ranker / Rank / Rankee / Type). Nicknames were matched to real
names using the WhatsApp export
`~/Downloads/WhatsApp Chat - The Angry Men Not Dead Yet.zip`.

Every mapping was confirmed from message context. The non-obvious one:
**Nugsy = Eli Ingber** — confirmed by several exchanges where Polatoff addresses
"nugsy" and Ingber answers in the next message.

**Shaps (Isaac Shapiro)** and **Mayer Adelman** are active in the chat but were not
in the 2020 file, so they carry `seed2020: null`, render an `UNSEEDED` tag, and sit
at the bottom of the default board. Draft-board convention: undrafted goes last.

## Who can vote

Each man has his own link, `…/angry-men/?k=<22-char token>`. The page sends the token
to the `angry-submit` edge function, which trades it for a name and writes the board
using the service role. **The name is never taken from the client** — a forged
`ranker` field in the request body is ignored. Without a valid token the board is
dimmed and the submit button is dead; results stay readable by anyone.

The first cut of this had a name dropdown and a public INSERT policy, which meant the
page was decoration: anyone could `curl` a board in as anyone. If you ever find
yourself adding a way for the client to declare its own identity, that hole is back.
Details and the adversarial test list are in [CLAUDE-supabase.md](CLAUDE-supabase.md).

Links are **not in this repo** — it's public. They live at
`/Users/moshe/Documents/Fantasy/angry-men-links.txt`, along with the admin link.
The admin link must never go in the group chat: it reveals every board.

## Rules baked into the math

- **Secret ballot, from the group only.** `ranker` IS recorded on every board. The
  secrecy is enforced at the read boundary, not by discarding the record. See
  "Anonymity" below.
- **Everyone ranks all fourteen, themselves included — but a man's vote for himself
  never counts toward his own average, best or worst.** That was the 2020 sheet's
  rule and it holds. The exclusion happens in SQL (`angry_stats`), not the browser,
  because it needs `ranker` and the browser is never given one.
- **One man, one board — overwritten in place.** Resubmitting PATCHes the existing
  row. Revisions are deliberately *not* kept: a stack of edits from one man is a
  behavioural signature, and diffing them would expose him.
- **His board comes back from the server, not from his browser.** On load the page
  calls the `angry_my_board` RPC with his token and renders what he actually
  submitted. It used to restore from `localStorage` alone, so on any second device
  the page said "You're in" above the 2020 default order — the board he'd sent was
  nowhere, which the men reported as not being able to edit their rankings. If he's
  already started dragging when the answer lands (`state.touched`), his hands win.
- **Results stay hidden until 3 boards are in** (`MIN_BALLOTS`), since with one
  ballot the "average" is simply that man's board read aloud.
- **No ties.** A drag-ordered list can't express them. The 2020 sheet had two
  (Mansy gave Rubin and Schlam a shared 2.5; Marmz gave Mansy and Rubin a shared
  11), so those import as adjacent whole ranks. Consequence: Schlam reads 5.67 here
  vs 5.61 in the sheet, Rubin 7.56 vs 7.50. **The finishing order is unchanged.**

## Anonymity

This was retrofitted, and it drove more of the design than anything else. The
threats that were actually closed, in order of how easy they'd be to miss:

1. **The obvious one** — `ranker` is NULL on every live-era ballot.
2. **The API** — the public key can't read `angry_submissions` at all, and there is
   no public endpoint that returns an individual ordering in any form. It reads four
   aggregate views: `angry_stats`, `angry_positions`, `angry_counts`, `angry_notes`.
3. **Timestamps and row order** — moot now that no ballot is served. Nothing public
   carries a `created_at` or a stable id, so arrival order can't be recovered.
5. **Small n** — with one board in, the "average" *is* that board. Results stay
   hidden below `MIN_BALLOTS` (3).
6. **Edit history** — repeated submissions overwrite in place. A stack of one
   man's revisions is a signature and diffing them would expose him.
7. **The fingerprint** — `fp` (a hash of IP + user-agent) used to sit on the
   ballot, which would re-link device to board. It lives on `angry_voters` now.
8. **The who-voted feed** — removed entirely. "Nugsy just voted" plus a new ballot
   appearing is a full deanonymisation.

**Anonymity is from the other men, and deliberately not from the runner.** Every
board stores its `ranker`. The Grid tab shows the whole attributed matrix, and
appears only when the URL carries a valid `?a=<26-char admin token>` — checked by
the edge function, so the flag on its own grants nothing. It leads with who still
hasn't voted, and ends with three summary columns:

| Column | Meaning |
|---|---|
| `AVG` | his consensus average, **excluding** his vote for himself |
| `SELF` | the slot he put himself in |
| `GAP` | `AVG − SELF`. Positive = he rates himself better than the group does. |

`GAP` is the ego column and the funniest number on the page. Bob was +6.3 in 2020
and +6.2 in 2026, which is its own kind of consistency.

There was briefly a version that NULLed `ranker` outright. Don't do that again: it
destroys the record for no gain, since the men never had a route to it anyway.
(It was recoverable only because `angry_voters.ballot_id` had been written first.)

## Design notes

Direction is a **fantasy draft big board** — the group's own vernacular (the source
file lived in a `Fantasy/` folder next to `Points.xlsx`, and their other spreadsheet
has a `Rank | Pitcher | Diff` layout).

- **Palette:** midnight slate ground `#12161F` (blue-shifted, not black), warm bone
  text `#E8E4DA`, sodium-vapour amber `#F2A03D` as the light, flare red `#E2513B`
  held back for the one accent that isn't the light.
- **Type:** Big Shoulders Display (condensed signage) for names and headings,
  IBM Plex Sans for body, IBM Plex Mono for all figures. Tabular numerals throughout.
- **Signature:** *the light belongs to the slot, not the man.* Slot 1 is lit full
  sodium and slot 14 sits in the dark; when you drag someone into slot 1 he takes
  the light already there. The same scale then becomes the Positions heat map —
  there shading by *how many boards agreed*, not by slot — so one visual system
  covers ballot and results.
- On drop, the moved row prints a `▲n` / `▼n` reach-or-steal callout, the one
  animated moment on the page. Respects `prefers-reduced-motion`.

## The consensus table

Seven columns — `#`, MAN, `±PL`, AVG, `±AVG`, BEST, WORST — every head sorts. It
replaced a stack of cards with range bars, which was three phone-screens tall and
couldn't be sorted at all. There was briefly an `N` (boards counted) column; it was
noise on a phone, and the ballot count is already in the line above the table.

- **The `#` travels with the man, on every tab.** It's his finish by average, not
  the row index, so sorting by WORST doesn't renumber the board. `placesFor()`
  builds the map and `placeBadge()` renders it, so Consensus, Positions and Grid
  all label a man with the same number — and it's painted on the same sodium scale
  as his slot on the ballot, which is what keeps the finishing order legible under
  any sort.
- `#` and AVG are the same sort (the place *is* the average), so only AVG shows the
  arrow. Two arrows on one ordering reads like two different sorts.
- **It is deliberately not inside a `.scroller`**, unlike Positions and Grid. A
  horizontally scrollable ancestor is what `position: sticky` resolves against, and
  that would kill the sticky column heads — which are the whole point on a phone.
  It fits instead: verified 300–430px, with `.man` on the `max-width: 0; width: 99%`
  trick so the names ellipsis away before any figure is pushed off screen. **If you
  add a column, re-measure at 320px.**
- The heads stick at `top: 55px`, clearing the sticky tab bar. Change the height of
  `.tabs` and that number has to move with it.
- **Two movement columns, because they disagree.** `±PL` is places gained on 2020,
  `±AVG` is what his average did. A man can hold his place while the group quietly
  cools on him — Elisha was flat at `±PL` while `±AVG` had him ▼0.76 — and places
  also shift underneath a man when the two unseeded arrivals land above him.
  **Up is funnier in both**, so `±AVG` flips the sign: a *falling* average is a
  rising man, and it's drawn with ▲ like the places tag rather than as `−0.76`.
- The `2020` era has neither `±` column — there's nothing to compare against.

## Drag implementation

Hand-rolled pointer-events sortable in `initDrag()` — no library.

**The one thing to not break:** drag starts from anywhere on a row for
`pointerType === 'mouse'`, but **only from the `.grip` handle on touch**. The rows
carry `touch-action: pan-y` and the grip carries `touch-action: none`, so the page
still scrolls normally under a finger. Making the whole row grabbable on touch makes
the list unscrollable on a phone, which is where nearly all of these get filled in.

Reordering assumes uniform row height (`--row-h` + 5px margin). Change one, change
the other. Keyboard: focus a row, ArrowUp/ArrowDown to move it — `move()` restores
focus to the moved row afterwards, checked *before* the re-render, since wiping the
list drops focus to `<body>` and the keys then go dead after one press.

**`move(from, to)` is a global function in a plain script, and so is everything
else here.** A second `function move(then, nick, now)` — the ▲/▼-vs-2020 tag — was
added later in the file, and the last declaration in a scope wins. Every drop and
every arrow key silently called the wrong function, so rows lifted, followed the
finger, and snapped back untouched, so the ballot was dead from that deploy until
the men reported it a couple of hours later. It's `movementTag()` now. Before adding
a top-level function, check the name isn't already taken:

```bash
grep -oE "^function [A-Za-z_$]+" app.js | sort | uniq -d   # must print nothing
```

The grip is the only way to drag on touch, so it's **wider** on a phone (52px), not
narrower — it was 34px, under the 44px fingertip minimum, on the device where nearly
every board actually gets filled in.

## Performance

Two things made it feel slow, both fixed; don't reintroduce them:

- **Identity through the edge function.** ~250ms warm, >1s cold, for one indexed
  lookup. It now calls the `angry_whoami` RPC on PostgREST directly (~60ms, always
  warm). See CLAUDE-supabase.md.
- **Render-blocking web fonts.** The Google Fonts `<link>` blocked first paint on a
  third-party round trip. It's `rel="preload"` + `onload` now, with a `<noscript>`
  fallback.

Identity is also cached in `localStorage` per token, so a return visit renders
before the network answers and revalidates behind it.

**Assets are versioned** (`app.js?v=5`). GitHub Pages caches for 10 minutes, so
without this a deploy leaves browsers running half-old code — that's what caused a
404 storm when a view was dropped while old JS was still cached. **Bump the version
on every change to a static asset.**

## Local testing

```bash
cd "/Users/moshe/Apps/Angry Men Rankings"
python3 -m http.server 8765          # then open http://localhost:8765
```

Headless screenshots (note: Chrome headless clamps the viewport to a 500px minimum,
so a `--window-size` under 500 renders at 500 and the capture just crops):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --virtual-time-budget=9000 --window-size=500,1500 \
  --screenshot=out.png --hide-scrollbars http://localhost:8765/index.html
```

To screenshot a tab other than the first, copy `index.html` to a scratch `probe.html`
with a small script that clicks the tab on load. Don't commit it.

## Deploying

Push to `main`. GitHub Pages serves the repo root and updates within a minute.
