/* ============================================================
   NFL — motor de simulación Monte Carlo por posesiones (drives).

   Cada juego se simula N_SIMS veces drive por drive:
   - Cada equipo tiene ~10.8 posesiones por juego.
   - Cada posesión termina en TD (~6.95 pts con la conversión),
     gol de campo (3) o sin puntos (despeje, pérdida, downs).
   - Las tasas TD/FG de cada equipo se derivan de sus puntos
     esperados en ESTE juego (ratings + local + descanso + clima),
     con los TDs escalando más rápido que los FGs — como en la
     realidad: las ofensivas buenas anotan TDs, no patadas.

   La estructura binomial por drives reproduce sola las varianzas
   reales de la NFL (margen ~13.5 pts, total ~13.5 pts), así que
   no hay factores de ruido artificiales encima.

   RNG con semilla por juego: el mismo juego en el mismo día da
   los mismos números (no "bailan" los picks entre recargas).
   ============================================================ */

const N_SIMS = 10000;
const DRIVES_MU = 10.8;      // posesiones por equipo por juego
const TD_PTS = 6.95;         // TD + conversión promedio
const LG_PTS_PER_DRIVE = 2.13;
const BASE_TD_RATE = 0.243;  // liga: TDs por posesión
const OT_TIE_P = 0.05;       // prob de empate si el OT no define

/* ---- RNG determinista (mulberry32) ---- */
function makeRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Tasas TD/FG por drive para un equipo con `exp` puntos esperados. */
function driveRates(exp) {
  const perDrive = Math.max(0.4, exp / DRIVES_MU);
  const f = perDrive / LG_PTS_PER_DRIVE;
  let tdP = Math.min(0.55, BASE_TD_RATE * Math.pow(f, 1.15));
  // El FG absorbe el resto para que la esperanza cuadre exacta.
  let fgP = (perDrive - tdP * TD_PTS) / 3;
  if (fgP < 0.03) { fgP = 0.03; tdP = Math.max(0.02, (perDrive - fgP * 3) / TD_PTS); }
  if (fgP > 0.30) fgP = 0.30;
  return { tdP, fgP };
}

/* Simula el juego completo. expHome/expAway ya traen TODOS los
   ajustes (ratings, localía, descanso, clima). */
function simulateGame({ expHome, expAway, seed }) {
  const rng = makeRng(seed || 'nfl');
  const H = driveRates(expHome);
  const A = driveRates(expAway);
  // margen esperado para inclinar el OT
  const expMargin = expHome - expAway;
  const pOtHome = Math.min(0.75, Math.max(0.25, 0.5 + expMargin * 0.022));

  const agg = {
    n: N_SIMS,
    homeWins: 0, awayWins: 0, ties: 0,
    margins: new Map(),          // margen -> conteo
    totalPts: 0, totalSq: 0,
    homePts: 0, awayPts: 0,
    h1Home: 0, h1Away: 0,
    overCounts: new Map(),       // se llena después con líneas
    samples: { totals: new Array(N_SIMS), margins: new Array(N_SIMS), homes: new Array(N_SIMS), aways: new Array(N_SIMS), h1tot: new Array(N_SIMS), h1marg: new Array(N_SIMS) },
  };

  for (let s = 0; s < N_SIMS; s++) {
    // posesiones del juego (compartidas: el ritmo es del partido)
    const drives = Math.max(8, Math.round(DRIVES_MU + (rng() + rng() + rng() - 1.5) * 1.5));
    let hp = 0, ap = 0, h1h = 0, h1a = 0;
    const half1 = Math.ceil(drives / 2);
    for (let d = 0; d < drives; d++) {
      const inH1 = d < half1;
      let r = rng();
      if (r < H.tdP) { const p = 7; hp += p; if (inH1) h1h += p; }
      else if (r < H.tdP + H.fgP) { hp += 3; if (inH1) h1h += 3; }
      r = rng();
      if (r < A.tdP) { const p = 7; ap += p; if (inH1) h1a += p; }
      else if (r < A.tdP + A.fgP) { ap += 3; if (inH1) h1a += 3; }
    }
    // TDs valen 6.95 en promedio: convertimos ~5% de TDs de 7 a 6 (fallo del extra)
    // aproximación barata: resta 1 punto con prob proporcional a TDs anotados
    if (rng() < (hp / 7) * 0.05) hp -= 1;
    if (rng() < (ap / 7) * 0.05) ap -= 1;

    if (hp === ap) {
      // tiempo extra
      const r = rng();
      if (r < OT_TIE_P) { agg.ties++; }
      else if (r < OT_TIE_P + (1 - OT_TIE_P) * pOtHome) { hp += 3; agg.homeWins++; }
      else { ap += 3; agg.awayWins++; }
    } else if (hp > ap) agg.homeWins++;
    else agg.awayWins++;

    const margin = hp - ap, total = hp + ap;
    agg.margins.set(margin, (agg.margins.get(margin) || 0) + 1);
    agg.totalPts += total; agg.totalSq += total * total;
    agg.homePts += hp; agg.awayPts += ap;
    agg.h1Home += h1h; agg.h1Away += h1a;
    agg.samples.totals[s] = total; agg.samples.margins[s] = margin;
    agg.samples.homes[s] = hp; agg.samples.aways[s] = ap;
    agg.samples.h1tot[s] = h1h + h1a; agg.samples.h1marg[s] = h1h - h1a;
  }
  return agg;
}

/* P(sample > line), con push si cae exacto (líneas enteras). */
function overProb(samples, line) {
  if (line == null) return null;
  let over = 0, push = 0;
  for (const v of samples) { if (v > line) over++; else if (v === line) push++; }
  const n = samples.length - push;
  return n > 0 ? over / n : null;
}
/* P(margen local + línea > 0): prob de que el LOCAL cubra su línea. */
function coverProb(margins, homeLine) {
  if (homeLine == null) return null;
  let cover = 0, push = 0;
  for (const m of margins) { const v = m + homeLine; if (v > 0) cover++; else if (v === 0) push++; }
  const n = margins.length - push;
  return n > 0 ? cover / n : null;
}
function quantile(sorted, q) {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/* Convierte la simulación en TODOS los mercados del juego. */
function marketsFromSims(agg, lines) {
  const n = agg.n;
  const sMarg = [...agg.samples.margins].sort((a, b) => a - b);
  const decided = agg.homeWins + agg.awayWins;
  const mlHome = decided ? agg.homeWins / decided : 0.5;

  const meanTotal = agg.totalPts / n;
  const meanHome = agg.homePts / n;
  const meanAway = agg.awayPts / n;
  const fairSpreadHome = -quantile(sMarg, 0.5); // línea justa del local

  // líneas: las del mercado si existen; si no, las del propio modelo
  const spreadLine = lines && lines.spread != null ? lines.spread : Math.round(fairSpreadHome * 2) / 2;
  const totalLine = lines && lines.total != null ? lines.total : Math.round(meanTotal * 2) / 2;

  const httLine = Math.round(meanHome * 2) / 2 - 0.5 + 0.5; // .5 para evitar push
  const attLine = Math.round(meanAway * 2) / 2;
  const h1Line = Math.round((totalLine / 2 - 1) * 2) / 2;

  return {
    moneyline: { home: mlHome, away: 1 - mlHome, tie: agg.ties / n },
    spread: {
      line: spreadLine,                                  // línea del LOCAL
      home_cover: coverProb(agg.samples.margins, spreadLine),
      fair_line: Math.round(fairSpreadHome * 2) / 2,
      exp_margin: +( (agg.homePts - agg.awayPts) / n ).toFixed(1),
    },
    total: {
      line: totalLine,
      over: overProb(agg.samples.totals, totalLine),
      model_total: +meanTotal.toFixed(1),
    },
    team_totals: {
      home: { line: httLine + 0.5, over: overProb(agg.samples.homes, httLine + 0.5), mean: +meanHome.toFixed(1) },
      away: { line: attLine + 0.5, over: overProb(agg.samples.aways, attLine + 0.5), mean: +meanAway.toFixed(1) },
    },
    first_half: {
      home_win: agg.samples.h1marg.filter(v => v > 0).length / n,
      total_line: h1Line,
      over: overProb(agg.samples.h1tot, h1Line),
      model_total: +((agg.h1Home + agg.h1Away) / n).toFixed(1),
    },
    margin_dist: (() => {
      // distribución agrupada del margen local: -21..21
      const buckets = [];
      for (let m = -21; m <= 21; m++) {
        let c = agg.margins.get(m) || 0;
        if (m === -21) { for (const [k, v] of agg.margins) if (k < -21) c += v; }
        if (m === 21) { for (const [k, v] of agg.margins) if (k > 21) c += v; }
        buckets.push(+(c / n).toFixed(4));
      }
      return buckets;
    })(),
  };
}

/* Props del QB: proyección de yardas y TDs de pase del titular,
   derivada del perfil de pase del equipo contra ESTA defensa. */
function qbProps({ expPts, oppDefFactor, windMph }) {
  // yardas de pase esperadas: base liga ~214, escala con la ofensiva
  let mu = 214 * (0.55 + 0.45 * (expPts / 23));
  mu *= oppDefFactor;                                  // defensa aérea rival
  if (windMph != null && windMph > 12) mu *= Math.max(0.85, 1 - (windMph - 12) * 0.012);
  const sd = 58;
  const line = Math.round(mu / 5) * 5 - 0.5;           // línea a .5
  // P(X > line) con normal
  const z = (line - mu) / sd;
  const overP = 1 - normCdf(z);
  // TDs de pase ~ Poisson; ~62% de los TDs llegan por aire
  const tdMu = Math.max(0.4, (expPts / 6.95) * 0.62);
  const p0 = Math.exp(-tdMu), p1 = p0 * tdMu;
  return {
    pass_yds: { mean: Math.round(mu), line, over: +overP.toFixed(3) },
    pass_tds: { mean: +tdMu.toFixed(2), line: 1.5, over: +(1 - p0 - p1).toFixed(3) },
  };
}
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

module.exports = { N_SIMS, simulateGame, marketsFromSims, qbProps, makeRng, driveRates };
