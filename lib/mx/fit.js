/* ============================================================
   LIGA MX — ajuste Dixon-Coles con decaimiento temporal.
   Usado SOLO por scripts (build-mx-priors, mx-backtest); nunca
   se carga en runtime del API.

   Modelo por partido:
     λ_local  = exp(mu + hfa + att[h] + def[a] + altC·altKm)
     λ_visita = exp(mu +       att[a] + def[h] − altC·altKm)
   att = fuerza ofensiva (goles que mete), def = DEBILIDAD
   defensiva (goles que concede; positivo = defensa mala).
   altKm = exceso de altitud de la sede sobre la casa del
   visitante, en km, solo cuesta arriba (max 0). rho corrige los
   marcadores bajos (0-0, 1-0, 0-1, 1-1) al estilo Dixon-Coles.

   Ajuste en dos pasos (estándar):
   1. att/def/mu/hfa/altC por Fisher scoring sobre la
      log-verosimilitud Poisson ponderada por recencia.
   2. rho por búsqueda en malla sobre la verosimilitud DC
      completa con las lambdas fijas.
   ============================================================ */

const { venueAltitude, TEAMS } = require('./teams');

const HALF_LIFE_DAYS = 300;   // medio torneo anterior pesa ~½; plantillas rotan cada 6 meses
const PLAYOFF_W = 0.9;        // liguilla/play-in pesan un poco menos
const REG_W = 8;              // pseudo-partidos hacia el ancla (regresión a la media)

/* Anclas para equipos sin historia en primera (ascendidos):
   perfil típico de recién llegado — ataque flojo, defensa floja. */
const PROMOTED_ANCHOR = { att: -0.20, def: 0.12 };

function altKmOf(g) {
  const va = venueAltitude(g.venueCity, g.home.abbr);
  const away = TEAMS[g.away.abbr];
  const awayAlt = away ? away.altM : 1000;
  return Math.min(2.3, Math.max(0, (va - awayAlt) / 1000));
}

function gameWeight(g, asOfMs, halfLife) {
  const days = Math.max(0, (asOfMs - new Date(g.date).getTime()) / 86400000);
  let w = Math.pow(0.5, days / (halfLife || HALF_LIFE_DAYS));
  const slug = g.seasonSlug || '';
  if (!/apertura|clausura/.test(slug) || /liguilla|playoff|play-in|repechaje/.test(slug)) w *= PLAYOFF_W;
  return w;
}

/* games: eventos parseados COMPLETOS (data.js). asOf: ms.
   Devuelve { ratings: {abbr:{att,def}}, mu, hfa, altC, rho, diag } */
function fitDixonColes(games, { asOf, halfLife, iters = 300, verbose = false } = {}) {
  const asOfMs = asOf || Date.now();
  const rows = [];
  for (const g of games) {
    if (!g.completed || g.home.score == null || g.away.score == null) continue;
    if (!g.home.abbr || !g.away.abbr) continue;
    rows.push({
      h: g.home.abbr, a: g.away.abbr,
      gh: g.home.score, ga: g.away.score,
      altKm: altKmOf(g),
      w: gameWeight(g, asOfMs, halfLife),
    });
  }
  if (!rows.length) throw new Error('fitDixonColes: sin partidos');

  const teams = [...new Set(rows.flatMap(r => [r.h, r.a]))];
  const att = {}, def = {}, anchorAtt = {}, anchorDef = {};
  const wSum = {};
  for (const t of teams) { att[t] = 0; def[t] = 0; wSum[t] = 0; anchorAtt[t] = 0; anchorDef[t] = 0; }
  for (const r of rows) { wSum[r.h] += r.w; wSum[r.a] += r.w; }
  // equipos actuales con poca/nula evidencia → ancla de ascendido
  for (const t of teams) {
    if (wSum[t] < 3) { anchorAtt[t] = PROMOTED_ANCHOR.att; anchorDef[t] = PROMOTED_ANCHOR.def; att[t] = anchorAtt[t]; def[t] = anchorDef[t]; }
  }

  let mu = 0, hfa = 0.25, altC = 0.05;

  const lamH = r => Math.exp(mu + hfa + att[r.h] + def[r.a] + altC * r.altKm);
  const lamA = r => Math.exp(mu + att[r.a] + def[r.h] - altC * r.altKm);

  /* mu y hfa NO se actualizan por gradiente junto con att/def
     (son casi colineales y el paso simultáneo diverge): dados
     att/def/altC, sus ecuaciones de score tienen forma cerrada
     exacta — media ponderada predicha = media observada. */
  const solveMuHfa = () => {
    let sGh = 0, sGa = 0, sEh = 0, sEa = 0;
    for (const r of rows) {
      sGh += r.w * r.gh; sGa += r.w * r.ga;
      sEh += r.w * Math.exp(att[r.h] + def[r.a] + altC * r.altKm);
      sEa += r.w * Math.exp(att[r.a] + def[r.h] - altC * r.altKm);
    }
    mu = Math.log(Math.max(1e-9, sGa / sEa));
    hfa = Math.log(Math.max(1e-9, sGh / sEh)) - mu;
  };

  for (let it = 0; it < iters; it++) {
    solveMuHfa();

    // att/def: Newton amortiguado por equipo (Fisher = Σw·λ + reg)
    const gAtt = {}, gDef = {}, fAtt = {}, fDef = {};
    for (const t of teams) { gAtt[t] = 0; gDef[t] = 0; fAtt[t] = 0; fDef[t] = 0; }
    for (const r of rows) {
      const lh = lamH(r), la = lamA(r);
      const rh = r.w * (r.gh - lh), ra = r.w * (r.ga - la);
      const fh = r.w * lh, fa = r.w * la;
      gAtt[r.h] += rh; fAtt[r.h] += fh;
      gAtt[r.a] += ra; fAtt[r.a] += fa;
      gDef[r.a] += rh; fDef[r.a] += fh;
      gDef[r.h] += ra; fDef[r.h] += fa;
    }
    let maxD = 0;
    for (const t of teams) {
      // regularización: REG_W pseudo-juegos empujando al ancla
      gAtt[t] -= REG_W * (att[t] - anchorAtt[t]); fAtt[t] += REG_W;
      gDef[t] -= REG_W * (def[t] - anchorDef[t]); fDef[t] += REG_W;
      const dA = 0.5 * gAtt[t] / Math.max(1e-6, fAtt[t]);
      const dD = 0.5 * gDef[t] / Math.max(1e-6, fDef[t]);
      att[t] += dA; def[t] += dD;
      maxD = Math.max(maxD, Math.abs(dA), Math.abs(dD));
    }

    // altC: paso Newton propio, con att/def/mu/hfa recién movidos
    let gAlt = 0, fAlt = 0;
    for (const r of rows) {
      const lh = lamH(r), la = lamA(r);
      gAlt += r.w * ((r.gh - lh) - (r.ga - la)) * r.altKm;
      fAlt += r.w * (lh + la) * r.altKm * r.altKm;
    }
    if (fAlt > 1e-6) altC += 0.5 * gAlt / fAlt;
    altC = Math.min(0.25, Math.max(0, altC)); // cuesta arriba nunca ayuda al visitante

    // identificabilidad: att y def centrados en 0 (el nivel vive en mu)
    const mA = teams.reduce((s, t) => s + att[t], 0) / teams.length;
    const mD = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const t of teams) { att[t] -= mA; def[t] -= mD; }
    mu += mA + mD;

    if (it > 20 && maxD < 1e-7) break;
  }
  solveMuHfa();

  /* ---- paso 2: rho por malla (verosimilitud DC completa) ---- */
  const tau = (x, y, lh, la, rho) => {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };
  let bestRho = 0, bestLL = -Infinity;
  for (let rho = -0.20; rho <= 0.08 + 1e-9; rho += 0.005) {
    let ll = 0, ok = true;
    for (const r of rows) {
      const lh = lamH(r), la = lamA(r);
      const t = tau(r.gh, r.ga, lh, la, rho);
      if (t <= 1e-9) { ok = false; break; }
      ll += r.w * Math.log(t);
    }
    if (ok && ll > bestLL) { bestLL = ll; bestRho = rho; }
  }

  const ratings = {};
  for (const t of teams) ratings[t] = { att: +att[t].toFixed(4), def: +def[t].toFixed(4) };

  // diagnóstico
  let sumH = 0, sumA = 0, draws = 0, totW = 0;
  for (const r of rows) { sumH += r.gh; sumA += r.ga; totW += r.w; if (r.gh === r.ga) draws++; }
  const diag = {
    games: rows.length,
    weightSum: +totW.toFixed(1),
    avg_home_goals: +(sumH / rows.length).toFixed(3),
    avg_away_goals: +(sumA / rows.length).toFixed(3),
    draw_rate: +(draws / rows.length).toFixed(3),
  };

  return {
    ratings,
    mu: +mu.toFixed(4), hfa: +hfa.toFixed(4),
    altC: +altC.toFixed(4), rho: +bestRho.toFixed(3),
    diag,
  };
}

module.exports = { fitDixonColes, gameWeight, altKmOf, HALF_LIFE_DAYS, PROMOTED_ANCHOR };
