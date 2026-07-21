// angry-submit — the only way a board gets written.
//
// Two jobs, and they must not be allowed to meet:
//   1. Prove you're allowed to vote, and that you only vote once.
//   2. Store a ballot that carries no trace of who cast it.
//
// The token identifies you long enough to check you're on the roll and to find
// which ballot row is yours to overwrite. The ballot row itself stores only the
// ordering — `ranker` is left NULL for the live era. Nothing readable by the
// public key ever ties a man to a board.
//
//   GET  ?k=<token>                     -> { nick, voted, deadline, closed }
//   POST { k, ranking: [...], note }    -> { ok }
//
// Note that POST does NOT echo back a name. It used to return `ranker`, which
// would have let anyone watching the network tab pair a response with the ballot
// that appeared a moment later.

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Boards lock at 11:59pm ET on Monday 10 August 2026. Change this one line to
// move the deadline; the page reads it from here so the two can't drift.
const DEADLINE = '2026-08-11T03:59:59Z';

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

/** Kept on the voter roll, never on a ballot, so it can't re-link the two. */
async function fingerprint(req: Request): Promise<string> {
  const raw = [
    req.headers.get('x-forwarded-for') ?? '',
    req.headers.get('user-agent') ?? '',
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Voter = { nick: string; ballot_id: string | null };

async function voterFor(token: unknown): Promise<Voter | null> {
  if (typeof token !== 'string' || !/^[a-z0-9]{22}$/.test(token)) return null;
  const res = await db(`angry_voters?select=nick,ballot_id&token=eq.${token}`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length === 1 ? rows[0] : null;
}

const closed = () => Date.now() > Date.parse(DEADLINE);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (req.method === 'GET') {
      const voter = await voterFor(new URL(req.url).searchParams.get('k'));
      return json({
        nick: voter?.nick ?? null,
        voted: !!voter?.ballot_id,
        deadline: DEADLINE,
        closed: closed(),
      });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    const { k, ranking, note } = await req.json().catch(() => ({}));

    const voter = await voterFor(k);
    if (!voter) return json({ error: 'That link isn\'t valid. Ask Danzzy for yours.' }, 403);

    if (closed()) return json({ error: 'Boards are closed. The results stand.' }, 403);

    // The board must be an exact permutation of the roll — including the voter
    // himself. Excluding him would make the missing name a signature.
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

    const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, 280) : null;
    // ranker stays NULL. That absence is the whole feature.
    const ballot = { ranking, era: 'current', note: clean, ranker: null };

    if (voter.ballot_id) {
      // Overwrite in place. Revisions are not kept: a stack of edits from one
      // man is a behavioural signature, and diffing them would expose him.
      const upd = await db(`angry_submissions?id=eq.${voter.ballot_id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(ballot),
      });
      if (!upd.ok) return json({ error: `Couldn't update that board. ${await upd.text()}` }, 502);
    } else {
      const ins = await db('angry_submissions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(ballot),
      });
      if (!ins.ok) return json({ error: `Couldn't save that board. ${await ins.text()}` }, 502);
      const [row] = await ins.json();

      await db(`angry_voters?nick=eq.${encodeURIComponent(voter.nick)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          ballot_id: row.id,
          voted_at: new Date().toISOString(),
          fp: await fingerprint(req),
        }),
      });
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
