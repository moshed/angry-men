# Angry Men Rankings — "The Board"

A single static page where the WhatsApp group **"The Angry Men Not Dead Yet"** ranks
each other. Anyone with the link drags all 14 men into order, locks it in, and the
results roll up into a consensus board and a sortable pivot grid.

- **Live:** https://moshed.github.io/angry-men/
- **Repo:** `moshed/angry-men` (public — GitHub Pages on a free account requires it)
- **Local source:** `/Users/moshe/Apps/Angry Men Rankings/`
- **Backend:** Supabase — see [CLAUDE-supabase.md](CLAUDE-supabase.md)

## Structure

Four files, no build step, no dependencies, no framework. Pages serves the repo root.

| File | Job |
|---|---|
| `index.html` | Markup + three tab panels (Your board / Consensus / The grid) |
| `style.css` | All styling and design tokens |
| `data.js` | The roster: nickname, real name, 2020 seed average |
| `app.js` | Drag reorder, Supabase read/write, tally math, pivot rendering |

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

## Rules baked into the math

- **A man's average excludes his own vote for himself.** This is the 2020 sheet's
  own rule, reproduced exactly (`tally()` in `app.js`). His self-vote is held aside
  and shown as the **ego gap** = `avg − self`. Positive means he rates himself
  higher than the group does. Bob's 2020 ego gap is +6.3 and it is the single
  funniest number in the dataset.
- **One man, one board — newest wins.** Resubmission is allowed and expected;
  `latest()` keeps only each ranker's most recent row per era. Nothing is ever
  updated or deleted, so the full history stays intact as an audit trail.
- **No ties.** A drag-ordered list can't express them. The 2020 sheet had two
  (Mansy gave Rubin and Schlam a shared 2.5; Marmz gave Mansy and Rubin a shared
  11), so those import as adjacent whole ranks. Consequence: Schlam reads 5.67 here
  vs 5.61 in the sheet, Rubin 7.56 vs 7.50. **The finishing order is unchanged.**

## Design notes

Direction is a **fantasy draft big board** — the group's own vernacular (the source
file lived in a `Fantasy/` folder next to `Points.xlsx`, and their other spreadsheet
has a `Rank | Pitcher | Diff` layout).

- **Palette:** midnight slate ground `#12161F` (blue-shifted, not black), warm bone
  text `#E8E4DA`, sodium-vapour amber `#F2A03D` as the light, flare red `#E2513B`
  held back for the ego gap and self-votes only.
- **Type:** Big Shoulders Display (condensed signage) for names and headings,
  IBM Plex Sans for body, IBM Plex Mono for all figures. Tabular numerals throughout.
- **Signature:** *the light belongs to the slot, not the man.* Slot 1 is lit full
  sodium and slot 14 sits in the dark; when you drag someone into slot 1 he takes
  the light already there. The same rank→light scale then becomes the pivot grid's
  heat map, so one visual system covers ballot and results.
- On drop, the moved row prints a `▲n` / `▼n` reach-or-steal callout, the one
  animated moment on the page. Respects `prefers-reduced-motion`.

## Drag implementation

Hand-rolled pointer-events sortable in `initDrag()` — no library.

**The one thing to not break:** drag starts from anywhere on a row for
`pointerType === 'mouse'`, but **only from the `.grip` handle on touch**. The rows
carry `touch-action: pan-y` and the grip carries `touch-action: none`, so the page
still scrolls normally under a finger. Making the whole row grabbable on touch makes
the list unscrollable on a phone, which is where nearly all of these get filled in.

Reordering assumes uniform row height (`--row-h` + 5px margin). Change one, change
the other. Keyboard: focus a row, ArrowUp/ArrowDown to move it.

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
