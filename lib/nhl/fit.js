/* ============================================================
   NHL — ajuste de ratings por rival. Usado SOLO por scripts
   (build-nhl-priors, nhl-backtest); nunca se carga en runtime del
   API. Mismo patrón que lib/nba/fit.js, en escala log (Poisson):

     λ_local  = exp(mu + hfa/2 + att[h] − def[a] + adj_h)
     λ_visita = exp(mu − hfa/2 + att[a] − def[h] + adj_a)

   El objetivo de cada lado es el MISMO que usa el aprendizaje en
   línea (core.targetOf): goles reglamentarios sin puerta vacía,
   mezclados con los "merecidos" por tiros. att/def se resuelven por
   ajuste proporcional iterativo (la solución de máxima verosimilitud
   Poisson) con encogimiento de REG_W pseudo-juegos hacia el promedio;
   mu y hfa en forma cerrada cada vuelta (lección MX/NFL: no moverlos
   por gradiente junto con los ratings).
   ============================================================ */
const { targetOf, shotsOf, cleanGoals, DEFAULTS } = require('./core');

const HALF_LIFE_DAYS = 300;  // la temporada anterior pesa ~½
const PLAYOFF_W = 0.8;       // playoffs pesan menos (series contra el mismo rival, otro hockey)
const REG_W = 10;            // pseudo-juegos hacia el promedio

function gameWeight(g, asOfMs, halfLife) {
  const days = Math.max(0, (asOfMs - new Date(g.date).getTime()) / 86400000);
  let w = Math.pow(0.5, days / (halfLife || HALF_LIFE_DAYS));
  if (g.seasontype === 3) w *= PLAYOFF_W;
  return w;
}

/* conversión de liga: goles limpios por tiro, para cada definición de tiro */
function leagueConv(games, asOfMs, halfLife) {
  const acc = { sog: [0, 0], fen: [0, 0], cor: [0, 0] };
  for (const g of games) {
    const w = asOfMs ? gameWeight(g, asOfMs, halfLife) : 1;
    for (const [s, o] of [[g.home, g.away], [g.away, g.home]]) {
      for (const k in acc) { const sh = shotsOf(s, o, k); if (sh != null) { acc[k][0] += w * cleanGoals(s, 1); acc[k][1] += w * sh; } }
    }
  }
  const out = {};
  for (const k in acc) out[k] = acc[k][1] > 0 ? +(acc[k][0] / acc[k][1]).toFixed(5) : null;
  return out;
}

/* games: [{date, seasontype, neutral, home:{abbr, reg, en, sog…}, away,
   adj?: {home, away} (offset log conocido de cada lado)}]
   Devuelve { ratings: {abbr:{att,def}}, mu, hfa, conv, diag } */
function fitRatings(games, { asOf, halfLife, params, iters = 300 } = {}) {
  const asOfMs = asOf || Date.now();
  const P = Object.assign({}, DEFAULTS, params || {});
  const conv = leagueConv(games, asOfMs, halfLife);
  const L0 = { conv };
  const rows = [];
  for (const g of games) {
    if (g.home.reg == null || g.away.reg == null || !g.home.abbr || !g.away.abbr) continue;
    const adj = g.adj || { home: 0, away: 0 };
    rows.push({
      h: g.home.abbr, a: g.away.abbr,
      yh: targetOf(g.home, g.away, L0, P), ya: targetOf(g.away, g.home, L0, P),
      oh: Math.exp(adj.home || 0), oa: Math.exp(adj.away || 0),
      hf: g.neutral ? 0 : 1,
      w: gameWeight(g, asOfMs, halfLife),
    });
  }
  if (!rows.length) throw new Error('fitRatings: sin juegos');
  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];
  const att = {}, def = {};
  for (const t of teams) { att[t] = 0; def[t] = 0; }
  let mu = Math.log(2.8), hfa = 0.05;

  const lam = r => [
    r.oh * Math.exp(mu + r.hf * hfa / 2 + att[r.h] - def[r.a]),
    r.oa * Math.exp(mu - r.hf * hfa / 2 + att[r.a] - def[r.h]),
  ];
  for (let it = 0; it < iters; it++) {
    // mu y hfa en forma cerrada (dos pasadas cortas)
    for (let k = 0; k < 3; k++) {
      let sy = 0, sl = 0, syh = 0, slh = 0, sya = 0, sla = 0;
      for (const r of rows) {
        const [lh, la] = lam(r);
        sy += r.w * (r.yh + r.ya); sl += r.w * (lh + la);
        if (r.hf) { syh += r.w * r.yh; slh += r.w * lh; sya += r.w * r.ya; sla += r.w * la; }
      }
      mu += Math.log(sy / sl);
      if (slh > 0 && sla > 0) hfa += Math.log((syh / slh) / (sya / sla));
    }
    let maxD = 0;
    const m = Math.exp(mu);
    for (const t of teams) {
      let num = REG_W * m, den = REG_W * m;
      for (const r of rows) {
        if (r.h === t) { num += r.w * r.yh; den += r.w * r.oh * Math.exp(mu + r.hf * hfa / 2 - def[r.a]); }
        if (r.a === t) { num += r.w * r.ya; den += r.w * r.oa * Math.exp(mu - r.hf * hfa / 2 - def[r.h]); }
      }
      const nv = Math.log(num / den); maxD = Math.max(maxD, Math.abs(nv - att[t])); att[t] = nv;
    }
    for (const t of teams) {
      let num = REG_W * m, den = REG_W * m;
      for (const r of rows) {
        if (r.a === t) { num += r.w * r.yh; den += r.w * r.oh * Math.exp(mu + r.hf * hfa / 2 + att[r.h]); }
        if (r.h === t) { num += r.w * r.ya; den += r.w * r.oa * Math.exp(mu - r.hf * hfa / 2 + att[r.a]); }
      }
      const nv = -Math.log(num / den); maxD = Math.max(maxD, Math.abs(nv - def[t])); def[t] = nv;
    }
    const mA = teams.reduce((s, t) => s + att[t], 0) / teams.length;
    const mD = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const t of teams) { att[t] -= mA; def[t] -= mD; }
    mu += mA - mD;
    if (it > 10 && maxD < 1e-7) break;
  }
  const ratings = {};
  for (const t of teams) ratings[t] = { att: +att[t].toFixed(4), def: +def[t].toFixed(4) };
  return { ratings, mu: +mu.toFixed(4), hfa: +hfa.toFixed(4), conv, diag: { games: rows.length, teams: teams.length, goals_per_team: +Math.exp(mu).toFixed(3) } };
}

module.exports = { fitRatings, gameWeight, leagueConv, HALF_LIFE_DAYS, REG_W, PLAYOFF_W };
