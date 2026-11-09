// MBKB Live: live scores from a scoreboard feed, projected with the MBKB model (core.js + params.json).
// Score source: ESPN's public scoreboard by default. Set localStorage "mbkb.src" (or SRC below) to a relay URL that
// returns the same JSON if the phone cannot reach ESPN directly.
'use strict';
var SRC = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
var POLL_MS = 30000;

var P = null, games = [], filter = 'all', query = '', day = new Date(), timer = null, lastOk = null, loading = false;
var store = loadStore(); pruneStore();

function $(id) { return document.getElementById(id); }
function loadStore() {
  try { return JSON.parse(localStorage.getItem('mbkb.v1')) || { lines: {}, star: {} }; } catch (e) { return { lines: {}, star: {} }; }
}
function rememberLine(id, mk) {
  store.mkt = store.mkt || {};
  var old = store.mkt[id];
  if (!old || old.total !== mk.total || old.spread !== mk.spread) { store.mkt[id] = { total: mk.total, spread: mk.spread, t: Date.now() }; saveStore(); }
}
function pruneStore() {
  var cut = Date.now() - 14 * 864e5;
  Object.keys(store.mkt || {}).forEach(function (k) { if ((store.mkt[k].t || 0) < cut) delete store.mkt[k]; });
}
function saveStore() { try { localStorage.setItem('mbkb.v1', JSON.stringify(store)); } catch (e) {} }
function source() { try { return localStorage.getItem('mbkb.src') || SRC; } catch (e) { return SRC; } }
function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
function isToday(d) { return ymd(d) === ymd(new Date()); }
function num(x) { var v = parseFloat(x); return isFinite(v) ? v : null; }
function f1(x) { return x == null ? '–' : x.toFixed(1); }
function pct(x) { return x > 0.995 ? '>99%' : x < 0.005 ? '<1%' : Math.round(x * 100) + '%'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ---------------------------------------------------------------- feed parsing
function parseSpread(details, home, away) {
  // "DUKE -7.5" -> home team's spread (negative when home is favored). "EVEN"/"PK" -> 0.
  if (!details) return null;
  var t = String(details).trim();
  if (/^(even|pk|pick)/i.test(t)) return 0;
  var m = t.match(/^(.*\S)\s+([+-]?\d+(?:\.\d+)?)$/); if (!m) return null;
  var who = m[1].toUpperCase(), v = parseFloat(m[2]);
  var hk = [home.abbr, home.short, home.name].map(function (s) { return String(s || '').toUpperCase(); });
  var ak = [away.abbr, away.short, away.name].map(function (s) { return String(s || '').toUpperCase(); });
  if (hk.indexOf(who) >= 0) return v;
  if (ak.indexOf(who) >= 0) return -v;
  return null;
}
function oddsOf(o, home, away) {
  // ESPN odds object -> {total, spread (home team's, negative when home is favored)}. null if it has neither.
  if (!o) return null;
  var total = num(o.overUnder), spread = num(o.spread);
  if (spread == null) spread = parseSpread(o.details, home, away);
  return total == null && spread == null ? null : { total: total, spread: spread };
}
function parseEvent(ev) {
  var c = (ev.competitions || [])[0]; if (!c) return null;
  var side = function (ha) {
    var x = (c.competitors || []).filter(function (t) { return t.homeAway === ha; })[0]; if (!x) return null;
    var tm = x.team || {}, rk = x.curatedRank && x.curatedRank.current;
    return { id: parseInt(tm.id, 10), name: tm.location || tm.shortDisplayName || tm.displayName || '?', short: tm.shortDisplayName,
             abbr: tm.abbreviation, score: num(x.score) || 0, rank: rk && rk < 99 ? rk : null };
  };
  var home = side('home'), away = side('away'); if (!home || !away) return null;
  var st = ev.status || c.status || {}, ty = st.type || {};
  var mk = oddsOf((c.odds || [])[0], home, away);
  if (mk) rememberLine(String(ev.id), mk);  // the feed drops lines at tip-off, so keep the pregame one
  else mk = (store.mkt || {})[String(ev.id)] || null;
  return {
    id: String(ev.id), start: new Date(ev.date), state: ty.state || 'pre', period: st.period || 0, clock: num(st.clock) || 0,
    detail: ty.shortDetail || ty.detail || '', halftime: ty.name === 'STATUS_HALFTIME', neutral: !!c.neutralSite,
    home: home, away: away, mktTotal: mk ? num(mk.total) : null, mktSpread: mk ? num(mk.spread) : null
  };
}

// ---------------------------------------------------------------- model
function pregameFor(g) { return P && P.pregame ? pregame(P, g.home.id, g.away.id, g.neutral) : null; }
function settings(g) {
  // Pregame total and spread: your own numbers first, then the posted market line, then the model's.
  var u = store.lines[g.id] || {}, pg = pregameFor(g);
  var total = num(u.total) != null ? num(u.total) : (g.mktTotal != null ? g.mktTotal : (pg ? pg.total : null));
  var spread = num(u.spread) != null ? num(u.spread) : (g.mktSpread != null ? g.mktSpread : (pg ? pg.spread : null));
  var line = num(u.line) != null ? num(u.line) : g.mktTotal;
  return { pg: pg, total: total, spread: spread, line: line, own: u };
}
function liveProjection(g, s) {
  var half = g.period >= 3 ? 3 : Math.max(1, g.period), left = Math.max(0, g.clock);
  if (g.halftime) { half = 1; left = 0; }
  var inp = { home: g.home.score, away: g.away.score, half: half, min: Math.floor(left / 60), sec: left - 60 * Math.floor(left / 60), neutral: g.neutral };
  if (s.total != null) inp.pregame = s.total;
  if (s.spread != null) inp.spread = s.spread;
  if (s.line != null) inp.line = s.line;
  return project(P, inp);
}

// ---------------------------------------------------------------- rendering
function clockText(g) {
  if (g.state === 'pre') return g.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return g.detail || (g.state === 'post' ? 'Final' : '');
}
function teamRow(t, lead) {
  return '<div class="team' + (lead ? ' lead' : '') + '">' + (t.rank ? '<span class="rk">' + t.rank + '</span>' : '') +
    '<span class="nm">' + esc(t.name) + '</span><span class="sc">' + (t.scoreShown ? t.score : '') + '</span></div>';
}
function cell(k, v, cls) { return '<div><div class="k">' + k + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div></div>'; }
function card(g) {
  var s = settings(g), live = g.state === 'in', show = g.state !== 'pre';
  g.home.scoreShown = g.away.scoreShown = show;
  var h = '<div class="card" data-id="' + esc(g.id) + '"><div class="row"><div class="teams">' +
    teamRow(g.away, show && g.away.score > g.home.score) + teamRow(g.home, show && g.home.score > g.away.score) +
    '</div><div class="clock' + (live ? ' live' : '') + '">' + esc(clockText(g)) + '</div>' +
    '<button class="star' + (store.star[g.id] ? ' on' : '') + '" data-star="' + esc(g.id) + '" aria-label="Follow">&#9733;</button></div>';
  var cells = [];
  if (P && live) {
    var r = liveProjection(g, s), w = r.win;
    cells.push(cell('Projected total', f1(r.projection) + ' <small>' + Math.round(r.i80[0]) + '–' + Math.round(r.i80[1]) + '</small>'));
    if (r.over != null) cells.push(cell('vs ' + s.line, '<span class="' + (r.over >= 0.5 ? 'over' : 'under') + '">' + (r.over >= 0.5 ? 'Over ' + pct(r.over) : 'Under ' + pct(r.under)) + '</span>'));
    else cells.push(cell('Line', '<small>tap to add</small>'));
    if (w) {
      var hp = w.pHome, fav = hp >= 0.5 ? g.home : g.away;
      cells.push(cell('Win', esc(fav.abbr || fav.name) + ' ' + pct(Math.max(hp, 1 - hp))));
      cells.push(cell('Proj. final', esc(g.away.abbr || '') + ' ' + Math.round(w.awayPts) + ' – ' + Math.round(w.homePts) + ' ' + esc(g.home.abbr || ''), 'fit'));
    }
  } else if (g.state === 'pre') {
    var pg = s.pg;
    cells.push(cell('Model total', pg ? f1(pg.total) : '<small>n/a</small>'));
    cells.push(cell('Market', g.mktTotal != null ? f1(g.mktTotal) : '<small>none yet</small>'));
    if (pg) {
      var fv = pg.margin >= 0 ? g.home : g.away;
      cells.push(cell('Model spread', esc(fv.abbr || fv.name) + ' -' + Math.abs(pg.margin).toFixed(1)));
      cells.push(cell('Win', esc(fv.abbr || fv.name) + ' ' + pct(Math.max(pg.pHome, 1 - pg.pHome))));
    }
  } else if (g.state === 'post') {
    var tot = g.home.score + g.away.score;
    cells.push(cell('Final total', String(tot)));
    if (s.line != null) cells.push(cell('vs ' + s.line, tot > s.line ? '<span class="over">Over</span>' : tot < s.line ? '<span class="under">Under</span>' : 'Push'));
  }
  if (cells.length) h += '<div class="proj">' + cells.join('') + '</div>';
  return h + '</div>';
}
function visible() {
  var q = query.trim().toLowerCase();
  return games.filter(function (g) {
    if (filter === 'star' && !store.star[g.id]) return false;
    if (filter !== 'all' && filter !== 'star' && g.state !== filter) return false;
    if (q && (g.home.name + ' ' + g.away.name + ' ' + (g.home.abbr || '') + ' ' + (g.away.abbr || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) {
    var o = { in: 0, pre: 1, post: 2 };
    return (store.star[b.id] ? 1 : 0) - (store.star[a.id] ? 1 : 0) || o[a.state] - o[b.state] || a.start - b.start;
  });
}
function render() {
  $('dayLbl').textContent = isToday(day) ? 'Today' : day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  var v = visible();
  $('list').innerHTML = v.length ? v.map(card).join('') : '<div class="empty">' + (loading ? 'Loading games…' : 'No games here.') + '</div>';
  var nLive = games.filter(function (g) { return g.state === 'in'; }).length;
  $('status').textContent = games.length + ' games' + (nLive ? ' · ' + nLive + ' live' : '') +
    (lastOk ? ' · updated ' + lastOk.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '');
  $('foot').textContent = P ? 'Model ' + P.version + ' · projections are estimates, not guarantees' : '';
}

// ---------------------------------------------------------------- data
function load() {
  loading = true; render();
  var url = source() + (source().indexOf('?') >= 0 ? '&' : '?') + 'dates=' + ymd(day) + '&groups=50&limit=400';
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
  }).then(function (j) {
    games = (j.events || []).map(parseEvent).filter(Boolean);
    lastOk = new Date(); $('banner').hidden = true;
    fillMissingLines();
  }).catch(function (e) {
    $('banner').hidden = false;
    $('banner').textContent = 'Could not load live scores (' + e.message + '). If this keeps happening, the score feed is blocking the app and needs the relay.';
  }).then(function () { loading = false; render(); schedule(); });
}
var asked = {};
function fillMissingLines() {
  // Games already underway lost their line in the scoreboard: look it up once from ESPN's game summary.
  var need = games.filter(function (g) { return g.state !== 'pre' && g.mktTotal == null && !asked[g.id]; }).slice(0, 12);
  if (!need.length) return;
  var base = source().replace(/scoreboard(\?.*)?$/, 'summary');
  Promise.all(need.map(function (g) {
    asked[g.id] = 1;
    return fetch(base + '?event=' + g.id).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var mk = j && oddsOf((j.pickcenter || [])[0], g.home, g.away);
      if (mk) { rememberLine(g.id, mk); g.mktTotal = num(mk.total); g.mktSpread = num(mk.spread); }
    }).catch(function () {});
  })).then(render);
}
function schedule() {
  clearTimeout(timer);
  var soon = games.some(function (g) { return g.state === 'in' || (g.state === 'pre' && g.start - Date.now() < 15 * 60000); });
  if (document.visibilityState === 'visible' && isToday(day) && soon) timer = setTimeout(load, POLL_MS);
}
function loadParams() {
  return fetch('params.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) { P = j; })
    .catch(function () { $('banner').hidden = false; $('banner').textContent = 'Could not load the model. Projections are unavailable.'; });
}

// ---------------------------------------------------------------- game sheet
function openSheet(id) {
  var g = games.filter(function (x) { return x.id === id; })[0]; if (!g) return;
  var s = settings(g), u = s.own, pg = s.pg;
  var mk = g.mktSpread == null ? '–' : (g.mktSpread <= 0 ? (g.home.abbr || g.home.name) + ' ' + f1(g.mktSpread) : (g.away.abbr || g.away.name) + ' ' + f1(-g.mktSpread));
  var md = pg ? ((pg.margin >= 0 ? (g.home.abbr || g.home.name) : (g.away.abbr || g.away.name)) + ' -' + Math.abs(pg.margin).toFixed(1)) : '–';
  $('sheet').innerHTML = '<h2>' + esc(g.away.name) + ' at ' + esc(g.home.name) + '</h2>' +
    '<div class="sub">' + esc(clockText(g)) + (g.neutral ? ' · neutral site' : '') + '</div>' +
    '<div class="cmp"><div><span>Model total</span><b>' + (pg ? f1(pg.total) : '–') + '</b></div>' +
    '<div><span>Market total</span><b>' + f1(g.mktTotal) + '</b></div>' +
    '<div><span>Model spread</span><b>' + esc(md) + '</b></div>' +
    '<div><span>Market spread</span><b>' + esc(mk) + '</b></div></div>' +
    '<div class="fields">' +
    '<label class="wide">Your over/under line (blank = market)<input name="line" type="number" inputmode="decimal" step="0.5" value="' + esc(u.line == null ? '' : u.line) + '"></label>' +
    '<label>Pregame total (blank = market, else model)<input name="total" type="number" inputmode="decimal" step="0.5" value="' + esc(u.total == null ? '' : u.total) + '"></label>' +
    '<label>Home spread, e.g. -6.5<input name="spread" type="text" autocomplete="off" value="' + esc(u.spread == null ? '' : u.spread) + '"></label>' +
    '</div><div class="actions"><button value="clear">Clear</button><button value="cancel">Cancel</button><button value="save" class="pri">Save</button></div>';
  var dlg = $('dlg');
  dlg.onclose = function () {
    if (dlg.returnValue === 'save') {
      var f = $('sheet'), o = {};
      ['line', 'total', 'spread'].forEach(function (k) { var v = num(f.elements[k].value); if (v != null) o[k] = v; });
      if (Object.keys(o).length) store.lines[id] = o; else delete store.lines[id];
      saveStore();
    } else if (dlg.returnValue === 'clear') { delete store.lines[id]; saveStore(); }
    render();
  };
  dlg.returnValue = ''; dlg.showModal();
}

// ---------------------------------------------------------------- wiring
$('list').addEventListener('click', function (e) {
  var st = e.target.closest('[data-star]');
  if (st) { var id = st.getAttribute('data-star'); if (store.star[id]) delete store.star[id]; else store.star[id] = 1; saveStore(); render(); return; }
  var c = e.target.closest('.card'); if (c) openSheet(c.getAttribute('data-id'));
});
$('filters').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  filter = b.getAttribute('data-f');
  Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
  render();
});
$('search').addEventListener('input', function () { query = this.value; render(); });
$('refresh').addEventListener('click', load);
$('prev').addEventListener('click', function () { day = new Date(day.getTime() - 864e5); games = []; load(); });
$('next').addEventListener('click', function () { day = new Date(day.getTime() + 864e5); games = []; load(); });
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); else clearTimeout(timer); });

loadParams().then(load);
