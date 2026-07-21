# Supabase — Angry Men Rankings

Shares the personal **"Misc"** project with Pollen and Bus Tracker.

- **Project ref:** `atqhfbaurrmivjarowco`
- **URL:** `https://atqhfbaurrmivjarowco.supabase.co`
- **Prefix convention:** everything here is `angry_`-prefixed so it can't collide
  with Pollen's `user_settings` or Bus Tracker's `bus_*` objects.

No edge functions. The page talks straight to PostgREST with the anon key, which is
embedded in `app.js` — that key is public by design and RLS is what actually
protects the data.

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

```sql
alter table public.angry_submissions enable row level security;

create policy angry_read on public.angry_submissions
  for select to anon, authenticated using (true);

create policy angry_insert on public.angry_submissions
  for insert to anon, authenticated with check (
    char_length(ranker) between 1 and 40
    and array_length(ranking, 1) between 2 and 40
    and era = 'current'
    and char_length(coalesce(note, '')) <= 280
  );
```

There is deliberately **no UPDATE and no DELETE policy**. Consequences:

- Nobody can edit or erase a submitted board, including their own. Changing your
  mind means submitting a new one; `latest()` in `app.js` keeps only each ranker's
  newest row per era, and the older rows stay as history.
- `era = 'current'` in the insert check means the anon key **cannot write or forge
  historical rows**. The 2020 boards can only be touched with the service role.

### Verified behaviour (smoke-tested with the anon key)

| Attempt | Result |
|---|---|
| `POST` a board with `era:'current'` | `201` — allowed |
| `POST` a board with `era:'2020'` | `401` — blocked |
| `DELETE ?ranker=eq.Bob` | `204` **but zero rows affected** — RLS filtered it |
| `GET` all rows | allowed |

Watch out for that DELETE: **PostgREST returns `204` even when RLS matched nothing**,
so a 204 is not evidence of a successful delete. Confirm with a row count via the
Management API before concluding anything was removed.

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
