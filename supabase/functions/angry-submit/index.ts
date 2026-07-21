// angry-submit — the only way a board gets written.
//
// The anon key can read results and nothing else; it has no INSERT policy on
// angry_submissions and no policy at all on angry_voters. So a ballot can only
// be cast by presenting a secret token, which this function trades for a name
// using the service role. The name is never taken from the client.
//
//   GET  ?k=<token>                     -> { nick, deadline, closed }
//   POST { k, ranking: [...], note }    -> { ok, ranker }

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Boards lock at 11:59pm ET on Monday 10 August 2026. Change this one line to
// move the deadline; the page reads it from here so the two can't drift.
const DEADLINE = '2026-08-11T03:59:59Z';

// A single token shouldn't be able to flood the table, even a legitimate one.
const MAX_BOARDS_PER_MAN = 40;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const db = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/** Coarse fingerprint kept only so a leaked link can be traced after the fact. */
async function fingerprint(req: Request): Promise<string> {
  const raw = [
    req.headers.get('x-forwarded-for') ?? '',
    req.headers.get('user-agent') ?? '',
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Trades a token for a name. Returns null for anything unrecognised. */
async function nickFor(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !/^[a-z0-9]{22}$/.test(token)) return null;
  const res = await db(`angry_voters?select=nick&token=eq.${token}`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length === 1 ? rows[0].nick : null;
}

const closed = () => Date.now() > Date.parse(DEADLINE);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── Who am I? ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const nick = await nickFor(new URL(req.url).searchParams.get('k'));
      return json({ nick, deadline: DEADLINE, closed: closed() });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    // ── Cast a board ─────────────────────────────────────────────────────
    const { k, ranking, note } = await req.json().catch(() => ({}));

    const nick = await nickFor(k);
    if (!nick) return json({ error: 'That link isn\'t valid. Ask Danzzy for yours.' }, 403);

    if (closed()) return json({ error: 'Boards are closed. The results stand.' }, 403);

    // The board must be an exact permutation of the roll — no extras, no
    // omissions, no duplicates. The roll is the source of truth, not the page.
    const rollRes = await db('angry_voters?select=nick');
    if (!rollRes.ok) return json({ error: 'Roster unavailable. Try again.' }, 502);
    const roll: string[] = (await rollRes.json()).map((r: { nick: string }) => r.nick);

    if (!Array.isArray(ranking) || ranking.length !== roll.length) {
      return json({ error: `A board needs all ${roll.length} men, in order.` }, 400);
    }
    const seen = new Set(ranking);
    if (seen.size !== ranking.length || !roll.every((n) => seen.has(n))) {
      return json({ error: 'That board doesn\'t match the roster.' }, 400);
    }

    const countRes = await db(
      `angry_submissions?select=id&ranker=eq.${encodeURIComponent(nick)}&era=eq.current`,
      { headers: { Prefer: 'count=exact', Range: '0-0' } },
    );
    const total = Number(countRes.headers.get('content-range')?.split('/')[1] ?? 0);
    if (total >= MAX_BOARDS_PER_MAN) {
      return json({ error: 'You have changed your mind enough times.' }, 429);
    }

    const clean = typeof note === 'string' ? note.trim().slice(0, 280) : null;

    const ins = await db('angry_submissions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        ranker: nick, // from the token, never from the request body
        ranking,
        era: 'current',
        note: clean || null,
        fp: await fingerprint(req),
      }),
    });
    if (!ins.ok) return json({ error: `Couldn't save that board. ${await ins.text()}` }, 502);

    return json({ ok: true, ranker: nick });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
