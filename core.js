// Live totals core. Pure functions, no DOM. Shared by the page, predict_cli.js and the parity test.
// Regulation: gamma blend of a prior and the current score, plus a (time left in game, |margin|) table that
// shifts the projection and supplies the residual quantiles. Overtime: a (time left in OT, |margin|) table
// of points still to come, including any further overtimes.
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  var i = 1; while (xs[i] < x) i++;
  var t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}
function elapsedMinutes(half, minLeft, secLeft) {
  var left = Math.min(1200, Math.max(0, minLeft * 60 + secLeft));
  return (half === 1 ? 1200 - left : 2400 - left) / 60;
}
function shareDone(P, el) { return interp(P.F.map(function (_, i) { return i / 2; }), P.F, el); }
function bilinear(LN, AN, l, a) {
  l = Math.min(LN[LN.length - 1], Math.max(LN[0], l)); a = Math.min(AN[AN.length - 1], Math.max(AN[0], a));
  var i = 0; while (i < LN.length - 2 && LN[i + 1] <= l) i++;
  var j = 0; while (j < AN.length - 2 && AN[j + 1] <= a) j++;
  var tl = (l - LN[i]) / (LN[i + 1] - LN[i]), ta = (a - AN[j]) / (AN[j + 1] - AN[j]);
  return function (f) { return f(i, j) * (1 - tl) * (1 - ta) + f(i + 1, j) * tl * (1 - ta) + f(i, j + 1) * (1 - tl) * ta + f(i + 1, j + 1) * tl * ta; };
}
function lookup(T, LN, AN, l, a, nq) {
  var mix = bilinear(LN, AN, l, a), q = [];
  for (var k = 0; k < nq; k++) q.push(mix(function (i, j) { return T.Q[i][j][k]; }));
  return { m: mix(function (i, j) { return T.M[i][j]; }), q: q };
}
function cdfResidual(P, q, x) {
  var L = P.q_levels.map(function (v) { return v / 100; });
  if (x <= q[0]) return 0.005;
  if (x >= q[q.length - 1]) return 0.995;
  return Math.min(0.995, Math.max(0.005, interp(q, L, x)));
}
function normCdf(z) {  // Abramowitz-Stegun 7.1.26 on erf; absolute error below 1.5e-7
  var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2), x = Math.abs(z) / Math.SQRT2;
  var e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
}
function interpCol(xs, rows, col, x) { return interp(xs, rows.map(function (r) { return r[col]; }), x); }
function probitAt(nodes, pc, x) {
  // Interpolate probit coefficients on the scale where uncertainty changes smoothly: 1/a^2 and b/a.
  var v = interp(nodes, pc.map(function (r) { return 1 / (r[0] * r[0]); }), x);
  var rr = interp(nodes, pc.map(function (r) { return r[1] / r[0]; }), x);
  var a = 1 / Math.sqrt(v); return [a, a * rr];
}
function winProb(P, inp, proj) {
  // Home win probability, projected final margin (home minus away) and each team's projected points.
  var W = P.wp; if (!W) return null;
  var d = inp.home - inp.away, useSpread = typeof inp.spread === 'number' && isFinite(inp.spread);
  var mode = useSpread ? 'B' : 'A', m0 = useSpread ? -inp.spread : (inp.neutral ? 0 : W.hca);
  var p, margin, mq = null, ab;
  if (inp.half === 3) {
    var O = W.ot, L = O.left_nodes, lt = Math.min(300, Math.max(0, inp.min * 60 + inp.sec));
    ab = probitAt(L, O[mode].probit, lt);
    p = (lt === 0 && d !== 0) ? (d > 0 ? 1 : 0) : normCdf(ab[0] * d + ab[1] * m0);
    margin = d + interpCol(L, O[mode].mw, 0, lt) * m0 + interpCol(L, O[mode].mw, 1, lt) * d;
  } else {
    var t = Math.min(2400, Math.max(0, elapsedMinutes(inp.half, inp.min, inp.sec) * 60)), T = W.t_nodes;
    ab = probitAt(T, W[mode].probit, t);
    p = (t >= 2400 && d !== 0) ? (d > 0 ? 1 : 0) : normCdf(ab[0] * d + ab[1] * m0);
    margin = d + interpCol(T, W[mode].mw, 0, t) * m0 + interpCol(T, W[mode].mw, 1, t) * d;
    mq = W.mq_levels.map(function (_, k) { return margin + interpCol(T, W[mode].mq, k, t); });
  }
  var lv = function (l) { return mq ? mq[W.mq_levels.indexOf(l)] : null; };
  return { pHome: p, margin: margin, m0: m0, mode: mode, margin80: mq ? [lv(10), lv(90)] : null,
           homePts: (proj + margin) / 2, awayPts: (proj - margin) / 2 };
}
function project(P, inp) {
  // inp: {home, away, half (1|2|3 = overtime), min, sec, pregame?, line?, league? (overrides the league prior),
  //       spread? (home team's pregame point spread, negative when home is favored), neutral? (true at a neutral site)}
  var S = inp.home + inp.away, am = Math.abs(inp.home - inp.away), nq = P.q_levels.length;
  var res, base, proj, q, lk;
  if (inp.half === 3) {
    var leftOt = Math.min(300, Math.max(0, inp.min * 60 + inp.sec));
    lk = lookup(P.ot.table, P.ot.left_nodes, P.ot.am_nodes, leftOt, am, nq);
    base = S; proj = S + lk.m; q = lk.q;
    var tie = lookup(P.ot.table, P.ot.left_nodes, P.ot.am_nodes, leftOt, 0, nq);
    res = { mode: 'OT', elapsed: 40, share: 1, prior: null, marginEffect: lk.m - tie.m, usesMargin: true };
  } else {
    var el = elapsedMinutes(inp.half, inp.min, inp.sec);
    var useUser = typeof inp.pregame === 'number' && isFinite(inp.pregame);
    var mode = useUser ? 'B' : 'A';
    var prior = useUser ? inp.pregame : (typeof inp.league === 'number' && isFinite(inp.league) ? inp.league : P.A.prior);
    var f = shareDone(P, el), k = P[mode].k;
    base = S + (1 - f) * (k * prior + S) / (k + f);
    var T = P.table, leftGame = 2400 - el * 60;
    lk = lookup(T.tables[mode], T.left_nodes, T.am_nodes, leftGame, am, nq);
    var even = lookup(T.tables[mode], T.left_nodes, T.am_nodes, leftGame, 0, nq);
    proj = base + lk.m; q = lk.q;
    res = { mode: mode, elapsed: el, share: f, prior: prior, marginEffect: lk.m - even.m, usesMargin: true };
  }
  var at = function (lv) { return q[P.q_levels.indexOf(lv)]; };
  res.projection = proj; res.score = S; res.base = base;
  res.median = base + at(50);
  res.i50 = [base + at(25), base + at(75)]; res.i80 = [base + at(10), base + at(90)]; res.i90 = [base + at(5), base + at(95)];
  if (typeof inp.line === 'number' && isFinite(inp.line)) {
    var line = inp.line, halfPt = Math.abs(line - Math.round(line)) > 0.01, over, under, push = 0;
    if (halfPt) { over = 1 - cdfResidual(P, q, line - base); under = 1 - over; }
    else { over = 1 - cdfResidual(P, q, line + 0.5 - base); under = cdfResidual(P, q, line - 0.5 - base); push = Math.max(0, 1 - over - under); }
    res.over = over; res.under = under; res.push = push;
  }
  res.win = winProb(P, inp, proj);
  return res;
}
function pregame(P, homeId, awayId, neutral) {
  // Pregame projection from the team ratings: possessions times each offense's adjusted points per 100 against that
  // defense. Totals and margins use separately tuned ratings; the margin's scale and home court come from the same
  // fit the win-probability model uses, so a matchup typed here behaves exactly like a pregame spread.
  var G = P.pregame; if (!G) return null;
  var row = function (id) { for (var i = 0; i < G.teams.length; i++) if (G.teams[i][0] === id) return G.teams[i]; return null; };
  var h = row(homeId), a = row(awayId); if (!h || !a || homeId === awayId) return null;
  var poss = G.tau + h[4] + a[4];
  var raw = (2 * G.mu + h[2] - a[3] + a[2] - h[3]) * poss / 100;
  var total = G.cal_a + G.cal_b * raw;
  var possM = G.tau_m + h[7] + a[7];
  var marginN = (h[5] - a[6] - a[5] + h[6]) * possM / 100;
  var margin = G.beta * marginN + (neutral ? 0 : G.hca);
  return { home: h[1], away: a[1], total: total, margin: margin, spread: -margin, possessions: poss,
           homePts: (total + margin) / 2, awayPts: (total - margin) / 2, pHome: normCdf(margin / G.sd_margin),
           sdTotal: G.sd_total, sdMargin: G.sd_margin,
           pOver: function (line) { return 1 - normCdf((line - total) / G.sd_total); } };
}
if (typeof module !== 'undefined') module.exports = { project: project, pregame: pregame, elapsedMinutes: elapsedMinutes, shareDone: shareDone };
