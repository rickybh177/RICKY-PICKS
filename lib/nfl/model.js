/* ============================================================
   MODELO NFL — orquestador (equivalente a lib/mx/model.js).

   buildWeek(week, seasontype) arma la semana completa:
   1. Ratings: priors 2026 ajustados por rival (2024+2025, ver
      scripts/build-nfl-priors.js) que se AUTO-ACTUALIZAN con
      cada resultado real de la 26-27 (estilo Elo sobre puntos),
      más una corrección GLOBAL del entorno anotador (muShift):
      si la liga está anotando más/menos de lo esperado, el nivel
      se corrige solo, encogido con n/(n+MU_SHIFT_N) — receta
      validada en el modelo Liga MX.
   2. Ajustes por juego: localía, descanso (semana corta/bye),
      clima real del estadio (viento/lluvia/frío/altitud) y sede
      neutral (juegos internacionales).
   3. Simulación Monte Carlo por drives (10,000 futuros por juego).
   4. Veredictos por EV REAL contra momios devigueados (The Odds
      API si hay key; ESPN BET si no), con encogimiento hacia el
      mercado (anti-sesgo de longshot, como en MX). Nunca BET con
      EV negativo; sin momios el tope es MAYBE.

   PRETEMPORADA (seasontype=1): entorno propio medido en las
   pretemporadas 2024-25 — ~19 pts por equipo, HFA de 1 punto y
   beta≈0: los ratings de temporada regular NO predicen agosto
   (corr ≈ 0, juegan los suplentes). El modelo lo dice de frente,
   se apoya más en el mercado (blend 0.5) y no hay OT: el empate
   se queda. Los resultados de pretemporada NUNCA tocan los
   ratings de la temporada regular.

   Los ratings y parámetros NUNCA salen de aquí: la API devuelve
   solo probabilidades, líneas y veredictos.
   ============================================================ */

const { PRIORS, LEAGUE_PPG, HFA, PRESEASON } = require('./priors');
const { TEAMS, logoUrl } = require('./teams');
const { getWeek, getCurrentPhase, getSeasonResults, getWeather } = require('./data');
const { getOddsApiLines, marketFor, probToAm, amToProb, devigPair } = require('./odds');
const { simulateGame, marketsFromSims, qbProps, N_SIMS } = require('./engine');

const SEASON = 2026;
const ELO_K = 0.10;        // qué tanto aprende de cada resultado (nfl-backtest)
const SURPRISE_CAP = 21;   // sorpresa máxima que se aprende por juego (pts)
const MU_SHIFT_N = 48;     // encogimiento de la corrección de entorno (~3 semanas)
const MU_SHIFT_CAP = 1.5;  // corrección máxima, pts por equipo
const PRE_WEEKS = 4, REG_WEEKS = 18;

/* ---- ratings vigentes: priors + resultados reales 26-27 ----
   Parametrizable para que el backtest inyecte sus propios priors
   y constantes (sin fuga del futuro); en runtime usa defaults.
   onPredict (opcional, para el backtest): se llama con los puntos
   esperados de cada juego ANTES de aprender su resultado —
   walk-forward honesto con exactamente la misma aritmética. */
function learnRatings(results, {
  priors = PRIORS, mu = LEAGUE_PPG, hfa = HFA,
  k = ELO_K, cap = SURPRISE_CAP, muShiftOn = true,
} = {}, onPredict) {
  const R = {};
  for (const abbr in priors) R[abbr] = { off: priors[abbr].off, def: priors[abbr].def };
  const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date));
  let obs = 0, pred = 0, n = 0, muShift = 0;
  for (const g of sorted) {
    const h = R[g.home.abbr], a = R[g.away.abbr];
    if (!h || !a) continue;
    const hfaHalf = g.neutral ? 0 : hfa / 2;
    const expH = mu + muShift + h.off - a.def + hfaHalf;
    const expA = mu + muShift + a.off - h.def - hfaHalf;
    if (onPredict) onPredict(g, expH, expA);
    obs += g.home.score + g.away.score;
    pred += expH + expA;
    n++;
    if (muShiftOn) {
      muShift = Math.max(-MU_SHIFT_CAP, Math.min(MU_SHIFT_CAP,
        ((obs - pred) / (2 * n)) * (n / (n + MU_SHIFT_N))));
    }
    const dH = Math.max(-cap, Math.min(cap, g.home.score - expH));
    const dA = Math.max(-cap, Math.min(cap, g.away.score - expA));
    h.off += k * dH; a.def -= k * dH;
    a.off += k * dA; h.def -= k * dA;
  }
  return { R, muShift: +muShift.toFixed(2), gamesLearned: n };
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

/* ---- veredictos por EV (receta del modelo MX) ----
   El EV se calcula sobre una prob ENCOGIDA hacia el devig del
   mercado: la línea trae información que el modelo no tiene
   (lesiones, QBs, dinero informado); sin el encogimiento el
   modelo regala BETs de +20% EV en underdogs (sesgo de longshot).
   La prob que se MUESTRA sigue siendo la del modelo puro.
   priceImp = prob implícita CON vig del precio a tomar (-110 si
   no hay precio publicado): nunca BET con EV negativo. */
const MKT_BLEND = 0.22;      // temporada regular
const PRE_BLEND = 0.5;       // pretemporada: el mercado sabe quién juega
const IMP_110 = 110 / 210;   // prob implícita de -110

/* Umbrales por fase. La señal de pretemporada es más débil que la
   de temporada regular, pero el dueño quiere tablero jugable en
   agosto (decisión 4-ago-2026: ~10-15 picks BET+MAYBE por semana,
   récord de pretemporada separado del de temporada). Con momios
   reales manda el EV (el blend 0.5 hacia el mercado ya modera
   solo); sin momios publicados, barras de probabilidad del modelo
   — cuando ESPN suelte las líneas (días antes de cada juego), el
   veredicto se recalcula solo contra el precio real. */
const BARS = {
  regular: { spread: { bet: 0.03, maybe: 0.01 }, total: { bet: 0.025, maybe: 0.01, floor: 0.3 }, ml: { bet: 0.03, maybe: 0.01 } },
  pre:     { spread: { bet: 0.03, maybe: 0.01 }, total: { bet: 0.025, maybe: 0.01, floor: 0.3 }, ml: { bet: 0.03, maybe: 0.01 } },
};
/* barras sin momios (prob del modelo): bet / maybe — calibradas
   para ~10-15 picks jugables por semana de 16 juegos */
const PRE_BARS_NO_ODDS = {
  spread: [0.565, 0.545],
  total: [0.565, 0.545],
  ml: [0.575, 0.53],
  h1: [0.575, 0.55],
};

function evVerdict(p, priceImp, pMarket, { bet = 0.03, maybe = 0.01, floor = 0.2, blend = MKT_BLEND } = {}) {
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

function fmtSpreadLabel(teamName, line) {
  // línea del equipo: -3.5 → "ganan por 4+"; +3.5 → "no pierden por 4+"
  if (line == null) return teamName;
  if (line < 0) return `${teamName} ganan por ${Math.ceil(Math.abs(line))} o más`;
  if (line > 0) return `${teamName} pierden por ${Math.floor(line)} o menos (o ganan)`;
  return `${teamName} ganan (línea pareja)`;
}

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(g, mk, market, wxNotes, restNotes, preseason) {
  const fav = mk.spread.exp_margin >= 0 ? g.home : g.away;
  const dog = mk.spread.exp_margin >= 0 ? g.away : g.home;
  const m = Math.abs(mk.spread.exp_margin);
  const parts = [];
  if (preseason) {
    parts.push('Pretemporada: aquí mandan los suplentes y qué coach se toma agosto en serio — el modelo usa ratings históricos de pretemporada (2021-2025), no los de la temporada.');
  }
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
async function buildWeek(weekParam, seasontypeParam) {
  const phase = await getCurrentPhase();
  const seasontype = Number(seasontypeParam) === 1 ? 1 : Number(seasontypeParam) === 2 ? 2 : phase.seasontype;
  const preseason = seasontype === 1;
  const maxWeek = preseason ? PRE_WEEKS : REG_WEEKS;
  const week = Math.min(maxWeek, Math.max(1, Number(weekParam) ||
    (seasontype === phase.seasontype ? phase.week : 1)));

  const [games, oddsMap] = await Promise.all([
    getWeek(SEASON, week, seasontype),
    getOddsApiLines(),
  ]);

  /* ratings: en regular aprenden de la 26-27; en pretemporada los
     priors se apagan (beta≈0 medido) y NADA de agosto se aprende */
  let R, muShift = 0, gamesLearned = 0, lastGame = {};
  let mu = LEAGUE_PPG, hfa = HFA;
  if (preseason) {
    /* universo aparte: ratings ajustados SOLO con pretemporadas
       previas (los de temporada regular no predicen agosto), mu y
       localía propios. Ver lib/nfl/fit.js. */
    R = {};
    for (const ab in PRESEASON.ratings) R[ab] = { ...PRESEASON.ratings[ab] };
    mu = PRESEASON.mu; hfa = PRESEASON.hfa;
    /* el entorno anotador de agosto oscila fuerte año con año
       (2021-25: 35, 39, 40, 35, 41 puntos por juego). Aprender de
       los juegos de ESTA pretemporada ayuda, pero poco: en la
       prueba, las semanas 1-2 predijeron las 3-4 con 4.2 pts de
       error contra 3.9 del promedio histórico. Por eso el
       encogimiento es fuerte — n/(n+30), no n/(n+16). */
    try {
      const weeks = await Promise.all([1, 2, 3, 4].map(w => getWeek(SEASON, w, 1)));
      let obs = 0, n = 0;
      for (const ws of weeks) for (const pg of ws) {
        if (pg.state === 'post' && pg.home.score != null && pg.away.score != null) {
          obs += pg.home.score + pg.away.score; n++;
        }
      }
      if (n > 0) {
        muShift = Math.max(-2.5, Math.min(2.5, (obs / (2 * n) - PRESEASON.mu) * (n / (n + 30))));
        muShift = +muShift.toFixed(2);
        gamesLearned = n;
      }
    } catch (e) {}
  } else {
    let results = [];
    if (week > 1) { try { results = await getSeasonResults(SEASON, week - 1); } catch (e) {} }
    const learned = learnRatings(results);
    R = learned.R; muShift = learned.muShift; gamesLearned = learned.gamesLearned;
    lastGame = restMap(results);
  }
  const blend = preseason ? PRE_BLEND : MKT_BLEND;
  const bars = preseason ? BARS.pre : BARS.regular;

  const out = [];
  for (const g of games) {
    const th = TEAMS[g.home.abbr], ta = TEAMS[g.away.abbr];
    const rh = R[g.home.abbr], ra = R[g.away.abbr];
    if (!th || !ta || !rh || !ra) { out.push({ id: g.id, error: 'Equipo no reconocido.' }); continue; }

    /* descanso (en pretemporada todos van al mismo ritmo) */
    const restH = preseason ? { pts: 0, note: null } : restAdj(lastGame[g.home.abbr], g.date);
    const restA = preseason ? { pts: 0, note: null } : restAdj(lastGame[g.away.abbr], g.date);

    /* clima: solo estadio abierto, en la sede del local, no neutral */
    let wx = null;
    const outdoor = !g.neutral && th.roof === 'open' && !g.indoor;
    if (outdoor) wx = await getWeather(th.lat, th.lon, g.date);
    const wxa = weatherAdj(outdoor ? wx : null, g.neutral ? '' : g.home.abbr);

    /* puntos esperados */
    const hfaHalf = g.neutral ? 0 : hfa / 2;
    const expHome = Math.max(8, mu + muShift + rh.off - ra.def + hfaHalf + restH.pts + wxa.each);
    const expAway = Math.max(8, mu + muShift + ra.off - rh.def - hfaHalf + restA.pts + wxa.each);

    /* simulación (semilla estable por juego y por día) */
    const seed = `${g.id}:${new Date().toISOString().slice(0, 10)}`;
    const agg = simulateGame({ expHome, expAway, seed, noOT: preseason });

    /* momios del mercado */
    const market = marketFor(g, oddsMap, { home: g.home.full, away: g.away.full });
    const mk = marketsFromSims(agg, market ? { spread: market.spread, total: market.total } : null);

    /* probs del mercado: devig por par (limpia) + precio crudo */
    const dv = market ? {
      ml: devigPair(market.ml_home_imp, market.ml_away_imp),
      spread: devigPair(market.spread_home_imp != null ? market.spread_home_imp : IMP_110,
                        market.spread_away_imp != null ? market.spread_away_imp : IMP_110),
      total: devigPair(market.total_over_imp != null ? market.total_over_imp : IMP_110,
                       market.total_under_imp != null ? market.total_under_imp : IMP_110),
    } : null;

    /* ---- veredictos principales ---- */
    const verdicts = [];
    // Spread — EV real contra el precio (si hay línea del mercado)
    {
      const pHome = mk.spread.home_cover;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : (pHome == null ? null : 1 - pHome);
      const team = side === 'home' ? g.home : g.away;
      const line = side === 'home' ? mk.spread.line : (mk.spread.line == null ? null : -mk.spread.line);
      let verdict, ev = null;
      if (market && market.spread != null && dv) {
        const priceImp = side === 'home'
          ? (market.spread_home_imp != null ? market.spread_home_imp : IMP_110)
          : (market.spread_away_imp != null ? market.spread_away_imp : IMP_110);
        const v = evVerdict(p, priceImp, side === 'home' ? dv.spread[0] : dv.spread[1], { blend, ...bars.spread });
        verdict = v.verdict; ev = v.ev;
      } else {
        // sin línea real: en regular tope MAYBE por probabilidad;
        // en pretemporada, barras del modelo (se recalcula solo
        // cuando ESPN publique la línea)
        verdict = preseason ? barVerdict(p, PRE_BARS_NO_ODDS.spread[0], PRE_BARS_NO_ODDS.spread[1]) : barVerdict(p, 1.01, 0.57);
      }
      const hasLine = !!(market && market.spread != null);
      verdicts.push({
        market: 'spread',
        label: fmtSpreadLabel(team.name, line),
        prob: p != null ? +p.toFixed(3) : null,
        edge: ev, verdict,
        line_txt: (line != null ? `${team.abbr} ${line > 0 ? '+' : ''}${line}` : null) +
          (hasLine ? '' : ' · línea del modelo, aún sin momios'),
      });
    }
    // Total
    {
      const pOver = mk.total.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : (pOver == null ? null : 1 - pOver);
      let verdict, ev = null;
      if (market && market.total != null && dv) {
        const priceImp = side === 'over'
          ? (market.total_over_imp != null ? market.total_over_imp : IMP_110)
          : (market.total_under_imp != null ? market.total_under_imp : IMP_110);
        const v = evVerdict(p, priceImp, side === 'over' ? dv.total[0] : dv.total[1], { blend, ...bars.total });
        verdict = v.verdict; ev = v.ev;
      } else {
        verdict = preseason ? barVerdict(p, PRE_BARS_NO_ODDS.total[0], PRE_BARS_NO_ODDS.total[1]) : barVerdict(p, 1.01, 0.57);
      }
      const hasLine = !!(market && market.total != null);
      verdicts.push({
        market: 'total',
        label: `${side === 'over' ? 'Más' : 'Menos'} de ${mk.total.line} puntos entre los dos`,
        prob: p != null ? +p.toFixed(3) : null,
        edge: ev, verdict,
        line_txt: `${side === 'over' ? 'O' : 'U'} ${mk.total.line} · modelo espera ${mk.total.model_total}` +
          (hasLine ? '' : ' · línea del modelo, aún sin momios'),
      });
    }
    // Moneyline
    {
      const pHome = mk.moneyline.home;
      const side = pHome >= 0.5 ? 'home' : 'away';
      const p = side === 'home' ? pHome : 1 - pHome;
      const team = side === 'home' ? g.home : g.away;
      let verdict, ev = null;
      const priceImp = market ? (side === 'home' ? market.ml_home_imp : market.ml_away_imp) : null;
      if (priceImp != null && dv) {
        const v = evVerdict(p, priceImp, side === 'home' ? dv.ml[0] : dv.ml[1], { blend, ...bars.ml });
        verdict = v.verdict; ev = v.ev;
      } else {
        verdict = preseason
          ? barVerdict(p, PRE_BARS_NO_ODDS.ml[0], PRE_BARS_NO_ODDS.ml[1])
          : barVerdict(p, 1.01, 0.60); // regular sin precio: tope MAYBE
      }
      verdicts.push({
        market: 'moneyline',
        label: `Ganan los ${team.name}`,
        prob: +p.toFixed(3),
        edge: ev, verdict,
        line_txt: `ML ${team.abbr}` + (priceImp != null ? ` (${probToAm(priceImp) > 0 ? '+' : ''}${probToAm(priceImp)})` : ' · aún sin momios'),
      });
    }
    // 1ª mitad (sin momios publicados: barras, tope MAYBE)
    {
      const pOver = mk.first_half.over;
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : (pOver == null ? null : 1 - pOver);
      verdicts.push({
        market: 'h1_total',
        label: `1ª mitad: ${side === 'over' ? 'más' : 'menos'} de ${mk.first_half.total_line} puntos`,
        prob: p != null ? +p.toFixed(3) : null,
        edge: null,
        verdict: preseason
          ? barVerdict(p, PRE_BARS_NO_ODDS.h1[0], PRE_BARS_NO_ODDS.h1[1])
          : barVerdict(p, 1.01, 0.575),
        line_txt: `1H ${side === 'over' ? 'O' : 'U'} ${mk.first_half.total_line}`,
      });
    }

    /* props del QB — solo temporada regular (en pretemporada el
       titular juega un cuarto: la proyección sería mentira) */
    let props = null;
    if (!preseason) {
      const defFactor = ab => Math.min(1.12, Math.max(0.88, 1 - (R[ab].def / 35)));
      props = {
        home: qbProps({ expPts: expHome, oppDefFactor: defFactor(g.away.abbr), windMph: wx && wx.wind_mph }),
        away: qbProps({ expPts: expAway, oppDefFactor: defFactor(g.home.abbr), windMph: wx && wx.wind_mph }),
      };
    }

    const strength = Math.max(0, ...verdicts.map(v => v.verdict === 'bet' ? v.prob : 0));

    out.push({
      id: g.id,
      date: g.date,
      venue: g.venue,
      neutral: g.neutral,
      /* marca para llevar el récord de pretemporada SEPARADO del de
         temporada regular (decisión del dueño 4-ago-2026) */
      preseason: preseason || undefined,
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
        /* momios REALES del mercado, para mostrarlos junto a los
           del modelo (lección MX: sin esto el usuario solo ve el
           precio "justo" y cree que los momios están mal) */
        market_odds: market ? {
          source: market.source,
          spread: market.spread,
          total: market.total,
          ml_home: probToAm(market.ml_home_imp),
          ml_away: probToAm(market.ml_away_imp),
        } : null,
        fair_odds: {
          ml_home: probToAm(mk.moneyline.home),
          ml_away: probToAm(mk.moneyline.away),
          spread_home: probToAm(mk.spread.home_cover),
          total_over: probToAm(mk.total.over),
        },
      },
      qb_props: props,
      analysis: buildAnalysis(g, mk, market, wxa.notes, [restH.note && `${g.home.name}: ${restH.note}`, restA.note && `${g.away.name}: ${restA.note}`], preseason),
      strength: +strength.toFixed(3),
    });
  }

  return {
    season: SEASON,
    seasontype,
    phase: preseason ? 'pretemporada' : 'regular',
    week,
    max_week: maxWeek,
    current_phase: phase,
    sims: N_SIMS,
    games_learned: gamesLearned, // juegos 26-27 ya absorbidos por los ratings
    mu_shift: muShift,
    odds_source: oddsMap ? 'the-odds-api' : 'espn',
    games: out,
  };
}

module.exports = { buildWeek, learnRatings, SEASON };
