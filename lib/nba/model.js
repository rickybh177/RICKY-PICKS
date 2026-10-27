/* ============================================================
   MODELO NBA 2026-27 — orquestador (equivalente a lib/nfl/model.js).

   buildBoard({ day }) arma la cartelera de hoy y mañana (hora CDMX):
   1. Ratings: priors 2026-27 ajustados por rival (3 temporadas, ver
      scripts/build-nba-priors.js) que se AUTO-ACTUALIZAN con cada
      resultado de la 2026-27 (eficiencia por 100 posesiones y ritmo,
      estilo Elo; la sorpresa se limpia de la suerte en triples), más
      la corrección global del entorno anotador (muShift). El historial
      de la temporada vive en lib/nba/season.js (estático + KV).
   2. Ajustes por juego: localía, descanso (segundo juego en dos
      noches, tercero en cuatro, descanso largo) y AUSENCIAS: el reporte
      de lesiones de ESPN se traduce a puntos con el valor de cada
      jugador en su rotación (lib/nba/players.js). Es la parte del modelo
      que más vale contra la línea de apertura (ver NBA-README).
   3. Mercados en forma cerrada (lib/nba/engine.js): ganador, hándicap,
      total, totales por equipo, 1ª mitad y 1er cuarto.
   4. Veredictos por EV REAL contra momios devigueados (The Odds API,
      única fuente), con encogimiento hacia el mercado. Sin momios el
      tope es MAYBE. Guardián: si la línea del mercado está a ≥7 puntos
      del modelo, el mercado sabe algo (una baja que ESPN aún no
      publica) → tope MAYBE con aviso.

   Los ratings y parámetros NUNCA salen de aquí: la API devuelve solo
   probabilidades, líneas y veredictos.
   ============================================================ */

const { PRIORS, LEAGUE, PARAMS, DISP } = require('./priors');
const { TEAMS, logoUrl } = require('./teams');
const { getRange, getInjuries, ymd, addDays } = require('./data');
const { learnRatings, expectation, restCategory, restPts, REST_NOTE } = require('./core');
const { markets: buildMarkets } = require('./engine');
const { buildIndex, absencesInGame, absencesToday } = require('./players');
const { loadSeason, SEASON } = require('./season');
const { getNbaOdds, findNbaOdds, probToAm, devigPair } = require('./odds');

const MX_TZ = 'America/Mexico_City';
const ALT_TEAMS = new Set(Object.keys(TEAMS).filter(ab => TEAMS[ab].altM > 1200));

/* ---- veredictos por EV (receta MX/NFL) ----
   El backtest 2025-26 NO encontró ventaja contra el CIERRE, pero sí
   contra la APERTURA (el lado del modelo cubre 56-57% cuando discrepa
   ≥3 pts, y la línea se mueve hacia el modelo 4 de cada 5 veces). Por
   eso el encogimiento hacia el mercado es alto (0.4) y la barra de BET
   exige EV ≥ 4%: pocos picks, y solo donde el modelo ve algo claro. */
const MKT_BLEND = 0.4;
const BARS = {
  spread: { bet: 0.04, maybe: 0.015, floor: 0.3 },
  total: { bet: 0.04, maybe: 0.015, floor: 0.3 },
  ml: { bet: 0.04, maybe: 0.015, floor: 0.25 },
};
const IMP_110 = 110 / 210;
const DIVERGENCE_PTS = 7;      // línea del mercado a ≥7 pts del modelo → tope MAYBE
const DIVERGENCE_TOTAL = 12;

function evVerdict(p, priceImp, pMarket, { bet, maybe, floor, blend = MKT_BLEND }) {
  if (p == null || priceImp == null || priceImp <= 0) return { verdict: 'skip', ev: null };
  const pb = pMarket != null ? (1 - blend) * p + blend * pMarket : p;
  const ev = pb / priceImp - 1;
  let verdict = 'skip';
  if (pb >= floor && ev >= bet) verdict = 'bet';
  else if (pb >= floor && ev >= maybe) verdict = 'maybe';
  const evR = Math.round(ev * 1000) / 1000;
  return { verdict, ev: evR === 0 ? 0 : evR };
}
function barVerdict(p, barBet, barMaybe) {
  if (p == null) return 'skip';
  if (p >= barBet) return 'bet';
  if (p >= barMaybe) return 'maybe';
  return 'skip';
}
const fmtLine = l => (l > 0 ? '+' : '') + l;
function spreadGloss(line) {
  if (line == null) return null;
  if (line === 0) return 'gana el juego';
  if (line < 0) return `gana por ${Math.floor(Math.abs(line)) + 1} o más`;
  const margen = Math.ceil(line) - 1;
  return margen > 0 ? `gana, o pierde por ${margen} o menos` : 'gana el juego';
}

/* fecha CDMX (YYYY-MM-DD) de un instante */
function mxDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(g, mk, market, e, notes) {
  const fav = mk.spread.exp_margin >= 0 ? g.home : g.away;
  const dog = mk.spread.exp_margin >= 0 ? g.away : g.home;
  const m = Math.abs(mk.spread.exp_margin);
  const parts = [];
  if (m < 2) parts.push(`El modelo ve un juego muy parejo entre ${g.away.name} y ${g.home.name} (margen esperado de ${m.toFixed(1)} puntos).`);
  else parts.push(`El modelo favorece a ${fav.name} por ${m.toFixed(1)} puntos sobre ${dog.name}.`);
  const pace = e.poss - LEAGUE.poss;
  if (Math.abs(pace) >= 2.5) parts.push(`Se espera un juego ${pace > 0 ? 'rápido' : 'lento'} (${e.poss.toFixed(0)} posesiones contra ${LEAGUE.poss.toFixed(0)} de promedio), ${pace > 0 ? 'con más tiros y más puntos' : 'con menos posesiones y menos puntos'}.`);
  if (market && market.spread != null) {
    const diff = mk.spread.fair_line - market.spread;
    if (Math.abs(diff) >= DIVERGENCE_PTS) parts.push(`La línea del mercado (${fmtLine(market.spread)} al local) está a ${Math.abs(diff).toFixed(1)} puntos de la del modelo: el mercado sabe algo que el reporte de lesiones aún no dice. Mejor esperar.`);
    else if (Math.abs(diff) >= 2) parts.push(`La línea del mercado (${fmtLine(market.spread)} al local) está ${Math.abs(diff).toFixed(1)} puntos ${diff < 0 ? 'corta' : 'larga'} contra lo que calcula el modelo: ahí está el valor.`);
    else parts.push('La línea del mercado está muy cerca de la del modelo: sin ventaja clara en el hándicap.');
  }
  const tDiff = mk.total.model_total - mk.total.line;
  if (market && market.total != null && Math.abs(tDiff) >= 3) parts.push(`En puntos totales el modelo espera ${mk.total.model_total}, ${tDiff > 0 ? 'ARRIBA' : 'ABAJO'} de la línea de ${mk.total.line}.`);
  if (notes.length) parts.push('Factores del día: ' + notes.join('; ') + '.');
  return parts.join(' ');
}

/* texto de ausencias de un equipo: "Sin Luka Dončić (fuera) y Kyrie Irving (duda)" */
const STATUS_ES = { out: 'fuera', doubtful: 'duda seria', questionable: 'en duda', 'day-to-day': 'día a día', 'game time decision': 'se decide al tiro', probable: 'probable', suspended: 'suspendido' };
function absNote(team, abs) {
  if (!abs || !abs.players.length) return null;
  const list = abs.players.slice().sort((a, b) => b.value * b.w - a.value * a.w).slice(0, 3)
    .map(p => `${p.name} (${STATUS_ES[String(p.status).toLowerCase()] || p.status})`);
  const pts = (abs.value * PARAMS.ABS_C);
  return `${team.name} sin ${list.join(', ')}${pts >= 0.8 ? ` — le cuesta ~${pts.toFixed(1)} puntos` : ''}`;
}

/* ---- construir la cartelera ---- */
async function buildBoard({ day } = {}) {
  const now = Date.now();
  // 1) temporada en curso (estático + delta KV + juegos nuevos)
  const season = await loadSeason({ update: true });
  const results = season.games;

  // índice de jugadores (temporada pasada + en curso) para rotaciones y ausencias
  const { loadHistory } = require('./players');
  const idx = buildIndex(loadHistory({ years: [SEASON - 1], extraRows: season.playerRows }));
  const absHist = (g, side) => absencesInGame(idx, g[side].abbr, g.id).value;

  // 2) ratings al día
  const learned = learnRatings(results, {
    priors: PRIORS, league: LEAGUE,
    params: { K: PARAMS.K, KP: PARAMS.KP, ABS_C: PARAMS.ABS_C, REST: PARAMS.REST, LUCK: PARAMS.LUCK },
    absences: absHist, altTeams: ALT_TEAMS,
  });
  const R = learned.R;

  // 3) cartelera: hoy y mañana (CDMX), o el día pedido
  const days = day ? [day] : [mxDate(now), mxDate(now + 86400000)];
  const sched = await getRange(addDays(new Date(now), -1), addDays(new Date(now), 2));
  const slate = sched.filter(g => days.includes(mxDate(g.date)) && TEAMS[g.home.abbr] && TEAMS[g.away.abbr])
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const [oddsList, injuries] = await Promise.all([getNbaOdds().catch(() => null), getInjuries()]);

  const out = [];
  for (const g of slate) {
    const th = TEAMS[g.home.abbr], ta = TEAMS[g.away.abbr];
    if (!R[g.home.abbr] || !R[g.away.abbr]) { out.push({ id: g.id, error: 'Equipo no reconocido.' }); continue; }

    // descanso a partir de los juegos ya jugados
    const rcH = restCategory(learned.prevDates[g.home.abbr], g.date), rcA = restCategory(learned.prevDates[g.away.abbr], g.date);
    // ausencias de hoy: reporte de lesiones → valor en la rotación
    const absH = absencesToday(idx, g.home.abbr, injuries.get(g.home.abbr), g.date);
    const absA = absencesToday(idx, g.away.abbr, injuries.get(g.away.abbr), g.date);
    const ctx = {
      muShift: learned.muShift,
      restHome: restPts(rcH.cat, true, PARAMS.REST), restAway: restPts(rcA.cat, false, PARAMS.REST),
      absHome: absH.value, absAway: absA.value, altHome: ALT_TEAMS.has(g.home.abbr),
    };
    const e = expectation(R, g, LEAGUE, ctx, { ABS_C: PARAMS.ABS_C, ALT_HFA: 0 });

    // momios (The Odds API, única fuente)
    const market = findNbaOdds(oddsList, g.home.abbr, g.away.abbr, g.date);
    const mk = buildMarkets({ expHome: e.expH, expAway: e.expA, disp: DISP, lines: market ? { spread: market.spread, total: market.total } : null });
    const dv = market ? {
      ml: devigPair(market.ml_home_imp, market.ml_away_imp),
      spread: devigPair(market.spread_home_imp != null ? market.spread_home_imp : IMP_110, market.spread_away_imp != null ? market.spread_away_imp : IMP_110),
      total: devigPair(market.total_over_imp != null ? market.total_over_imp : IMP_110, market.total_under_imp != null ? market.total_under_imp : IMP_110),
    } : null;
    const divergeSpread = !!(market && market.spread != null && Math.abs(mk.spread.fair_line - market.spread) >= DIVERGENCE_PTS);
    const divergeTotal = !!(market && market.total != null && Math.abs(mk.total.model_total - market.total) >= DIVERGENCE_TOTAL);
    const cap = v => (v.verdict === 'bet' ? { ...v, verdict: 'maybe' } : v);

    const verdicts = [];
    // Hándicap
    {
      const pHome = mk.spread.home_cover;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : 1 - pHome;
      const team = side === 'home' ? g.home : g.away;
      const line = side === 'home' ? mk.spread.line : -mk.spread.line;
      let v;
      if (market && market.spread != null && dv) {
        const priceImp = side === 'home' ? (market.spread_home_imp != null ? market.spread_home_imp : IMP_110) : (market.spread_away_imp != null ? market.spread_away_imp : IMP_110);
        v = evVerdict(p, priceImp, side === 'home' ? dv.spread[0] : dv.spread[1], BARS.spread);
        if (divergeSpread) v = cap(v);
      } else v = { verdict: barVerdict(p, 1.01, 0.58), ev: null };
      const gloss = spreadGloss(line);
      verdicts.push({
        market: 'spread', label: `Hándicap: ${team.name} ${fmtLine(line)}`, prob: +p.toFixed(3), edge: v.ev, verdict: v.verdict,
        line_txt: `${team.abbr} ${gloss}` + (market && market.spread != null ? '' : ' · línea del modelo, aún sin momios') + (divergeSpread ? ' · el mercado se movió lejos del modelo' : ''),
      });
    }
    // Total
    {
      const pOver = mk.total.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : 1 - pOver;
      let v;
      if (market && market.total != null && dv) {
        const priceImp = side === 'over' ? (market.total_over_imp != null ? market.total_over_imp : IMP_110) : (market.total_under_imp != null ? market.total_under_imp : IMP_110);
        v = evVerdict(p, priceImp, side === 'over' ? dv.total[0] : dv.total[1], BARS.total);
        if (divergeTotal) v = cap(v);
      } else v = { verdict: barVerdict(p, 1.01, 0.58), ev: null };
      verdicts.push({
        market: 'total', label: `Total: ${side === 'over' ? 'Más' : 'Menos'} de ${mk.total.line} puntos`, prob: +p.toFixed(3), edge: v.ev, verdict: v.verdict,
        line_txt: `entre los dos equipos · modelo espera ${mk.total.model_total}` + (market && market.total != null ? '' : ' · línea del modelo, aún sin momios'),
      });
    }
    // Ganador
    {
      const pHome = mk.moneyline.home;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : 1 - pHome;
      const team = side === 'home' ? g.home : g.away;
      const priceImp = market ? (side === 'home' ? market.ml_home_imp : market.ml_away_imp) : null;
      let v;
      if (priceImp != null && dv) { v = evVerdict(p, priceImp, side === 'home' ? dv.ml[0] : dv.ml[1], BARS.ml); if (divergeSpread) v = cap(v); }
      else v = { verdict: barVerdict(p, 1.01, 0.62), ev: null };
      verdicts.push({
        market: 'moneyline', label: `Ganador: ${team.name}`, prob: +p.toFixed(3), edge: v.ev, verdict: v.verdict,
        line_txt: `${team.abbr} gana el juego` + (priceImp != null ? ` · ${fmtLine(probToAm(priceImp))}` : ' · aún sin momios'),
      });
    }
    // 1ª mitad (sin momios publicados: barras, tope MAYBE)
    {
      const pOver = mk.first_half.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : 1 - pOver;
      verdicts.push({
        market: 'h1_total', label: `Total 1ª mitad: ${side === 'over' ? 'Más' : 'Menos'} de ${mk.first_half.total_line} puntos`, prob: +p.toFixed(3), edge: null,
        verdict: barVerdict(p, 1.01, 0.575), line_txt: `solo los 2 primeros cuartos · modelo espera ${mk.first_half.model_total}`,
      });
    }

    const notes = [];
    if (REST_NOTE[rcH.cat]) notes.push(`${g.home.name}: ${REST_NOTE[rcH.cat]}`);
    if (REST_NOTE[rcA.cat]) notes.push(`${g.away.name}: ${REST_NOTE[rcA.cat]}`);
    const nH = absNote(g.home, absH), nA = absNote(g.away, absA);
    if (nH) notes.push(nH);
    if (nA) notes.push(nA);

    const strength = Math.max(0, ...verdicts.map(v => v.verdict === 'bet' ? v.prob : 0));
    out.push({
      id: g.id, date: g.date, day_mx: mxDate(g.date), venue: g.venue, neutral: g.neutral,
      home: { abbr: g.home.abbr, name: g.home.name, record: g.home.record, logo: logoUrl(g.home.abbr), city: th.city },
      away: { abbr: g.away.abbr, name: g.away.name, record: g.away.record, logo: logoUrl(g.away.abbr), city: ta.city },
      state: g.state,
      score: g.state !== 'pre' ? { home: g.home.score, away: g.away.score, detail: g.detail } : null,
      market_source: market ? market.source : null,
      rest: { home: REST_NOTE[rcH.cat] || null, away: REST_NOTE[rcA.cat] || null },
      absences: {
        home: absH.players.map(p => ({ name: p.name, status: p.status })),
        away: absA.players.map(p => ({ name: p.name, status: p.status })),
      },
      verdicts,
      markets: {
        ...mk,
        market_odds: market ? {
          source: market.source, spread: market.spread, total: market.total,
          ml_home: probToAm(market.ml_home_imp), ml_away: probToAm(market.ml_away_imp),
          spread_home: probToAm(market.spread_home_imp), spread_away: probToAm(market.spread_away_imp),
          total_over: probToAm(market.total_over_imp), total_under: probToAm(market.total_under_imp),
        } : null,
        fair_odds: {
          ml_home: probToAm(mk.moneyline.home), ml_away: probToAm(mk.moneyline.away),
          spread_home: probToAm(mk.spread.home_cover), total_over: probToAm(mk.total.over),
        },
      },
      /* entorno para /api/nba-props (bajo demanda) */
      env: {
        exp_home: +e.expH.toFixed(1), exp_away: +e.expA.toFixed(1), exp_poss: +e.poss.toFixed(1),
        odds_event_id: (market && market.odds_event_id) || null,
      },
      analysis: buildAnalysis(g, mk, market, e, notes),
      strength: +strength.toFixed(3),
    });
  }

  return {
    season: SEASON,
    days,
    games_learned: learned.gamesLearned,
    mu_shift: learned.muShift,
    season_last_date: season.lastDate,
    odds_source: oddsList ? 'the-odds-api' : null,
    injuries_teams: injuries.size,
    games: out,
    parlay: suggestParlay(out),
  };
}

/* ---- parlay sugerido del día: hasta 3 PICKs de juegos distintos,
   probabilidad conjunta = producto (juegos independientes) de la prob
   ENCOGIDA hacia el mercado (la misma con que se decidió el veredicto),
   no la del modelo puro: honesto por construcción. ---- */
function suggestParlay(games) {
  const legs = [];
  for (const g of games) {
    if (g.error || g.state !== 'pre') continue;
    const best = (g.verdicts || []).filter(v => v.verdict === 'bet' && v.edge != null && ['spread', 'total', 'moneyline'].includes(v.market))
      .sort((a, b) => b.edge - a.edge)[0];
    if (best) legs.push({ game_id: g.id, match: `${g.away.abbr} @ ${g.home.abbr}`, label: best.label, prob: best.prob, edge: best.edge });
  }
  if (legs.length < 2) return null;
  const pick = legs.sort((a, b) => b.edge - a.edge).slice(0, 3);
  // prob conjunta con la prob encogida: p_b ≈ p·(1−blend) + blend·p_mercado; aquí usamos p − blend·edge/2 como aproximación conservadora
  let joint = 1;
  for (const l of pick) { const pb = Math.max(0.3, l.prob * (1 - MKT_BLEND) + MKT_BLEND * (l.prob - l.edge * 0.5)); joint *= pb; l.prob_used = +pb.toFixed(3); }
  return { legs: pick, joint_prob: +joint.toFixed(3), fair_odds: probToAm(joint), note: 'Probabilidad conjunta honesta: producto de las probabilidades encogidas hacia el mercado. Un parlay multiplica el riesgo, no la ventaja.' };
}

module.exports = { buildBoard, mxDate, MKT_BLEND, BARS, SEASON };
