// angry-submit — the only way a board gets written, and the only way an
// attributed one is ever read.
//
// Who sees what:
//   the men      — aggregates only, via the angry_stats / angry_positions
//                  views. No endpoint returns an individual ordering.
//   the runner   — everything, by presenting the admin token, which never
//                  touches the page unless it's in the URL.
//
// So `ranker` IS stored. Secrecy is enforced at the read boundary, not by
// throwing the record away.
//
//   GET  ?k=<token>                     -> { nick, voted, deadline, closed }
//                                          (legacy; the page calls the
//                                           angry_whoami RPC directly instead,
//                                           which is ~4x faster)
//   GET  ?a=<admin token>               -> { admin, ballots: [{ranker, ranking, note, era}] }
//   POST { k, ranking: [...], note }    -> { ok }
//
// POST deliberately does NOT echo back a name. It used to, which would let
// anyone watching the network tab pair a response with the ballot that appeared
// a moment later.

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The deadline lives in public.angry_config, so this and angry_whoami() (which
// the page calls directly) can never disagree. To move it, update that row.
async function deadline(): Promise<string> {
  const res = await db('angry_config?select=deadline&id=eq.1');
  if (!res.ok) throw new Error('config unavailable');
  return (await res.json())[0].deadline;
}

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

const isClosed = (d: string) => Date.now() > Date.parse(d);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams;

      // The full record, for whoever runs this. Checked server-side like
      // everything else — the page can't grant itself the privilege.
      const admin = params.get('a');
      if (admin) {
        if (!/^[a-z0-9]{26}$/.test(admin)) return json({ admin: false }, 403);
        const ok = await db(`angry_admin?select=token&token=eq.${admin}`);
        if (!ok.ok || (await ok.json()).length !== 1) return json({ admin: false }, 403);

        const all = await db('angry_submissions?select=ranker,ranking,note,era');
        return json({ admin: true, ballots: all.ok ? await all.json() : [] });
      }

      // Kept for compatibility; the page uses the angry_whoami RPC instead.
      const voter = await voterFor(params.get('k'));
      const due = await deadline();
      return json({
        nick: voter?.nick ?? null,
        voted: !!voter?.ballot_id,
        deadline: due,
        closed: isClosed(due),
      });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

    const { k, ranking, note } = await req.json().catch(() => ({}));

    const voter = await voterFor(k);
    if (!voter) return json({ error: 'That link isn\'t valid. Ask Danzzy for yours.' }, 403);

    if (isClosed(await deadline())) {
      return json({ error: 'Boards are closed. The results stand.' }, 403);
    }

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
    // The name is recorded. It simply never leaves through a public read.
    const ballot = { ranking, era: 'current', note: clean, ranker: voter.nick };

    if (voter.ballot_id) {
      // Overwrite in place — one board per man, and no pile of revisions.
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
