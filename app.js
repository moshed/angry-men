/* The Angry Men, Not Dead Yet — one board, fourteen men, secret ballot. */

const SUPABASE_URL = 'https://atqhfbaurrmivjarowco.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cWhmYmF1cnJtaXZqYXJvd2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODc2ODgsImV4cCI6MjA5NTk2MzY4OH0.buWqvUnwid4QEE6m9OFM7n1tu51mcogTc01oG7pdtJI';

// The public API serves aggregates only — no ballot, in any form. Self-votes are
// excluded in SQL, where `ranker` is visible; that exclusion is impossible in the
// browser precisely because the browser is never given a name. The one way to get
// an attributed board is the edge function with the admin token.
const REST = `${SUPABASE_URL}/rest/v1`;
const FN = `${SUPABASE_URL}/functions/v1/angry-submit`;
const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

const ERA_LABEL = { current: '2026', 2020: '2020' };

// With one or two boards in, an "average" is just somebody's ballot read aloud.
const MIN_BALLOTS = 3;

const state = {
  board: [...DEFAULT_BOARD],
  stats: [],
  positions: [],
  counts: [],
  notes: [],
  era: 'current',
  sortBy: 'avg',
  sortDir: 1,
  gridSort: 'name',
  gridDir: 1,
  token: new URLSearchParams(location.search).get('k'),
  // Present only in the runner's own URL. Everything it unlocks is fetched
  // from the edge function, which re-checks it — the flag alone grants nothing.
  // Remembered once validated, so the admin link only has to be opened once and
  // a truncated "&a=" in a chat app can't lock the runner out of his own grid.
  adminKey: new URLSearchParams(location.search).get('a') || localStorage.getItem('angry.admin'),
  admin: false,
  attributed: [],
  me: null,
  // Until the server has ruled on the token we know nothing. Rendering "invalid"
  // in the meantime accuses every valid link of being fake for a beat.
  checked: false,
  voted: false,
  deadline: null,
  closed: false,
  // Set the moment he moves a row. His own submitted board arrives a beat after
  // first paint, and must never overwrite a change he's already started making.
  touched: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ─── Colour: the light on a slot ─────────────────────────────────────────
   Rank 1 gets the full sodium lamp; the last man stands in the dark. */

const SODIUM = [242, 160, 61];
const DARK = [23, 29, 38];
const CARD = [26, 32, 41];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function lightFor(rank, total, base = DARK) {
  const t = total > 1 ? (rank - 1) / (total - 1) : 0;
  return mix(SODIUM, base, t);
}

function readable([r, g, b]) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.48 ? '#17120a' : 'var(--bone)';
}

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function paintSlot(el, rank, total, base) {
  const c = lightFor(rank, total, base);
  el.style.backgroundColor = rgb(c);
  el.style.color = readable(c);
}

/* ─── The ballot ──────────────────────────────────────────────────────── */

function renderBoard() {
  const list = $('#board');
  list.innerHTML = '';
  state.board.forEach((nick, i) => {
    const man = ROSTER.find((m) => m.nick === nick);
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.nick = nick;
    li.tabIndex = 0;
    li.setAttribute('aria-label', `${nick}, position ${i + 1} of ${state.board.length}`);
    li.innerHTML = `
      <div class="slot">${String(i + 1).padStart(2, '0')}</div>
      <div class="who">
        <div class="nick">${nick}${man.seed2020 === null ? '<span class="tag">UNSEEDED</span>' : ''}</div>
        <div class="real">${man.name}</div>
      </div>
      <div class="grip" aria-hidden="true">⣿</div>`;
    paintSlot(li.querySelector('.slot'), i + 1, state.board.length);
    list.appendChild(li);
  });
}

function move(from, to) {
  if (to < 0 || to >= state.board.length || to === from) return;
  state.touched = true;
  const [man] = state.board.splice(from, 1);
  state.board.splice(to, 0, man);
  renderBoard();
  flashDelta(to, from - to);
  const row = $('#board').children[to];
  if (document.activeElement !== document.body) row.focus();
}

function flashDelta(index, change) {
  if (!change) return;
  const row = $('#board').children[index];
  const el = document.createElement('div');
  el.className = `delta ${change > 0 ? 'up' : 'down'}`;
  el.textContent = `${change > 0 ? '▲' : '▼'}${Math.abs(change)}`;
  el.style.top = `${row.offsetTop + 20}px`;
  $('#board').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/* Drag: full-row on a mouse, grip-only on touch so the page still scrolls. */
function initDrag() {
  const list = $('#board');
  let drag = null;

  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (e.pointerType !== 'mouse' && !e.target.closest('.grip')) return;

    const rows = [...list.children].filter((n) => n.classList.contains('row'));
    const step = row.offsetHeight + 5;
    drag = { row, rows, step, from: rows.indexOf(row), to: rows.indexOf(row), y: e.clientY };
    row.classList.add('lifted');
    row.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag.row.style.transform = `translateY(${dy}px)`;
    const to = Math.max(0, Math.min(drag.rows.length - 1, drag.from + Math.round(dy / drag.step)));
    if (to !== drag.to) {
      drag.to = to;
      drag.rows.forEach((r, i) => {
        if (r === drag.row) return;
        let shift = 0;
        if (i > drag.from && i <= to) shift = -drag.step;
        else if (i < drag.from && i >= to) shift = drag.step;
        r.classList.add('shift');
        r.style.transform = `translateY(${shift}px)`;
      });
    }
  });

  const drop = () => {
    if (!drag) return;
    const { from, to } = drag;
    drag.rows.forEach((r) => {
      r.classList.remove('shift', 'lifted');
      r.style.transform = '';
    });
    drag = null;
    if (from !== to) move(from, to);
  };

  list.addEventListener('pointerup', drop);
  list.addEventListener('pointercancel', drop);

  list.addEventListener('keydown', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const i = [...list.children].indexOf(row);
    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
  });
}

/* ─── Identity ────────────────────────────────────────────────────────── */

const idKey = () => `angry.id.${state.token}`;
// Per token, not global: two men on one phone would otherwise inherit each
// other's board. `angry.board` (no token) is the pre-2026 key, read once.
const boardKey = () => `angry.board.${state.token || 'anon'}`;

const isFullBoard = (b) =>
  Array.isArray(b) && b.length === DEFAULT_BOARD.length &&
  new Set(b).size === b.length && DEFAULT_BOARD.every((n) => b.includes(n));

/** His own board, read back from the server with his own token.
 *
 *  Without this, a man who voted on his laptop and reopened the link on his
 *  phone was shown the 2020 default order and told he was "in" — the board he
 *  actually submitted lived only in the other browser's localStorage. He can
 *  only ever fetch his own: the token is the lookup key, and it's the same
 *  token that already lets him overwrite that board, so this grants nothing new.
 *  Nothing here goes near another man's ballot. */
async function fetchMyBoard() {
  if (!state.token) return;
  try {
    const res = await fetch(`${REST}/rpc/angry_my_board`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: state.token }),
    });
    const [row] = await res.json();
    if (!row || !isFullBoard(row.ranking)) return;

    localStorage.setItem(boardKey(), JSON.stringify(row.ranking));
    // He may have started dragging while this was in flight. His hands win.
    if (state.touched) return;
    state.board = row.ranking;
    renderBoard();
    // Carry his note back too, or a resubmit silently wipes it.
    if (row.note && !$('#note').value) $('#note').value = row.note;
  } catch { /* offline: whatever's cached locally stands */ }
}

/** Last known answer for this token, so a return visit renders with no wait. */
function useCachedIdentity() {
  if (!state.token) return false;
  try {
    const c = JSON.parse(localStorage.getItem(idKey()) || 'null');
    if (!c || !c.nick) return false;
    Object.assign(state, { me: c.nick, voted: !!c.voted, deadline: c.deadline, checked: true });
    return true;
  } catch { return false; }
}

async function identify() {
  if (!state.token) { state.checked = true; return; }
  try {
    // Straight to Postgres. Routing this through the edge function cost ~250ms
    // warm and over a second cold, for a single indexed lookup — the function
    // was just making its own HTTP call to the same place. Writes still go
    // through it, where the checks matter and the latency doesn't.
    const res = await fetch(`${REST}/rpc/angry_whoami`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: state.token }),
    });
    const [data = {}] = await res.json();
    state.me = data.nick ?? null;
    state.voted = !!data.voted;
    state.deadline = data.deadline ?? null;
    state.closed = !!data.closed;
    state.checked = true;
    // Only cache a real answer; a null nick must not be remembered as one.
    if (data.nick) {
      localStorage.setItem(idKey(), JSON.stringify({
        nick: data.nick, voted: !!data.voted, deadline: data.deadline,
      }));
    } else {
      localStorage.removeItem(idKey());
    }
  } catch {
    // A dead network is not a bad link. If we already knew who this is, stay
    // put and say nothing; only complain when we have nothing to show.
    if (!state.me) { state.me = null; state.checked = 'error'; }
  }
}

function renderIdentity() {
  const gate = $('#gate');
  const when = state.deadline
    ? new Date(state.deadline).toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : null;

  if (state.token && !state.checked) {
    gate.className = 'gate wait';
    gate.innerHTML = `Checking your link…`;
  } else if (state.token && state.checked === 'error') {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>Couldn't check your link.</b>
      That's the connection, not the link. Reload and it should sort itself out.`;
  } else if (!state.token) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>You need your own link to vote.</b>
      Every man got a different one. Ask Danzzy for yours. Results are open to
      everyone; individual boards are not.`;
  } else if (!state.me) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>That link isn't valid.</b>
      It may have been mistyped or cut short by the chat. Ask Danzzy to resend it.`;
  } else if (state.closed) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>Boards are closed.</b> The results stand.`;
  } else {
    gate.className = 'gate open';
    gate.innerHTML = `Ranking as <b>${state.me}</b> · no one else sees your board
      <span class="until">${
        state.voted
          ? `You're in. Change your board as often as you like until ${when} — it replaces the old one.`
          : `Change it as often as you like until ${when}.`
      }</span>`;
  }

  const live = !!state.me && !state.closed;
  $('#submit').disabled = !live;
  $('#note').disabled = !live;
  $('#board').classList.toggle('locked', !live);
  $('#submit').textContent = state.voted ? 'Replace my board' : 'Lock in board';
}

async function submit() {
  const msg = $('#submit-note');
  const btn = $('#submit');
  btn.disabled = true;
  btn.textContent = 'Locking…';

  try {
    const res = await fetch(FN, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: state.token, ranking: state.board, note: $('#note').value.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    state.voted = true;
    state.touched = false;
    localStorage.setItem(boardKey(), JSON.stringify(state.board));
    // The cached identity says "hasn't voted" until it's refreshed; correct it
    // now so a reload doesn't offer to "Lock in" a board that's already in.
    try {
      const c = JSON.parse(localStorage.getItem(idKey()) || 'null');
      if (c) localStorage.setItem(idKey(), JSON.stringify({ ...c, voted: true }));
    } catch { /* nothing cached */ }
    msg.textContent = 'Board in. None of the others can see it was yours.';
    msg.className = 'note good';
    // The note is deliberately left in place — clearing it meant the next
    // resubmit sent an empty one and wiped what he'd written.
    await load();
    renderAll();
    show('consensus');
  } catch (err) {
    msg.textContent = String(err.message || err).slice(0, 120);
    msg.className = 'note bad';
  } finally {
    renderIdentity();
  }
}

/* ─── Reading ─────────────────────────────────────────────────────────── */

async function load() {
  const grab = async (path) => {
    const res = await fetch(`${REST}/${path}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Couldn't reach the board (${res.status}).`);
    return res.json();
  };
  [state.stats, state.positions, state.counts, state.notes] = await Promise.all([
    grab('angry_stats?select=era,rankee,n,avg,best,worst'),
    grab('angry_positions?select=era,rankee,slot,cnt'),
    grab('angry_counts?select=era,boards'),
    grab('angry_notes?select=era,note'),
  ]);
}

/** Where each man finished in 2020, for the movement column. */
function ranks2020() {
  const rows = state.stats
    .filter((s) => s.era === '2020')
    .map((s) => ({ nick: s.rankee, avg: Number(s.avg) }))
    .sort((a, b) => a.avg - b.avg);
  return Object.fromEntries(rows.map((r, i) => [r.nick, i + 1]));
}

/** Everything the page knows: totals, already stripped of self-votes. */
function tally(era) {
  const rows = state.stats
    .filter((s) => s.era === era)
    .map((s) => ({
      nick: s.rankee,
      n: s.n,
      avg: s.avg === null ? null : Number(s.avg),   // numeric arrives as a string
      best: s.best,
      worst: s.worst,
      counts: {},
    }));

  const byNick = Object.fromEntries(rows.map((r) => [r.nick, r]));
  state.positions
    .filter((p) => p.era === era)
    .forEach((p) => { if (byNick[p.rankee]) byNick[p.rankee].counts[p.slot] = p.cnt; });

  rows.sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));

  return {
    boards: state.counts.find((c) => c.era === era)?.boards ?? 0,
    rows,
    notes: state.notes.filter((n) => n.era === era).map((n) => n.note),
  };
}

/** Below the threshold an average is just one man's ballot, read aloud. */
const tooFew = (t) => state.era === 'current' && t.boards < MIN_BALLOTS;

function waiting(t) {
  const left = MIN_BALLOTS - t.boards;
  return `<div class="empty">${
    t.boards === 0
      ? 'No boards in yet.<br>Be the first, and set the tone.'
      : `${t.boards} board${t.boards === 1 ? '' : 's'} in.<br>
         Results open at ${MIN_BALLOTS} — ${left} to go, so nobody's board
         can be read off the totals.`
  }</div>`;
}

/* ─── Consensus ───────────────────────────────────────────────────────── */

function renderConsensus() {
  const t = tally(state.era);
  const then = state.era === 'current' ? ranks2020() : {};
  const host = $('#consensus-list');
  const label = ERA_LABEL[state.era];

  $('#consensus-hint').textContent =
    state.era === 'current' ? '▲▼ is movement against where he finished in 2020.' : '';
  $('#consensus-sub').textContent = t.boards
    ? `${t.boards} secret board${t.boards === 1 ? '' : 's'} in for ${label}. A man's own vote for himself never counts toward his numbers.`
    : '';

  if (tooFew(t) || !t.boards) {
    host.innerHTML = waiting(t);
    $('#notes').innerHTML = '';
    return;
  }

  const span = t.rows.length;
  const pct = (v) => ((v - 1) / Math.max(1, span - 1)) * 100;

  host.innerHTML = t.rows
    .map((r, i) => `
      <div class="standing">
        <div class="slot" data-rank="${i + 1}" data-total="${span}">${String(i + 1).padStart(2, '0')}</div>
        <div class="standing-body">
          <div class="standing-top">
            <span class="nick">${r.nick}</span>
            <span class="real">${NAME_BY_NICK[r.nick] ?? ''}</span>
            ${move(then, r.nick, i + 1)}
            <span class="avg">${r.avg === null ? '—' : r.avg.toFixed(2)}</span>
          </div>
          <div class="range">
            <div class="range-bar" style="left:${pct(r.best)}%;width:${Math.max(1.5, pct(r.worst) - pct(r.best))}%"></div>
            <div class="range-tick" style="left:${pct(r.avg)}%"></div>
          </div>
          <div class="meta">
            <span>BEST ${r.best ?? '—'}</span>
            <span>WORST ${r.worst ?? '—'}</span>
            <span>VOTES ${r.n}</span>
          </div>
        </div>
      </div>`)
    .join('');

  host.querySelectorAll('.slot').forEach((el) =>
    paintSlot(el, +el.dataset.rank, +el.dataset.total));

  $('#notes').innerHTML = t.notes.length
    ? `<h3 class="minihed">What they said</h3>` +
      t.notes.map((n) => `<div class="said">“${n.replace(/</g, '&lt;')}”</div>`).join('')
    : '';
}

/** Movement against 2020: up is a promotion, so a smaller number is better. */
function move(then, nick, now) {
  if (!Object.keys(then).length) return '';
  const was = then[nick];
  if (!was) return `<span class="move new">NEW</span>`;
  const d = was - now;
  if (!d) return `<span class="move flat">—</span>`;
  return `<span class="move ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
}

/* ─── Positions ───────────────────────────────────────────────────────── */

/* The old grid showed who ranked whom. This shows only how often each man
   landed in each slot — same shape, no attribution. A column of counts can't
   be traced to a ballot unless there are barely any, which MIN_BALLOTS covers. */
function renderPositions() {
  const t = tally(state.era);
  const host = $('#positions-host');

  if (tooFew(t) || !t.boards) {
    host.innerHTML = waiting(t);
    return;
  }

  const span = t.rows.length;
  const slots = Array.from({ length: span }, (_, i) => i + 1);
  const peak = Math.max(1, ...t.rows.flatMap((r) => Object.values(r.counts)));

  const sorted = [...t.rows].sort((a, b) => {
    let av, bv;
    if (state.sortBy === 'name') { av = a.nick; bv = b.nick; }
    else if (state.sortBy === 'avg') { av = a.avg ?? 99; bv = b.avg ?? 99; }
    else { av = -(a.counts[state.sortBy] ?? 0); bv = -(b.counts[state.sortBy] ?? 0); }
    return av > bv ? state.sortDir : av < bv ? -state.sortDir : 0;
  });

  const arrow = (k) => (String(state.sortBy) === String(k) ? (state.sortDir === 1 ? ' ↓' : ' ↑') : '');

  const head = `<tr>
    <th class="corner ${state.sortBy === 'name' ? 'sorted' : ''}">
      <button data-sort="name">MAN${arrow('name')}</button></th>
    ${slots.map((s) => `<th class="cell ${String(state.sortBy) === String(s) ? 'sorted' : ''}"><button data-sort="${s}">${s}${arrow(s)}</button></th>`).join('')}
    <th class="cell ${state.sortBy === 'avg' ? 'sorted' : ''}"><button data-sort="avg">AVG${arrow('avg')}</button></th>
  </tr>`;

  const body = sorted
    .map((r) => {
      const cells = slots
        .map((s) => {
          const c = r.counts[s] ?? 0;
          if (!c) return `<td class="cell" style="color:var(--line)">·</td>`;
          // Heat by how many boards agreed, not by the slot number.
          const col = lightFor(peak - c + 1, peak, CARD);
          return `<td class="cell" style="background-color:${rgb(col)};color:${readable(col)}">${c}</td>`;
        })
        .join('');
      return `<tr><th class="rowhead"><span>${r.nick}</span></th>${cells}<td class="cell">${r.avg.toFixed(1)}</td></tr>`;
    })
    .join('');

  host.innerHTML = `
    <div class="scroller"><table class="gridtable"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="legend"><span>FEW</span><span class="legend-scale rev"></span><span>MANY</span>
      <span style="margin-left:auto">BOARDS THAT PUT HIM THERE · SELF-VOTES EXCLUDED</span></div>`;

  host.querySelectorAll('button[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      state.sortDir = String(state.sortBy) === String(key) ? -state.sortDir : 1;
      state.sortBy = /^\d+$/.test(key) ? Number(key) : key;
      renderPositions();
    }));
}

/* ─── The grid (runner's eyes only) ───────────────────────────────────── */

async function loadAdmin() {
  if (!state.adminKey) return;
  try {
    const res = await fetch(`${FN}?a=${encodeURIComponent(state.adminKey)}`, { headers: HEADERS });
    const data = await res.json();
    state.admin = !!data.admin;
    state.attributed = data.ballots ?? [];
    if (state.admin) localStorage.setItem('angry.admin', state.adminKey);
    else localStorage.removeItem('angry.admin');
  } catch {
    state.admin = false;
  }
  $('#tab-grid').hidden = !state.admin;
}

function renderGrid() {
  if (!state.admin) return;
  const host = $('#grid-host');
  const ballots = state.attributed.filter((b) => b.era === state.era && b.ranker);
  const voted = new Set(ballots.map((b) => b.ranker));
  const missing = DEFAULT_BOARD.filter((n) => !voted.has(n));
  const chase = state.era !== 'current' ? '' : missing.length
    ? `<div class="chase"><b>Still to vote — ${missing.length} of ${DEFAULT_BOARD.length}</b>
         <span>${missing.join(' · ')}</span></div>`
    : `<div class="chase in"><b>All ${DEFAULT_BOARD.length} boards are in.</b></div>`;

  if (!ballots.length) {
    host.innerHTML = chase + `<div class="empty">No boards for ${ERA_LABEL[state.era]} yet.</div>`;
    return;
  }

  const rankers = ballots.map((b) => b.ranker).sort();
  const stats = tally(state.era);
  const rankees = stats.rows.map((r) => r.nick);
  const avgOf = Object.fromEntries(stats.rows.map((r) => [r.nick, r.avg]));

  const at = (ranker, rankee) => {
    const b = ballots.find((x) => x.ranker === ranker);
    const i = b ? b.ranking.indexOf(rankee) : -1;
    return i === -1 ? null : i + 1;
  };

  // Where he put himself, and how far that sits from where everyone else put
  // him. Positive gap = he rates himself better than the group does.
  const selfOf = (n) => at(n, n);
  const gapOf = (n) => {
    const self = selfOf(n);
    return self === null || avgOf[n] == null ? null : avgOf[n] - self;
  };

  const sorted = [...rankees].sort((a, b) => {
    const key = state.gridSort;
    let av, bv;
    if (key === 'name') { av = a; bv = b; }
    else if (key === 'avg') { av = avgOf[a] ?? 99; bv = avgOf[b] ?? 99; }
    else if (key === 'self') { av = selfOf(a) ?? 99; bv = selfOf(b) ?? 99; }
    else if (key === 'gap') { av = -(gapOf(a) ?? -99); bv = -(gapOf(b) ?? -99); }
    else { av = at(key, a) ?? 99; bv = at(key, b) ?? 99; }
    return av > bv ? state.gridDir : av < bv ? -state.gridDir : 0;
  });

  const arrow = (k) => (state.gridSort === k ? (state.gridDir === 1 ? ' ↓' : ' ↑') : '');
  const total = rankees.length;

  host.innerHTML = chase + `
    <div class="warn">Only visible with your admin link. Don't share this URL — it shows every man's board with his name on it.</div>
    <div class="scroller"><table class="gridtable">
      <thead><tr>
        <th class="corner ${state.gridSort === 'name' ? 'sorted' : ''}"><button data-g="name">RANKEE${arrow('name')}</button></th>
        ${rankers.map((r) => `<th class="cell ${state.gridSort === r ? 'sorted' : ''}"><button data-g="${r}">${r}${arrow(r)}</button></th>`).join('')}
        <th class="cell tot ${state.gridSort === 'avg' ? 'sorted' : ''}"><button data-g="avg">AVG${arrow('avg')}</button></th>
        <th class="cell tot ${state.gridSort === 'self' ? 'sorted' : ''}"><button data-g="self">SELF${arrow('self')}</button></th>
        <th class="cell tot ${state.gridSort === 'gap' ? 'sorted' : ''}"><button data-g="gap">GAP${arrow('gap')}</button></th>
      </tr></thead>
      <tbody>${sorted.map((rankee) => `
        <tr><th class="rowhead"><span>${rankee}</span></th>
        ${rankers.map((r) => {
          const v = at(r, rankee);
          if (v === null) return `<td class="cell" style="color:var(--line)">·</td>`;
          const c = lightFor(v, total, CARD);
          return `<td class="cell ${r === rankee ? 'self' : ''}" style="background-color:${rgb(c)};color:${readable(c)}">${v}</td>`;
        }).join('')}
        <td class="cell tot">${avgOf[rankee] == null ? '—' : avgOf[rankee].toFixed(2)}</td>
        <td class="cell tot">${selfOf(rankee) ?? '—'}</td>
        <td class="cell tot ${gapClass(gapOf(rankee))}">${fmtGap(gapOf(rankee))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="legend"><span>RANK 1</span><span class="legend-scale"></span><span>RANK ${total}</span>
      <span style="margin-left:auto">AVG EXCLUDES HIS SELF-VOTE · GAP = AVG − SELF, + MEANS HE FLATTERS HIMSELF</span></div>`;

  host.querySelectorAll('button[data-g]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const k = btn.dataset.g;
      state.gridDir = state.gridSort === k ? -state.gridDir : 1;
      state.gridSort = k;
      renderGrid();
    }));
}

/** A gap of +6.3 means he put himself six places above where the group has him. */
function fmtGap(g) {
  if (g === null) return '—';
  return `${g > 0 ? '+' : g < 0 ? '−' : ''}${Math.abs(g).toFixed(1)}`;
}

function gapClass(g) {
  if (g === null) return '';
  if (g >= 2) return 'gap-hi';
  if (g <= -2) return 'gap-lo';
  return '';
}

/* ─── Wiring ──────────────────────────────────────────────────────────── */

function show(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.panel === name)));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === `panel-${name}`));
}

function renderAll() {
  renderConsensus();
  renderPositions();
  renderGrid();
}

function init() {
  const saved = JSON.parse(
    localStorage.getItem(boardKey()) || localStorage.getItem('angry.board') || 'null');
  if (isFullBoard(saved)) state.board = saved;

  renderBoard();
  initDrag();

  $('#submit').addEventListener('click', submit);
  $('#reset').addEventListener('click', () => {
    state.board = [...DEFAULT_BOARD];
    state.touched = true;
    renderBoard();
    $('#submit-note').textContent = 'Back to the 2020 order.';
    $('#submit-note').className = 'note';
  });
  $('#shuffle').addEventListener('click', () => {
    state.touched = true;
    for (let i = state.board.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.board[i], state.board[j]] = [state.board[j], state.board[i]];
    }
    renderBoard();
    $('#submit-note').textContent = 'Shuffled. Now fix it.';
    $('#submit-note').className = 'note';
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.panel)));
  $$('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      state.era = c.dataset.era;
      state.sortBy = 'avg';
      state.sortDir = 1;
      $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.era === state.era)));
      renderAll();
    }));

  useCachedIdentity();
  renderIdentity();
  identify().then(renderIdentity);
  fetchMyBoard();
  loadAdmin().then(renderGrid);

  load()
    .then(() => {
      if (!(state.counts.find((c) => c.era === 'current')?.boards)) {
        state.era = '2020';
        $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.era === '2020')));
      }
      renderAll();
    })
    .catch((err) => {
      $('#consensus-list').innerHTML = `<div class="empty">${err.message}<br>Reload the page.</div>`;
      $('#positions-host').innerHTML = '';
    });
}

init();
