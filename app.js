/* The Angry Men, Not Dead Yet — one board, fourteen men, no mercy. */

const SUPABASE_URL = 'https://atqhfbaurrmivjarowco.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0cWhmYmF1cnJtaXZqYXJvd2NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODc2ODgsImV4cCI6MjA5NTk2MzY4OH0.buWqvUnwid4QEE6m9OFM7n1tu51mcogTc01oG7pdtJI';
const REST = `${SUPABASE_URL}/rest/v1/angry_submissions`;
const FN = `${SUPABASE_URL}/functions/v1/angry-submit`;
const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

const ERA_LABEL = { current: '2026', 2020: '2020' };

const state = {
  board: [...DEFAULT_BOARD],
  submissions: [],
  era: 'current',
  sortBy: 'avg',
  sortDir: 1,
  transposed: false,
  // Identity comes from the ?k= token in the link, confirmed by the server.
  // The page never gets to decide who you are.
  token: new URLSearchParams(location.search).get('k'),
  me: null,
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

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function lightFor(rank, total, base = DARK) {
  const t = total > 1 ? (rank - 1) / (total - 1) : 0;
  return mix(SODIUM, base, t);
}

function readable([r, g, b]) {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.48 ? '#17120a' : 'var(--bone)';
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
      <div class="slot"></div>
      <div class="who">
        <div class="nick">${nick}${man.seed2020 === null ? '<span class="tag">UNSEEDED</span>' : ''}</div>
        <div class="real">${man.name}</div>
      </div>
      <div class="grip" aria-hidden="true">⣿</div>`;
    paintSlot(li.querySelector('.slot'), i + 1, state.board.length);
    li.querySelector('.slot').textContent = String(i + 1).padStart(2, '0');
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

/* ─── Reading and writing boards ──────────────────────────────────────── */

async function load() {
  const res = await fetch(`${REST}?select=*&order=created_at.desc&limit=500`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Couldn't reach the board (${res.status}).`);
  state.submissions = await res.json();
}

/* One man, one board: only his most recent submission counts. */
function latest(era) {
  const seen = new Set();
  return state.submissions
    .filter((s) => s.era === era)
    .filter((s) => (seen.has(s.ranker) ? false : seen.add(s.ranker)));
}

/** Asks the server who this link belongs to. A bad token simply isn't anybody. */
async function identify() {
  if (!state.token) return;
  try {
    const res = await fetch(`${FN}?k=${encodeURIComponent(state.token)}`, { headers: HEADERS });
    const data = await res.json();
    state.me = data.nick ?? null;
    state.deadline = data.deadline ?? null;
    state.closed = !!data.closed;
  } catch {
    state.me = null;
  }
}

function renderIdentity() {
  const gate = $('#gate');
  const when = state.deadline
    ? new Date(state.deadline).toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : null;

  if (!state.token) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>You need your own link to vote.</b>
      Every man got a different one. Ask Danzzy for yours — then this page will
      know who you are and you can drag straight in. Results are open to everyone.`;
  } else if (!state.me) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>That link isn't valid.</b>
      It may have been mistyped or cut short by the chat. Ask Danzzy to resend it.`;
  } else if (state.closed) {
    gate.className = 'gate shut';
    gate.innerHTML = `<b>Boards are closed.</b> The results stand.`;
  } else {
    gate.className = 'gate open';
    gate.innerHTML = `Ranking as <b>${state.me}</b> · ${NAME_BY_NICK[state.me] ?? ''}
      <span class="until">Change it as often as you like until ${when}.</span>`;
  }

  const live = !!state.me && !state.closed;
  $('#submit').disabled = !live;
  $('#note').disabled = !live;
  $('#board').classList.toggle('locked', !live);
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

    localStorage.setItem('angry.board', JSON.stringify(state.board));
    msg.textContent = `Board locked as ${data.ranker}. Change it any time before the deadline.`;
    msg.className = 'note good';
    $('#note').value = '';
    await load();
    renderConsensus();
    renderGrid();
    renderFeed();
    show('consensus');
  } catch (err) {
    msg.textContent = String(err.message || err).slice(0, 120);
    msg.className = 'note bad';
  } finally {
    btn.textContent = 'Lock in board';
    renderIdentity();
  }
}

/* ─── Consensus ───────────────────────────────────────────────────────── */

/* A man's average excludes his own vote for himself. That was the 2020 rule
   and it stands. His self-vote is kept aside as the ego gap. */
function tally(era) {
  const boards = latest(era);
  const men = new Map();

  boards.forEach((b) => {
    b.ranking.forEach((nick, i) => {
      if (!men.has(nick)) men.set(nick, { nick, ranks: [], self: null });
      const m = men.get(nick);
      if (nick === b.ranker) m.self = i + 1;
      else m.ranks.push(i + 1);
    });
  });

  const rows = [...men.values()].map((m) => ({
    ...m,
    n: m.ranks.length,
    avg: m.ranks.length ? m.ranks.reduce((a, b) => a + b, 0) / m.ranks.length : null,
    best: m.ranks.length ? Math.min(...m.ranks) : null,
    worst: m.ranks.length ? Math.max(...m.ranks) : null,
  }));

  rows.sort((a, b) => (a.avg ?? 99) - (b.avg ?? 99));
  return { boards, rows };
}

function renderConsensus() {
  const { boards, rows } = tally(state.era);
  const host = $('#consensus-list');
  const label = ERA_LABEL[state.era];
  $('#consensus-sub').textContent = boards.length
    ? `${boards.length} board${boards.length === 1 ? '' : 's'} in for ${label}. A man's average leaves out his vote for himself.`
    : '';

  if (!boards.length) {
    host.innerHTML = `<div class="empty">No boards in for ${label} yet.<br>Be the first, and set the tone.</div>`;
    return;
  }

  const span = rows.length;
  host.innerHTML = rows
    .map((r, i) => {
      const pct = (v) => ((v - 1) / Math.max(1, span - 1)) * 100;
      const ego = r.self !== null && r.avg !== null ? Math.round((r.avg - r.self) * 10) / 10 : null;
      return `
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
            ${r.self !== null ? `<div class="range-self" style="left:${pct(r.self)}%" title="Where he put himself"></div>` : ''}
          </div>
          <div class="meta">
            <span>BEST ${r.best ?? '—'}</span>
            <span>WORST ${r.worst ?? '—'}</span>
            <span>VOTES ${r.n}</span>
            ${r.self !== null ? `<span>SELF ${r.self}</span>` : ''}
            ${ego !== null && ego !== 0 ? `<span class="ego">EGO GAP ${ego > 0 ? '+' : ''}${ego.toFixed(1)}</span>` : ''}
          </div>
        </div>
      </div>`;
    })
    .join('');

  host.querySelectorAll('.slot').forEach((el) =>
    paintSlot(el, +el.dataset.rank, +el.dataset.total)
  );
}

/* ─── The grid ────────────────────────────────────────────────────────── */

function renderGrid() {
  const { boards, rows } = tally(state.era);
  const host = $('#grid-host');

  if (!boards.length) {
    host.innerHTML = `<div class="empty">Nothing to pivot yet.</div>`;
    return;
  }

  const rankers = boards.map((b) => b.ranker).sort();
  const rankees = rows.map((r) => r.nick);
  const at = (ranker, rankee) => {
    const b = boards.find((x) => x.ranker === ranker);
    const i = b ? b.ranking.indexOf(rankee) : -1;
    return i === -1 ? null : i + 1;
  };

  // Rows are the men being ranked; transposing puts the voters on the left.
  const down = state.transposed ? rankers : rankees;
  const across = state.transposed ? rankees : rankers;
  const cell = (d, a) => (state.transposed ? at(d, a) : at(a, d));

  // Rows of rankees get their consensus average (self-vote excluded, as always).
  // Rows of rankers get something a voter's own row can actually tell you:
  // how far his board sits from everyone else's. Highest number is the contrarian.
  const consensusRank = new Map(rankees.map((n, i) => [n, i + 1]));

  const avgOf = (d) => {
    if (state.transposed) {
      const gaps = rankees
        .map((m) => {
          const v = at(d, m);
          return v === null ? null : Math.abs(v - consensusRank.get(m));
        })
        .filter((v) => v !== null);
      return gaps.length ? gaps.reduce((x, y) => x + y, 0) / gaps.length : null;
    }
    const vals = across.filter((a) => a !== d).map((a) => at(a, d)).filter((v) => v !== null);
    return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
  };

  const avgLabel = state.transposed ? 'OFF' : 'AVG';

  const sorted = [...down].sort((a, b) => {
    let av, bv;
    if (state.sortBy === 'name') { av = a; bv = b; }
    else if (state.sortBy === 'avg') { av = avgOf(a) ?? 99; bv = avgOf(b) ?? 99; }
    else { av = cell(a, state.sortBy) ?? 99; bv = cell(b, state.sortBy) ?? 99; }
    return av > bv ? state.sortDir : av < bv ? -state.sortDir : 0;
  });

  const arrow = (key) => (state.sortBy === key ? (state.sortDir === 1 ? ' ↓' : ' ↑') : '');
  const total = rankees.length;

  const head = `<tr>
    <th class="corner ${state.sortBy === 'name' ? 'sorted' : ''}">
      <button data-sort="name">${state.transposed ? 'RANKER' : 'RANKEE'}${arrow('name')}</button></th>
    ${across.map((a) => `<th class="cell ${state.sortBy === a ? 'sorted' : ''}"><button data-sort="${a}">${a}${arrow(a)}</button></th>`).join('')}
    <th class="cell ${state.sortBy === 'avg' ? 'sorted' : ''}"><button data-sort="avg">${avgLabel}${arrow('avg')}</button></th>
  </tr>`;

  const body = sorted
    .map((d) => {
      const cells = across
        .map((a) => {
          const v = cell(d, a);
          if (v === null) return `<td class="cell" style="color:var(--line)">·</td>`;
          const c = lightFor(v, total, CARD);
          const isSelf = d === a;
          return `<td class="cell ${isSelf ? 'self' : ''}" style="background-color:${rgb(c)};color:${readable(c)}">${v}</td>`;
        })
        .join('');
      const avg = avgOf(d);
      return `<tr><th class="rowhead"><span>${d}</span></th>${cells}<td class="cell">${avg === null ? '—' : avg.toFixed(1)}</td></tr>`;
    })
    .join('');

  host.innerHTML = `
    <div class="scroller"><table class="gridtable"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="legend"><span>RANK 1</span><span class="legend-scale"></span><span>RANK ${total}</span>
      <span style="margin-left:auto">${
        state.transposed
          ? 'OFF = AVG SLOTS FROM CONSENSUS'
          : 'AVG EXCLUDES SELF-VOTE · RED OUTLINE = SELF-VOTE'
      }</span></div>`;

  host.querySelectorAll('button[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      state.sortDir = state.sortBy === key ? -state.sortDir : 1;
      state.sortBy = key;
      renderGrid();
    })
  );
}

/* ─── Feed ────────────────────────────────────────────────────────────── */

function ago(iso) {
  const mins = (Date.now() - new Date(iso)) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  return days < 45 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function renderFeed() {
  const recent = state.submissions.filter((s) => s.era === 'current').slice(0, 12);
  $('#feed').innerHTML = recent.length
    ? recent
        .map(
          (s) =>
            `<div><b>${s.ranker}</b> locked a board · ${ago(s.created_at)}${
              s.note ? ` — “${s.note.replace(/</g, '&lt;')}”` : ''
            }</div>`
        )
        .join('')
    : '';
}

/* ─── Wiring ──────────────────────────────────────────────────────────── */

function show(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.panel === name)));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === `panel-${name}`));
}

function init() {
  const savedBoard = JSON.parse(localStorage.getItem('angry.board') || 'null');
  if (Array.isArray(savedBoard) && savedBoard.length === DEFAULT_BOARD.length) {
    state.board = savedBoard;
  }

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
  $('#transpose').addEventListener('click', () => {
    state.transposed = !state.transposed;
    state.sortBy = 'avg';
    state.sortDir = 1;
    renderGrid();
  });

  $$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.panel)));
  $$('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      state.era = c.dataset.era;
      state.sortBy = 'avg';
      state.sortDir = 1;
      // Both panels carry a copy of the era chips; keep them in step.
      $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.era === state.era)));
      renderConsensus();
      renderGrid();
    })
  );

  renderIdentity();
  identify().then(renderIdentity);

  load()
    .then(() => {
      // Open on whichever year has boards in it.
      if (!latest('current').length) {
        state.era = '2020';
        $$('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.era === '2020')));
      }
      renderConsensus();
      renderGrid();
      renderFeed();
    })
    .catch((err) => {
      $('#consensus-list').innerHTML = `<div class="empty">${err.message}<br>Reload the page.</div>`;
      $('#grid-host').innerHTML = '';
    });
}

init();
