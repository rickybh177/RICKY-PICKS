/* ============================================================
   MODELO NFL — orquestador (equivalente a lib/mlb/model.js).

   buildWeek(week) arma la semana completa:
   1. Ratings: priors 2026 (generados de la temporada 2025) que se
      AUTO-ACTUALIZAN con cada resultado real de la temporada 26-27
      (estilo Elo sobre puntos anotados/permitidos). Cero trabajo
      manual: el modelo aprende solo semana a semana.
   2. Ajustes por juego: localía, descanso (semana corta/bye),
      clima real del estadio (viento/lluvia/frío/altitud) y sede
      neutral (juegos internacionales).
   3. Simulación Monte Carlo por drives (10,000 futuros por juego).
   4. Mercados: spread, total, moneyline, totales por equipo,
      1ª mitad y props del QB — con edge contra momios reales
      (The Odds API si hay key; si no, ESPN BET del scoreboard).

   Los ratings y parámetros NUNCA salen de aquí: la API devuelve
   solo probabilidades, líneas y veredictos.
   ============================================================ */

const { PRIORS, LEAGUE_PPG } = require('./priors');
const { TEAMS, logoUrl } = require('./teams');
const { getWeek, getCurrentWeek, getSeasonResults, getWeather } = require('./data');
const { getOddsApiLines, marketFor, probToAm } = require('./odds');
const { simulateGame, marketsFromSims, qbProps, N_SIMS } = require('./engine');

const SEASON = 2026;
const HFA = 1.5;          // ventaja de local total, en puntos de margen
const ELO_K = 0.10;       // qué tanto aprende de cada resultado
const ELO_CAP = 4;        // aprendizaje máximo por juego (puntos)

/* ---- ratings vigentes: priors + resultados reales 26-27 ---- */
async function currentRatings(uptoWeek) {
  const R = {};
  for (const abbr in PRIORS) R[abbr] = { off: PRIORS[abbr].off, def: PRIORS[abbr].def };
  if (uptoWeek < 1) return { R, gamesLearned: 0 };
  let results = [];
  try { results = await getSeasonResults(SEASON, uptoWeek); } catch (e) {}
  results.sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const g of results) {
    const h = R[g.home.abbr], a = R[g.away.abbr];
    if (!h || !a) continue;
    const hfaHalf = g.neutral ? 0 : HFA / 2;
    const expH = LEAGUE_PPG + h.off - a.def + hfaHalf;
    const expA = LEAGUE_PPG + a.off - h.def - hfaHalf;
    const dH = Math.max(-ELO_CAP / ELO_K, Math.min(ELO_CAP / ELO_K, g.home.score - expH));
    const dA = Math.max(-ELO_CAP / ELO_K, Math.min(ELO_CAP / ELO_K, g.away.score - expA));
    h.off += ELO_K * dH; a.def -= ELO_K * dH;
    a.off += ELO_K * dA; h.def -= ELO_K * dA;
  }
  return { R, gamesLearned: results.length };
}

/* ---- descanso: días desde el último juego de cada equipo ---- */
function restMap(results) {
  const last = {};
  for (const g of results) {
    const d = new Date(g.date).getTime();
    for (const side of ['home', 'away']) {
      const ab = g[side].abbr;
      if (!last[ab] || d > last[ab]) last[ab] = d;
    }
  }
  return last;
}
function restAdj(lastMs, kickoffISO) {
  if (!lastMs) return { pts: 0, note: null };
  const days = (new Date(kickoffISO).getTime() - lastMs) / 86400000;
  if (days < 5.5) return { pts: -0.8, note: 'semana corta' };
  if (days > 9.5) return { pts: +0.8, note: 'viene de descanso largo' };
  return { pts: 0, note: null };
}

/* ---- clima → ajuste en puntos por equipo ---- */
function weatherAdj(wx, homeAbbr) {
  const out = { each: 0, notes: [] };
  if (TEAMS[homeAbbr] && TEAMS[homeAbbr].altM > 1500) { out.each += 0.5; out.notes.push('altitud de Denver'); }
  if (!wx) return out;
  if (wx.wind_mph != null && wx.wind_mph > 12) {
    out.each -= Math.min(2, (wx.wind_mph - 12) * 0.15);
    out.notes.push(`viento ${Math.round(wx.wind_mph)} mph`);
  }
  if (wx.precip_pct != null && wx.precip_pct >= 60) { out.each -= 0.75; out.notes.push('probable lluvia'); }
  if (wx.temp_f != null && wx.temp_f < 20) { out.each -= 0.5; out.notes.push('frío extremo'); }
  return out;
}

/* ---- veredictos ---- */
const BE = 0.5238; // breakeven a -110
function verdictFromProb(p, threshBet, threshMaybe) {
  if (p == null) return 'skip';
  if (p >= threshBet) return 'bet';
  if (p >= threshMaybe) return 'maybe';
  return 'skip';
}

function fmtSpreadLabel(teamName, line) {
  // línea del equipo: -3.5 → "ganan por 4+"; +3.5 → "no pierden por 4+"
  if (line == null) return teamName;
  if (line < 0) return `${teamName} ganan por ${Math.ceil(Math.abs(line))} o más`;
  if (line > 0) return `${teamName} pierden por ${Math.floor(line)} o menos (o ganan)`;
  return `${teamName} ganan (línea pareja)`;
}

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(g, mk, market, wxNotes, restNotes) {
  const fav = mk.spread.exp_margin >= 0 ? g.home : g.away;
  const dog = mk.spread.exp_margin >= 0 ? g.away : g.home;
  const m = Math.abs(mk.spread.exp_margin);
  const parts = [];
  if (m < 2) parts.push(`El modelo ve un juego muy parejo entre ${g.away.name} y ${g.home.name} (margen esperado de ${m.toFixed(1)} puntos).`);
  else parts.push(`El modelo favorece a ${fav.name} por ${m.toFixed(1)} puntos sobre ${dog.name}.`);
  if (market && market.spread != null) {
    const diff = mk.spread.fair_line - market.spread;
    if (Math.abs(diff) >= 1.5) parts.push(`La línea del mercado (${market.spread > 0 ? '+' : ''}${market.spread} al local) está ${Math.abs(diff).toFixed(1)} puntos ${diff < 0 ? 'corta' : 'larga'} contra lo que calcula el modelo — ahí está el valor.`);
    else parts.push('La línea del mercado está muy cerca de la del modelo: sin ventaja clara en el spread.');
  }
  const tDiff = mk.total.model_total - mk.total.line;
  if (Math.abs(tDiff) >= 2) parts.push(`En puntos totales el modelo espera ${mk.total.model_total}, ${tDiff > 0 ? 'ARRIBA' : 'ABAJO'} de la línea de ${mk.total.line}.`);
  const extra = [...wxNotes, ...restNotes.filter(Boolean)];
  if (extra.length) parts.push('Factores del día: ' + extra.join(', ') + '.');
  return parts.join(' ');
}

/* ---- construir una semana completa ---- */
async function buildWeek(weekParam) {
  const curWeek = await getCurrentWeek();
  const week = Math.min(18, Math.max(1, Number(weekParam) || curWeek));

  const [games, oddsMap] = await Promise.all([
    getWeek(SEASON, week),
    getOddsApiLines(),
  ]);
  const { R, gamesLearned } = await currentRatings(week - 1);
  let results = [];
  if (week > 1) { try { results = await getSeasonResults(SEASON, week - 1); } catch (e) {} }
  const lastGame = restMap(results);

  const out = [];
  for (const g of games) {
    const th = TEAMS[g.home.abbr], ta = TEAMS[g.away.abbr];
    const rh = R[g.home.abbr], ra = R[g.away.abbr];
    if (!th || !ta || !rh || !ra) { out.push({ id: g.id, error: 'Equipo no reconocido.' }); continue; }

    /* descanso */
    const restH = restAdj(lastGame[g.home.abbr], g.date);
    const restA = restAdj(lastGame[g.away.abbr], g.date);

    /* clima: solo estadio abierto, en la sede del local, no neutral */
    let wx = null;
    const outdoor = !g.neutral && th.roof === 'open' && !g.indoor;
    if (outdoor) wx = await getWeather(th.lat, th.lon, g.date);
    const wxa = weatherAdj(outdoor ? wx : null, g.neutral ? '' : g.home.abbr);

    /* puntos esperados */
    const hfaHalf = g.neutral ? 0 : HFA / 2;
    const expHome = Math.max(9, LEAGUE_PPG + rh.off - ra.def + hfaHalf + restH.pts + wxa.each);
    const expAway = Math.max(9, LEAGUE_PPG + ra.off - rh.def - hfaHalf + restA.pts + wxa.each);

    /* simulación (semilla estable por juego y por día) */
    const seed = `${g.id}:${new Date().toISOString().slice(0, 10)}`;
    const agg = simulateGame({ expHome, expAway, seed });

    /* momios del mercado */
    const market = marketFor(g, oddsMap, { home: g.home.full, away: g.away.full });
    const mk = marketsFromSims(agg, market ? { spread: market.spread, total: market.total } : null);

    /* ---- veredictos principales ---- */
    const verdicts = [];
    // Spread
    {
      const pHome = mk.spread.home_cover;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : 1 - pHome;
      const team = side === 'home' ? g.home : g.away;
      const line = side === 'home' ? mk.spread.line : (mk.spread.line == null ? null : -mk.spread.line);
      verdicts.push({
        market: 'spread',
        label: fmtSpreadLabel(team.name, line),
        prob: +p.toFixed(3),
        edge: +(p - BE).toFixed(3),
        verdict: verdictFromProb(p, 0.555, 0.535),
        line_txt: line != null ? `${team.abbr} ${line > 0 ? '+' : ''}${line}` : null,
      });
    }
    // Total
    {
      const pOver = mk.total.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : 1 - pOver;
      verdicts.push({
        market: 'total',
        label: `${side === 'over' ? 'Más' : 'Menos'} de ${mk.total.line} puntos entre los dos`,
        prob: +p.toFixed(3),
        edge: +(p - BE).toFixed(3),
        verdict: verdictFromProb(p, 0.555, 0.535),
        line_txt: `${side === 'over' ? 'O' : 'U'} ${mk.total.line}`,
      });
    }
    // Moneyline (solo cuando el modelo discrepa del mercado)
    {
      const pHome = mk.moneyline.home;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : 1 - pHome;
      const team = side === 'home' ? g.home : g.away;
      let edge = null;
      if (market && market.ml_home_prob != null) {
        const mktP = side === 'home' ? market.ml_home_prob : market.ml_away_prob;
        edge = +(p - mktP).toFixed(3);
      }
      verdicts.push({
        market: 'moneyline',
        label: `Ganan los ${team.name}`,
        prob: +p.toFixed(3),
        edge,
        verdict: edge != null ? (edge >= 0.05 && p <= 0.78 ? 'bet' : edge >= 0.03 ? 'maybe' : 'skip')
                              : verdictFromProb(p, 0.62, 0.56),
        line_txt: `ML ${team.abbr}`,
      });
    }
    // 1ª mitad
    {
      const pOver = mk.first_half.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : 1 - pOver;
      verdicts.push({
        market: 'h1_total',
        label: `1ª mitad: ${side === 'over' ? 'más' : 'menos'} de ${mk.first_half.total_line} puntos`,
        prob: +p.toFixed(3),
        edge: +(p - BE).toFixed(3),
        verdict: verdictFromProb(p, 0.565, 0.545),
        line_txt: `1H ${side === 'over' ? 'O' : 'U'} ${mk.first_half.total_line}`,
      });
    }

    /* props del QB (secundarios) */
    const defFactor = ab => Math.min(1.12, Math.max(0.88, 1 - (R[ab].def / 35)));
    const props = {
      home: qbProps({ expPts: expHome, oppDefFactor: defFactor(g.away.abbr), windMph: wx && wx.wind_mph }),
      away: qbProps({ expPts: expAway, oppDefFactor: defFactor(g.home.abbr), windMph: wx && wx.wind_mph }),
    };

    const strength = Math.max(...verdicts.map(v => v.verdict === 'bet' ? v.prob : 0));

    out.push({
      id: g.id,
      date: g.date,
      venue: g.venue,
      neutral: g.neutral,
      home: { abbr: g.home.abbr, name: g.home.name, record: g.home.record, logo: logoUrl(g.home.abbr), city: th.city },
      away: { abbr: g.away.abbr, name: g.away.name, record: g.away.record, logo: logoUrl(g.away.abbr), city: ta.city },
      state: g.state,
      score: g.state !== 'pre' ? { home: g.home.score, away: g.away.score, detail: g.detail } : null,
      market_source: market ? market.source : null,
      weather: outdoor ? (wx ? { ...wx, notes: wxa.notes } : { pending: true }) : { roof: 'cerrado' },
      rest: { home: restH.note, away: restA.note },
      verdicts,
      markets: {
        ...mk,
        fair_odds: {
          ml_home: probToAm(mk.moneyline.home),
          ml_away: probToAm(mk.moneyline.away),
          spread_home: probToAm(mk.spread.home_cover),
          total_over: probToAm(mk.total.over),
        },
      },
      qb_props: props,
      analysis: buildAnalysis(g, mk, market, wxa.notes, [restH.note && `${g.home.name}: ${restH.note}`, restA.note && `${g.away.name}: ${restA.note}`]),
      strength: +strength.toFixed(3),
    });
  }

  return {
    season: SEASON,
    week,
    current_week: curWeek,
    sims: N_SIMS,
    games_learned: gamesLearned, // juegos 26-27 ya absorbidos por los ratings
    odds_source: oddsMap ? 'the-odds-api' : 'espn',
    games: out,
  };
}

module.exports = { buildWeek, SEASON };
