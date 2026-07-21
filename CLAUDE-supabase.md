# Supabase — Angry Men Rankings

Shares the personal **"Misc"** project with Pollen and Bus Tracker.

- **Project ref:** `atqhfbaurrmivjarowco`
- **URL:** `https://atqhfbaurrmivjarowco.supabase.co`
- **Prefix convention:** everything here is `angry_`-prefixed so it can't collide
  with Pollen's `user_settings` or Bus Tracker's `bus_*` objects.

The anon key is embedded in `app.js`. That key is public by design; RLS is what
actually protects the data, and **it grants read only**. Every write goes through
the `angry-submit` edge function, which is the sole holder of the service role.

## The rule that everything else follows

**A voter's name is derived server-side from a secret token, never taken from the
request body.** The page has no say in who you are. Any design change that lets the
client name itself reintroduces impersonation — that was the whole point of the
rebuild, so don't undo it.

## Schema

One table. A whole board is stored as an ordered `text[]` rather than a row per
vote, because the ballot *is* an ordering and the pivots are computed client-side
from a few dozen rows anyway.

```sql
create table public.angry_submissions (
  id         uuid primary key default gen_random_uuid(),
  ranker     text not null,          -- nickname, e.g. 'Mordy'
  ranking    text[] not null,        -- ordered best → worst; index 0 is rank 1
  era        text not null default 'current',   -- 'current' (shown as 2026) or '2020'
  note       text,                   -- optional one-line defence, ≤280 chars
  created_at timestamptz not null default now()
);

create index angry_submissions_era_created_idx
  on public.angry_submissions (era, created_at desc);
```

## RLS

The voter roll — the token→name mapping — is a separate table:

```sql
create table public.angry_voters (
  nick       text primary key,
  token      text not null unique,   -- 22 chars, [a-z0-9], ~113 bits
  created_at timestamptz not null default now()
);
alter table public.angry_voters enable row level security;
-- and NO policies whatsoever, so anon and authenticated can never read it
```

## RLS

```sql
alter table public.angry_submissions enable row level security;

create policy angry_read on public.angry_submissions
  for select to anon, authenticated using (true);
```

That is the **only** policy on the table. No INSERT, no UPDATE, no DELETE for anon.
Consequences:

- The public key can read results and do nothing else. Boards are written solely by
  `angry-submit` using the service role, which bypasses RLS.
- Nobody can edit or erase a submitted board, including their own. Changing your
  mind means submitting a new one; `latest()` in `app.js` keeps only each ranker's
  newest row per era, and older rows stay as history.
- An impersonated board is therefore *recoverable*: the real man just submits
  again before the deadline and his board wins, while the forgery stays visible in
  the history.

### Verified behaviour (smoke-tested with the anon key)

| Attempt | Result |
|---|---|
| `GET` submissions | allowed |
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

- `GET  ?k=<token>` → `{ nick, deadline, closed }`. `nick` is `null` for anything
  unrecognised; the page uses this to render "Ranking as MORDY".
- `POST { k, ranking, note }` → `{ ok, ranker }`.

What it enforces, all server-side:

1. Token matches `^[a-z0-9]{22}$` and resolves to exactly one row in `angry_voters`.
2. `ranker` is set from that lookup. **Any `ranker` in the request body is ignored.**
3. The deadline has not passed.
4. `ranking` is an exact permutation of the roll — no duplicates, omissions or extras.
5. At most 40 boards per man, as a flood stop.
6. `note` trimmed to 280 chars.

It also stores `fp`, an 8-byte SHA-256 prefix of `x-forwarded-for` + user-agent, purely
so a leaked link can be traced after the fact. It is not an access control.

### Adversarial tests that must keep passing

| Attempt | Expected |
|---|---|
| POST with no `k`, `ranker: "Mordy"` | `403` invalid link |
| POST with a made-up 22-char token | `403` invalid link |
| POST with a **valid** token plus `ranker: "Bob"` | `200`, saved as the token's owner |
| POST a board with a duplicated name | `400` doesn't match roster |
| POST a board of the wrong length | `400` needs all 14 |
| `GET ?k=<junk>` | `{ nick: null }` |

The third row is the one that matters. If it ever saves as `Bob`, impersonation is back.

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
Because the anon insert policy forbids that era, they were written with the
Management API. That's also how any future admin fix has to be done.

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
