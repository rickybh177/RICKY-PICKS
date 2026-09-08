/* ============================================================
   MODELOS DE EUROPA — orquestador (equivalente a lib/mx/model.js
   para Premier League, LaLiga y Bundesliga; una liga por llamada).

   buildBoard(leagueId) arma la cartelera visible (ayer → +9 días):
   1. Ratings: priors Dixon-Coles ajustados sobre cuatro temporadas
      (scripts/build-euro-priors.js → lib/euro/priors/<liga>.js) que
      se ACTUALIZAN solos con cada resultado de 2026-27 (paso de
      gradiente Poisson por juego + corrección global del entorno
      goleador). El ciclo de aprendizaje vive en lib/euro/core.js y
      es EL MISMO que mide scripts/euro-backtest.js — aquí no se
      re-implementa nada, solo se orquesta.
   2. Ajustes por partido: localía y descanso corto (jornada entre
      semana). Sin altitud: es Europa.
   3. Matriz exacta de marcadores (Dixon-Coles, lib/mx/engine.js —
      el motor es agnóstico de liga) → todos los mercados: 1X2,
      doble oportunidad, totales, ambos anotan, hándicap, marcador
      exacto, 1ª mitad, córneres.
   4. Veredictos BET/MAYBE/SKIP: con EV real contra el consenso de
      The Odds API cuando existe; con barras calibradas cuando no.
      Las barras y el encogimiento hacia el mercado salen de CAL en
      el archivo de priors (nunca se escriben aquí).

   Identidad por id de ESPN (string) en todo: ratings, priors,
   córneres y momios. La abreviatura es solo para mostrar.

   Coeficientes y ratings NUNCA salen de aquí: el API devuelve solo
   probabilidades, líneas, veredictos y texto.
   ============================================================ */

const { LEAGUES, TEAMS, logoUrl } = require('./leagues');
const { getWindow, getSeasonResults, getMatchStats } = require('./data');
const core = require('./core');
const {
  dcMatrix, marketsFromMatrix, firstHalfMarkets, cornersMarkets,
  ahCover, overProb, amToProb, probToAm, devig,
} = require('../mx/engine');
const { getSoccerOdds, findSoccerOdds } = require('../odds/theoddsapi');
const { nameToId } = require('./oddsnames');

/* El EV contra el mercado (barras, encogimiento, piso del 1X2) vive
   en lib/euro/core.js: es el mismo código que mide el backtest
   contra cierres reales. Aquí solo se orquesta. */

/* Priors + calibración por liga, del archivo GENERADO por
   scripts/build-euro-priors.js. Requires estáticos (no un template
   string) para que el empaquetador de Vercel los rastree y los meta
   al bundle del lambda. Nunca se copian valores a mano: si el script
   regenera el archivo, el runtime lo sigue en el próximo despliegue. */
const PRIORS_FILES = {
  epl: require('./priors/epl'),
  laliga: require('./priors/laliga'),
  bundesliga: require('./priors/bundesliga'),
  ucl: require('./priors/ucl'),   // generado por scripts/build-ucl-priors.js (ajuste conjunto)
};
function priorsOf(leagueId) {
  const p = PRIORS_FILES[leagueId];
  if (!p) throw new Error(`Sin priors para la liga: ${leagueId}`);
  return { LEAGUE: p.LEAGUE, PRIORS: p.PRIORS, CORNERS: p.CORNERS || {}, CAL: core.withDefaults(p.CAL) };
}

/* Config de liga o error claro. */
function cfgOf(leagueId) {
  const cfg = LEAGUES[leagueId];
  if (!cfg || !cfg.enabled) throw new Error(`Liga no disponible: ${leagueId}`);
  return cfg;
}

/* Ascendido (o debutante europeo, en copa) sin historia en la ventana
   del fit: sus priors son exactamente el ancla. Sirve para avisarlo en
   el análisis, no cambia ningún cálculo. */
function isPromoted(P, LEAGUE, id) {
  const a = LEAGUE.promoted_anchor, r = P[id];
  return !!(a && r && r.att === a.att && r.def === a.def);
}

/* ---- córneres: priors mezclados con la temporada en curso ---- */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const CORNER_PRIOR_W = 12; // pseudo-juegos del prior
const CORNER_MAX_SUMMARIES = 40; // tope de summaries por corrida (como Liga MX)
async function cornerRates(leagueId, results, { LEAGUE, CORNERS }) {
  const recent = results.slice(-CORNER_MAX_SUMMARIES);
  const stats = await mapLimit(recent, 6, async g => ({ g, s: await getMatchStats(leagueId, g.id) }));
  const acc = {};
  const cMu = (LEAGUE.corners_home + LEAGUE.corners_away) / 2;
  for (const { g, s } of stats) {
    if (!s || !s.home || !s.away || s.home.corners == null || s.away.corners == null) continue;
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const id = g[side].id;
      acc[id] = acc[id] || { f: 0, a: 0, n: 0 };
      acc[id].f += s[side].corners; acc[id].a += s[opp].corners; acc[id].n++;
    }
  }
  const rates = {};
  for (const id in TEAMS[leagueId]) {
    const prior = CORNERS[id] || { f: 1, a: 1 };
    const c = acc[id];
    if (c && c.n > 0) {
      rates[id] = {
        f: (prior.f * CORNER_PRIOR_W + (c.f / c.n / cMu) * c.n) / (CORNER_PRIOR_W + c.n),
        a: (prior.a * CORNER_PRIOR_W + (c.a / c.n / cMu) * c.n) / (CORNER_PRIOR_W + c.n),
      };
    } else rates[id] = prior;
  }
  return rates;
}

/* ---- veredictos sin precio: barras calibradas ---- */
function barVerdict(p, barBet, barMaybe) {
  if (p == null) return 'skip';
  if (p >= barBet) return 'bet';
  if (p >= barMaybe) return 'maybe';
  return 'skip';
}

const fmtPct = p => Math.round(p * 100) + '%';

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(cfg, names, L, mk, market, notes, promoted) {
  const parts = [];
  const { home, away } = names;
  // liga: recién ascendido · copa: debutante europeo (también aprende de su liga)
  const cup = cfg.type === 'cup';
  const quien = cup ? 'debutante en Europa' : 'recién ascendido';
  const perfil = cup ? 'el perfil típico del debutante' : 'el perfil típico del ascendido';
  const ritmo = cup ? 'con cada partido, también los de su liga' : 'con cada jornada';
  const ml = mk.moneyline;
  const fav = ml.home >= ml.away ? home : away;
  const pFav = Math.max(ml.home, ml.away);
  if (Math.abs(ml.home - ml.away) < 0.07) {
    parts.push(`En ${cfg.name} el modelo ve un partido cerrado: ${fmtPct(ml.home)} ${home}, ${fmtPct(ml.draw)} empate, ${fmtPct(ml.away)} ${away}.`);
  } else {
    parts.push(`En ${cfg.name} el modelo favorece a ${fav} (${fmtPct(pFav)} de ganar, con ${fmtPct(ml.draw)} de empate).`);
  }
  if (promoted.home && promoted.away) parts.push(`${home} y ${away} son ${quien}s: el modelo los arranca con ${perfil} y aprende partido a partido.`);
  else if (promoted.home) parts.push(`${home} es ${quien}: arranca con ${perfil} y el modelo lo va ajustando ${ritmo}.`);
  else if (promoted.away) parts.push(`${away} es ${quien}: arranca con ${perfil} y el modelo lo va ajustando ${ritmo}.`);
  parts.push(`Goles esperados: ${L.lh.toFixed(2)} del local vs ${L.la.toFixed(2)} de la visita.`);
  if (market && market.ml_home != null) {
    const imp = devig([amToProb(market.ml_home), amToProb(market.ml_draw), amToProb(market.ml_away)]);
    const edges = [ml.home - imp[0], ml.draw - imp[1], ml.away - imp[2]];
    const labels = [`${home} gana`, 'el empate', `${away} gana`];
    const bi = edges.indexOf(Math.max(...edges));
    if (edges[bi] >= 0.03) parts.push(`Contra los momios, el valor está en ${labels[bi]}: el mercado le da ${fmtPct(imp[bi])} y el modelo ${fmtPct([ml.home, ml.draw, ml.away][bi])}.`);
    else parts.push('Los momios están muy alineados con el modelo: sin ventaja clara en el 1X2.');
  }
  const t25 = mk.totals.find(t => t.line === 2.5);
  if (t25 && (t25.over >= 0.58 || t25.over <= 0.42)) {
    parts.push(`En goles, el modelo espera ${mk.model_total} en total: ${t25.over >= 0.58 ? 'partido para MÁS de 2.5' : 'partido para MENOS de 2.5'} (${fmtPct(Math.max(t25.over, 1 - t25.over))}).`);
  }
  if (notes.length) parts.push('Factores: ' + notes.join('; ') + '.');
  const top = mk.exact_scores[0];
  if (top) parts.push(`Marcador más probable: ${top.score} (${fmtPct(top.p)}).`);
  return parts.join(' ');
}

/* ---- jornada estimada (no viene en el API): mediana de juegos
   por equipo + 1, topada al total de jornadas de la liga ---- */
function jornadaOf(leagueId, results, rounds) {
  const gp = {};
  for (const id in TEAMS[leagueId]) gp[id] = 0;
  for (const g of results) {
    if (gp[g.home.id] != null) gp[g.home.id]++;
    if (gp[g.away.id] != null) gp[g.away.id]++;
  }
  const vals = Object.values(gp).sort((a, b) => a - b);
  if (!vals.length) return 1;
  return Math.min(rounds, vals[Math.floor(vals.length / 2)] + 1);
}

/* ---- copas: fase de la competencia para la cabecera ----
   La Champions no tiene "jornada" fuera de la fase de liga: la fase
   sale del season.slug de los partidos por jugar de la ventana
   (ESPN: league-phase, knockout-round-playoffs, round-of-16…). En
   la fase de liga se numera como jornada (mediana + 1, topada a 8). */
const STAGE_LABEL = {
  'knockout-round-playoffs': 'Playoffs', 'round-of-16': 'Octavos de final',
  'quarterfinals': 'Cuartos de final', 'semifinals': 'Semifinales', 'final': 'Final',
};
function phaseLabel(cfg, windowGames, jornada) {
  if (cfg.type !== 'cup') return null;
  const pending = windowGames.filter(g => g.state !== 'post');
  const pool = pending.length ? pending : windowGames;
  const counts = {};
  for (const g of pool) counts[g.seasonSlug || ''] = (counts[g.seasonSlug || ''] || 0) + 1;
  const slug = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  if (!slug || slug === 'league-phase') return `Jornada ${jornada} de ${cfg.rounds}`;
  return STAGE_LABEL[slug] || 'Eliminatoria';
}

/* Ratings vigentes de la liga (priors + temporada en curso), con el
   mismo ciclo que el backtest. Exportado para diagnósticos de
   scripts; el API nunca lo expone. */
function currentRatings(leagueId, results) {
  const { LEAGUE, PRIORS, CAL } = priorsOf(leagueId);
  return core.currentRatings(results, PRIORS, LEAGUE, CAL);
}

/* ---- construir la cartelera completa de UNA liga ---- */
async function buildBoard(leagueId) {
  const cfg = cfgOf(leagueId);
  const { LEAGUE, PRIORS, CORNERS, CAL } = priorsOf(leagueId);
  const teams = TEAMS[leagueId] || {};

  /* Copa (Champions): además de sus propios resultados, aprende de la
     liga de cada club (cfg.learnFrom). Los partidos propios llevan la
     etiqueta cfg.comp ('uefa') y los domésticos 'dom': el núcleo les
     aplica su propio nivel y localía (LEAGUE.comps.dom) y muShift solo
     se alimenta de la competencia que se predice. Para las ligas
     normales nada de esto existe y el flujo es el de siempre. */
  const learnLeagues = cfg.learnFrom || [];
  const [windowRaw, ownResults, consensusOdds, ...domestic] = await Promise.all([
    getWindow(leagueId),
    getSeasonResults(leagueId),
    getSoccerOdds(cfg.oddsKey, nameToId[leagueId]), // única fuente de momios (caché 60 min)
    ...learnLeagues.map(l => getSeasonResults(l).catch(() => [])),
  ]);
  const tag = (list, comp) => (comp ? list.map(g => ({ ...g, comp })) : list);
  const windowGames = tag(windowRaw, cfg.comp);
  const results = [...tag(ownResults, cfg.comp), ...domestic.flatMap(list => tag(list, 'dom'))];
  /* rival doméstico sin prior (recién ascendido en su liga): arranca con
     el ancla, como un debutante — así su partido contra un club de la
     copa sí enseña algo en vez de saltarse. En liga no pasa (PRIORS
     trae a toda la plantilla). */
  const P = { ...PRIORS };
  for (const g of results) for (const id of [g.home.id, g.away.id]) {
    if (id && !P[id]) P[id] = { ...LEAGUE.promoted_anchor };
  }
  const { R, muShift, learned } = core.currentRatings(results, P, LEAGUE, CAL);
  const LG = { ...LEAGUE, mu: LEAGUE.mu + muShift };
  const corners = await cornerRates(leagueId, ownResults, { LEAGUE, CORNERS });

  /* último juego por equipo (para el descanso). Solo cuenta la LIGA:
     los partidos de copa europea (Champions, Europa League) o de
     copa nacional entre semana no entran en el scoreboard de la
     liga, así que un equipo que jugó el martes en Champions se ve
     aquí como descansado. Limitación conocida; se acepta. */
  const lastGame = {};
  for (const g of results) {
    const d = new Date(g.date).getTime();
    for (const side of ['home', 'away']) {
      const id = g[side].id;
      if (!lastGame[id] || d > lastGame[id]) lastGame[id] = d;
    }
  }

  const out = [];
  for (const g of windowGames) {
    const th = teams[g.home.id], ta = teams[g.away.id];
    if (!th || !ta || !R[g.home.id] || !R[g.away.id]) {
      out.push({ id: g.id, error: 'Equipo no reconocido.' });
      continue;
    }

    const restH = core.restInfo(lastGame[g.home.id], g.date, CAL);
    const restA = core.restInfo(lastGame[g.away.id], g.date, CAL);

    const L = core.lambdas(R, g, LG);
    const lh = core.clampLambda(L.lh * restH.mult);
    const la = core.clampLambda(L.la * restA.mult);

    const P = dcMatrix(lh, la, LG.rho);
    const mk = marketsFromMatrix(P, lh, la);
    const h1 = firstHalfMarkets(lh, la, LG.rho);
    const cr = cornersMarkets(
      LEAGUE.corners_home * corners[g.home.id].f * corners[g.away.id].a,
      LEAGUE.corners_away * corners[g.away.id].f * corners[g.home.id].a,
      null
    );

    /* momios del mercado: SOLO consenso multi-casas (The Odds API).
       Sin match → sin momios: los veredictos se topan en MAYBE, no
       se inventa precio. */
    const cons = findSoccerOdds(consensusOdds, g.home.id, g.away.id, g.date);
    let market = null;
    if (cons && cons.ml_home != null && cons.ml_away != null) {
      market = {
        provider: `consenso ${cons.books} casas`,
        ml_home: cons.ml_home,
        ml_draw: cons.ml_draw,
        ml_away: cons.ml_away,
        total_line: cons.total_line,
        total_over_odds: cons.total_over_odds,
        total_under_odds: cons.total_under_odds,
        spread_line: null, spread_home_odds: null, spread_away_odds: null,
      };
    }

    /* notas de contexto */
    const notes = [];
    if (restH.note) notes.push(`${th.name}: ${restH.note}`);
    if (restA.note) notes.push(`${ta.name}: ${restA.note}`);
    const promoted = { home: isPromoted(PRIORS, LEAGUE, g.home.id), away: isPromoted(PRIORS, LEAGUE, g.away.id) };

    /* ---- veredictos principales ---- */
    const verdicts = [];

    // 1X2 — el resultado con valor si lo hay; si no, el favorito del modelo
    {
      const opts = [
        { key: 'home', label: `Gana ${th.name}`, p: mk.moneyline.home, am: market && market.ml_home, txt: `1X2 ${th.abbr}` },
        { key: 'draw', label: 'Empate', p: mk.moneyline.draw, am: market && market.ml_draw, txt: '1X2 empate' },
        { key: 'away', label: `Gana ${ta.name}`, p: mk.moneyline.away, am: market && market.ml_away, txt: `1X2 ${ta.abbr}` },
      ];
      let best = null;
      // con momios: EV de los tres resultados (core.ev1x2, el mismo del backtest)
      const evs = market ? core.ev1x2(opts.map(o => o.p), [market.ml_home, market.ml_draw, market.ml_away], CAL) : null;
      if (evs) {
        opts.forEach((o, i) => { o.ev = evs[i].ev; o.verdict = evs[i].verdict; });
        const vi = core.bestValueIndex(evs);
        best = vi >= 0 ? opts[vi] : [...opts].sort((a, b) => b.p - a.p)[0];
      }
      if (!best) {
        // sin momios publicados no hay precio que ganar: tope en MAYBE
        best = [...opts].sort((a, b) => b.p - a.p)[0];
        best.verdict = barVerdict(best.p, 1.01, 0.52);
        best.ev = null;
      }
      verdicts.push({
        market: '1x2', label: best.label, prob: +best.p.toFixed(3),
        edge: best.ev != null ? best.ev : null, verdict: best.verdict,
        line_txt: best.txt + (best.am != null ? ` (${best.am > 0 ? '+' : ''}${best.am})` : ' · aún sin momios'),
      });
    }

    // Doble oportunidad — el "seguro" del partido: 1X o X2 (barras de CAL)
    {
      const opts = [
        { label: `${th.name} o empate (1X)`, p: mk.double_chance.home_draw, txt: 'DC 1X' },
        { label: `${ta.name} o empate (X2)`, p: mk.double_chance.away_draw, txt: 'DC X2' },
      ];
      const best = opts.sort((a, b) => b.p - a.p)[0];
      verdicts.push({
        market: 'double_chance', label: best.label, prob: +best.p.toFixed(3),
        edge: null, verdict: barVerdict(best.p, CAL.dcBet, CAL.dcMaybe),
        line_txt: best.txt + ' · modelo ' + (probToAm(best.p) > 0 ? '+' : '') + probToAm(best.p),
      });
    }

    // Total de goles (línea del mercado si hay; 2.5 si no)
    {
      const line = market && market.total_line != null ? market.total_line : 2.5;
      const found = mk.totals.find(t => t.line === line);
      const pOver = found ? found.over : overProb(P, line);
      // EV contra el par over/under de ESA línea (core.evTotal, el mismo del backtest)
      const t = core.evTotal(pOver, market ? market.total_over_odds : null, market ? market.total_under_odds : null, CAL);
      const { side, p } = t;
      let verdict = t.verdict, ev = t.ev;
      if (verdict == null) verdict = barVerdict(p, 1.01, 0.575); // sin precio: tope en MAYBE
      verdicts.push({
        market: 'total',
        label: `${side === 'over' ? 'Más' : 'Menos'} de ${line} goles`,
        prob: +p.toFixed(3), edge: ev, verdict,
        line_txt: `${side === 'over' ? 'O' : 'U'} ${line} · modelo espera ${mk.model_total}`,
      });
    }

    // Ambos anotan (sin momios de BTTS en el consenso: barras de CAL)
    {
      const side = mk.btts.yes >= 0.5 ? 'yes' : 'no';
      const p = side === 'yes' ? mk.btts.yes : mk.btts.no;
      verdicts.push({
        market: 'btts',
        label: side === 'yes' ? 'Ambos equipos anotan: SÍ' : 'Ambos equipos anotan: NO',
        prob: +p.toFixed(3), edge: null,
        verdict: barVerdict(p, CAL.bttsBet, CAL.bttsMaybe),
        line_txt: 'BTTS · modelo ' + (probToAm(p) > 0 ? '+' : '') + probToAm(p),
      });
    }

    /* hándicap asiático del mercado (detalle; el consenso h2h/totals
       no lo trae, queda listo por si algún día se pide spreads) */
    let ah = null;
    if (market && market.spread_line != null) {
      const cover = ahCover(P, market.spread_line);
      ah = { line: market.spread_line, home_cover: cover != null ? +cover.toFixed(3) : null };
    }

    const strength = Math.max(0, ...verdicts.map(v => v.verdict === 'bet' ? v.prob : 0));

    out.push({
      id: g.id,
      date: g.date,
      venue: g.venue,
      venue_city: g.venueCity,
      home: { id: g.home.id, abbr: th.abbr, name: th.name, form: g.home.form, record: g.home.record, logo: logoUrl(g.home.id) },
      away: { id: g.away.id, abbr: ta.abbr, name: ta.name, form: g.away.form, record: g.away.record, logo: logoUrl(g.away.id) },
      state: g.state,
      detail: g.detail,
      score: g.state !== 'pre' ? { home: g.home.score, away: g.away.score } : null,
      rest: { home: restH.note, away: restA.note },
      market_source: market ? (market.provider || 'sportsbook') : null,
      verdicts,
      markets: {
        moneyline: {
          home: +mk.moneyline.home.toFixed(3), draw: +mk.moneyline.draw.toFixed(3), away: +mk.moneyline.away.toFixed(3),
          fair: { home: probToAm(mk.moneyline.home), draw: probToAm(mk.moneyline.draw), away: probToAm(mk.moneyline.away) },
        },
        /* momios REALES del mercado, para mostrarlos junto a los del
           modelo — sin esto el usuario solo ve el precio "modelo" y
           cree que los momios están mal */
        market_odds: market ? {
          ml_home: market.ml_home, ml_draw: market.ml_draw, ml_away: market.ml_away,
          total_line: market.total_line,
          total_over: market.total_over_odds, total_under: market.total_under_odds,
        } : null,
        double_chance: {
          home_draw: +mk.double_chance.home_draw.toFixed(3),
          away_draw: +mk.double_chance.away_draw.toFixed(3),
          home_away: +mk.double_chance.home_away.toFixed(3),
        },
        dnb: { home: +mk.dnb.home.toFixed(3), away: +mk.dnb.away.toFixed(3) },
        totals: mk.totals.map(t => ({ line: t.line, over: +t.over.toFixed(3) })),
        model_total: mk.model_total,
        btts: { yes: +mk.btts.yes.toFixed(3), no: +mk.btts.no.toFixed(3) },
        team_totals: mk.team_totals,
        clean_sheet: { home: +mk.clean_sheet.home.toFixed(3), away: +mk.clean_sheet.away.toFixed(3) },
        exact_scores: mk.exact_scores,
        margin_dist: mk.margin_dist,
        first_half: {
          home: +h1.home.toFixed(3), draw: +h1.draw.toFixed(3), away: +h1.away.toFixed(3),
          over_05: +h1.over_05.toFixed(3), over_15: +h1.over_15.toFixed(3), model_total: h1.model_total,
        },
        corners: cr,
        asian_handicap: ah,
      },
      analysis: buildAnalysis(cfg, { home: th.name, away: ta.name }, { lh, la }, mk, market, notes, promoted),
      strength: +strength.toFixed(3),
    });
  }

  // próximos primero dentro de la cartelera; terminados al final
  out.sort((a, b) => {
    const sa = a.state === 'post' ? 1 : 0, sb = b.state === 'post' ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return new Date(a.date) - new Date(b.date);
  });

  return {
    tournament: `${cfg.name} ${cfg.seasonLabel}`,
    league_id: cfg.id,
    league_name: cfg.name,
    league_flag: cfg.flag,
    season_label: cfg.seasonLabel,
    rounds: cfg.rounds,
    jornada: jornadaOf(leagueId, ownResults, cfg.rounds),
    phase_label: phaseLabel(cfg, windowGames, jornadaOf(leagueId, ownResults, cfg.rounds)), // solo copas
    method: 'Matriz exacta de marcadores (Dixon-Coles) — sin simulación, probabilidad exacta de cada marcador',
    games_learned: ownResults.length,      // partidos propios de la temporada
    games_learned_total: learned,          // incluye los de liga de los que también aprende (copa)
    mu_shift: muShift,
    odds_source: consensusOdds && consensusOdds.length
      ? 'consenso del mercado (multi-casas)'
      : null, // única fuente The Odds API; null = sin key o sin cobertura
    league: {
      avg_goals: +(LEAGUE.avg_home_goals + LEAGUE.avg_away_goals).toFixed(2),
      draw_rate: LEAGUE.draw_rate,
      fit_games: LEAGUE.fit_games,
    },
    /* parámetros del EV para que la página replique los veredictos
       con los momios del usuario (solo barras y encogimiento, nada
       del modelo) */
    ev_params: { blend: CAL.mktBlend, ...core.evBars(CAL) },
    games: out,
  };
}

module.exports = {
  buildBoard,
  currentRatings,
  sgdUpdate: core.sgdUpdate,
  lambdas: core.lambdas,
};
