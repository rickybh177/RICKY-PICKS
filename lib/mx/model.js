/* ============================================================
   MODELO LIGA MX — orquestador (equivalente a lib/nfl/model.js).

   buildBoard() arma la cartelera visible (ayer → +9 días):
   1. Ratings: priors Dixon-Coles ajustados sobre 2.5 años de
      resultados (scripts/build-mx-priors.js) que se ACTUALIZAN
      solos con cada resultado del Apertura 2026 (paso de
      gradiente Poisson por juego, estilo Elo). Cero mantenimiento.
   2. Ajustes por partido: localía, ALTITUD de la sede real (la
      firma de la Liga MX: CDMX/Toluca/Pachuca castigan al que
      sube), descanso corto por doble jornada.
   3. Matriz exacta de marcadores (Dixon-Coles) → todos los
      mercados: 1X2, doble oportunidad, totales, ambos anotan,
      hándicap, marcador exacto, 1ª mitad, córneres.
   4. Veredictos BET/MAYBE/SKIP: con EV real contra los momios
      de DraftKings (scoreboard de ESPN) cuando existen; con
      barras calibradas cuando no.

   Coeficientes y ratings NUNCA salen de aquí: el API devuelve
   solo probabilidades, líneas y veredictos.
   ============================================================ */

const { LEAGUE, PRIORS, CORNERS } = require('./priors');
const { TEAMS, venueAltitude, logoUrl } = require('./teams');
const { getWindow, getSeasonResults, getMatchStats } = require('./data');
const {
  dcMatrix, marketsFromMatrix, firstHalfMarkets, cornersMarkets,
  ahCover, overProb, amToProb, probToAm, devig,
} = require('./engine');
const { getLigaMxOdds, findMxOdds } = require('../odds/theoddsapi');

const TOURNAMENT = 'Apertura 2026';
const SGD_K = 0.025;       // qué tanto aprende de cada resultado (backtest C2026: óptimo 0.02–0.035)
const SGD_CAP = 2.2;       // sorpresa máxima que se aprende por juego (goles)
const MU_SHIFT_N = 80;     // encogimiento de la corrección goleadora de liga
const MU_SHIFT_CAP = 0.08;
const REST_DAYS_SHORT = 4.5;
const REST_MULT = 0.97;    // doble jornada: −3% de goles esperados
const LAM_MIN = 0.15, LAM_MAX = 4.2;

/* goles esperados de UN partido con los ratings R dados.
   LG parametrizable para que el backtest inyecte sus propios
   parámetros de liga (sin fuga del futuro); en runtime siempre
   es LEAGUE. */
function lambdas(R, g, LG = LEAGUE) {
  const rh = R[g.home.abbr], ra = R[g.away.abbr];
  if (!rh || !ra) return null;
  const va = venueAltitude(g.venueCity, g.home.abbr);
  const awayAlt = TEAMS[g.away.abbr] ? TEAMS[g.away.abbr].altM : 1000;
  const altKm = Math.min(2.3, Math.max(0, (va - awayAlt) / 1000));
  const lh = Math.exp(LG.mu + LG.hfa + rh.att + ra.def + LG.altC * altKm);
  const la = Math.exp(LG.mu + ra.att + rh.def - LG.altC * altKm);
  return { lh, la, altKm };
}

/* paso de aprendizaje con UN resultado (gradiente Poisson, capado) */
function sgdUpdate(R, g, LG = LEAGUE, k = SGD_K) {
  const L = lambdas(R, g, LG);
  if (!L) return;
  const dH = Math.max(-SGD_CAP, Math.min(SGD_CAP, g.home.score - L.lh));
  const dA = Math.max(-SGD_CAP, Math.min(SGD_CAP, g.away.score - L.la));
  R[g.home.abbr].att += k * dH;
  R[g.away.abbr].def += k * dH;
  R[g.away.abbr].att += k * dA;
  R[g.home.abbr].def += k * dA;
}

/* ratings vigentes: priors + todos los resultados del torneo.
   Además de los ratings por equipo, aprende una corrección
   GLOBAL del entorno goleador (muShift): si el torneo está
   anotando más/menos de lo que la historia decía, el nivel de
   liga se corrige solo, encogido con n/(n+MU_SHIFT_N). El
   backtest del C2026 mostró exactamente esa deriva (+5% de
   goles vs la historia) — sin esto, O/U y BTTS salen sesgados
   a la baja todo el torneo. */
function currentRatings(results, priors = PRIORS, LG = LEAGUE, k = SGD_K) {
  const R = {};
  for (const t in priors) R[t] = { att: priors[t].att, def: priors[t].def };
  const sorted = [...results].sort((a, b) => new Date(a.date) - new Date(b.date));
  let obs = 0, pred = 0, n = 0, muShift = 0;
  for (const g of sorted) {
    if (!R[g.home.abbr] || !R[g.away.abbr]) continue;
    const LGdyn = { ...LG, mu: LG.mu + muShift };
    const L = lambdas(R, g, LGdyn);
    obs += g.home.score + g.away.score;
    pred += L.lh + L.la;
    n++;
    // pseudo-goles (8) para que un 0-0 temprano no mueva la liga entera
    muShift = Math.max(-MU_SHIFT_CAP, Math.min(MU_SHIFT_CAP,
      Math.log((obs + 8) / (pred + 8)) * (n / (n + MU_SHIFT_N))));
    sgdUpdate(R, g, LGdyn, k);
  }
  return { R, muShift: +muShift.toFixed(4) };
}

/* ---- descanso: días desde el último juego de liga ---- */
function restInfo(lastMs, kickoffISO) {
  if (!lastMs) return { mult: 1, note: null };
  const days = (new Date(kickoffISO).getTime() - lastMs) / 86400000;
  if (days < REST_DAYS_SHORT) return { mult: REST_MULT, note: 'doble jornada (descanso corto)' };
  return { mult: 1, note: null };
}

/* ---- córneres: priors mezclados con el torneo en curso ---- */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const CORNER_PRIOR_W = 12; // pseudo-juegos del prior
async function cornerRates(results) {
  const recent = results.slice(-40); // tope de summaries por corrida
  const stats = await mapLimit(recent, 6, async g => ({ g, s: await getMatchStats(g.id) }));
  const acc = {};
  const cMu = (LEAGUE.corners_home + LEAGUE.corners_away) / 2;
  for (const { g, s } of stats) {
    if (!s || !s.home || !s.away || s.home.corners == null || s.away.corners == null) continue;
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const ab = g[side].abbr;
      acc[ab] = acc[ab] || { f: 0, a: 0, n: 0 };
      acc[ab].f += s[side].corners; acc[ab].a += s[opp].corners; acc[ab].n++;
    }
  }
  const rates = {};
  for (const t in TEAMS) {
    const prior = CORNERS[t] || { f: 1, a: 1 };
    const c = acc[t];
    if (c && c.n > 0) {
      rates[t] = {
        f: (prior.f * CORNER_PRIOR_W + (c.f / c.n / cMu) * c.n) / (CORNER_PRIOR_W + c.n),
        a: (prior.a * CORNER_PRIOR_W + (c.a / c.n / cMu) * c.n) / (CORNER_PRIOR_W + c.n),
      };
    } else rates[t] = prior;
  }
  return rates;
}

/* ---- veredictos ---- */
/* Con momios reales el EV se calcula sobre una prob ENCOGIDA
   hacia el mercado (72% modelo + 28% cierre): la línea de cierre
   trae información que el modelo no tiene (lesiones, rotaciones,
   dinero informado), y sin el encogimiento el modelo regala BETs
   de +20% de EV en underdogs — el clásico sesgo de longshot.
   La prob que se MUESTRA sigue siendo la del modelo puro. */
const MKT_BLEND = 0.22;
function evVerdict(p, amOdds, pMarket, { bet = 0.05, maybe = 0.02, floor = 0.2 } = {}) {
  if (p == null || amOdds == null) return { verdict: 'skip', ev: null };
  const imp = amToProb(amOdds);
  if (imp == null) return { verdict: 'skip', ev: null };
  const pb = pMarket != null ? (1 - MKT_BLEND) * p + MKT_BLEND * pMarket : p;
  const dec = 1 / imp;
  const ev = pb * dec - 1;
  let verdict = 'skip';
  if (pb >= floor && ev >= bet) verdict = 'bet';
  else if (pb >= floor && ev >= maybe) verdict = 'maybe';
  return { verdict, ev: +ev.toFixed(3) };
}
function barVerdict(p, barBet, barMaybe) {
  if (p == null) return 'skip';
  if (p >= barBet) return 'bet';
  if (p >= barMaybe) return 'maybe';
  return 'skip';
}

const fmtPct = p => Math.round(p * 100) + '%';

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(g, L, mk, market, notes) {
  const parts = [];
  const home = TEAMS[g.home.abbr] ? TEAMS[g.home.abbr].name : g.home.name;
  const away = TEAMS[g.away.abbr] ? TEAMS[g.away.abbr].name : g.away.name;
  const ml = mk.moneyline;
  const fav = ml.home >= ml.away ? home : away;
  const pFav = Math.max(ml.home, ml.away);
  if (Math.abs(ml.home - ml.away) < 0.07) {
    parts.push(`El modelo ve un partido cerrado: ${fmtPct(ml.home)} ${home}, ${fmtPct(ml.draw)} empate, ${fmtPct(ml.away)} ${away}.`);
  } else {
    parts.push(`El modelo favorece a ${fav} (${fmtPct(pFav)} de ganar, con ${fmtPct(ml.draw)} de empate).`);
  }
  parts.push(`Goles esperados: ${L.lh.toFixed(2)} del local vs ${L.la.toFixed(2)} de la visita.`);
  if (market && market.ml_home != null) {
    const imp = devig([amToProb(market.ml_home), amToProb(market.ml_draw), amToProb(market.ml_away)]);
    const edges = [ml.home - imp[0], ml.draw - imp[1], ml.away - imp[2]];
    const names = [`${home} gana`, 'el empate', `${away} gana`];
    const bi = edges.indexOf(Math.max(...edges));
    if (edges[bi] >= 0.03) parts.push(`Contra los momios, el valor está en ${names[bi]}: el mercado le da ${fmtPct(imp[bi])} y el modelo ${fmtPct([ml.home, ml.draw, ml.away][bi])}.`);
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

/* ---- jornada estimada (no viene en el API): juegos por equipo ---- */
function jornadaOf(results) {
  const gp = {};
  for (const t in TEAMS) gp[t] = 0;
  for (const g of results) {
    if (gp[g.home.abbr] != null) gp[g.home.abbr]++;
    if (gp[g.away.abbr] != null) gp[g.away.abbr]++;
  }
  const vals = Object.values(gp).sort((a, b) => a - b);
  return Math.min(17, vals[Math.floor(vals.length / 2)] + 1);
}

/* ---- construir la cartelera completa ---- */
async function buildBoard() {
  const [windowGames, results, consensusOdds] = await Promise.all([
    getWindow(), getSeasonResults(), getLigaMxOdds(),
  ]);
  const { R, muShift } = currentRatings(results);
  const LG = { ...LEAGUE, mu: LEAGUE.mu + muShift };
  const corners = await cornerRates(results);

  // último juego por equipo (para descanso)
  const lastGame = {};
  for (const g of results) {
    const d = new Date(g.date).getTime();
    for (const side of ['home', 'away']) {
      const ab = g[side].abbr;
      if (!lastGame[ab] || d > lastGame[ab]) lastGame[ab] = d;
    }
  }

  const out = [];
  for (const g of windowGames) {
    const th = TEAMS[g.home.abbr], ta = TEAMS[g.away.abbr];
    if (!th || !ta) { out.push({ id: g.id, error: 'Equipo no reconocido.' }); continue; }

    const restH = restInfo(lastGame[g.home.abbr], g.date);
    const restA = restInfo(lastGame[g.away.abbr], g.date);

    const L = lambdas(R, g, LG);
    let lh = Math.min(LAM_MAX, Math.max(LAM_MIN, L.lh * restH.mult));
    let la = Math.min(LAM_MAX, Math.max(LAM_MIN, L.la * restA.mult));

    const P = dcMatrix(lh, la, LG.rho);
    const mk = marketsFromMatrix(P, lh, la);
    const h1 = firstHalfMarkets(lh, la, LG.rho);
    const cr = cornersMarkets(
      LEAGUE.corners_home * corners[g.home.abbr].f * corners[g.away.abbr].a,
      LEAGUE.corners_away * corners[g.away.abbr].f * corners[g.home.abbr].a,
      null
    );

    /* momios del mercado: consenso multi-casas (The Odds API) con
       preferencia; DraftKings vía ESPN como respaldo. El spread (AH)
       solo viene de ESPN, así que se conserva de ahí en ambos casos. */
    const espnMkt = g.market && (g.market.ml_home != null || g.market.total_line != null) ? g.market : null;
    const cons = findMxOdds(consensusOdds, g.home.abbr, g.away.abbr, g.date);
    let market = espnMkt;
    if (cons && cons.ml_home != null && cons.ml_away != null) {
      market = {
        provider: `consenso ${cons.books} casas`,
        ml_home: cons.ml_home,
        ml_draw: cons.ml_draw,
        ml_away: cons.ml_away,
        total_line: cons.total_line != null ? cons.total_line : (espnMkt ? espnMkt.total_line : null),
        total_over_odds: cons.total_over_odds != null ? cons.total_over_odds : (espnMkt ? espnMkt.total_over_odds : null),
        total_under_odds: cons.total_under_odds != null ? cons.total_under_odds : (espnMkt ? espnMkt.total_under_odds : null),
        spread_line: espnMkt ? espnMkt.spread_line : null,
        spread_home_odds: espnMkt ? espnMkt.spread_home_odds : null,
        spread_away_odds: espnMkt ? espnMkt.spread_away_odds : null,
      };
    }

    /* notas de contexto */
    const notes = [];
    if (L.altKm >= 0.7) notes.push(`la sede está ${Math.round(L.altKm * 1000)} m por encima de la casa de ${ta.name} — la altitud pesa`);
    if (restH.note) notes.push(`${th.name}: ${restH.note}`);
    if (restA.note) notes.push(`${ta.name}: ${restA.note}`);

    /* ---- veredictos principales ---- */
    const verdicts = [];

    // 1X2 — muestra el resultado con valor si lo hay; si no, el favorito del modelo
    {
      const opts = [
        { key: 'home', label: `Gana ${th.name}`, p: mk.moneyline.home, am: market && market.ml_home, txt: `1X2 ${g.home.abbr}` },
        { key: 'draw', label: 'Empate', p: mk.moneyline.draw, am: market && market.ml_draw, txt: '1X2 empate' },
        { key: 'away', label: `Gana ${ta.name}`, p: mk.moneyline.away, am: market && market.ml_away, txt: `1X2 ${g.away.abbr}` },
      ];
      let best = null;
      if (market && market.ml_home != null && market.ml_draw != null && market.ml_away != null) {
        const imp = devig([amToProb(market.ml_home), amToProb(market.ml_draw), amToProb(market.ml_away)]);
        opts.forEach((o, i) => {
          const v = evVerdict(o.p, o.am, imp[i]);
          o.ev = v.ev; o.verdict = v.verdict;
        });
        // el de mejor EV solo si es apostable; si no, el favorito del modelo
        const value = opts.filter(o => o.verdict !== 'skip').sort((a, b) => b.ev - a.ev)[0];
        best = value || [...opts].sort((a, b) => b.p - a.p)[0];
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

    // Doble oportunidad — el "seguro" del partido: 1X o X2 (el 12 vive en el detalle)
    {
      const opts = [
        { label: `${th.name} o empate (1X)`, p: mk.double_chance.home_draw, txt: 'DC 1X' },
        { label: `${ta.name} o empate (X2)`, p: mk.double_chance.away_draw, txt: 'DC X2' },
      ];
      const best = opts.sort((a, b) => b.p - a.p)[0];
      verdicts.push({
        market: 'double_chance', label: best.label, prob: +best.p.toFixed(3),
        edge: null, verdict: barVerdict(best.p, 0.80, 0.72),
        line_txt: best.txt + ' · modelo ' + (probToAm(best.p) > 0 ? '+' : '') + probToAm(best.p),
      });
    }

    // Total de goles (línea del mercado si hay; 2.5 si no)
    {
      const line = market && market.total_line != null ? market.total_line : 2.5;
      const found = mk.totals.find(t => t.line === line);
      const pOver = found ? found.over : overProb(P, line);
      const side = pOver >= 0.5 ? 'over' : 'under';
      const p = side === 'over' ? pOver : 1 - pOver;
      const am = market ? (side === 'over' ? market.total_over_odds : market.total_under_odds) : null;
      let verdict, ev = null;
      if (am != null) {
        const impO = amToProb(market.total_over_odds), impU = amToProb(market.total_under_odds);
        const [dO, dU] = devig([impO, impU]);
        const pMkt = side === 'over' ? dO : dU;
        const v = evVerdict(p, am, pMkt, { bet: 0.04, maybe: 0.015, floor: 0.3 });
        verdict = v.verdict; ev = v.ev;
      } else {
        verdict = barVerdict(p, 1.01, 0.575); // sin precio: tope en MAYBE
      }
      verdicts.push({
        market: 'total',
        label: `${side === 'over' ? 'Más' : 'Menos'} de ${line} goles`,
        prob: +p.toFixed(3), edge: ev, verdict,
        line_txt: `${side === 'over' ? 'O' : 'U'} ${line} · modelo espera ${mk.model_total}`,
      });
    }

    // Ambos anotan (sin momios en el scoreboard: barras)
    {
      const side = mk.btts.yes >= 0.5 ? 'yes' : 'no';
      const p = side === 'yes' ? mk.btts.yes : mk.btts.no;
      verdicts.push({
        market: 'btts',
        label: side === 'yes' ? 'Ambos equipos anotan: SÍ' : 'Ambos equipos anotan: NO',
        prob: +p.toFixed(3), edge: null,
        verdict: barVerdict(p, 0.575, 0.55),
        line_txt: 'BTTS · modelo ' + (probToAm(p) > 0 ? '+' : '') + probToAm(p),
      });
    }

    /* hándicap asiático del mercado (detalle) */
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
      home: { abbr: g.home.abbr, name: th.name, form: g.home.form, record: g.home.record, logo: logoUrl(g.home.abbr) },
      away: { abbr: g.away.abbr, name: ta.name, form: g.away.form, record: g.away.record, logo: logoUrl(g.away.abbr) },
      state: g.state,
      detail: g.detail,
      score: g.state !== 'pre' ? { home: g.home.score, away: g.away.score } : null,
      altitude_m: Math.round(L.altKm * 1000) || 0,
      rest: { home: restH.note, away: restA.note },
      market_source: market ? (market.provider || 'sportsbook') : null,
      verdicts,
      markets: {
        moneyline: {
          home: +mk.moneyline.home.toFixed(3), draw: +mk.moneyline.draw.toFixed(3), away: +mk.moneyline.away.toFixed(3),
          fair: { home: probToAm(mk.moneyline.home), draw: probToAm(mk.moneyline.draw), away: probToAm(mk.moneyline.away) },
        },
        /* momios REALES del mercado (consenso o DK), para mostrarlos
           junto a los del modelo — sin esto el usuario solo ve el
           precio "modelo" y cree que los momios están mal */
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
      analysis: buildAnalysis(g, { lh, la }, mk, market, notes),
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
    tournament: TOURNAMENT,
    jornada: jornadaOf(results),
    method: 'Matriz exacta de marcadores (Dixon-Coles) — sin simulación, probabilidad exacta de cada marcador',
    games_learned: results.length,
    mu_shift: muShift,
    odds_source: consensusOdds && consensusOdds.length
      ? 'consenso del mercado (multi-casas)'
      : 'DraftKings (ESPN)',
    league: {
      avg_goals: +(LEAGUE.avg_home_goals + LEAGUE.avg_away_goals).toFixed(2),
      draw_rate: LEAGUE.draw_rate,
      fit_games: LEAGUE.fit_games,
    },
    games: out,
  };
}

module.exports = { buildBoard, currentRatings, sgdUpdate, lambdas, TOURNAMENT };
