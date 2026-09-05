/* GestionMoney - front end. Vanilla JS, no build step. */
'use strict';

const S = {
  view: 'dash',
  ym: new Date().toISOString().slice(0, 7),
  cur: '€',
  cats: [], catRows: [], catColor: {},
  kinds: [], kindRows: [],
  accounts: [],
  data: {},
  txFilter: { q: '', cats: [], kinds: [], logic: 'and', txkind: '', account: '', scope: 'month' },
  repFilter: { cats: [], kinds: [], logic: 'and' },
  profile: null, profiles: [],
};

// budget types that exist only as a transaction state, never as an envelope
const PSEUDO_KINDS = [
  { name: 'oneoff', label: 'One-off — exceptional, outside any envelope' },
  { name: 'unassigned', label: 'Unassigned — not linked to an envelope yet' },
];

/* ---------- utils ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n2 = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const money = v => (v < 0 ? '-' : '') + S.cur + n2(Math.abs(+v || 0));
const money0 = v => (v < 0 ? '-' : '') + S.cur + Math.round(Math.abs(+v || 0)).toLocaleString();
const ymAdd = (ym, k) => {
  const t = (+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7) - 1) + k;
  return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String(t % 12 + 1).padStart(2, '0');
};
const ymLabel = ym => new Date(ym + '-01T00:00:00')
  .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = ym => { const d = new Date(+ym.slice(0,4), +ym.slice(5,7), 0); return d.toISOString().slice(0,10); };

async function api(path, opts) {
  // Every request says which profile it is for; the server opens that profile's
  // own database, so two people never see each other's money.
  const h = { 'Content-Type': 'application/json' };
  if (S.profile) h['X-Profile'] = String(S.profile);
  const r = await fetch('/api/' + path, Object.assign({ headers: h }, opts || {}));
  if (r.status === 401) {
    // the session ran out, or the password was changed elsewhere
    if (!$('#lock')) {
      const info = await (await fetch('/api/auth')).json();
      $('#main').innerHTML = '';
      lockScreen('login', info);
    }
    throw new Error('locked');
  }
  if (!r.ok) {
    let e = await r.text();
    try { e = JSON.parse(e).error || e; } catch (_) { }
    toast(e, true);
    throw new Error(e);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}
const GET = p => api(p);
const POST = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b || {}) });
const PUT = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b || {}) });
const DEL = p => api(p, { method: 'DELETE' });
// DELETE that carries a body, used to say where in-use records should move to
const DELB = (p, b) => api(p, { method: 'DELETE', body: JSON.stringify(b || {}) });

let toastT;
function toast(msg, err) {
  $$('.toast').forEach(e => e.remove());
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  clearTimeout(toastT);
  toastT = setTimeout(() => d.remove(), 2600);
}

function selOpts(list, sel) {
  return list.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

// Budget-type <option>s, built from whatever types you have defined.
const kindOpts = sel => selOpts(S.kinds, sel);
const catColor = c => S.catColor[c] || '#94a3b8';
const kindColor = k => (S.kindRows.find(x => x.name === k) || {}).color || '#94a3b8';
const allKinds = () => S.kinds.concat(PSEUDO_KINDS.map(p => p.name));
// Look up a kind's is_saving/is_fixed flags by name, never by string-matching
// the name itself - kinds can be renamed (Bill -> "Loyer & co"), so anything
// checking `=== 'bill'` silently breaks the moment someone does that.
const kindMeta = k => S.kindRows.find(x => x.name === k) || { is_saving: 0, is_fixed: 0 };
// Bills are meant to reach 100% - that is a solved payment, not a warning.
// Savings are the same: hitting your monthly goal is good news. Only a plain
// budget allowance should show amber as it climbs, and anything past 100%
// (over) always means the same thing regardless of kind: it needs fixing.
function envelopeStatus(e) {
  if (e.over) return 'bad';
  const km = kindMeta(e.kind);
  if (km.is_saving || km.is_fixed) return 'ok';
  return e.pct >= 85 ? 'warn' : 'ok';
}

/* ---------- reusable category / type filter ---------- */

function filterBar(f, id) {
  const chip = (list, sel, group, colorFn) => list.map(v => `
    <span class="chip ${sel.includes(v) ? 'on' : ''}" data-fg="${id}" data-grp="${group}" data-v="${esc(v)}"
      ${sel.includes(v) ? '' : `style="border-left:3px solid ${colorFn(v)}"`}>${esc(v)}</span>`).join('');
  const both = f.cats.length && f.kinds.length;
  const n = f.cats.length + f.kinds.length;
  return `<div class="fbar">
    <div class="frow"><span class="flab">Categories</span>
      <div class="chips">${chip(S.cats, f.cats, 'cats', catColor)}</div></div>
    <div class="frow"><span class="flab">Budget type</span>
      <div class="chips">${chip(allKinds(), f.kinds, 'kinds', kindColor)}</div></div>
    <div class="frow"><span class="flab">Match</span>
      <div class="chips">
        <span class="chip ${f.logic === 'and' ? 'on' : ''} ${both ? '' : 'off'}" data-fg="${id}" data-grp="logic" data-v="and">both — category AND type</span>
        <span class="chip ${f.logic === 'or' ? 'on' : ''} ${both ? '' : 'off'}" data-fg="${id}" data-grp="logic" data-v="or">either — category OR type</span>
        ${both ? '' : '<span class="dim2" style="font-size:11px;align-self:center">pick from both rows to combine them</span>'}
        ${n ? `<span class="chip clr" data-fg="${id}" data-grp="clear" data-v="">clear ${n} filter${n > 1 ? 's' : ''}</span>` : ''}
      </div></div>
  </div>`;
}

function bindFilterBar(id, f, after) {
  $$(`[data-fg="${id}"]`).forEach(c => c.onclick = () => {
    const g = c.dataset.grp, v = c.dataset.v;
    if (g === 'clear') { f.cats = []; f.kinds = []; f.logic = 'and'; }
    else if (g === 'logic') f.logic = v;
    else {
      const i = f[g].indexOf(v);
      if (i < 0) f[g].push(v); else f[g].splice(i, 1);
    }
    after();
  });
}

function filterQS(f) {
  const p = new URLSearchParams();
  if (f.cats.length) p.set('cats', f.cats.join(','));
  if (f.kinds.length) p.set('kinds', f.kinds.join(','));
  if (f.cats.length && f.kinds.length) p.set('logic', f.logic);
  return p;
}

function filterSummary(f) {
  if (!f.cats.length && !f.kinds.length) return '';
  const a = f.cats.length ? '(' + f.cats.join(' or ') + ')' : '';
  const b = f.kinds.length ? '(' + f.kinds.join(' or ') + ')' : '';
  return [a, b].filter(Boolean).join(f.logic === 'or' ? '  OR  ' : '  AND  ');
}

/* ---------- shell ---------- */
function header(title, withMonth) {
  return `<div class="head"><h2>${esc(title)}</h2><div class="spacer"></div>` +
    (withMonth ? `<div class="mnav">
      <button data-mv="-1">&#8249;</button>
      <span class="cur">${ymLabel(S.ym)}</span>
      <button data-mv="1">&#8250;</button>
      <button data-mv="0" title="Jump to current month">Today</button>
    </div>` : '') + `</div>`;
}

function bindHeader() {
  $$('[data-mv]').forEach(b => b.onclick = () => {
    const k = +b.dataset.mv;
    S.ym = k === 0 ? new Date().toISOString().slice(0, 7) : ymAdd(S.ym, k);
    render();
  });
}

function nav(v) { S.view = v; render(); }

async function render() {
  $$('.nav').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  const m = $('#main');
  try {
    await VIEWS[S.view](m);
  } catch (e) {
    m.innerHTML = `<div class="alert danger">Failed to load: ${esc(e.message)}</div>`;
    console.error(e);
  }
  bindHeader();
}

/* ================= DASHBOARD ================= */
async function vDash(root) {
  const d = await GET('dashboard?ym=' + S.ym);
  S.data.dash = d;
  const t = d.month.totals;
  const envs = d.month.envelopes;
  const spentPct = t.income ? Math.min(100, 100 * t.total_spent / t.income) : 0;

  const kpi = (lab, val, sub, cls) => `<div class="card kpi"><h3>${lab}</h3>
    <div class="v ${cls || ''}">${val}</div><div class="s">${sub}</div></div>`;

  root.innerHTML = header('Dashboard', true) +
    `<div class="grid g4" style="margin-bottom:12px">
      ${kpi('Income', money(t.income), t.extra_income ? `base ${money(t.base_income)} + extra ${money(t.extra_income)}` : 'salary')}
      ${kpi('Spent so far', money(t.total_spent), `${t.n_tx} transactions · ${spentPct.toFixed(0)}% of income`, t.total_spent > t.income ? 'bad' : '')}
      ${kpi('Left to spend', money(t.left_to_spend), `${money(t.planned_left)} of budgets still unspent`, t.left_to_spend < 0 ? 'bad' : 'ok')}
      ${kpi('Saved', money(t.saved), 'into savings envelopes', 'sv')}
    </div>

    <div class="grid g4" style="margin-bottom:12px">
      ${kpi('Fixed + budgets', money(t.planned), `${envs.length} envelopes planned`)}
      ${kpi('Exceptional', money(t.oneoff_spent), `${d.month.oneoffs.length} one-off spends this month`, t.oneoff_spent > 0 ? 'warn' : '')}
      ${kpi('Debts net', money(d.debts.net), `owed to me ${money(d.debts.they_owe_me)} · I owe ${money(d.debts.i_owe)}`, d.debts.net < 0 ? 'bad' : 'ok')}
      ${kpi('Subscriptions', money(d.subs.per_month), `${d.subs.count} active · ${money(d.subs.per_year)}/year`)}
    </div>` +

    (d.alerts.length ? `<div class="card" style="margin-bottom:12px"><h3>Attention</h3>` +
      d.alerts.slice(0, 8).map(a => `<div class="alert ${a.level}">${esc(a.text)}</div>`).join('') +
      `</div>` : '') +

    `<div class="grid g2" style="margin-bottom:12px">
      <div class="card"><h3>Budget envelopes — ${ymLabel(S.ym)}</h3>
        <div class="envhead"><span>Envelope</span><span>Planned</span><span>Spent</span><span>Left</span><span></span></div>
        <div class="scroll">${envs.length ? envs.map(envRow).join('') : '<div class="empty">No envelopes. Add them in “Fixed &amp; budgets”.</div>'}</div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px"><h3>Income vs spending — last 12 months</h3>
          ${trendChart(d.trend)}
          <div class="legend"><span><i style="background:var(--acc)"></i>Income</span>
            <span><i style="background:var(--warn)"></i>Spent</span></div>
        </div>
        <div class="card"><h3>Where the money went this month</h3>${catBars(d.month.by_category)}</div>
      </div>
    </div>

    <div class="grid g3">
      <div class="card"><h3>Biggest spends this month</h3>
        ${d.top.length ? `<table><tbody>${d.top.map(x => `<tr>
          <td>${esc(x.label)}<div class="dim2" style="font-size:11px">${esc(x.category)}${x.n > 1 ? ' · ' + x.n + '×' : ''}</div></td>
          <td class="num">${money(x.s)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet</div>'}
      </div>
      <div class="card"><h3>Latest transactions</h3>
        ${d.recent.length ? `<table><tbody>${d.recent.map(x => `<tr>
          <td class="dim2 mono" style="width:74px">${esc(x.date.slice(5))}</td>
          <td>${esc(x.label)}${x.kind === 'transfer' ? ' <span class="tag p" style="font-size:10px">transfer</span>' : ''}</td>
          <td class="num ${x.kind === 'income' ? 'ok' : x.kind === 'transfer' ? 'sv' : ''}">${x.kind === 'income' ? '+' : ''}${money(x.amount)}</td>
        </tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet</div>'}
      </div>
      <div class="card"><h3>Accounts · net ${money(d.net_worth)}</h3>
        ${d.balances.length ? `<table><tbody>${d.balances.map(b => `<tr>
          <td>${esc(b.account)}<div class="dim2" style="font-size:11px">as of ${esc(b.ym)}</div></td>
          <td class="num">${money(b.amount)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Record balances in Settings</div>'}
      </div>
    </div>`;

  $$('.env .nm').forEach(el => el.onclick = () => {
    S.view = 'tx'; S.txFilter = { q: '', category: '', kind: '', account: '', scope: 'month', envelope_id: el.dataset.env };
    render();
  });
}

function envRow(e) {
  const km = kindMeta(e.kind);
  const cls = km.is_saving ? 'sv' : envelopeStatus(e);
  const w = Math.min(100, e.planned ? 100 * e.spent / e.planned : (e.spent ? 100 : 0));
  return `<div class="env">
    <div class="nm" data-env="${e.id}" title="Click to see the ${e.n_tx} transaction(s)">
      ${esc(e.label)}<small>${esc(e.category)} · ${e.n_tx} tx</small>
      <div class="bar"><i class="${cls}" style="width:${w}%"></i></div>
    </div>
    <div class="n dim">${money(e.planned)}</div>
    <div class="n">${money(e.spent)}</div>
    <div class="n ${e.remaining < 0 ? 'bad' : 'dim'}">${money(e.remaining)}</div>
    <div class="n"><span class="tag" style="border-left:3px solid ${esc(km.color || '#94a3b8')}">${esc(e.kind)}</span></div>
  </div>`;
}

function trendChart(tr) {
  const W = 460, H = 150, pad = 26;
  const max = Math.max(1, ...tr.map(x => Math.max(x.income, x.spent)));
  const bw = (W - pad * 2) / tr.length;
  let s = `<svg viewBox="0 0 ${W} ${H + 22}" style="width:100%;height:auto">`;
  for (let g = 0; g <= 2; g++) {
    const y = pad + (H - pad * 2) * g / 2;
    s += `<line x1="${pad}" y1="${y}" x2="${W - 4}" y2="${y}" stroke="var(--line)"/>`;
    s += `<text x="0" y="${y + 3}" font-size="9">${Math.round(max * (1 - g / 2) / 100) / 10}k</text>`;
  }
  tr.forEach((x, i) => {
    const bx = pad + i * bw;
    const hi = (H - pad * 2) * x.income / max, hs = (H - pad * 2) * x.spent / max;
    s += `<rect x="${bx + 2}" y="${H - pad - hi}" width="${bw / 2 - 3}" height="${hi}" fill="var(--acc)" opacity=".75" rx="2"><title>${x.ym} income ${n2(x.income)}</title></rect>`;
    s += `<rect x="${bx + bw / 2}" y="${H - pad - hs}" width="${bw / 2 - 3}" height="${hs}" fill="var(--warn)" opacity=".9" rx="2"><title>${x.ym} spent ${n2(x.spent)}</title></rect>`;
    if (i % 2 === 0) s += `<text x="${bx + bw / 2 - 6}" y="${H - 8}" font-size="9">${x.ym.slice(2).replace('-', '/')}</text>`;
  });
  return s + '</svg>';
}

const PALETTE = ['#4f9cf9', '#3ecf8e', '#f5a524', '#f2545b', '#a78bfa', '#38bdf8',
  '#fb7185', '#84cc16', '#e879f9', '#fbbf24', '#2dd4bf', '#94a3b8'];

function catBars(by) {
  const ent = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!ent.length) return '<div class="empty">No spending recorded yet</div>';
  const tot = ent.reduce((a, b) => a + b[1], 0);
  return ent.slice(0, 9).map(([k, v], i) => `<div style="margin-bottom:7px">
    <div style="display:flex;justify-content:space-between;font-size:12px">
      <span>${esc(k)}</span><span class="mono dim">${money(v)} · ${(100 * v / tot).toFixed(0)}%</span></div>
    <div class="bar"><i style="width:${100 * v / tot}%;background:${PALETTE[i % PALETTE.length]}"></i></div>
  </div>`).join('');
}

/* ================= MONTH PLAN ================= */
async function vMonth(root) {
  const d = await GET('month?ym=' + S.ym);
  const t = d.totals;
  root.innerHTML = header('Month plan', true) +
    `<div class="grid g4" style="margin-bottom:12px">
      <div class="card kpi"><h3>Salary</h3>
        <input type="number" step="0.01" id="inc" value="${n2(d.month.income)}" style="width:100%;font-size:20px">
        <div class="s">applies to this month and every upcoming one</div></div>
      <div class="card kpi"><h3>Extra income</h3>
        <input type="number" step="0.01" id="xinc" value="${n2(d.month.extra_income)}" style="width:100%;font-size:20px">
        <div class="s">bonus or refund — this month only</div></div>
      <div class="card kpi"><h3>Planned out</h3><div class="v">${money(t.planned)}</div>
        <div class="s">fixed + budgets</div></div>
      <div class="card kpi"><h3>Free after plan</h3><div class="v ${t.free < 0 ? 'bad' : 'ok'}">${money(t.free)}</div>
        <div class="s">income − planned − one-offs</div></div>
    </div>

    <div class="alert info" style="margin-bottom:12px">
      <b>This is where you work.</b> Add anything here and say whether it repeats:
      <b>every month</b> puts it in your master list so every future month is built
      with it, <b>only this month</b> keeps it to ${ymLabel(S.ym)}.
      <i>Fixed &amp; budgets</i> is just the master list itself, if you ever want to
      see or edit it directly.</div>

    <div class="card" style="margin-bottom:12px">
      <div class="head" style="margin-bottom:8px"><h2 style="font-size:15px">Envelopes this month</h2>
        <div class="spacer"></div>
        <button class="btn sm sec" id="sync">Pull in new fixed items</button>
        <button class="btn sm sec" id="tmpl" title="Copy these amounts back into the master list">Save amounts as template</button>
      </div>
      <table><thead><tr><th>Envelope</th><th>Category</th><th>Type</th>
        <th class="num">Planned</th><th class="num">Spent</th><th class="num">Left</th>
        <th></th><th>Repeats</th><th></th></tr></thead>
      <tbody>${d.envelopes.map(e => `<tr>
        <td><input class="ef w200" data-id="${e.id}" data-f="label" data-rec="${e.recurring_id || ''}"
             value="${esc(e.label)}" title="Rename it here - its transactions follow automatically"></td>
        <td><select class="ef w130" data-id="${e.id}" data-f="category" data-rec="${e.recurring_id || ''}">${selOpts(S.cats, e.category)}</select></td>
        <td><select class="ef w110" data-id="${e.id}" data-f="kind" data-rec="${e.recurring_id || ''}">
          ${kindOpts(e.kind)}</select></td>
        <td class="num"><input type="number" step="0.01" class="w90 ep" data-id="${e.id}" value="${n2(e.planned)}"></td>
        <td class="num ${e.over ? 'bad' : ''}">${money(e.spent)}</td>
        <td class="num ${e.remaining < 0 ? 'bad' : 'dim'}">${money(e.remaining)}</td>
        <td>${e.remaining > 0.005
            ? `<button class="btn sm" data-payenv="${e.id}" data-remaining="${e.remaining}"
                 data-lb="${esc(e.label)}" data-cat="${esc(e.category)}" title="Log a payment against this envelope">Paid</button>`
            : e.remaining < -0.005
            ? `<button class="btn sm dgr" data-gap="${e.id}"
                 title="This went over - pull the difference from another budget or this month's leftover">Cover ${money(-e.remaining)}</button>`
            : (e.spent > 0 ? '<span class="tag g" title="Fully paid">✓ paid</span>' : '')}</td>
        <td>${e.recurring_id
            ? '<span class="tag g" title="Comes from your master list, so every month gets it">every month</span>'
            : `<button class="btn sm sec" data-mkrec="${e.id}" title="Keep it from now on">${ymLabel(S.ym).split(' ')[0]} only · make regular</button>`}</td>
        <td><button class="x" data-del-env="${e.id}" title="Remove from this month only">&times;</button></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3">Total</th>
        <th class="num">${money(t.planned)}</th><th class="num">${money(t.envelope_spent)}</th>
        <th class="num">${money(t.planned - t.envelope_spent)}</th><th colspan="3"></th></tr></tfoot></table>
      <div class="hr"></div>
      <h3>Add something to ${ymLabel(S.ym)}</h3>
      <div class="form" style="margin-bottom:8px">
        <div class="fld grow"><label>What</label><input id="ne_l" placeholder="e.g. Assurance, Medics, Vacation"></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="ne_a" class="w90" placeholder="0.00"></div>
        <div class="fld"><label>Category</label><select id="ne_c" class="w130">${selOpts(S.cats)}</select></div>
        <div class="fld"><label>Type</label><select id="ne_k" class="w110">${kindOpts()}</select></div>
        <button class="btn" id="ne_go">Add</button>
      </div>
      <div class="frow" style="align-items:center">
        <span class="flab">Repeats</span>
        <div class="chips">
          <span class="chip on" data-rep="1">every month — keep it in the plan from now on</span>
          <span class="chip" data-rep="0">only ${ymLabel(S.ym)} — just this once</span>
        </div>
      </div>
      <label class="ckl" id="ne_subwrap" style="margin-top:6px"><input type="checkbox" id="ne_sub">
        It is a subscription — also list it under Subscriptions</label>
    </div>

    <div class="card">
      <div class="head" style="margin-bottom:4px"><h2 style="font-size:15px">Exceptional spends — money already gone</h2>
        <div class="spacer"></div><span class="dim">${money(t.oneoff_spent)} across ${d.oneoffs.length} item(s)</span></div>
      <div class="dim2" style="font-size:12px;margin-bottom:10px">
        Actual spending that belongs to no envelope — a one-time purchase, a gift,
        a repair. This is a record of what left your account, not a plan.</div>
      <div class="form">
        <div class="fld"><label>Date</label><input type="date" id="oo_d" class="w130" value="${clampDate()}"></div>
        <div class="fld grow"><label>What</label><input id="oo_l" placeholder="e.g. Nintendo game, plane ticket…"></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="oo_a" class="w90"></div>
        <div class="fld"><label>Category</label><select id="oo_c" class="w130">${selOpts(S.cats)}</select></div>
        <div class="fld"><label>Account</label><select id="oo_ac" class="w110">${selOpts(S.accounts)}</select></div>
        <button class="btn" id="oo_go">Add one-off</button>
      </div>
      ${d.oneoffs.length ? txTable(d.oneoffs) : '<div class="empty">No exceptional spending this month</div>'}
      ${d.unassigned.length ? `<div class="hr"></div><h3 style="color:var(--warn)">Not linked to any envelope (${d.unassigned.length})</h3>${txTable(d.unassigned)}` : ''}
    </div>`;

  $('#inc').onchange = async e => {
    const val = e.target.value;
    let r = await PUT('months/' + d.month.id, { income: val });
    // months that had been given their own figure are skipped, then offered
    if (r.left_alone && r.left_alone.length) {
      const list = r.left_alone.slice(0, 6).map(ymLabel).join(', ')
        + (r.left_alone.length > 6 ? ` and ${r.left_alone.length - 6} more` : '');
      if (confirm(`${r.left_alone.length} upcoming month(s) have their own salary:\n\n${list}\n\n`
        + `Set them to ${money(val)} as well?`)) {
        r = await PUT('months/' + d.month.id, { income: val, force_all: 1 });
      }
    }
    let msg = 'Salary set for ' + ymLabel(S.ym);
    if (r.updated_later) msg += ' and ' + r.updated_later + ' upcoming month(s)';
    toast(msg); render();
  };
  $('#xinc').onchange = async e => {
    await PUT('months/' + d.month.id, { extra_income: e.target.value });
    toast('Extra income saved for ' + ymLabel(S.ym)); render();
  };
  $$('.ep').forEach(i => i.onchange = async () => {
    await PUT('envelopes/' + i.dataset.id, { planned: i.value }); toast('Updated'); render();
  });
  // Rename / recategorise an envelope in place. Its transactions are linked by
  // id, so they follow the rename — nothing has to be deleted and re-added.
  $$('.ef').forEach(el => {
    const was = el.value;
    el.onchange = async () => {
      const v = el.value.trim();
      if (el.dataset.f === 'label' && !v) { el.value = was; return toast('Name cannot be empty', true); }
      let rename_template = 0;
      if (el.dataset.rec) {
        rename_template = confirm(
          'Apply this to future months too?\n\n' +
          'OK = also change it in the master list (Fixed & budgets).\n' +
          'Cancel = change ' + ymLabel(S.ym) + ' only.') ? 1 : 0;
      }
      try {
        await PUT('envelopes/' + el.dataset.id, { [el.dataset.f]: v, rename_template });
        toast(rename_template ? 'Updated here and in the master list' : 'Updated for ' + ymLabel(S.ym));
        render();
      } catch (e) { el.value = was; }
    };
  });
  $$('[data-del-env]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this envelope from ' + ymLabel(S.ym) + '? Its transactions stay.')) return;
    await DEL('envelopes/' + b.dataset.delEnv); toast('Removed'); render();
  });
  $$('[data-mkrec]').forEach(b => b.onclick = async () => {
    if (!confirm('Keep this line every month from now on?\n\nIt joins your master list, so future months are built with it.')) return;
    await POST('envelopes/' + b.dataset.mkrec + '/make-regular', {});
    toast('Now part of every month'); render();
  });
  // One click logs a payment against an envelope, prefilled with what is left
  // to pay so a fixed bill (Loyer, Darna, Forfait Mobile...) is just click ->
  // Enter. The amount stays editable in the prompt for bills that vary
  // month to month (Engie, water...).
  $$('[data-payenv]').forEach(b => b.onclick = async () => {
    const remaining = +b.dataset.remaining;
    const v = prompt('Pay "' + b.dataset.lb + '" - amount:', n2(remaining));
    if (v === null) return;
    const amt = +v;
    if (!amt || amt <= 0) return toast('Enter an amount', true);
    await POST('tx', {
      date: clampDate(), label: b.dataset.lb, amount: amt,
      envelope_id: b.dataset.payenv, category: b.dataset.cat,
      account: S.accounts[0] || 'Compte', kind: 'expense', oneoff: 0,
    });
    toast('Paid ' + money(amt) + ' — ' + b.dataset.lb);
    render();
  });
  // An envelope that went negative needs the gap covered from somewhere real -
  // either money this month never allocated to anything, or another budget
  // that still has room. Either way it is a transfer inside the plan, not new
  // spending, and it is a real transaction so the move stays visible.
  $$('[data-gap]').forEach(b => b.onclick = () => {
    const env = d.envelopes.find(x => String(x.id) === b.dataset.gap);
    if (env) openSolveGap(env, d);
  });
  $('#sync').onclick = async () => {
    const r = await POST('month/sync', { ym: S.ym });
    toast(r.added ? r.added + ' envelope(s) added' : 'Already up to date'); render();
  };
  $('#tmpl').onclick = async () => {
    if (!confirm('Copy this month’s planned amounts into the master list, so future months use them?')) return;
    const r = await POST('month/apply-template', { ym: S.ym });
    toast(r.updated + ' template(s) updated');
  };
  let repeats = 1;
  const syncRep = () => {
    $$('[data-rep]').forEach(c => c.classList.toggle('on', +c.dataset.rep === repeats));
    $('#ne_subwrap').style.display = repeats ? 'flex' : 'none';
  };
  $$('[data-rep]').forEach(c => c.onclick = () => { repeats = +c.dataset.rep; syncRep(); });
  syncRep();

  $('#ne_go').onclick = async () => {
    const l = $('#ne_l').value.trim();
    if (!l) return toast('Name it first', true);
    const common = { label: l, category: $('#ne_c').value, kind: $('#ne_k').value };
    if (repeats) {
      // goes into the master list, so every future month is built with it
      const r = await POST('recurring', Object.assign({}, common, {
        amount: $('#ne_a').value || 0, active: 1, ym: S.ym,
        is_sub: $('#ne_sub').checked ? 1 : 0,
      }));
      toast(r.sub ? 'Added every month, and to Subscriptions'
                  : 'Added to ' + ymLabel(S.ym) + ' and every month after');
    } else {
      await POST('envelopes', Object.assign({}, common, {
        ym: S.ym, planned: $('#ne_a').value || 0,
      }));
      toast('Added to ' + ymLabel(S.ym) + ' only');
    }
    render();
  };
  $('#oo_go').onclick = async () => {
    const l = $('#oo_l').value.trim(), a = +$('#oo_a').value;
    if (!l || !a) return toast('Need a label and an amount', true);
    await POST('tx', { date: $('#oo_d').value, label: l, amount: a, category: $('#oo_c').value, account: $('#oo_ac').value, oneoff: 1, kind: 'expense' });
    toast('Added'); render();
  };
  bindTxTable();
}

function clampDate() {
  const t = today();
  return t.slice(0, 7) === S.ym ? t : monthEnd(S.ym);
}

/* ================= TRANSACTIONS ================= */
function txTable(items) {
  // a transfer is not a real spend or income - it just moves budget you
  // already have between two envelopes - so it gets its own tag rather than
  // borrowing the destination envelope's budget type, and no +/- on the amount.
  const tk = t => t.kind === 'transfer' ? 'transfer'
    : t.tkind || (t.oneoff ? 'oneoff' : (t.envelope ? '' : 'unassigned'));
  return `<div class="scroll"><table><thead><tr>
    <th style="width:96px">Date</th><th>What</th><th>Category</th><th>Type</th><th>Envelope</th>
    <th>Account</th><th class="num">Amount</th><th style="width:30px"></th></tr></thead>
    <tbody>${items.map(t => `<tr>
      <td class="dim mono">${esc(t.date)}</td>
      <td>${esc(t.label)}${t.note ? `<div class="dim2" style="font-size:11px">${esc(t.note)}</div>` : ''}</td>
      <td><span class="tag" style="border-left:3px solid ${catColor(t.category)}">${esc(t.category)}</span></td>
      <td>${tk(t) ? `<span class="tag ${tk(t) === 'oneoff' ? 'y' : tk(t) === 'unassigned' ? 'r' : tk(t) === 'transfer' ? 'p' : ''}"
            ${['oneoff', 'unassigned', 'transfer'].includes(tk(t)) ? '' : `style="border-left:3px solid ${kindColor(tk(t))}"`}>${esc(tk(t))}</span>` : ''}</td>
      <td class="dim2">${t.envelope ? esc(t.envelope) : '—'}</td>
      <td class="dim2">${esc(t.account)}</td>
      <td class="num ${t.kind === 'income' ? 'ok' : t.kind === 'transfer' ? 'sv' : ''}">${t.kind === 'income' ? '+' : ''}${money(t.amount)}</td>
      <td><button class="x" data-del-tx="${t.id}">&times;</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function bindTxTable() {
  $$('[data-del-tx]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this transaction?')) return;
    await DEL('tx/' + b.dataset.delTx); toast('Deleted'); render();
  });
}

async function vTx(root) {
  const f = S.txFilter;
  const qs = filterQS(f);
  if (f.scope === 'month') qs.set('ym', S.ym);
  else if (f.scope === 'year') { qs.set('start', S.ym.slice(0, 4) + '-01-01'); qs.set('end', S.ym.slice(0, 4) + '-12-31'); }
  else if (f.scope === 'custom') { qs.set('start', S.txStart); qs.set('end', S.txEnd); }
  if (f.q) qs.set('q', f.q);
  if (f.txkind) qs.set('kind', f.txkind);
  if (f.account) qs.set('account', f.account);
  if (f.envelope_id) qs.set('envelope_id', f.envelope_id);
  qs.set('limit', '800');
  const d = await GET('tx?' + qs);
  const mv = await GET('month?ym=' + S.ym);

  root.innerHTML = header('Transactions', true) +
    `<div class="card" style="margin-bottom:12px">
      <h3>Add a spend</h3>
      <div class="form">
        <div class="fld"><label>Date</label><input type="date" id="a_d" class="w130" value="${clampDate()}"></div>
        <div class="fld grow"><label>What / where</label><input id="a_l" list="sugg" placeholder="Carrefour, Uber, pharmacie…" autocomplete="off"><datalist id="sugg"></datalist></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="a_a" class="w90"></div>
        <div class="fld"><label>Goes to</label><select id="a_e" class="w160">
          <option value="">— one-off (exceptional) —</option>
          ${mv.envelopes.map(e => `<option value="${e.id}" data-cat="${esc(e.category)}">${esc(e.label)}</option>`).join('')}
        </select></div>
        <div class="fld"><label>Category</label><select id="a_c" class="w130">${selOpts(S.cats)}</select></div>
        <div class="fld"><label>Account</label><select id="a_ac" class="w110">${selOpts(S.accounts)}</select></div>
        <div class="fld"><label>Type</label><select id="a_k" class="w100">
          <option value="expense">expense</option><option value="income">income</option></select></div>
        <div class="fld grow"><label>Note (optional)</label><input id="a_n" placeholder="why / with whom"></div>
        <button class="btn" id="a_go">Add</button>
      </div>
    </div>

    <div class="card">
      <div class="chips">
        ${['month', 'year', 'all'].map(s => `<span class="chip ${f.scope === s ? 'on' : ''}" data-scope="${s}">${s === 'month' ? ymLabel(S.ym) : s === 'year' ? S.ym.slice(0, 4) : 'All time'}</span>`).join('')}
        ${f.scope === 'custom' ? `<span class="chip on">${esc(S.txStart)} → ${esc(S.txEnd)}</span>` : ''}
      </div>
      ${filterBar(f, 'tx')}
      <div class="form">
        <div class="fld grow"><label>Search</label><input id="f_q" value="${esc(f.q)}" placeholder="label, note or payee…"></div>
        <div class="fld"><label>Account</label><select id="f_ac" class="w110"><option value="">All</option>${selOpts(S.accounts, f.account)}</select></div>
        <div class="fld"><label>Money</label><select id="f_k" class="w110"><option value="">All</option>
          <option value="expense"${f.txkind === 'expense' ? ' selected' : ''}>expense</option>
          <option value="income"${f.txkind === 'income' ? ' selected' : ''}>income</option></select></div>
        <button class="btn sec" id="f_clear">Clear all</button>
        <div class="spacer"></div>
        <a class="btn sec" href="/api/tx/export?${qs}" download="transactions.csv">Export CSV</a>
      </div>
      <div class="dim" style="margin-bottom:8px">
        <b>${d.total}</b> transaction(s) · spent <b class="warn">${money(d.spent)}</b>${d.earned ? ` · received <b class="ok">${money(d.earned)}</b>` : ''}
        ${filterSummary(f) ? ` · matching <b class="mono">${esc(filterSummary(f))}</b>` : ''}
        ${f.envelope_id ? ` · filtered to one envelope <button class="btn sm sec" id="f_ne">show all</button>` : ''}
      </div>
      ${d.items.length ? txTable(d.items) : '<div class="empty">Nothing matches</div>'}
    </div>`;

  const g = id => $('#' + id).value;
  $('#a_go').onclick = async () => {
    const l = g('a_l').trim(), a = +g('a_a');
    if (!l || !a) return toast('Need a label and an amount', true);
    const env = g('a_e');
    await POST('tx', {
      date: g('a_d'), label: l, amount: a, kind: g('a_k'),
      envelope_id: env || null, category: g('a_c'), account: g('a_ac'),
      note: g('a_n'), oneoff: env ? 0 : 1,
    });
    toast('Added ' + money(a)); render();
  };
  $('#a_e').onchange = e => {
    const o = e.target.selectedOptions[0];
    if (o && o.dataset.cat) $('#a_c').value = o.dataset.cat;
  };
  let sT;
  $('#a_l').oninput = e => {
    clearTimeout(sT);
    const v = e.target.value;
    if (v.length < 2) return;
    sT = setTimeout(async () => {
      const s = await GET('suggest?q=' + encodeURIComponent(v));
      $('#sugg').innerHTML = s.map(x => `<option value="${esc(x.label)}">${esc(x.category)}</option>`).join('');
      const hit = s.find(x => x.label.toLowerCase() === v.toLowerCase());
      if (hit) { $('#a_c').value = hit.category; if (hit.account) $('#a_ac').value = hit.account; }
    }, 180);
  };
  $$('[data-scope]').forEach(c => c.onclick = () => { f.scope = c.dataset.scope; render(); });
  bindFilterBar('tx', f, render);
  let fT;
  $('#f_q').oninput = e => { clearTimeout(fT); fT = setTimeout(() => { f.q = e.target.value; render(); }, 300); };
  $('#f_ac').onchange = e => { f.account = e.target.value; render(); };
  $('#f_k').onchange = e => { f.txkind = e.target.value; render(); };
  $('#f_clear').onclick = () => {
    S.txFilter = { q: '', cats: [], kinds: [], logic: 'and', txkind: '', account: '', scope: f.scope };
    render();
  };
  if ($('#f_ne')) $('#f_ne').onclick = () => { delete f.envelope_id; render(); };
  bindTxTable();
}

/* ================= SUBSCRIPTIONS ================= */
async function vSubs(root) {
  const subs = await GET('subs');
  const act = subs.filter(s => s.active);
  const perM = act.reduce((a, s) => a + s.per_month, 0);
  const inPlan = act.filter(s => s.in_plan).reduce((a, s) => a + s.per_month, 0);

  root.innerHTML = header('Subscriptions') +
    `<div class="grid g4" style="margin-bottom:12px">
      <div class="card kpi"><h3>Per month</h3><div class="v">${money(perM)}</div><div class="s">${act.length} active</div></div>
      <div class="card kpi"><h3>Per year</h3><div class="v warn">${money(perM * 12)}</div><div class="s">what they really cost you</div></div>
      <div class="card kpi"><h3>In the monthly plan</h3><div class="v ok">${money(inPlan)}</div>
        <div class="s">${money(perM - inPlan)} not budgeted for</div></div>
      <div class="card kpi"><h3>Share of income</h3><div class="v">${S.data.dash ? (100 * perM / (S.data.dash.month.totals.income || 1)).toFixed(1) : '–'}%</div><div class="s">of this month's income</div></div>
    </div>
    <div class="card">
      <h3>Add a subscription</h3>
      <div class="form">
        <div class="fld grow"><label>Name</label><input id="s_l" placeholder="Netflix, Canal+, gym…"></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="s_a" class="w90"></div>
        <div class="fld"><label>Billed</label><select id="s_p" class="w110">
          <option value="monthly">monthly</option><option value="yearly">yearly</option>
          <option value="quarterly">quarterly</option><option value="weekly">weekly</option></select></div>
        <div class="fld"><label>Starts from</label><input type="date" id="s_st" class="w130" value="${today()}"
          title="The month it enters your plan"></div>
        <div class="fld"><label>Next charge</label><input type="date" id="s_n" class="w130" value="${today()}"></div>
        <div class="fld"><label>Category</label><select id="s_c" class="w130">${selOpts(S.cats, 'Subscription')}</select></div>
        <div class="fld"><label>Account</label><select id="s_ac" class="w110">${selOpts(S.accounts)}</select></div>
        <div class="fld"><label>Plan type</label><select id="s_k" class="w110">${kindOpts(S.kinds[0])}</select></div>
        <button class="btn" id="s_go">Add</button>
      </div>
      <label class="ckl"><input type="checkbox" id="s_plan" checked>
        Add it to the monthly plan from its start month — it becomes a
        <b>bill</b> line you can pay and track like any other</label>
      <div class="hr"></div>
      <table><thead><tr><th>Name</th><th>Category</th><th class="num">Amount</th><th>Billed</th>
        <th>Starts</th><th>Next</th><th class="num">Per month</th><th class="num">Per year</th>
        <th>In monthly plan</th><th></th><th></th></tr></thead>
      <tbody>${subs.map(s => `<tr style="${s.active ? '' : 'opacity:.45'}">
        <td>${esc(s.label)}</td><td><span class="tag" style="border-left:3px solid ${catColor(s.category)}">${esc(s.category)}</span></td>
        <td class="num">${money(s.amount)}</td><td class="dim">${esc(s.period)}</td>
        <td class="dim2 mono">${esc((s.started || '').slice(0, 7))}</td>
        <td class="dim mono">${esc(s.next_date || '')}</td>
        <td class="num">${money(s.per_month)}${s.period !== 'monthly' ? '<div class="dim2" style="font-size:10px">spread</div>' : ''}</td>
        <td class="num dim">${money(s.per_year)}</td>
        <td>${s.in_plan && s.plan_label
            ? `<span class="tag g">${esc(s.plan_label)}</span>`
            : '<span class="tag y">not in the plan</span>'}</td>
        <td><button class="btn sm sec" data-pay="${s.id}" data-a="${s.amount}" data-lb="${esc(s.label)}" data-c="${esc(s.category)}" data-ac="${esc(s.account)}">Log payment</button></td>
        <td style="white-space:nowrap">
            <button class="btn sm sec" data-plan="${s.id}" data-v="${s.in_plan ? 0 : 1}">${s.in_plan ? 'Remove from plan' : 'Add to plan'}</button>
            <button class="btn sm sec" data-tog="${s.id}" data-v="${s.active ? 0 : 1}">${s.active ? 'Pause' : 'Resume'}</button>
            <button class="x" data-del="${s.id}">&times;</button></td>
      </tr>`).join('')}</tbody></table>
      ${subs.length ? '' : '<div class="empty">No subscriptions yet</div>'}
      <div class="dim2" style="font-size:11px;margin-top:10px">
        A subscription in the plan is one thing shown in two places: change the
        amount here and its plan line follows, and vice versa. Yearly and weekly
        ones are carried in the plan at their <b>monthly equivalent</b>, so the
        total still adds up.</div>
    </div>`;

  $('#s_go').onclick = async () => {
    const l = $('#s_l').value.trim(); if (!l) return toast('Name it first', true);
    const r = await POST('subs', {
      label: l, amount: $('#s_a').value || 0, period: $('#s_p').value,
      next_date: $('#s_n').value, started: $('#s_st').value,
      category: $('#s_c').value, account: $('#s_ac').value, active: 1,
      in_plan: $('#s_plan').checked ? 1 : 0, plan_kind: $('#s_k').value,
    });
    toast(r.plan ? `Added — ${money(r.plan.amount)}/month now in your plan` : 'Subscription added');
    render();
  };
  $$('[data-plan]').forEach(b => b.onclick = async () => {
    const on = b.dataset.v === '1';
    const r = await POST('subs/' + b.dataset.plan + (on ? '/link' : '/unlink'), {});
    toast(on ? `Added to the plan at ${money(r.amount)}/month` : 'Taken out of the plan');
    render();
  });
  $$('[data-pay]').forEach(b => b.onclick = async () => {
    // A subscription that is in the plan has an envelope this month; book the
    // charge there rather than as a one-off, so it is never counted twice.
    const ym = today().slice(0, 7);
    const mv = await GET('month?ym=' + ym);
    const sub = subs.find(s => String(s.id) === b.dataset.pay);
    const env = mv.envelopes.find(e =>
      (sub && sub.recurring_id && e.recurring_id === sub.recurring_id) ||
      e.label.toLowerCase() === b.dataset.lb.toLowerCase());
    await POST('tx', {
      date: today(), label: b.dataset.lb, amount: b.dataset.a, category: b.dataset.c,
      account: b.dataset.ac, sub_id: b.dataset.pay, kind: 'expense',
      envelope_id: env ? env.id : null, oneoff: env ? 0 : 1,
      note: 'subscription charge',
    });
    toast(env ? 'Logged into the "' + env.label + '" envelope' : 'Payment logged');
  });
  $$('[data-tog]').forEach(b => b.onclick = async () => {
    await PUT('subs/' + b.dataset.tog, { active: b.dataset.v }); render();
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this subscription?')) return;
    await DEL('subs/' + b.dataset.del); toast('Deleted'); render();
  });
}

/* ================= DEBTS ================= */
async function vDebts(root) {
  const d = await GET('debts');
  root.innerHTML = header('Debts') +
    `<div class="grid g3" style="margin-bottom:12px">
      <div class="card kpi"><h3>People owe me</h3><div class="v ok">${money(d.they_owe_me)}</div>
        <div class="s">${d.open.filter(x => x.direction === 'they_owe').length} open item(s)</div></div>
      <div class="card kpi"><h3>I owe people</h3><div class="v bad">${money(d.i_owe)}</div>
        <div class="s">${d.open.filter(x => x.direction === 'i_owe').length} open item(s)</div></div>
      <div class="card kpi"><h3>Net position</h3><div class="v ${d.net < 0 ? 'bad' : 'ok'}">${money(d.net)}</div>
        <div class="s">${d.net >= 0 ? 'in your favour' : 'you are behind'}</div></div>
    </div>

    ${d.people.length ? `<div class="card" style="margin-bottom:12px"><h3>By person</h3>
      <table><thead><tr><th>Person</th><th class="num">They owe me</th><th class="num">I owe them</th>
        <th class="num">Net</th><th>Items</th></tr></thead>
      <tbody>${d.people.map(p => `<tr><td><b>${esc(p.person)}</b></td>
        <td class="num ok">${p.they_owe ? money(p.they_owe) : '—'}</td>
        <td class="num bad">${p.i_owe ? money(p.i_owe) : '—'}</td>
        <td class="num ${p.net < 0 ? 'bad' : 'ok'}"><b>${money(p.net)}</b></td>
        <td class="dim">${p.items}</td></tr>`).join('')}</tbody></table></div>` : ''}

    <div class="card">
      <h3>Record a debt</h3>
      <div class="form">
        <div class="fld"><label>Direction</label><select id="d_dir" class="w160">
          <option value="they_owe">They owe me</option><option value="i_owe">I owe them</option></select></div>
        <div class="fld"><label>Person</label><input id="d_p" class="w130" placeholder="Hakim"></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="d_a" class="w90"></div>
        <div class="fld grow"><label>Why</label><input id="d_r" placeholder="reason / what it was for"></div>
        <div class="fld"><label>Date</label><input type="date" id="d_d" class="w130" value="${today()}"></div>
        <div class="fld"><label>Due by (optional)</label><input type="date" id="d_due" class="w130"></div>
        <button class="btn" id="d_go">Add</button>
      </div>
      <table><thead><tr><th>Date</th><th>Person</th><th>Direction</th><th>Why</th>
        <th class="num">Amount</th><th class="num">Paid</th><th class="num">Left</th>
        <th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${d.all.map(x => `<tr style="${x.status !== 'open' ? 'opacity:.45' : ''}">
        <td class="dim mono">${esc(x.date)}</td><td><b>${esc(x.person)}</b></td>
        <td><span class="tag ${x.direction === 'they_owe' ? 'g' : 'r'}">${x.direction === 'they_owe' ? 'owes me' : 'I owe'}</span></td>
        <td>${esc(x.reason || '')}</td>
        <td class="num">${money(x.amount)}</td>
        <td class="num dim">${money(x.paid)}</td>
        <td class="num ${x.outstanding > 0 ? (x.direction === 'they_owe' ? 'ok' : 'bad') : 'dim2'}"><b>${money(x.outstanding)}</b></td>
        <td class="dim2 mono">${esc(x.due_date || '')}</td>
        <td><span class="tag ${x.status === 'open' ? 'y' : 'g'}">${esc(x.status)}</span></td>
        <td style="white-space:nowrap">
          ${x.status === 'open' ? `<button class="btn sm sec" data-pp="${x.id}" data-left="${x.outstanding}" data-nm="${esc(x.person)}">Settle</button>` : ''}
          <button class="x" data-dd="${x.id}">&times;</button></td>
      </tr>`).join('')}</tbody></table>
      ${d.all.length ? '' : '<div class="empty">No debts recorded</div>'}
    </div>`;

  $('#d_go').onclick = async () => {
    const p = $('#d_p').value.trim(), a = +$('#d_a').value;
    if (!p || !a) return toast('Need a person and an amount', true);
    await POST('debts', {
      direction: $('#d_dir').value, person: p, amount: a, reason: $('#d_r').value,
      date: $('#d_d').value, due_date: $('#d_due').value || null, status: 'open',
    });
    toast('Debt recorded'); render();
  };
  $$('[data-pp]').forEach(b => b.onclick = async () => {
    const left = +b.dataset.left;
    const v = prompt(`How much did ${b.dataset.nm} settle? (${money(left)} outstanding)`, n2(left));
    if (v === null) return;
    const amt = +v; if (!amt) return;
    await POST('debt_payments', { debt_id: b.dataset.pp, date: today(), amount: amt });
    toast('Recorded ' + money(amt)); render();
  });
  $$('[data-dd]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this debt and its repayments?')) return;
    await DEL('debts/' + b.dataset.dd); toast('Deleted'); render();
  });
}

/* ================= RECURRING ================= */
async function vRecurring(root) {
  const rs = await GET('recurring');
  const act = rs.filter(r => r.active);
  const sum = k => act.filter(r => r.kind === k).reduce((a, r) => a + r.amount, 0);

  root.innerHTML = header('Fixed &amp; budgets') +
    `<div class="alert info" style="margin-bottom:12px">
      <b>The master list every month is built from.</b> You normally never need
      this screen — adding something in <i>Month plan</i> and choosing “every
      month” puts it here for you. Come here to change a number once for all
      future months, or to switch an old line off.</div>
    <div class="grid g4" style="margin-bottom:12px">
      ${S.kindRows.filter(k => !k.archived).map(k => `
        <div class="card kpi"><h3>${esc(k.name)}</h3>
          <div class="v ${k.is_saving ? 'sv' : ''}">${money(sum(k.name))}</div>
          <div class="s">${k.is_saving ? 'put aside monthly' : 'per month'}</div></div>`).join('')}
      <div class="card kpi"><h3>Total committed</h3>
        <div class="v">${money(act.reduce((a, r) => a + r.amount, 0))}</div>
        <div class="s">per month, all types</div></div>
    </div>
    <div class="card">
      <h3>Add a monthly item</h3>
      <div class="form">
        <div class="fld grow"><label>Label</label><input id="r_l" placeholder="Loyer, Assurance, Medics…"></div>
        <div class="fld"><label>Amount</label><input type="number" step="0.01" id="r_a" class="w90"></div>
        <div class="fld"><label>Type</label><select id="r_k" class="w110">
          ${kindOpts()}</select></div>
        <div class="fld"><label>Category</label><select id="r_c" class="w130">${selOpts(S.cats)}</select></div>
        <div class="fld"><label>Due day</label><input type="number" min="1" max="31" id="r_d" class="w70" placeholder="5"></div>
        <button class="btn" id="r_go">Add</button>
      </div>
      <label class="ckl"><input type="checkbox" id="r_sub">
        This is a subscription — also track it on the Subscriptions tab
        (Netflix, phone, gym, insurance…)</label>
      <div class="hr"></div>
      <table><thead><tr><th>Label</th><th>Category</th><th>Type</th><th class="num">Amount</th>
        <th>Due day</th><th>Subscription</th><th>Active</th><th></th></tr></thead>
      <tbody>${rs.map(r => `<tr style="${r.active ? '' : 'opacity:.45'}">
        <td><input class="rf w200" data-id="${r.id}" data-f="label" value="${esc(r.label)}"></td>
        <td><select class="rf w130" data-id="${r.id}" data-f="category">${selOpts(S.cats, r.category)}</select></td>
        <td><select class="rf w110" data-id="${r.id}" data-f="kind">
          ${kindOpts(r.kind)}</select></td>
        <td class="num"><input type="number" step="0.01" class="rf w90" data-id="${r.id}" data-f="amount" value="${n2(r.amount)}"></td>
        <td><input type="number" min="1" max="31" class="rf w70" data-id="${r.id}" data-f="due_day" value="${r.due_day || ''}"></td>
        <td>${r.sub_id
            ? `<span class="tag g" title="Billed ${esc(r.sub_period || '')}, next ${esc(r.sub_next || '')}">yes · ${esc(r.sub_period || '')}</span>`
            : `<button class="btn sm sec" data-mksub="${r.id}">make one</button>`}</td>
        <td><button class="btn sm sec" data-tog="${r.id}" data-v="${r.active ? 0 : 1}">${r.active ? 'on' : 'off'}</button></td>
        <td><button class="x" data-del="${r.id}">&times;</button></td>
      </tr>`).join('')}</tbody></table>
      <div class="dim2" style="font-size:11px;margin-top:10px">
        Marking a line as a subscription does not change your plan — it just also
        lists it under Subscriptions, so you can see its yearly cost and when it
        renews. The two stay in step automatically.</div>
    </div>`;

  $('#r_go').onclick = async () => {
    const l = $('#r_l').value.trim(); if (!l) return toast('Label it first', true);
    const r = await POST('recurring', {
      label: l, amount: $('#r_a').value || 0, kind: $('#r_k').value,
      category: $('#r_c').value, due_day: $('#r_d').value || null, active: 1, ym: S.ym,
      is_sub: $('#r_sub').checked ? 1 : 0,
    });
    toast(r.sub ? 'Added to the plan and to Subscriptions' : 'Added — also placed in ' + ymLabel(S.ym));
    render();
  };
  $$('[data-mksub]').forEach(b => b.onclick = async () => {
    await POST('recurring/' + b.dataset.mksub + '/make-sub', {});
    toast('Now tracked as a subscription too'); render();
  });
  $$('.rf').forEach(el => el.onchange = async () => {
    const propagate = confirm(
      'Change ' + ymLabel(S.ym) + ' as well?\n\n' +
      'Every month after it is updated either way.\n' +
      'OK = change ' + ymLabel(S.ym) + ' too.\n' +
      'Cancel = leave ' + ymLabel(S.ym) + ' as it is.');
    const r = await PUT('recurring/' + el.dataset.id,
      { [el.dataset.f]: el.value, propagate: propagate ? 1 : 0, ym: S.ym });
    toast(r.updated ? 'Saved — ' + r.updated + ' month(s) updated' : 'Saved');
    render();
  });
  $$('[data-tog]').forEach(b => b.onclick = async () => {
    await PUT('recurring/' + b.dataset.tog, { active: b.dataset.v }); render();
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this item from the master list? Past months keep their envelopes.')) return;
    await DEL('recurring/' + b.dataset.del); toast('Deleted'); render();
  });
}

/* ================= REPORTS ================= */
async function vReports(root) {
  const y = S.ym.slice(0, 4);
  const start = S.reportStart || (y + '-01-01');
  const end = S.reportEnd || (y + '-12-31');
  const f = S.repFilter;
  const qs = filterQS(f);
  qs.set('start', start); qs.set('end', end);
  const r = await GET('report?' + qs);

  const maxM = Math.max(1, ...r.months.map(m => m.total));
  root.innerHTML = header('Reports') +
    `<div class="card" style="margin-bottom:12px">
      <div class="form">
        <div class="fld"><label>From</label><input type="date" id="rs" value="${start}"></div>
        <div class="fld"><label>To</label><input type="date" id="re" value="${end}"></div>
        <button class="btn" id="rgo">Apply</button>
        <div class="chips" style="margin:0 0 0 10px">
          <span class="chip" data-rng="ytd">This year</span>
          <span class="chip" data-rng="12m">Last 12 months</span>
          <span class="chip" data-rng="all">Everything</span>
        </div>
        <div class="spacer"></div>
        <div class="right"><div class="dim" style="font-size:11px">TOTAL SPENT</div>
          <div style="font-size:22px;font-weight:650">${money(r.total)}</div>
          <div class="dim2" style="font-size:11px">${r.n_tx} tx · ${money(r.avg_month)}/month · ${money(r.avg_tx)} avg</div></div>
      </div>
      <div class="hr"></div>
      ${filterBar(f, 'rep')}
      ${filterSummary(f) ? `<div class="dim" style="margin-top:6px">Showing only <b class="mono">${esc(filterSummary(f))}</b></div>` : ''}
    </div>

    <div class="grid g2" style="margin-bottom:12px">
      <div class="card"><h3>By category</h3>
        <table><thead><tr><th>Category</th><th class="num">Total</th><th class="num">Share</th><th class="num">Count</th><th class="num">Avg</th></tr></thead>
        <tbody>${r.categories.map((c, i) => `<tr>
          <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${PALETTE[i % PALETTE.length]};margin-right:7px"></span>${esc(c.category)}</td>
          <td class="num"><b>${money(c.total)}</b></td>
          <td class="num dim">${c.pct}%</td><td class="num dim">${c.n}</td>
          <td class="num dim">${money(c.total / c.n)}</td></tr>`).join('')}</tbody></table>
        ${r.categories.length ? '' : '<div class="empty">No data in this range</div>'}
      </div>
      <div>
        <div class="card" style="margin-bottom:12px"><h3>By budget type</h3>
          <table><thead><tr><th>Type</th><th class="num">Total</th><th class="num">Share</th><th class="num">Count</th></tr></thead>
          <tbody>${r.kinds.map(k => `<tr>
            <td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${kindColor(k.tkind)};margin-right:7px"></span>${esc(k.tkind)}</td>
            <td class="num"><b>${money(k.total)}</b></td>
            <td class="num dim">${k.pct}%</td><td class="num dim">${k.n}</td></tr>`).join('')}</tbody></table>
          ${r.kinds.length ? '' : '<div class="empty">No data in this range</div>'}
        </div>
        <div class="card"><h3>Month by month</h3>
          <div class="scroll">${r.months.map(m => `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px">
              <span>${ymLabel(m.ym)}</span><span class="mono">${money(m.total)}</span></div>
            <div class="bar"><i style="width:${100 * m.total / maxM}%"></i></div></div>`).join('')}
          </div>
          ${r.months.length ? '' : '<div class="empty">No data</div>'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px"><h3>Category × budget type</h3>
      <div class="dim" style="font-size:12px;margin-bottom:8px">
        Every combination at once. Click any amount to see the transactions behind it.</div>
      ${matrixTable(r)}
    </div>

    <div class="card"><h3>Where it actually goes — top 25 payees</h3>
      <table><thead><tr><th>#</th><th>What / where</th><th>Category</th>
        <th class="num">Total</th><th class="num">Times</th><th class="num">Average</th></tr></thead>
      <tbody>${r.payees.map((p, i) => `<tr><td class="dim2">${i + 1}</td>
        <td><b>${esc(p.label)}</b></td><td><span class="tag">${esc(p.category)}</span></td>
        <td class="num">${money(p.total)}</td><td class="num dim">${p.n}</td>
        <td class="num dim">${money(p.total / p.n)}</td></tr>`).join('')}</tbody></table>
      ${r.payees.length ? '' : '<div class="empty">No data</div>'}
    </div>`;

  bindFilterBar('rep', f, render);
  $$('[data-mx]').forEach(td => td.onclick = () => {
    // jump to the transactions behind one cell
    S.view = 'tx';
    S.txFilter = {
      q: '', cats: [td.dataset.mc], kinds: [td.dataset.mk], logic: 'and',
      txkind: 'expense', account: '', scope: 'custom',
    };
    S.txStart = start; S.txEnd = end;
    render();
  });
  $('#rgo').onclick = () => { S.reportStart = $('#rs').value; S.reportEnd = $('#re').value; render(); };
  $$('[data-rng]').forEach(c => c.onclick = () => {
    const t = new Date();
    if (c.dataset.rng === 'ytd') { S.reportStart = t.getFullYear() + '-01-01'; S.reportEnd = today(); }
    else if (c.dataset.rng === '12m') { S.reportStart = ymAdd(S.ym, -11) + '-01'; S.reportEnd = monthEnd(S.ym); }
    else { S.reportStart = '2000-01-01'; S.reportEnd = '2999-12-31'; }
    render();
  });
}

function matrixTable(r) {
  if (!r.matrix.length) return '<div class="empty">No data in this range</div>';
  const ks = r.kinds.map(k => k.tkind);
  const cell = {};
  r.matrix.forEach(m => { cell[m.category + ' ' + m.tkind] = m; });
  const max = Math.max(...r.matrix.map(m => m.total));

  const head = `<tr><th>Category</th>${ks.map(k =>
    `<th class="num"><span style="border-bottom:2px solid ${kindColor(k)}">${esc(k)}</span></th>`).join('')}
    <th class="num">Total</th></tr>`;

  const body = r.categories.map(c => {
    const tds = ks.map(k => {
      const m = cell[c.category + ' ' + k];
      if (!m) return '<td class="num dim2">·</td>';
      // shade the cell by how big it is relative to the biggest one
      const a = 0.08 + 0.42 * (m.total / max);
      return `<td class="num mx" data-mx="1" data-mc="${esc(c.category)}" data-mk="${esc(k)}"
        style="background:rgba(79,156,249,${a.toFixed(3)})"
        title="${esc(c.category)} + ${esc(k)} — ${m.n} transaction(s)">${money0(m.total)}</td>`;
    }).join('');
    return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;
      background:${catColor(c.category)};margin-right:7px"></span>${esc(c.category)}</td>
      ${tds}<td class="num"><b>${money0(c.total)}</b></td></tr>`;
  }).join('');

  const foot = `<tr><th>Total</th>${r.kinds.map(k =>
    `<th class="num">${money0(k.total)}</th>`).join('')}<th class="num">${money0(r.total)}</th></tr>`;

  return `<div class="scroll" style="overflow-x:auto"><table class="mx-t">
    <thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

/* ================= CATEGORIES & TYPES ================= */
async function vCats(root) {
  const [cats, kinds] = await Promise.all([GET('categories'), GET('kinds')]);
  const others = n => cats.filter(c => c.name !== n).map(c => c.name);
  const kothers = n => kinds.filter(k => k.name !== n).map(k => k.name);

  root.innerHTML = header('Categories & budget types') +
    `<div class="alert info" style="margin-bottom:12px">
      Renaming carries every existing record over with it — nothing is lost.
      Deleting something still in use asks you where to move those records first.</div>

    <div class="grid g2">
      <div class="card"><h3>Categories — what you spent it on</h3>
        <div class="form">
          <div class="fld grow"><label>New category</label><input id="nc" placeholder="e.g. Medics, Travel, Kids"></div>
          <div class="fld"><label>Colour</label><input type="color" id="ncc" value="#4f9cf9" class="w70" style="padding:3px;height:36px"></div>
          <button class="btn" id="nc_go">Add</button>
        </div>
        <table><thead><tr><th></th><th>Name</th><th class="num">Used</th><th class="num">Spent</th><th></th></tr></thead>
        <tbody>${cats.map(c => `<tr style="${c.archived ? 'opacity:.45' : ''}">
          <td><input type="color" class="cf" data-t="categories" data-id="${c.id}" data-f="color"
               value="${esc(c.color || '#94a3b8')}" style="width:30px;height:26px;padding:2px;border-radius:5px"></td>
          <td><input class="cf w160" data-t="categories" data-id="${c.id}" data-f="name" value="${esc(c.name)}"></td>
          <td class="num dim">${c.n_tx}</td>
          <td class="num dim">${money(c.spent)}</td>
          <td style="white-space:nowrap">
            <button class="btn sm sec" data-arch="categories" data-id="${c.id}" data-v="${c.archived ? 0 : 1}"
              title="${c.archived ? 'Show it again' : 'Hide it from the dropdowns, keep the history'}">${c.archived ? 'restore' : 'hide'}</button>
            <button class="x" data-del="categories" data-id="${c.id}" data-nm="${esc(c.name)}"
              data-used="${c.n_tx}" data-opts="${esc(others(c.name).join('|'))}">&times;</button></td>
        </tr>`).join('')}</tbody></table>
      </div>

      <div class="card"><h3>Budget types — how you planned it</h3>
        <div class="form">
          <div class="fld grow"><label>New type</label><input id="nk" placeholder="e.g. investment, medics"></div>
          <div class="fld"><label>Colour</label><input type="color" id="nkc" value="#3ecf8e" class="w70" style="padding:3px;height:36px"></div>
          <div class="fld"><label>Counts as</label><select id="nks" class="w130">
            <option value="0">spending</option><option value="1">money put aside</option></select></div>
          <div class="fld"><label>Reaching 100%</label><select id="nkf" class="w160">
            <option value="0">warn as it fills up</option>
            <option value="1">is the goal (a bill)</option></select></div>
          <button class="btn" id="nk_go">Add</button>
        </div>
        <table><thead><tr><th></th><th>Name</th><th>Counts as</th><th>Reaching 100%</th>
          <th class="num">Used</th><th></th></tr></thead>
        <tbody>${kinds.map(k => `<tr style="${k.archived ? 'opacity:.45' : ''}">
          <td><input type="color" class="cf" data-t="kinds" data-id="${k.id}" data-f="color"
               value="${esc(k.color || '#94a3b8')}" style="width:30px;height:26px;padding:2px;border-radius:5px"></td>
          <td><input class="cf w130" data-t="kinds" data-id="${k.id}" data-f="name" value="${esc(k.name)}">
              <div class="dim2" style="font-size:11px">${esc(k.label || '')}</div></td>
          <td><select class="cf w130" data-t="kinds" data-id="${k.id}" data-f="is_saving">
            <option value="0"${k.is_saving ? '' : ' selected'}>spending</option>
            <option value="1"${k.is_saving ? ' selected' : ''}>money put aside</option></select></td>
          <td><select class="cf w160" data-t="kinds" data-id="${k.id}" data-f="is_fixed">
            <option value="0"${k.is_fixed ? '' : ' selected'}>warn as it fills up</option>
            <option value="1"${k.is_fixed ? ' selected' : ''}>is the goal (a bill)</option></select></td>
          <td class="num dim">${k.n_env + k.n_rec}</td>
          <td style="white-space:nowrap">
            <button class="btn sm sec" data-arch="kinds" data-id="${k.id}" data-v="${k.archived ? 0 : 1}">${k.archived ? 'restore' : 'hide'}</button>
            <button class="x" data-del="kinds" data-id="${k.id}" data-nm="${esc(k.name)}"
              data-used="${k.n_env + k.n_rec}" data-opts="${esc(kothers(k.name).join('|'))}">&times;</button></td>
        </tr>`).join('')}</tbody></table>
        <div class="dim2" style="font-size:11px;margin-top:10px">
          <b>Counts as</b> decides the dashboard's “Saved” figure: types marked
          <i>money put aside</i> are added up there instead of counting as spending.
          <br><b>Reaching 100%</b> decides the warning colour: <i>is the goal</i>
          means a full envelope is green (a paid bill), not amber — reserve
          <i>warn as it fills up</i> for an allowance meant to last the month.
          Going over is always flagged either way.
          <br>“one-off” and “unassigned” are automatic states, not types — they
          show up in filters and reports but cannot be edited here.</div>
      </div>
    </div>`;

  const add = async (table, body, okMsg) => {
    await POST(table, body); await boot(); toast(okMsg); render();
  };
  $('#nc_go').onclick = () => {
    const v = $('#nc').value.trim();
    if (!v) return toast('Type a name first', true);
    add('categories', { name: v, color: $('#ncc').value }, 'Category added');
  };
  $('#nk_go').onclick = () => {
    const v = $('#nk').value.trim();
    if (!v) return toast('Type a name first', true);
    add('kinds', { name: v, label: v, color: $('#nkc').value,
                   is_saving: $('#nks').value, is_fixed: $('#nkf').value },
        'Budget type added');
  };
  $$('.cf').forEach(el => {
    const was = el.value;
    el.onchange = async () => {
      try {
        await PUT(el.dataset.t + '/' + el.dataset.id, { [el.dataset.f]: el.value });
        await boot(); toast('Saved'); render();
      } catch (e) { el.value = was; }
    };
  });
  $$('[data-arch]').forEach(b => b.onclick = async () => {
    await PUT(b.dataset.arch + '/' + b.dataset.id, { archived: b.dataset.v });
    await boot(); render();
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const used = +b.dataset.used, opts = (b.dataset.opts || '').split('|').filter(Boolean);
    let body = {};
    if (used) {
      const to = prompt(
        `“${b.dataset.nm}” is used by ${used} record(s).\n\n` +
        `Type the name to move them to, or Cancel to keep it:\n\n${opts.join(', ')}`, 'Other');
      if (to === null) return;
      if (!opts.includes(to.trim())) return toast('“' + to + '” is not on the list', true);
      body = { reassign: to.trim() };
    } else if (!confirm('Delete “' + b.dataset.nm + '”?')) return;
    try {
      const r = await DELB(b.dataset.del + '/' + b.dataset.id, body);
      await boot();
      toast(r.moved ? 'Deleted — ' + r.moved + ' record(s) moved' : 'Deleted');
      render();
    } catch (e) { /* message already shown */ }
  });
}

/* ================= SETTINGS ================= */
async function vSettings(root) {
  const st = await GET('settings');
  const bal = await GET('balances');
  const latest = {};
  bal.forEach(b => { if (!latest[b.account] || b.ym > latest[b.account].ym) latest[b.account] = b; });

  root.innerHTML = header('Settings') +
    `<div class="grid g2">
      <div class="card"><h3>General</h3>
        <div class="form" style="flex-direction:column;align-items:stretch">
          <div class="fld"><label>Currency symbol</label><input id="st_cur" value="${esc(st.currency)}"></div>
          <div class="fld"><label>Default monthly income (used for a brand-new month)</label>
            <input type="number" step="0.01" id="st_inc" value="${esc(st.default_income)}"></div>
          <div class="fld"><label>Accounts (comma separated)</label><input id="st_acc" value="${esc(st.accounts)}"></div>
          <button class="btn" id="st_go">Save settings</button>
          <div class="dim2" style="font-size:12px;margin-top:4px">
            Categories and budget types have their own screen now —
            <a href="#" id="gocats">Categories &amp; types</a>.</div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px"><h3>Account balances — ${ymLabel(S.ym)}</h3>
          <div class="dim" style="font-size:12px;margin-bottom:8px">Snapshot what each account actually holds. Used for the net-worth figure.</div>
          <table><tbody>${S.accounts.map(a => `<tr>
            <td>${esc(a)}<div class="dim2" style="font-size:11px">${latest[a] ? 'last: ' + money(latest[a].amount) + ' (' + latest[a].ym + ')' : 'never recorded'}</div></td>
            <td class="num"><input type="number" step="0.01" class="w130 bal" data-a="${esc(a)}"
              value="${(bal.find(b => b.account === a && b.ym === S.ym) || {}).amount ?? ''}" placeholder="0.00"></td>
          </tr>`).join('')}</tbody></table>
          <button class="btn" id="bal_go" style="margin-top:10px">Save balances for ${ymLabel(S.ym)}</button>
        </div>
        <div class="card" style="margin-bottom:12px"><h3>Password lock</h3>
          <div id="authbox"></div>
        </div>
        <div class="card" style="margin-bottom:12px"><h3>Server &amp; storage</h3>
          <div id="srvbox" class="dim">loading…</div>
        </div>
        <div class="card"><h3>Your data</h3>
          <div class="dim" style="font-size:12px;margin-bottom:10px">
            Everything lives in one file: <code>data/money.db</code>. Copy it anywhere to back it up or move it to another PC.</div>
          <button class="btn sec" id="bk">Make a backup copy now</button>
          <div id="bkout" class="dim2" style="font-size:11px;margin-top:8px"></div>
        </div>
      </div>
    </div>`;

  await renderAuthBox();
  await renderServerBox();
  $('#gocats').onclick = e => { e.preventDefault(); nav('cats'); };
  $('#st_go').onclick = async () => {
    await POST('settings', {
      currency: $('#st_cur').value, default_income: $('#st_inc').value,
      accounts: $('#st_acc').value,
    });
    await boot(); toast('Settings saved'); render();
  };
  $('#bal_go').onclick = async () => {
    for (const i of $$('.bal')) {
      if (i.value !== '') await POST('balances', { account: i.dataset.a, ym: S.ym, amount: i.value });
    }
    toast('Balances saved'); render();
  };
  $('#bk').onclick = async () => {
    const r = await GET('backup');
    $('#bkout').textContent = 'Saved to ' + r.file;
    toast('Backup created');
  };
}

function humanAge(sec) {
  if (sec < 90) return sec + ' seconds';
  if (sec < 5400) return Math.round(sec / 60) + ' minutes';
  if (sec < 172800) return Math.round(sec / 3600) + ' hours';
  return Math.round(sec / 86400) + ' days';
}

async function renderServerBox() {
  const box = $('#srvbox');
  if (!box) return;
  const s = await GET('serverinfo');
  const kb = s.db_bytes >= 1048576
    ? (s.db_bytes / 1048576).toFixed(1) + ' MB'
    : Math.round(s.db_bytes / 1024) + ' KB';
  const fresh = s.uptime_seconds < 900;
  const hasData = s.counts.tx > 0 || s.counts.recurring > 0;

  box.innerHTML = `
    <table style="margin-bottom:10px"><tbody>
      <tr><td class="dim2">Running since</td><td class="right">${esc(s.started_at.replace('T', ' '))}
        <span class="dim2">(${humanAge(s.uptime_seconds)} ago)</span></td></tr>
      <tr><td class="dim2">Storage folder</td><td class="right mono" style="font-size:11px">${esc(s.data_dir)}</td></tr>
      <tr><td class="dim2">This profile's file</td><td class="right mono" style="font-size:11px">${esc(s.db_file)} · ${kb}</td></tr>
      <tr><td class="dim2">Holding</td><td class="right">${s.counts.tx} transactions ·
        ${s.counts.recurring} fixed lines · ${s.counts.months} months ·
        ${s.counts.subs} subscriptions · ${s.counts.debts} debts</td></tr>
      ${s.oldest_record ? `<tr><td class="dim2">Oldest record written</td>
        <td class="right mono" style="font-size:11px">${esc(s.oldest_record)}</td></tr>` : ''}
    </tbody></table>
    ${s.in_container && s.mounted === false ? `<div class="alert danger">
      <b>This folder is not a mounted volume.</b> <code>${esc(s.data_dir)}</code> is
      ordinary container disk, so everything in it — budgets <i>and</i> your password —
      is deleted on the next deploy. On Railway: service →
      <b>Settings → Volumes → Add Volume</b>, mount path exactly
      <code>${esc(s.data_dir)}</code>. Check it is attached to <i>this</i> service.</div>`
    : s.in_container && s.mounted ? `<div class="alert info">
      <b>Persistent volume attached</b> at <code>${esc(s.data_dir)}</code> — it is on
      its own filesystem, so it survives deploys.${fresh && !hasData
        ? ' The profile is empty, but that is the volume starting fresh, not losing data.' : ''}</div>`
    : fresh && hasData ? `<div class="alert info">
      <b>Storage is persisting.</b> The server restarted ${humanAge(s.uptime_seconds)} ago,
      yet your ${s.counts.tx} transaction(s) and ${s.counts.recurring} fixed line(s) are
      still here — so the data outlived the process.</div>`
    : ''}
    <div class="dim2" style="font-size:11px;margin-top:8px">
      After a deploy, “running since” resets while everything else should not.
      That is how you tell a real restart from a page that simply did not reload.</div>`;
}

async function renderAuthBox() {
  const box = $('#authbox');
  if (!box) return;
  const a = await (await fetch('/api/auth')).json();
  S.auth = a;

  box.innerHTML = a.enabled ? `
    <div class="dim" style="font-size:12px;margin-bottom:10px">
      <span class="tag g">on</span> The app asks for a password when it opens.
      Changing it signs out every device.</div>
    <div class="form" style="flex-direction:column;align-items:stretch">
      <div class="fld"><label>Current password</label><input type="password" id="pw_cur" autocomplete="current-password"></div>
      <div class="fld"><label>New password</label><input type="password" id="pw_new" autocomplete="new-password" placeholder="at least ${a.min_length} characters"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="pw_change">Change password</button>
        <button class="btn sec" id="pw_lock">Lock now</button>
        <div class="spacer"></div>
        <button class="btn sec" id="pw_off">Remove the lock</button>
      </div>
    </div>` : `
    <div class="dim" style="font-size:12px;margin-bottom:10px">
      <span class="tag y">off</span> Anyone who opens this app sees your money.
      Fine on your own PC — <b>set one before you host it anywhere</b>.</div>
    ${a.exposed ? `<div class="alert danger">This app is listening on a public
      address with no password. Set one now.</div>` : ''}
    <div class="form" style="flex-direction:column;align-items:stretch">
      <div class="fld"><label>New password</label><input type="password" id="pw_new" autocomplete="new-password" placeholder="at least ${a.min_length} characters"></div>
      <div class="fld"><label>Type it again</label><input type="password" id="pw_new2" autocomplete="new-password"></div>
      <button class="btn" id="pw_set">Set password</button>
    </div>`;

  const post = async (path, body) => {
    const r = await fetch('/api/auth/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'Failed', true); throw new Error(d.error); }
    return d;
  };

  if ($('#pw_set')) $('#pw_set').onclick = async () => {
    const p = $('#pw_new').value;
    if (p.length < a.min_length) return toast(`At least ${a.min_length} characters`, true);
    if (p !== $('#pw_new2').value) return toast('The two do not match', true);
    try { await post('setup', { password: p }); toast('Password set'); renderAuthBox(); } catch (e) { }
  };
  if ($('#pw_change')) $('#pw_change').onclick = async () => {
    const p = $('#pw_new').value;
    if (p.length < a.min_length) return toast(`At least ${a.min_length} characters`, true);
    try {
      await post('change', { current: $('#pw_cur').value, password: p });
      toast('Password changed — other devices signed out'); renderAuthBox();
    } catch (e) { }
  };
  if ($('#pw_off')) $('#pw_off').onclick = async () => {
    if (!confirm('Remove the password?\n\nAnyone who can open the app will see your money.')) return;
    try {
      await post('disable', { current: $('#pw_cur').value });
      toast('Lock removed'); renderAuthBox();
    } catch (e) { }
  };
  if ($('#pw_lock')) $('#pw_lock').onclick = async () => {
    await post('logout', {});
    location.reload();
  };
}

/* ================= COVER A NEGATIVE ENVELOPE ================= */
function openSolveGap(env, mv) {
  const gap = Math.round(-env.remaining * 100) / 100;
  const leftover = mv.totals.left_to_spend;
  const useLeftover = Math.max(0, Math.min(gap, leftover));
  const others = mv.envelopes
    .filter(x => x.id !== env.id && x.remaining > 0.005)
    .sort((a, b) => b.remaining - a.remaining);

  const w = document.createElement('div');
  w.className = 'modal';
  w.innerHTML = `<div class="box">
    <h3>Cover ${money(gap)} in "${esc(env.label)}"</h3>
    <p class="dim" style="font-size:13px;margin-top:-8px;line-height:1.5">
      This went ${money(gap)} over what was planned. Pick where it comes from -
      this moves budget you already have, it does not add new spending.</p>
    <div class="form" style="flex-direction:column;align-items:stretch">
      ${leftover > 0.005 ? `
      <button class="btn" id="sg_leftover" style="text-align:left;line-height:1.4">
        Use money not yet allocated this month
        <div style="font-weight:400;font-size:12px;opacity:.85">
          ${money(useLeftover)} of ${money(leftover)} left this month</div>
      </button>` : `
      <div class="dim2" style="font-size:12px">Nothing is left unallocated this
        month, so this has to come from another budget.</div>`}
      ${others.length ? `
      <div class="hr"></div>
      <div class="fld"><label>Or pull it from another budget</label>
        <select id="sg_from"><option value="">choose one…</option>
          ${others.map(o => `<option value="${o.id}">${esc(o.label)} — ${money(o.remaining)} left</option>`).join('')}
        </select>
      </div>
      <div class="fld"><label>Amount to move</label>
        <input type="number" step="0.01" id="sg_amt" value="${n2(gap)}"></div>
      <button class="btn sec" id="sg_go">Transfer &amp; solve</button>` : ''}
      <button class="btn sec" id="sg_cancel">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  w.onclick = e => { if (e.target === w) close(); };
  document.addEventListener('keydown', function esc1(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc1); }
  });
  $('#sg_cancel', w).onclick = close;

  if ($('#sg_leftover', w)) $('#sg_leftover', w).onclick = async () => {
    try {
      await POST('envelopes/transfer', { ym: S.ym, to_id: env.id, amount: useLeftover });
      close(); toast('Covered ' + money(useLeftover) + ' from unallocated income'); render();
    } catch (e) { /* message already shown */ }
  };
  if ($('#sg_go', w)) $('#sg_go', w).onclick = async () => {
    const fromId = $('#sg_from', w).value;
    const amt = +$('#sg_amt', w).value;
    if (!fromId) return toast('Pick a budget to pull from', true);
    if (!amt || amt <= 0) return toast('Enter an amount', true);
    try {
      await POST('envelopes/transfer', { ym: S.ym, to_id: env.id, from_id: fromId, amount: amt });
      close(); toast('Transferred ' + money(amt)); render();
    } catch (e) { /* message already shown */ }
  };
}

/* ================= QUICK ADD ================= */
async function quickAdd() {
  const mv = await GET('month?ym=' + new Date().toISOString().slice(0, 7));
  const w = document.createElement('div');
  w.className = 'modal';
  w.innerHTML = `<div class="box"><h3>Quick add</h3>
    <div class="form" style="flex-direction:column;align-items:stretch">
      <div class="fld"><label>What / where</label><input id="q_l" placeholder="Carrefour, Uber…" autofocus></div>
      <div style="display:flex;gap:8px">
        <div class="fld" style="flex:1"><label>Amount</label><input type="number" step="0.01" id="q_a"></div>
        <div class="fld" style="flex:1"><label>Date</label><input type="date" id="q_d" value="${today()}"></div>
      </div>
      <div class="fld"><label>Goes to</label><select id="q_e">
        <option value="">— one-off (exceptional) —</option>
        ${mv.envelopes.map(e => `<option value="${e.id}" data-cat="${esc(e.category)}">${esc(e.label)} · ${money(e.remaining)} left</option>`).join('')}
      </select></div>
      <div style="display:flex;gap:8px">
        <div class="fld" style="flex:1"><label>Category</label><select id="q_c">${selOpts(S.cats)}</select></div>
        <div class="fld" style="flex:1"><label>Account</label><select id="q_ac">${selOpts(S.accounts)}</select></div>
      </div>
      <div class="fld"><label>Note</label><input id="q_n" placeholder="optional"></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn" id="q_go" style="flex:1">Add expense</button>
        <button class="btn sec" id="q_x">Cancel</button>
      </div>
    </div></div>`;
  document.body.appendChild(w);
  $('#q_l', w).focus();
  const close = () => w.remove();
  $('#q_x', w).onclick = close;
  w.onclick = e => { if (e.target === w) close(); };
  $('#q_e', w).onchange = e => {
    const o = e.target.selectedOptions[0];
    if (o && o.dataset.cat) $('#q_c', w).value = o.dataset.cat;
  };
  const go = async () => {
    const l = $('#q_l', w).value.trim(), a = +$('#q_a', w).value;
    if (!l || !a) return toast('Need a label and an amount', true);
    const env = $('#q_e', w).value;
    await POST('tx', {
      date: $('#q_d', w).value, label: l, amount: a, kind: 'expense',
      envelope_id: env || null, category: $('#q_c', w).value,
      account: $('#q_ac', w).value, note: $('#q_n', w).value, oneoff: env ? 0 : 1,
    });
    close(); toast('Added ' + money(a)); render();
  };
  $('#q_go', w).onclick = go;
  w.addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
    if (e.key === 'Escape') close();
  });
}

/* ================= boot ================= */
const VIEWS = {
  dash: vDash, month: vMonth, tx: vTx, subs: vSubs, debts: vDebts,
  recurring: vRecurring, reports: vReports, cats: vCats, settings: vSettings,
  profiles: vProfiles,
};

/* ---------- profiles ---------- */

function renderProfiles() {
  const box = $('#profbox');
  if (!box) return;
  const cur = S.profiles.find(p => p.id === S.profile) || S.profiles[0] || {};
  box.innerHTML = `
    <div class="profcur" id="profcur" title="Switch profile">
      <span class="dot" style="background:${esc(cur.color || '#4f9cf9')}"></span>
      <span class="nm">${esc(cur.name || '—')}</span>
      <span class="cv">▾</span>
    </div>
    <div class="proflist" id="proflist" hidden>
      ${S.profiles.filter(p => !p.archived).map(p => `
        <button class="profitem ${p.id === S.profile ? 'on' : ''}" data-pid="${p.id}">
          <span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}
        </button>`).join('')}
      <div class="hr" style="margin:6px 0"></div>
      <button class="profitem add" id="profadd">+ New profile</button>
      <button class="profitem add" id="profmanage">Manage profiles…</button>
    </div>`;

  $('#profcur').onclick = () => {
    const l = $('#proflist');
    l.hidden = !l.hidden;
  };
  $$('.profitem[data-pid]').forEach(b => b.onclick = async () => {
    await switchProfile(+b.dataset.pid);
  });
  $('#profadd').onclick = async () => {
    const name = prompt('Name for the new profile (e.g. your wife’s name):', '');
    if (name === null) return;
    if (!name.trim()) return toast('It needs a name', true);
    try {
      const r = await POST('profiles', { name: name.trim() });
      S.profiles = r.profiles;
      toast('Profile created — it starts completely empty');
      await switchProfile(r.id);
    } catch (e) { /* message already shown */ }
  };
  $('#profmanage').onclick = () => { $('#proflist').hidden = true; nav('profiles'); };
}

async function switchProfile(pid) {
  S.profile = pid;
  try { localStorage.setItem('gm_profile', String(pid)); } catch (e) { }
  S.ym = new Date().toISOString().slice(0, 7);
  S.txFilter = { q: '', cats: [], kinds: [], logic: 'and', txkind: '', account: '', scope: 'month' };
  S.repFilter = { cats: [], kinds: [], logic: 'and' };
  S.data = {};
  await boot();
  renderProfiles();
  render();
}

async function vProfiles(root) {
  const r = await GET('profiles');
  S.profiles = r.profiles;
  root.innerHTML = header('Profiles') +
    `<div class="alert info" style="margin-bottom:12px">
      Each profile is a <b>separate budget in its own database file</b> — its own
      months, transactions, subscriptions, debts, categories and settings.
      Nothing is shared or added together. Switch between them at the top left.</div>
    <div class="card">
      <h3>Add a profile</h3>
      <div class="form">
        <div class="fld grow"><label>Name</label><input id="p_n" placeholder="e.g. Sarra"></div>
        <div class="fld"><label>Colour</label><input type="color" id="p_c" value="#3ecf8e" class="w70" style="padding:3px;height:36px"></div>
        <button class="btn" id="p_go">Create</button>
      </div>
      <table><thead><tr><th></th><th>Name</th><th>Created</th><th>Data file</th><th></th></tr></thead>
      <tbody>${r.profiles.map(p => `<tr>
        <td><input type="color" class="pf" data-id="${p.id}" data-f="color" value="${esc(p.color)}"
             style="width:30px;height:26px;padding:2px;border-radius:5px"></td>
        <td><input class="pf w160" data-id="${p.id}" data-f="name" value="${esc(p.name)}"></td>
        <td class="dim2 mono">${esc((p.created_at || '').slice(0, 10))}</td>
        <td class="dim2 mono" style="font-size:11px">data/profile-${p.id}.db</td>
        <td>${p.id === S.profile ? '<span class="tag g">in use</span>'
              : `<button class="btn sm sec" data-use="${p.id}">Switch to</button>`}
            ${r.profiles.length > 1 ? `<button class="x" data-delp="${p.id}" data-nm="${esc(p.name)}">&times;</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>
      <div class="dim2" style="font-size:11px;margin-top:10px">
        Deleting a profile deletes its database file and everything in it. Back it
        up first from Settings if you might want it back.</div>
    </div>`;

  $('#p_go').onclick = async () => {
    const n = $('#p_n').value.trim();
    if (!n) return toast('It needs a name', true);
    try {
      const res = await POST('profiles', { name: n, color: $('#p_c').value });
      S.profiles = res.profiles;
      toast('Profile created'); render(); renderProfiles();
    } catch (e) { /* shown */ }
  };
  $$('.pf').forEach(el => {
    const was = el.value;
    el.onchange = async () => {
      try {
        const res = await PUT('profiles/' + el.dataset.id, { [el.dataset.f]: el.value });
        S.profiles = res.profiles; renderProfiles(); toast('Saved'); render();
      } catch (e) { el.value = was; }
    };
  });
  $$('[data-use]').forEach(b => b.onclick = () => switchProfile(+b.dataset.use));
  $$('[data-delp]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete the profile “' + b.dataset.nm + '” and everything in it?\n\nThis cannot be undone.')) return;
    if (!confirm('Really delete “' + b.dataset.nm + '”? Its budget, transactions and history are all removed.')) return;
    try {
      const res = await DELB('profiles/' + b.dataset.delp, {});
      S.profiles = res.profiles;
      if (+b.dataset.delp === S.profile) return switchProfile(res.profiles[0].id);
      toast('Profile deleted'); render(); renderProfiles();
    } catch (e) { /* shown */ }
  });
}

async function boot() {
  const [st, cats, kinds] = await Promise.all(
    [GET('settings'), GET('categories'), GET('kinds')]);
  S.cur = st.currency || '€';
  S.accounts = (st.accounts || '').split(',').map(s => s.trim()).filter(Boolean);
  S.catRows = cats;
  S.cats = cats.filter(c => !c.archived).map(c => c.name);
  S.catColor = {};
  cats.forEach(c => { S.catColor[c.name] = c.color; });
  S.kindRows = kinds;
  S.kinds = kinds.filter(k => !k.archived).map(k => k.name);
}

const KEYS = { 1: 'dash', 2: 'month', 3: 'tx', 4: 'subs', 5: 'debts',
               6: 'recurring', 7: 'reports', 8: 'cats', 9: 'settings' };
document.addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if ($('.modal')) return;
  if (KEYS[e.key]) nav(KEYS[e.key]);
  else if (e.key.toLowerCase() === 'a') { e.preventDefault(); quickAdd(); }
  else if (e.key === 'ArrowLeft') { S.ym = ymAdd(S.ym, -1); render(); }
  else if (e.key === 'ArrowRight') { S.ym = ymAdd(S.ym, 1); render(); }
});

$$('.nav').forEach(b => b.onclick = () => nav(b.dataset.v));
$('#quickAdd').onclick = quickAdd;
document.addEventListener('click', e => {
  const l = $('#proflist');
  if (l && !l.hidden && !e.target.closest('#profbox')) l.hidden = true;
});

/* ---------- the lock screen ---------- */

function lockScreen(mode, info) {
  // mode: 'login' = a password exists | 'setup' = choose one now
  const setup = mode === 'setup';
  document.body.insertAdjacentHTML('beforeend', `
    <div class="lock" id="lock">
      <form class="lockbox" id="lockform">
        <div class="lockmark">🔒</div>
        <h1>Gestion<span>Money</span></h1>
        <p class="lockmsg">${setup
          ? 'Choose a password. You will need it every time you open the app.'
          : 'Enter your password to unlock.'}</p>
        ${setup && info.exposed ? `<div class="alert warn" style="text-align:left">
          This app is reachable from other machines. Set a password now.</div>` : ''}
        <input type="password" id="lockpw" placeholder="Password" autocomplete="${setup ? 'new-password' : 'current-password'}" autofocus>
        ${setup ? '<input type="password" id="lockpw2" placeholder="Type it again" autocomplete="new-password">' : ''}
        <button class="btn" type="submit" id="lockgo">${setup ? 'Set password' : 'Unlock'}</button>
        <div class="lockerr" id="lockerr"></div>
        ${setup ? `<p class="lockhint">At least ${info.min_length} characters. Stored as a
          PBKDF2 hash — if you forget it, delete <code>data/profiles.db</code>’s
          password with the reset tool; your budgets are untouched.</p>` : ''}
      </form>
    </div>`);

  const err = m => { $('#lockerr').textContent = m; };
  $('#lockform').onsubmit = async e => {
    e.preventDefault();
    const pw = $('#lockpw').value;
    if (setup) {
      if (pw.length < info.min_length) return err(`At least ${info.min_length} characters.`);
      if (pw !== $('#lockpw2').value) return err('The two do not match.');
    }
    $('#lockgo').disabled = true;
    try {
      const r = await fetch('/api/auth/' + (setup ? 'setup' : 'login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json();
      if (!r.ok) { err(d.error || 'Could not unlock.'); $('#lockgo').disabled = false; return; }
      $('#lock').remove();
      startApp();
    } catch (ex) {
      err('Could not reach the app.');
      $('#lockgo').disabled = false;
    }
  };
  $('#lockpw').focus();
}

async function startApp() {
  const r = await GET('profiles');
  S.profiles = r.profiles;
  let saved = null;
  try { saved = localStorage.getItem('gm_profile'); } catch (e) { }
  S.profile = (saved && r.profiles.some(p => String(p.id) === saved))
    ? +saved : r.current;
  renderProfiles();
  await boot();
  render();
}

(async function start() {
  const info = await (await fetch('/api/auth')).json();
  S.auth = info;
  if (info.enabled && !info.authed) return lockScreen('login', info);
  // No password yet. On this machine that is fine; reachable from elsewhere it
  // is not, so insist on one before showing any figures.
  if (!info.enabled && info.exposed) return lockScreen('setup', info);
  startApp();
})();
