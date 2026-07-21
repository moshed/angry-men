# Angry Men Rankings — "The Board"

A single static page where the WhatsApp group **"The Angry Men Not Dead Yet"** ranks
each other for humour. Each man has a private link, drags all 14 into order and locks
it in; the boards roll up into a consensus table and a sortable positions pivot.
**Ballots are secret** — nothing shows or serves a board with a name on it.

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
`/Users/moshe/Documents/Fantasy/angry-men-links.txt`.

## Rules baked into the math

- **Secret ballot.** No board is ever shown, or served, with a name on it. See
  "Anonymity" below — it is the constraint the rest of the design bends around.
- **Everyone ranks all fourteen, themselves included.** The 2020 sheet excluded a
  man's vote for himself, and that rule had to go: *any* self-exclusion mechanism
  identifies the voter (store `self_rank` and the man at that index is the caster;
  omit his own name and the missing man is the caster). Self-votes therefore count.
  This shifts the historical 2020 figures very slightly from the spreadsheet —
  Mordy reads 2.4 here vs 2.44 there — because self-votes are now included.
- **One man, one board — overwritten in place.** Resubmitting PATCHes the existing
  row. Revisions are deliberately *not* kept: a stack of edits from one man is a
  behavioural signature, and diffing them would expose him.
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
2. **The API** — the public key can no longer read `angry_submissions` at all. It
   reads `angry_board`, a view exposing `ranking, era, note` and nothing else. Even
   the 2020 boards are served unattributed now.
3. **Timestamps** — a ballot's `created_at` plus a chatty group ("just did mine")
   identifies the caster. The view returns no timestamp.
4. **Row order** — PostgREST with no `order` returns physical, i.e. insertion,
   order. Since the view exposes no id or timestamp there is nothing to sort by,
   so arrival order can't be recovered.
5. **Small n** — with one board in, the "average" *is* that board. Results stay
   hidden below `MIN_BALLOTS` (3).
6. **Edit history** — repeated submissions overwrite in place. A stack of one
   man's revisions is a signature and diffing them would expose him.
7. **The fingerprint** — `fp` (a hash of IP + user-agent) used to sit on the
   ballot, which would re-link device to board. It lives on `angry_voters` now.
8. **The who-voted feed** — removed entirely. "Nugsy just voted" plus a new ballot
   appearing is a full deanonymisation.

**What is *not* claimed:** perfect anonymity from you. `angry_voters.ballot_id`
points at each man's row, because overwriting his board on resubmit requires
knowing which one is his. Holding the service-role key you can join the two. That
link is the price of letting men change their minds; drop editing and it can go.
Nothing short of blind signatures removes it, which is absurd for fourteen men and
a joke spreadsheet. Anonymity from *everyone else* is real and enforced server-side.

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
