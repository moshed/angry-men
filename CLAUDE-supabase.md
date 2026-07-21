# Supabase — Angry Men Rankings

Shares the personal **"Misc"** project with Pollen and Bus Tracker.

- **Project ref:** `atqhfbaurrmivjarowco`
- **URL:** `https://atqhfbaurrmivjarowco.supabase.co`
- **Prefix convention:** everything here is `angry_`-prefixed so it can't collide
  with Pollen's `user_settings` or Bus Tracker's `bus_*` objects.

The anon key is embedded in `app.js`. That key is public by design; RLS is what
actually protects the data, and **it grants read only**. Every write goes through
the `angry-submit` edge function, which is the sole holder of the service role.

## The two rules everything else follows

1. **A voter's name is derived server-side from a secret token, never taken from the
   request body.** The page has no say in who you are. Any change that lets the
   client name itself reintroduces impersonation.
2. **A stored ballot carries no voter.** `ranker` is NULL for the live era, and the
   public reads a view that can't return a name, a timestamp or a row id at all.

The two pull against each other — the token has to identify you long enough to check
the roll and find your row, then that identity must not reach the ballot. The edge
function is the only place they touch.

## Schema

A whole board is stored as an ordered `text[]` rather than a row per vote, because
the ballot *is* an ordering, and the aggregates are computed client-side from a few
dozen rows anyway.

```sql
create table public.angry_submissions (
  id         uuid primary key default gen_random_uuid(),
  ranker     text,                   -- NULL for the live era. That absence is the feature.
  ranking    text[] not null,        -- ordered funniest → least; index 0 is slot 1
  era        text not null default 'current',   -- 'current' (shown as 2026) or '2020'
  note       text,                   -- optional one-line defence, ≤280 chars, shown unattributed
  created_at timestamptz not null default now()
);

create index angry_submissions_era_created_idx
  on public.angry_submissions (era, created_at desc);
```

The voter roll — token → name, plus which ballot is his:

```sql
create table public.angry_voters (
  nick       text primary key,
  token      text not null unique,   -- 22 chars, [a-z0-9], ~113 bits
  ballot_id  uuid,                   -- his row in angry_submissions; NULL until he votes
  voted_at   timestamptz,
  fp         text,                   -- device hash, kept here and never on a ballot
  created_at timestamptz not null default now()
);
```

`ballot_id` is the one thing that can re-link a man to a board, and only with the
service role. It exists so a resubmit can overwrite in place. Drop editing and you
can drop the column.

## The public view

```sql
create view public.angry_board as
  select ranking, era, note from public.angry_submissions;

grant select on public.angry_board to anon, authenticated;
```

Three columns, deliberately. No `ranker`, no `created_at` (timestamps plus a chatty
group deanonymise), no `id` (a stable id would let arrival order be recovered).
Note it is a plain view, so it runs as its owner and bypasses RLS on the base table —
that's what lets it serve rows the anon key otherwise can't touch.

## RLS

```sql
alter table public.angry_submissions enable row level security;   -- and NO policies
alter table public.angry_voters      enable row level security;   -- and NO policies
```

Neither table has a single policy, so the anon key can't read or write either one.
Everything public goes through `angry_board`; everything written goes through the
edge function on the service role. Consequences:

- No client can insert, edit or erase a board.
- An impersonated board is *recoverable*: the real man submits again before the
  deadline and it overwrites the forgery.

### Verified behaviour (smoke-tested with the anon key)

| Attempt | Result |
|---|---|
| `GET angry_board` (the view) | allowed — no names, no timestamps |
| `GET angry_submissions` (the table) | `[]` — no SELECT policy |
| `POST` a board directly to PostgREST | `401` — blocked |
| `GET angry_voters` | `[]` — RLS returns nothing, tokens are unreadable |
| `DELETE ?ranker=eq.Bob` | `204` **but zero rows affected** — RLS filtered it |

Watch out for that DELETE: **PostgREST returns `204` even when RLS matched nothing**,
so a 204 is not evidence of a successful delete. Confirm with a row count via the
Management API before concluding anything was removed.

## Edge function: `angry-submit`

Source: `supabase/functions/angry-submit/index.ts`. Deploy with

```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w \
  | sed 's/^go-keyring-base64://' | base64 -d)
supabase functions deploy angry-submit --project-ref atqhfbaurrmivjarowco
```

JWT-verified, so callers must send the anon key as `Authorization: Bearer`. Two routes:

- `GET  ?k=<token>` → `{ nick, voted, deadline, closed }`. `nick` is `null` for
  anything unrecognised; the page renders "Ranking as MORDY" from it. The page must
  not show "invalid link" before this resolves — it did once, and accused every
  good link of being fake for a beat.
- `POST { k, ranking, note }` → `{ ok: true }`.

What it enforces, all server-side:

1. Token matches `^[a-z0-9]{22}$` and resolves to exactly one row in `angry_voters`.
2. The name from that lookup is used **only** to find the man's existing ballot.
   `ranker` is written NULL. Any `ranker` in the request body is ignored.
3. The deadline has not passed.
4. `ranking` is an exact permutation of the roll — no duplicates, omissions or extras,
   the voter himself included. Letting a man omit himself would make the missing
   name a signature.
5. If he has voted, his row is PATCHed in place; otherwise INSERT, then his
   `ballot_id` is recorded. One row per man, ever — no revision trail to diff.
6. `note` trimmed to 280 chars.

`POST` returns only `{ok:true}`. It used to echo the name back, which would let anyone
watching the network tab pair a response with the ballot that appeared a moment later.

`fp` (an 8-byte SHA-256 prefix of `x-forwarded-for` + user-agent) is stored on
`angry_voters`, **never on the ballot** — on a ballot it would re-link device to board.

### Adversarial tests that must keep passing

| Attempt | Expected |
|---|---|
| POST with no `k`, `ranker: "Mordy"` | `403` invalid link |
| POST with a made-up 22-char token | `403` invalid link |
| POST with a **valid** token plus `ranker: "Bob"` | `200`, saved as the token's owner |
| POST a board with a duplicated name | `400` doesn't match roster |
| POST a board of the wrong length | `400` needs all 14 |
| `GET ?k=<junk>` | `{ nick: null }` |
| POST twice with one token | one row total, overwritten |
| `GET angry_board` | never a name or timestamp for the live era |

Row three is the one that matters for impersonation; the last two for anonymity.

## The deadline

One constant, `DEADLINE`, at the top of the edge function — currently
`2026-08-11T03:59:59Z` (11:59pm ET, Monday 10 August 2026). The page reads it from
the `GET` response rather than hardcoding it, so the two can't drift. To move it,
edit that line and redeploy.

## Tokens

Minted once with `secrets.choice` over `[a-z0-9]`, 22 chars. They are **not in the
repo** — the repo is public. The distributable list lives at
`/Users/moshe/Documents/Fantasy/angry-men-links.txt`.

To re-mint one man's link (say he forwarded his):

```sql
update public.angry_voters
   set token = <new 22-char token>
 where nick = 'Nugsy';
```

His old link stops working immediately. Boards he already submitted are untouched.

## Historical seed

The ten 2020 boards were imported from `12AM Humor.xlsx` as `era = '2020'` rows.
They were written with the Management API, which is also the only way to touch
them now. That's also how any future admin fix has to be done.

```bash
export TOK=$(security find-generic-password -s "Supabase CLI" -w \
  | sed 's/^go-keyring-base64://' | base64 -d)

curl -s -X POST \
  -H "Authorization: Bearer $TOK" \
  -H "User-Agent: dnz-cli/1.0" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/atqhfbaurrmivjarowco/database/query" \
  -d '{"query":"select era, count(*) from public.angry_submissions group by era"}'
```

Two gotchas, both previously known on this account:

- The Management API needs a **custom `User-Agent`** or Cloudflare returns 403.
- `supabase db push` hangs on this account — use the Management API for all DDL.

## Starting a new season

Eras are just strings. To open a 2027 board, rename the current one and repoint the
insert policy:

```sql
update public.angry_submissions set era = '2026' where era = 'current';
```

Then add a chip for `'2026'` in both `.era` blocks in `index.html` and extend
`ERA_LABEL` in `app.js`. New submissions keep going to `'current'`, so the insert
policy needs no change.
