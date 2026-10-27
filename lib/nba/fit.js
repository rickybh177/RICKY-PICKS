/* ============================================================
   NBA — ajuste de ratings por rival. Usado SOLO por scripts
   (build-nba-priors, nba-backtest); nunca se carga en runtime del
   API. Mismo patrón que lib/nfl/fit.js, con la diferencia de que el
   básquet se separa en RITMO y EFICIENCIA:

   posesiones del juego  poss = P + pace[h] + pace[a]
   eficiencia (pts/100)  ortg_local  = mu + hfa/2 + off[h] − def[a] + ajustes
                         ortg_visita = mu − hfa/2 + off[a] − def[h] + ajustes
   puntos esperados      E = poss · ortg / 100

   off = puntos por 100 posesiones que mete vs promedio; def = los que
   QUITA vs promedio (positivo = buena defensa). Los ajustes son
   offsets conocidos por juego (descanso, ausencias) con coeficientes
   que el backtest fija; aquí se restan antes de ajustar off/def para
   que los ratings sean "a plantel completo y descansado".

   Lección del fitter MX/NFL: mu y hfa NO se mueven por gradiente
   junto con off/def (colinealidad): dados off/def se resuelven en
   forma cerrada cada iteración; off/def por descenso coordenado con
   regularización ridge (REG_W pseudo-juegos hacia 0).
   ============================================================ */

const HALF_LIFE_DAYS = 365;  // la temporada anterior pesa ~½ (rosters rotan mucho en la NBA)
const PLAYOFF_W = 0.8;       // playoffs pesan menos (rotaciones cortas, matchups extremos)
const REG_W = 8;             // pseudo-juegos hacia 0
const LG_POSS_FALLBACK = 99; // si un juego no trae boxscore

function gameWeight(g, asOfMs, halfLife) {
  const days = Math.max(0, (asOfMs - new Date(g.date).getTime()) / 86400000);
  let w = Math.pow(0.5, days / (halfLife || HALF_LIFE_DAYS));
  if (g.seasontype === 3) w *= PLAYOFF_W;
  return w;
}

/* posesiones del juego (promedio de los dos equipos) */
function gamePoss(g) {
  const ph = g.home.poss, pa = g.away.poss;
  if (ph != null && pa != null && ph > 60 && pa > 60) return (ph + pa) / 2;
  if (ph != null && ph > 60) return ph;
  if (pa != null && pa > 60) return pa;
  return null;
}

/* games: [{date, seasontype, neutral, home:{abbr,score,poss}, away:{…},
   adj?: {home, away} (offset conocido en pts/100 para cada lado)}]
   Devuelve { ratings: {abbr:{off,def,pace}}, mu, hfa, poss, diag } */
function fitRatings(games, { asOf, halfLife, iters = 200 } = {}) {
  const asOfMs = asOf || Date.now();
  const rows = [];
  for (const g of games) {
    if (g.home.score == null || g.away.score == null || !g.home.abbr || !g.away.abbr) continue;
    const poss = gamePoss(g) || LG_POSS_FALLBACK;
    const adj = g.adj || { home: 0, away: 0 };
    rows.push({
      h: g.home.abbr, a: g.away.abbr,
      poss, hasPoss: gamePoss(g) != null,
      oh: 100 * g.home.score / poss - (adj.home || 0),
      oa: 100 * g.away.score / poss - (adj.away || 0),
      hfaOn: g.neutral ? 0 : 1,
      w: gameWeight(g, asOfMs, halfLife),
    });
  }
  if (!rows.length) throw new Error('fitRatings: sin juegos');

  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];
  const off = {}, def = {}, pace = {};
  for (const t of teams) { off[t] = 0; def[t] = 0; pace[t] = 0; }
  let mu = 112, hfa = 2.5, P = 99;

  const solveMuHfa = () => {
    let sW = 0, sWh = 0, sWhh = 0, sR = 0, sRh = 0;
    for (const r of rows) {
      const bh = off[r.h] - def[r.a], ba = off[r.a] - def[r.h];
      sW += r.w; sWh += r.w * (r.hfaOn / 2); sWhh += r.w * (r.hfaOn / 2) ** 2;
      sR += r.w * (r.oh - bh); sRh += r.w * (r.oh - bh) * (r.hfaOn / 2);
      sW += r.w; sWh += r.w * (-r.hfaOn / 2); sWhh += r.w * (r.hfaOn / 2) ** 2;
      sR += r.w * (r.oa - ba); sRh += r.w * (r.oa - ba) * (-r.hfaOn / 2);
    }
    const det = sW * sWhh - sWh * sWh;
    if (Math.abs(det) > 1e-9) { mu = (sR * sWhh - sRh * sWh) / det; hfa = (sW * sRh - sWh * sR) / det; }
  };

  for (let it = 0; it < iters; it++) {
    solveMuHfa();
    let maxD = 0;
    for (const t of teams) {
      let num = 0, den = REG_W;
      for (const r of rows) {
        if (r.h === t) { num += r.w * (r.oh - mu - (r.hfaOn * hfa) / 2 + def[r.a]); den += r.w; }
        if (r.a === t) { num += r.w * (r.oa - mu + (r.hfaOn * hfa) / 2 + def[r.h]); den += r.w; }
      }
      const nv = num / den; maxD = Math.max(maxD, Math.abs(nv - off[t])); off[t] = nv;
    }
    for (const t of teams) {
      let num = 0, den = REG_W;
      for (const r of rows) {
        if (r.a === t) { num += r.w * (mu + (r.hfaOn * hfa) / 2 + off[r.h] - r.oh); den += r.w; }
        if (r.h === t) { num += r.w * (mu - (r.hfaOn * hfa) / 2 + off[r.a] - r.oa); den += r.w; }
      }
      const nv = num / den; maxD = Math.max(maxD, Math.abs(nv - def[t])); def[t] = nv;
    }
    const mO = teams.reduce((s, t) => s + off[t], 0) / teams.length;
    const mD = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const t of teams) { off[t] -= mO; def[t] -= mD; }
    mu += mO - mD;
    if (it > 10 && maxD < 1e-6) break;
  }
  solveMuHfa();

  /* ritmo: poss = P + pace[h] + pace[a], solo juegos con boxscore */
  const prow = rows.filter(r => r.hasPoss);
  if (prow.length) {
    for (let it = 0; it < 100; it++) {
      let sw = 0, sr = 0;
      for (const r of prow) { sw += r.w; sr += r.w * (r.poss - pace[r.h] - pace[r.a]); }
      P = sr / sw;
      let maxD = 0;
      for (const t of teams) {
        let num = 0, den = REG_W;
        for (const r of prow) {
          if (r.h === t) { num += r.w * (r.poss - P - pace[r.a]); den += r.w; }
          if (r.a === t) { num += r.w * (r.poss - P - pace[r.h]); den += r.w; }
        }
        const nv = num / den; maxD = Math.max(maxD, Math.abs(nv - pace[t])); pace[t] = nv;
      }
      const mP = teams.reduce((s, t) => s + pace[t], 0) / teams.length;
      for (const t of teams) pace[t] -= mP;
      P += 2 * mP;
      if (it > 5 && maxD < 1e-6) break;
    }
  }

  // diagnóstico
  let se = 0, sw = 0, sPts = 0, seM = 0, seT = 0, n = 0;
  for (const r of rows) {
    const eh = mu + (r.hfaOn * hfa) / 2 + off[r.h] - def[r.a];
    const ea = mu - (r.hfaOn * hfa) / 2 + off[r.a] - def[r.h];
    se += r.w * ((r.oh - eh) ** 2 + (r.oa - ea) ** 2); sw += 2 * r.w;
    const ph = r.poss * (r.oh) / 100, pa = r.poss * (r.oa) / 100;
    const xh = r.poss * eh / 100, xa = r.poss * ea / 100;
    seM += ((ph - pa) - (xh - xa)) ** 2; seT += ((ph + pa) - (xh + xa)) ** 2; n++;
    sPts += ph + pa;
  }
  const ratings = {};
  for (const t of teams) ratings[t] = { off: +off[t].toFixed(2), def: +def[t].toFixed(2), pace: +pace[t].toFixed(2) };
  return {
    ratings,
    mu: +mu.toFixed(2), hfa: +hfa.toFixed(2), poss: +P.toFixed(2),
    diag: {
      games: rows.length, with_poss: prow.length,
      resid_sd_ortg: +Math.sqrt(se / sw).toFixed(2),
      resid_sd_margin: +Math.sqrt(seM / n).toFixed(2),
      resid_sd_total: +Math.sqrt(seT / n).toFixed(2),
      avg_total: +(sPts / n).toFixed(1),
    },
  };
}

module.exports = { fitRatings, gameWeight, gamePoss, HALF_LIFE_DAYS, REG_W, PLAYOFF_W };
