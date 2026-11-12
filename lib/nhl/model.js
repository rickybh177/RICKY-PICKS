/* ============================================================
   MODELO NHL 2026-27 — orquestador (equivalente a lib/nba/model.js).

   buildBoard({ day }) arma la cartelera de hoy y mañana (hora CDMX):
   1. Ratings: priors 2026-27 ajustados por rival (4 temporadas, ver
      scripts/build-nhl-priors.js) que se AUTO-ACTUALIZAN con cada
      resultado de la 2026-27 (goles reglamentarios sin puerta vacía,
      mezclados con los "merecidos" por tiros a puerta), más la
      corrección global del entorno goleador (muShift). El historial de
      la temporada vive en lib/nhl/season.js (estático + KV).
   2. Ajustes por juego: localía, segundo juego en dos noches y el
      PORTERO probable que publica ESPN (su nivel contra la mezcla de
      porteros habitual del equipo).
   3. Mercados en forma cerrada (lib/nhl/engine.js): ganador con tiempo
      extra, línea de gol ±1.5, total, resultado a 60 minutos (3 vías),
      totales por equipo y 1er periodo.
   4. Veredictos y PICK PRINCIPAL por partido (lib/nhl/verdicts.js): EV
      real contra momios devigueados (The Odds API, única fuente), con
      encogimiento hacia el mercado.

   Los ratings y parámetros NUNCA salen de aquí: la API devuelve solo
   probabilidades, líneas, veredictos y texto.
   ============================================================ */

const { PRIORS, LEAGUE, PARAMS, DISP, GOALIES, TEAM_REF } = require('./priors');
const { TEAMS, logoUrl } = require('./teams');
const { getRange, addDays } = require('./data');
const { DEFAULTS, learnRatings, expectation, restCategory, REST_NOTE, goalieDelta } = require('./core');
const { markets: buildMarkets } = require('./engine');
const { loadSeason, SEASON } = require('./season');
const { getNhlOdds, findNhlOdds, probToAm } = require('./odds');
const { decide, sidesOf, NO_PICK_TXT, RULES } = require('./verdicts');
const { kvGet, kvPut } = require('../odds/theoddsapi');

const MX_TZ = 'America/Mexico_City';
const P = Object.assign({}, DEFAULTS, PARAMS);
/* el portero "Expected" de ESPN todavía puede cambiar: su ajuste pesa menos */
const GOALIE_W = { confirmed: 1, expected: 0.7 };
const GOALIE_ES = { confirmed: 'confirmado', expected: 'probable' };

const fmtLine = l => (l > 0 ? '+' : '') + l;
const pc = p => Math.round(p * 100);
function plGloss(line) {
  if (line == null) return '';
  if (line < 0) return `gana por ${Math.floor(Math.abs(line)) + 1} o más goles`;
  const m = Math.ceil(line) - 1;
  return m === 1 ? 'gana, o pierde por 1 gol (también vale si pierde en tiempo extra)' : `gana, o pierde por ${m} o menos`;
}

/* fecha CDMX (YYYY-MM-DD) de un instante */
function mxDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MX_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/* ---- análisis en español, para humanos ---- */
function buildAnalysis(g, mk, market, dv, notes, guarded) {
  const homeFav = mk.moneyline.home >= 0.5;
  const fav = homeFav ? g.home : g.away, dog = homeFav ? g.away : g.home;
  const pFav = homeFav ? mk.moneyline.home : mk.moneyline.away;
  const eF = homeFav ? mk.dist.exp_home : mk.dist.exp_away, eD = homeFav ? mk.dist.exp_away : mk.dist.exp_home;
  const parts = [];
  if (pFav < 0.535) parts.push(`El modelo ve un juego de volado entre ${g.away.name} y ${g.home.name} (${pc(pFav)}% para ${fav.name}), con ${mk.dist.exp_total.toFixed(1)} goles esperados entre los dos.`);
  else parts.push(`El modelo le da a ${fav.name} ${pc(pFav)}% de ganar contra ${dog.name} y espera un marcador de ${eF.toFixed(1)} a ${eD.toFixed(1)} goles.`);
  parts.push(`Hay ${pc(mk.regulation.draw)}% de probabilidad de que lleguen empatados al final de los 60 minutos; ahí el tiempo extra es casi un volado.`);
  if (market && dv) {
    const pm = homeFav ? dv[0] : dv[1];
    const diff = pFav - pm;
    if (guarded) parts.push(`El mercado le da ${pc(pm)}% a ${fav.name}: está muy lejos del modelo. Casi siempre es un portero o una baja que el modelo todavía no ve. Mejor esperar.`);
    else if (Math.abs(diff) >= 0.035) parts.push(`La casa lo paga como si ${fav.name} ganara ${pc(pm)}% de las veces; el modelo ve ${pc(pFav)}%: ${diff > 0 ? `el precio de ${fav.name} está barato` : `el valor está del lado de ${dog.name}`}.`);
    else parts.push('El mercado y el modelo ven casi lo mismo en el ganador: sin ventaja clara ahí.');
  }
  if (market && market.total != null) {
    const tDiff = mk.total.model_total - market.total;
    if (Math.abs(tDiff) >= 0.4) parts.push(`En goles totales el modelo espera ${mk.total.model_total.toFixed(1)}, ${tDiff > 0 ? 'ARRIBA' : 'ABAJO'} de la línea de ${market.total}.`);
  }
  if (notes.length) parts.push('Factores del día: ' + notes.join('; ') + '.');
  return parts.join(' ');
}

/* ---- construir la cartelera ---- */
async function buildBoard({ day } = {}) {
  const now = Date.now();
  // 1) temporada en curso (estático + delta KV + juegos nuevos)
  const season = await loadSeason({ update: true });

  // 2) ratings al día (el recorrido también deja al día a los porteros)
  const learned = learnRatings(season.games, { priors: PRIORS, league: LEAGUE, params: PARAMS, goalies: GOALIES, teamRef: TEAM_REF });
  const R = learned.R;

  // 3) cartelera: hoy y mañana (CDMX), o el día pedido
  const days = day ? [day] : [mxDate(now), mxDate(now + 86400000)];
  const center = day ? new Date(day + 'T18:00:00Z') : new Date(now);
  const sched = await getRange(addDays(center, -2), addDays(center, 2));
  const slate = sched.filter(g => days.includes(mxDate(g.date)) && TEAMS[g.home.abbr] && TEAMS[g.away.abbr])
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const oddsList = await getNhlOdds().catch(() => null);

  /* ¿viene de jugar la noche anterior? Se mira el calendario, no solo
     los juegos ya aprendidos: el juego de HOY todavía no termina y ya
     cansa al equipo para el de MAÑANA. */
  const prevOf = (abbr, g) => {
    const t = new Date(g.date).getTime();
    const ds = (learned.prevDates[abbr] || []).filter(x => x < t);
    for (const s of sched) if (s.id !== g.id && (s.home.abbr === abbr || s.away.abbr === abbr)) { const ts = new Date(s.date).getTime(); if (ts < t) ds.push(ts); }
    return ds.sort((a, b) => a - b);
  };

  const out = [];
  for (const g of slate) {
    const th = TEAMS[g.home.abbr], ta = TEAMS[g.away.abbr];
    if (!R[g.home.abbr] || !R[g.away.abbr]) { out.push({ id: g.id, error: 'Equipo no reconocido.' }); continue; }
    // ESPN manda el apodo en inglés; el nombre visible es el nuestro
    g.home.name = th.name; g.away.name = ta.name;

    const rcH = restCategory(prevOf(g.home.abbr, g), g.date), rcA = restCategory(prevOf(g.away.abbr, g), g.date);
    // portero probable de ESPN → diferencial contra lo habitual del equipo
    const gk = (side, abbr) => {
      const x = side.goalie;
      if (!x || !x.id) return { d: 0, info: null };
      const st = String(x.status || '').toLowerCase();
      const w = GOALIE_W[st] != null ? GOALIE_W[st] : 0.7;
      const raw = goalieDelta(learned.G, learned.teamRef, abbr, x.id, P);
      return { d: raw * w, info: { name: x.name, status: GOALIE_ES[st] || 'probable' }, raw };
    };
    const gH = gk(g.home, g.home.abbr), gA = gk(g.away, g.away.abbr);
    const ctx = { muShift: learned.muShift, b2bHome: rcH.cat === 'b2b', b2bAway: rcA.cat === 'b2b', gdHome: gH.d, gdAway: gA.d };
    const e = expectation(R, g, LEAGUE, ctx, P);

    // momios (The Odds API, única fuente)
    const market = findNhlOdds(oddsList, g.home.abbr, g.away.abbr, g.date);
    const full = buildMarkets({ lamHome: e.lh, lamAway: e.la, disp: DISP, lines: market ? { pl: market.pl, total: market.total } : null });
    const { _raw, ...mk } = full;
    const sides = sidesOf(mk, market);
    const dec = decide(sides);
    const dvMl = market ? [sides.ml[0].pMkt, sides.ml[1].pMkt] : null;
    const teamOf = s => (s === 'home' ? g.home : g.away);
    const probableTxt = r => (r.kind === 'probable' ? (r.priced ? ' · lo más probable; el precio es justo' : ' · pick por probabilidad del modelo') : '');

    const verdicts = [];
    // Ganador
    const rMl = dec.rows.ml;
    {
      const t = teamOf(rMl.side);
      verdicts.push({
        market: 'moneyline', label: `Ganador: ${t.name}`, prob: +rMl.p.toFixed(3), edge: rMl.ev, verdict: rMl.verdict, kind: rMl.kind,
        line_txt: `${t.abbr} gana el juego, con tiempo extra y penales` + (rMl.imp != null ? ` · ${fmtLine(probToAm(rMl.imp))}` : ' · aún sin momios') + probableTxt(rMl) + (dec.guarded ? ' · el mercado está lejos del modelo' : ''),
      });
    }
    // Línea de gol
    const rPl = dec.rows.pl;
    {
      const t = teamOf(rPl.side);
      const line = rPl.side === 'home' ? mk.puck_line.line : -mk.puck_line.line;
      verdicts.push({
        market: 'puck_line', label: `Línea de gol: ${t.name} ${fmtLine(line)}`, prob: +rPl.p.toFixed(3), edge: rPl.ev, verdict: rPl.verdict, kind: rPl.kind,
        line_txt: `${t.abbr} ${plGloss(line)}` + (rPl.imp != null ? ` · ${fmtLine(probToAm(rPl.imp))}` : ' · aún sin momios'),
      });
    }
    // Total
    const rTo = dec.rows.total;
    {
      verdicts.push({
        market: 'total', label: `Total: ${rTo.side === 'over' ? 'Más' : 'Menos'} de ${mk.total.line} goles`, prob: +rTo.p.toFixed(3), edge: rTo.ev, verdict: rTo.verdict, kind: rTo.kind,
        line_txt: `entre los dos, con tiempo extra · modelo espera ${mk.total.model_total.toFixed(1)}` + (rTo.imp != null ? ` · ${fmtLine(probToAm(rTo.imp))}` : ' · línea del modelo, aún sin momios'),
      });
    }
    /* 60 minutos (3 vías). Las casas europeas sí lo pagan (consenso de
       las casas de 3 vías), así que lleva EV; pero no hay cierres
       históricos de este mercado para validarlo: tope MAYBE. */
    {
      const outs = [
        { k: 'home', p: mk.regulation.home, imp: market ? market.reg_home_imp : null },
        { k: 'draw', p: mk.regulation.draw, imp: market ? market.reg_draw_imp : null },
        { k: 'away', p: mk.regulation.away, imp: market ? market.reg_away_imp : null },
      ];
      const priced = outs.every(o => o.imp != null && o.imp > 0);
      const sumImp = priced ? outs.reduce((s, o) => s + o.imp, 0) : null;
      for (const o of outs) o.ev = priced ? ((1 - RULES.BLEND) * o.p + RULES.BLEND * (o.imp / sumImp)) / o.imp - 1 : null;
      const likely = outs.slice().sort((a, b) => b.p - a.p)[0];
      const best = priced ? outs.slice().sort((a, b) => b.ev - a.ev)[0] : null;
      const o = best && best.ev >= RULES.MAYBE_EV && best.p >= 0.2 ? best : likely;
      const verdict = priced ? (o.ev >= RULES.MAYBE_EV && o.p >= 0.2 ? 'maybe' : 'skip') : (o.p >= 0.5 ? 'maybe' : 'skip');
      const ev = o.ev != null ? Math.round(o.ev * 1000) / 1000 : null;
      verdicts.push({
        market: 'reg60', label: o.k === 'draw' ? '60 minutos: empate' : `60 minutos: gana ${teamOf(o.k).name}`, prob: +o.p.toFixed(3), edge: ev === 0 ? 0 : ev, verdict,
        line_txt: 'solo tiempo reglamentario, sin tiempo extra' + (priced ? ` · ${fmtLine(probToAm(o.imp))}` : ` · empate ${pc(mk.regulation.draw)}% · aún sin momios`),
      });
    }

    /* la conclusión del partido, en una frase */
    const KEY_IX = { ml: 0, pl: 1, total: 2 };
    let main_pick = null, conclusion;
    const favSide = mk.moneyline.home >= 0.5 ? 'home' : 'away';
    if (dec.main != null) {
      const v = verdicts[KEY_IX[dec.main]], r = dec.rows[dec.main];
      main_pick = { market: v.market, label: v.label, prob: v.prob, edge: v.edge, kind: v.kind };
      const pm = r.pMkt != null ? pc(r.pMkt) : null, pp = pc(v.prob);
      conclusion = v.kind === 'valor'
        ? `El modelo le da ${pp}% y la casa lo paga como si fuera ${pm}%: ahí está la ventaja.`
        : r.priced
          ? `Es el resultado más probable (${pp}%). El precio es justo: no paga de más, pero es la jugada clara del partido.`
          : `Es el resultado más probable (${pp}%). Aún sin momios: cuando salgan, el modelo revisa si hay algo mejor.`;
    } else {
      const lean = ` Si tuviera que elegir, el modelo se inclina por ${teamOf(favSide).name} (${pc(mk.moneyline[favSide])}% de ganar).`;
      conclusion = (NO_PICK_TXT[dec.reason] || NO_PICK_TXT.parejo) + (dec.reason === 'mercado_lejos' ? '' : lean);
    }
    /* ya empezó y no hay foto previa (freezeStarted la pone si existe) */
    if (g.state !== 'pre') conclusion = main_pick ? `Era el pick antes de empezar (${pc(main_pick.prob)}%).` : 'El partido ya empezó: el modelo no alcanzó a dejar un pick con momios.';

    const notes = [];
    if (REST_NOTE[rcH.cat]) notes.push(`${g.home.name}: ${REST_NOTE[rcH.cat]}`);
    if (REST_NOTE[rcA.cat]) notes.push(`${g.away.name}: ${REST_NOTE[rcA.cat]}`);
    for (const [t, x] of [[g.home, gH], [g.away, gA]]) {
      if (!x.info) continue;
      const rel = x.raw != null && Math.abs(x.raw) >= 0.003 ? (x.raw > 0 ? ', mejor que el portero habitual del equipo' : ', por debajo del portero habitual del equipo') : '';
      notes.push(`${t.name} sale con ${x.info.name} en la portería (${x.info.status}${rel})`);
    }

    const strength = Math.max(0, ...verdicts.map(v => (v.verdict === 'bet' ? v.prob : 0)));
    out.push({
      id: g.id, date: g.date, day_mx: mxDate(g.date), venue: g.venue, neutral: g.neutral,
      home: { abbr: g.home.abbr, name: g.home.name, record: g.home.record, logo: logoUrl(g.home.abbr), city: th.city },
      away: { abbr: g.away.abbr, name: g.away.name, record: g.away.record, logo: logoUrl(g.away.abbr), city: ta.city },
      state: g.state,
      score: g.state !== 'pre' ? { home: g.home.score, away: g.away.score, detail: g.detail } : null,
      market_source: market ? market.source : null,
      rest: { home: REST_NOTE[rcH.cat] || null, away: REST_NOTE[rcA.cat] || null },
      goalies: { home: gH.info, away: gA.info },
      verdicts,
      /* el PICK del partido y su porqué en una frase (o por qué no hay) */
      main_pick, conclusion,
      markets: {
        ...mk,
        market_odds: market ? {
          source: market.source, pl: market.pl, total: market.total,
          ml_home: probToAm(market.ml_home_imp), ml_away: probToAm(market.ml_away_imp),
          pl_home: probToAm(market.pl_home_imp), pl_away: probToAm(market.pl_away_imp),
          total_over: probToAm(market.total_over_imp), total_under: probToAm(market.total_under_imp),
          reg_home: probToAm(market.reg_home_imp), reg_draw: probToAm(market.reg_draw_imp), reg_away: probToAm(market.reg_away_imp),
        } : null,
        fair_odds: {
          ml_home: probToAm(mk.moneyline.home), ml_away: probToAm(mk.moneyline.away),
          pl_home: probToAm(mk.puck_line.home_cover), total_over: probToAm(mk.total.over),
        },
      },
      analysis: buildAnalysis(g, mk, market, dvMl, notes, dec.guarded),
      strength: +strength.toFixed(3),
    });
  }

  await freezeStarted(out, days);

  return {
    season: SEASON,
    days,
    games_learned: learned.gamesLearned,
    mu_shift: learned.muShift,
    season_last_date: season.lastDate,
    odds_source: oddsList ? 'the-odds-api' : null,
    games: out,
  };
}

/* ---- juegos que ya empezaron: se congela lo último que dijo el modelo
   ANTES del inicio (mismo mecanismo que NBA). Al arrancar el partido
   los momios previos desaparecen y el tablero se quedaría sin pick
   justo cuando la gente lo está viendo. Una foto por día (CDMX) en el
   KV: cada corrida actualiza la de los juegos por empezar y la reusa
   para los que ya empezaron. ---- */
async function freezeStarted(games, days) {
  for (const day of days) {
    const mine = games.filter(g => !g.error && g.day_mx === day);
    if (!mine.length) continue;
    const key = 'nhl-snap-' + day;
    let snap = null;
    try { snap = await kvGet(key); } catch (e) {}
    snap = snap && typeof snap === 'object' ? snap : {};
    const before = JSON.stringify(snap);
    for (const g of mine) {
      const lostOdds = g.state === 'pre' && !g.markets.market_odds && snap[g.id] && snap[g.id].market_odds
        && new Date(g.date).getTime() - Date.now() < 3 * 3600e3;
      if (g.state === 'pre' && !lostOdds) {
        snap[g.id] = { verdicts: g.verdicts, main_pick: g.main_pick, conclusion: g.conclusion, market_odds: g.markets.market_odds, market_source: g.market_source };
      } else if (snap[g.id]) {
        const s = snap[g.id];
        g.verdicts = s.verdicts; g.main_pick = s.main_pick; g.conclusion = s.conclusion;
        g.markets.market_odds = s.market_odds; g.market_source = s.market_source;
        g.frozen = true;
        g.strength = +Math.max(0, ...g.verdicts.map(v => (v.verdict === 'bet' ? v.prob : 0))).toFixed(3);
      }
    }
    if (JSON.stringify(snap) !== before) { try { await kvPut(key, snap); } catch (e) {} }
  }
}

module.exports = { buildBoard, mxDate, RULES, SEASON };
