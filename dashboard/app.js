// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// arithmetic and the protocol's farm plan, the already-launched peers the model calibrates from, and
// the method page. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watch: false, sort: 'implied', tab: 'board', selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0') + 'x'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model in one function: the page recomputes a row from the figures data.js carries and the
  // detail view shows the result beside board.json's number, so the page and the board are visibly
  // the same arithmetic, not two copies that can drift.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.growth_multiplier * row.maturity_multiplier));
  }

  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var calibByCat = {};
  DATA.calibration.forEach(function (c) { calibByCat[c.category] = c; });

  /* ---------- header ---------- */
  var stats = document.getElementById('stats');
  [
    ['Ranked', String(DATA.board_size)],
    ['Watchlist', String(DATA.watchlist_size)],
    ['Early finds', String(DATA.early_size)],
    ['Global peer x', DATA.global_multiple.toFixed(3)],
    ['Snapshot', DATA.as_of]
  ].forEach(function (pair) {
    stats.appendChild(el('div', null, el('dt', { text: pair[0] }), el('dd', { text: pair[1] })));
  });
  document.getElementById('method-line').appendChild(document.createTextNode('implied value  =  TVL  x  '));
  var b = el('b', { text: 'peer multiple' });
  document.getElementById('method-line').appendChild(b);
  document.getElementById('method-line').appendChild(
    document.createTextNode(' (the category\u2019s median market cap / TVL among launched peers, shrunk to the global median)  x  growth  x  maturity   \u00b7   model ' + DATA.model_version)
  );

  /* ---------- filters ---------- */
  var catSel = document.getElementById('cat');
  catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
  var cats = {};
  DATA.rows.forEach(function (r) { if (r.category) cats[r.category] = true; });
  Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
  var chainSel = document.getElementById('chain');
  chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
  var chains = {};
  DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { chains[c] = true; }); });
  Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
      multiple: function (r) { return r.peer_multiple; }
    }[state.sort];
    rows.sort(function (a, c) { return key(c) - key(a) || (a.slug < c.slug ? -1 : 1); });
    return rows;
  }

  /* ---------- board ---------- */
  var body = document.getElementById('board-body');
  var count = document.getElementById('count');
  function renderBoard() {
    var rows = visibleRows();
    count.textContent = rows.length + ' of ' + DATA.board_size + ' protocols';
    body.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : null, onclick: function () { select(r.slug, true); } },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null,
          el('span', { class: 'name', text: r.name }),
          r.watchlist ? el('span', { class: 'wl', text: '\u25c6 watchlist' }) : null,
          el('span', { class: 'slug', text: r.slug })),
        el('td', { class: 'dim', text: r.category || 'Uncategorised' }),
        el('td', { class: 'dim', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      body.appendChild(tr);
    });
    if (rows.length === 0) {
      body.appendChild(el('tr', null, el('td', { class: 'dim', text: 'No protocol matches these filters.' })));
    }
  }

  /* ---------- detail ---------- */
  var detail = document.getElementById('detail');
  function select(slug, pushHash) {
    state.selected = slug;
    var r = bySlug[slug];
    renderBoard();
    if (!r) {
      detail.textContent = '';
      detail.appendChild(el('p', { class: 'empty', text: 'Pick a protocol on the board to see its value breakdown and farm plan.' }));
      return;
    }
    if (pushHash) history.replaceState(null, '', '#slug=' + encodeURIComponent(slug));
    var calib = r.category ? calibByCat[r.category] : null;
    var check = impliedOf(r);
    var drift = Math.abs(check - r.implied_value_usd) / r.implied_value_usd;
    detail.textContent = '';
    detail.appendChild(el('h2', { text: r.name }));
    detail.appendChild(el('p', { class: 'dslug', text: r.slug + ' \u00b7 rank #' + r.rank + (r.watchlist ? ' \u00b7 \u25c6 on the snapshot watchlist' : ' \u00b7 early find below the watchlist floor') }));
    detail.appendChild(el('p', { class: 'big', text: fmtUsd(r.implied_value_usd) }));
    detail.appendChild(el('p', { class: 'big-label', text: 'Implied value if the record stayed as it is' }));
    var factors = el('table', { class: 'factors' },
      el('tr', null, el('td', { text: 'TVL (snapshot)' }), el('td', { text: fmtUsd(r.tvl_usd) })),
      el('tr', null, el('td', { text: 'Peer multiple \u2014 ' + (r.category || 'uncategorised') }), el('td', { text: fmtMult(r.peer_multiple) })),
      el('tr', null, el('td', { text: 'Launched peers behind it' }), el('td', { text: r.peer_count === 0 ? 'none \u2014 global median' : r.peer_count + (calib ? ', median ' + fmtMult(calib.median_multiple) : '') })),
      el('tr', null, el('td', { text: 'Growth factor (7d ' + fmtPct(r.change_7d) + ')' }), el('td', { text: 'x' + r.growth_multiplier.toFixed(3) })),
      el('tr', null, el('td', { text: 'Maturity factor (age ' + fmtAge(r.age_days) + ')' }), el('td', { text: 'x' + r.maturity_multiplier.toFixed(3) })),
      el('tr', null, el('td', { text: 'Chains' }), el('td', { text: r.chains.join(', ') || 'n/a' })),
      el('tr', null, el('td', { text: 'Tracked since' }), el('td', { text: r.listed_at || 'not recorded' })));
    detail.appendChild(factors);
    detail.appendChild(el('p', { class: 'why', text:
      'The page recomputes this row from its own figures as ' + fmtUsd(check) +
      (drift < 0.005 ? ', the same value board.json carries.' : ' (board.json carries ' + fmtUsd(r.implied_value_usd) + '; the small gap is the rounding of the printed factors).') +
      ' Nothing about ' + r.name + ' itself is in the formula: every ' + (r.category || 'uncategorised') + ' protocol is scored with the same multiple.' }));
    detail.appendChild(el('h3', { text: 'Farm plan' }));
    var plan = el('ol', { class: 'plan' });
    r.farm_steps.forEach(function (s) { plan.appendChild(el('li', { text: s })); });
    detail.appendChild(plan);
  }

  /* ---------- live view ---------- */
  var liveBody = document.getElementById('live-body');
  DATA.live.forEach(function (r) {
    liveBody.appendChild(el('tr', null,
      el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'slug', text: r.slug })),
      el('td', { class: 'dim', text: r.category || 'Uncategorised' }),
      el('td', { class: 'dim', text: r.chains.slice(0, 3).join(', ') }),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
      el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a' }),
      el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })));
  });

  /* ---------- method view ---------- */
  var method = document.getElementById('method-body');
  method.appendChild(el('h2', { text: 'How this board is built' }));
  method.appendChild(el('p', { text: 'The board ranks every protocol in the sealed snapshot that records no token and is not a product of one that trades, and it ranks them by one number: the implied value, what a token would be worth if the protocol\u2019s record stayed exactly as the snapshot froze it. It is a statement about the record, never a prediction that a token will be issued.' }));
  method.appendChild(el('div', { class: 'formula', text: 'implied = TVL x peer multiple(category) x growth(7d change) x maturity(age without a token)' }));
  method.appendChild(el('h3', { text: 'The peer multiple: calibrated, not chosen' }));
  method.appendChild(el('p', { text: 'A flat multiple pretends a lending market and a prediction market launch at the same price. This model instead reads the snapshot\u2019s own launched protocols: for each category it takes the median market cap to TVL ratio of the peers that already trade, then shrinks that median toward the global median (' + DATA.global_multiple.toFixed(3) + 'x) by the peer count, with a weight of ' + M.shrink_k + ' on the global figure. A category with eleven launched peers mostly trusts its own median; a category with one is pulled most of the way to the market\u2019s. The result is clamped between ' + M.multiple_floor + 'x and ' + M.multiple_cap + 'x so a single rich or broken peer cannot carry a category away.' }));
  method.appendChild(el('h3', { text: 'Growth and maturity' }));
  method.appendChild(el('p', { text: 'Growth multiplies by 1 + clamp(7d change, ' + M.growth_floor + '%, +' + M.growth_cap + '%) x ' + M.growth_weight + '; a protocol with no reported change is scored neutral. Maturity runs from ' + M.maturity_floor + ' to ' + (M.maturity_floor + M.maturity_range).toFixed(2) + ' on a square-root curve over ' + M.maturity_days + ' days: a protocol that has run for years with no token has had every chance to issue one and still built its record, so the model trusts its TVL more. A missing listing date is scored at the pre-token median age, ' + DATA.median_age_days + ' days, itself read from the snapshot.' }));
  method.appendChild(el('h3', { text: 'Who is on the board, and who is not' }));
  method.appendChild(el('p', { text: 'Every watchlist protocol is ranked: the watchlist is the floor. Below it, the radar applies the watchlist\u2019s own rule to the whole snapshot: no token recorded, the name carries no version marker and no whole word wrapped, staked or staking, the protocol does not begin with an exchange\u2019s name, and its category is not CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking or Restaked BTC. Those categories are products issued against a token that already trades (WBTC and USDT0 sit in Bridge), so their TVL is that token\u2019s footprint, not a launch waiting to happen. Already-launched protocols are never ranked; they are the calibration set, on the Already launched tab.' }));
  method.appendChild(el('h3', { text: 'Farm plans' }));
  method.appendChild(el('p', { text: 'Each row\u2019s plan is generated from its own record: the category picks the playbook (supply and borrow for lending, liquidity and swaps for a DEX, bridge and use for a chain), the first chain sets the gas band a farmer actually pays there, the TVL sets the position size, and the age sets the holding window. Every step names its cost and its time. Two rules hold for all of them: use a fresh wallet, and never pay a fee to claim an airdrop.' }));
  method.appendChild(el('h3', { text: 'Calibration table (from this snapshot)' }));
  var calTable = el('table', { class: 'board' },
    el('thead', null, el('tr', null,
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Launched peers' }),
      el('th', { class: 'num', text: 'Median MCap / TVL' }), el('th', { class: 'num', text: 'Multiple in use' }))));
  var calBody = el('tbody', null);
  DATA.calibration.forEach(function (c) {
    calBody.appendChild(el('tr', null,
      el('td', { text: c.category }),
      el('td', { class: 'num', text: String(c.peers) }),
      el('td', { class: 'num', text: fmtMult(c.median_multiple) }),
      el('td', { class: 'num', text: fmtMult(c.used_multiple) })));
  });
  calTable.appendChild(calBody);
  method.appendChild(calTable);
  method.appendChild(el('p', { text: 'Source: ' + DATA.source + ' \u00b7 as of ' + DATA.as_of + ' \u00b7 watchlist floor ' + fmtUsd(DATA.floor_usd) + ' TVL \u00b7 model ' + DATA.model_version + '.' }));

  /* ---------- tabs and events ---------- */
  var tabs = document.getElementById('tabs');
  function showTab(tab) {
    state.tab = tab;
    ['board', 'live', 'method'].forEach(function (t) {
      document.getElementById('view-' + t).hidden = t !== tab;
    });
    tabs.querySelectorAll('button').forEach(function (btn) {
      btn.className = btn.getAttribute('data-tab') === tab ? 'on' : '';
    });
  }
  tabs.querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', function () { showTab(btn.getAttribute('data-tab')); });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });

  /* ---------- hash state: #slug=, #cat=, #tab= make every view linkable and screenshot-able ---------- */
  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
    var at = pair.indexOf('=');
    if (at > 0) hash[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(pair.slice(at + 1));
  });
  if (hash.cat && cats[hash.cat]) { state.category = hash.cat; catSel.value = hash.cat; }
  if (hash.tab === 'live' || hash.tab === 'method') showTab(hash.tab);
  renderBoard();
  var initial = hash.slug && bySlug[hash.slug] ? hash.slug : null;
  if (initial === null && hash.cat) { var first = visibleRows()[0]; initial = first ? first.slug : null; }
  if (initial === null && DATA.rows[0]) initial = DATA.rows[0].slug;
  select(initial, false);
})();
