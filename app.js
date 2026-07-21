/* The Angry Men, Not Dead Yet — one board, fourteen men, secret ballot. */

const SUPABASE_URL = 'https://atqhfbaurrmivjarowco.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cWhmYmF1cnJtaXZqYXJvd2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODc2ODgsImV4cCI6MjA5NTk2MzY4OH0.buWqvUnwid4QEE6m9OFM7n1tu51mcogTc01oG7pdtJI';

// Reads go through a view that exposes the ordering and nothing else — no name,
// no timestamp, not even a row id. There is no endpoint that returns a ballot
// with a man attached to it, so the page couldn't leak one if it tried.
const REST = `${SUPABASE_URL}/rest/v1/angry_board`;
const FN = `${SUPABASE_URL}/functions/v1/angry-submit`;
const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

const ERA_LABEL = { current: '2026', 2020: '2020' };

// With one or two boards in, an "average" is just somebody's ballot read aloud.
const MIN_BALLOTS = 3;

const state = {
  board: [...DEFAULT_BOARD],
  ballots: [],
  era: 'current',
  sortBy: 'avg',
  sortDir: 1,
  token: new URLSearchParams(location.search).get('k'),
  me: null,
  // Until the server has ruled on the token we know nothing. Rendering "invalid"
  // in the meantime accuses every valid link of being fake for a beat.
  checked: false,
  voted: false,
  deadline: null,
  closed: false,
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

async function identify() {
  if (!state.token) { state.checked = true; return; }
  try {
    const res = await fetch(`${FN}?k=${encodeURIComponent(state.token)}`, { headers: HEADERS });
    const data = await res.json();
    state.me = data.nick ?? null;
    state.voted = !!data.voted;
    state.deadline = data.deadline ?? null;
    state.closed = !!data.closed;
    state.checked = true;
  } catch {
    // A dead network is not a bad link — say so, and let a reload settle it.
    state.me = null;
    state.checked = 'error';
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
      everyone — and every board is secret, including yours.`;
  } else if (!state.me) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>That link isn't valid.</b>
      It may have been mistyped or cut short by the chat. Ask Danzzy to resend it.`;
  } else if (state.closed) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>Boards are closed.</b> The results stand.`;
  } else {
    gate.className = 'gate open';
    gate.innerHTML = `Ranking as <b>${state.me}</b> · your board is secret
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
    localStorage.setItem('angry.board', JSON.stringify(state.board));
    msg.textContent = 'Board in. Nobody can see it was yours.';
    msg.className = 'note good';
    $('#note').value = '';
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
  // No ordering is requested, and none is meaningful: the view hands back
  // ballots with no id and no timestamp, so there is nothing to sort them by.
  const res = await fetch(`${REST}?select=ranking,era,note`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Couldn't reach the board (${res.status}).`);
  state.ballots = await res.json();
}

/** Everything the page knows: counts, and nothing per-person. */
function tally(era) {
  const ballots = state.ballots.filter((b) => b.era === era);
  const men = new Map();

  ballots.forEach((b) => {
    b.ranking.forEach((nick, i) => {
      if (!men.has(nick)) men.set(nick, { nick, ranks: [] });
      men.get(nick).ranks.push(i + 1);
    });
  });

  const rows = [...men.values()].map((m) => {
    const counts = {};
    m.ranks.forEach((r) => (counts[r] = (counts[r] ?? 0) + 1));
    return {
      nick: m.nick,
      n: m.ranks.length,
      counts,
      avg: m.ranks.length ? m.ranks.reduce((a, b) => a + b, 0) / m.ranks.length : null,
      best: m.ranks.length ? Math.min(...m.ranks) : null,
      worst: m.ranks.length ? Math.max(...m.ranks) : null,
    };
  });

  rows.sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));
  return { ballots, rows, notes: ballots.map((b) => b.note).filter(Boolean) };
}

/** Below the threshold an average is just one man's ballot, read aloud. */
const tooFew = (t) => state.era === 'current' && t.ballots.length < MIN_BALLOTS;

function waiting(t) {
  const left = MIN_BALLOTS - t.ballots.length;
  return `<div class="empty">${
    t.ballots.length === 0
      ? 'No boards in yet.<br>Be the first, and set the tone.'
      : `${t.ballots.length} board${t.ballots.length === 1 ? '' : 's'} in.<br>
         Results open at ${MIN_BALLOTS} — ${left} to go, so nobody's board
         can be read off the totals.`
  }</div>`;
}

/* ─── Consensus ───────────────────────────────────────────────────────── */

function renderConsensus() {
  const t = tally(state.era);
  const host = $('#consensus-list');
  const label = ERA_LABEL[state.era];

  $('#consensus-sub').textContent = t.ballots.length
    ? `${t.ballots.length} secret board${t.ballots.length === 1 ? '' : 's'} in for ${label}. Everyone ranks all fourteen, themselves included.`
    : '';

  if (tooFew(t) || !t.ballots.length) {
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
            <span class="avg">${r.avg === null ? '—' : r.avg.toFixed(2)}</span>
          </div>
          <div class="range">
            <div class="range-bar" style="left:${pct(r.best)}%;width:${Math.max(1.5, pct(r.worst) - pct(r.best))}%"></div>
            <div class="range-tick" style="left:${pct(r.avg)}%"></div>
          </div>
          <div class="meta">
            <span>BEST ${r.best ?? '—'}</span>
            <span>WORST ${r.worst ?? '—'}</span>
            <span>BOARDS ${r.n}</span>
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

/* ─── Positions ───────────────────────────────────────────────────────── */

/* The old grid showed who ranked whom. This shows only how often each man
   landed in each slot — same shape, no attribution. A column of counts can't
   be traced to a ballot unless there are barely any, which MIN_BALLOTS covers. */
function renderPositions() {
  const t = tally(state.era);
  const host = $('#positions-host');

  if (tooFew(t) || !t.ballots.length) {
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
      <span style="margin-left:auto">HOW MANY BOARDS PUT HIM IN THAT SLOT</span></div>`;

  host.querySelectorAll('button[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      state.sortDir = String(state.sortBy) === String(key) ? -state.sortDir : 1;
      state.sortBy = /^\d+$/.test(key) ? Number(key) : key;
      renderPositions();
    }));
}

/* ─── Wiring ──────────────────────────────────────────────────────────── */

function show(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.panel === name)));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === `panel-${name}`));
}

function renderAll() {
  renderConsensus();
  renderPositions();
}

function init() {
  const saved = JSON.parse(localStorage.getItem('angry.board') || 'null');
  if (Array.isArray(saved) && saved.length === DEFAULT_BOARD.length) state.board = saved;

  renderBoard();
  initDrag();

  $('#submit').addEventListener('click', submit);
  $('#reset').addEventListener('click', () => {
    state.board = [...DEFAULT_BOARD];
    renderBoard();
    $('#submit-note').textContent = 'Back to the 2020 order.';
    $('#submit-note').className = 'note';
  });
  $('#shuffle').addEventListener('click', () => {
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

  renderIdentity();
  identify().then(renderIdentity);

  load()
    .then(() => {
      if (!state.ballots.some((b) => b.era === 'current')) {
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
