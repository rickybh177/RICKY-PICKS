/* ============================================================
   MODELO MLB — orquestador (equivalente a lib/model.js del fútbol).

   Junta datos reales del día (calendario, abridores, lineups,
   clima), construye las tasas por PA de cada matchup con
   shrinkage bayesiano, corre la simulación Monte Carlo y
   devuelve SOLO probabilidades y esperados.

   Las tasas, splits y parámetros NUNCA salen de aquí.
   ============================================================ */

const { getSchedule, getPeople, getTeamSplit, getLeagueHitting } = require('./statsapi');
const { parkFor, teamMeta, weatherMods } = require('./parks');
const { FALLBACK_LEAGUE, precomputeSide, simulateGame, marketsFromAgg, probOverHist } = require('./engine');
const { getMarketMap, findMarket } = require('./market');

/* Breakeven a -110: lo que hay que ganar para salir tablas. */
const BE_110 = 0.5238;

const N_SIMS = 10000;
const SEASON = () => String(new Date().getFullYear());

/* Ventaja de local: boost al bateo del local y nerf al visitante
   (equivale a boost del pitcheo local). Calibrada al 52.2% real
   de la temporada 2026 (1,356 juegos al 6-jul), no al 54% histórico. */
const HOME_BAT_BOOST = 1.015;
const AWAY_BAT_NERF = 0.985;

/* Shrinkage (Bayes empírico) por outcome: PAs "ficticios" hacia el
   prior. Tasas que estabilizan rápido (K) reciben menos; las
   ruidosas (HR, XBH) más. */
const SHRINK_K = { bb: 120, k: 60, hr: 170, d3: 300, d2: 300, s1: 200 };

/* ---- tasas por PA desde un blob de stats de la API ---- */
function ratesFromHitting(stat) {
  const pa = Number(stat && stat.plateAppearances) || 0;
  if (!pa) return null;
  const g = k => Number(stat[k]) || 0;
  const hits = g('hits'), d2 = g('doubles'), d3 = g('triples'), hr = g('homeRuns');
  return {
    n: pa,
    bb: (g('baseOnBalls') + g('hitByPitch')) / pa,
    k: g('strikeOuts') / pa,
    hr: hr / pa,
    d3: d3 / pa,
    d2: d2 / pa,
    s1: (hits - d2 - d3 - hr) / pa,
  };
}
function ratesFromPitching(stat) {
  const bf = Number(stat && stat.battersFaced) || 0;
  if (!bf) return null;
  const g = k => Number(stat[k]) || 0;
  const hits = g('hits'), d2 = g('doubles'), d3 = g('triples'), hr = g('homeRuns');
  const hbp = g('hitBatsmen') || g('hitByPitch');
  return {
    n: bf,
    bb: (g('baseOnBalls') + hbp) / bf,
    k: g('strikeOuts') / bf,
    hr: hr / bf,
    d3: d3 / bf,
    d2: d2 / bf,
    s1: (hits - d2 - d3 - hr) / bf,
  };
}

/* Encoge `r` (con muestra r.n) hacia el prior por outcome. */
function shrink(r, prior) {
  if (!r) return { ...prior };
  const out = {};
  for (const o of ['bb', 'k', 'hr', 'd3', 'd2', 's1']) {
    const K = SHRINK_K[o];
    out[o] = (r[o] * r.n + prior[o] * K) / (r.n + K);
  }
  return out;
}

/* Tasa efectiva de un bateador contra mano de pitcher:
   temporada → liga, luego split vs mano → temporada encogida. */
function batterVs(person, pitchHand, lg) {
  if (!person) return { ...lg };
  const season = shrink(ratesFromHitting(person.hitting.season), lg);
  const splitStat = pitchHand === 'L' ? person.hitting.vl : person.hitting.vr;
  return shrink(ratesFromHitting(splitStat), season);
}

/* Tasa efectiva de un pitcher contra lado del bateador. */
function pitcherVs(person, batSide, lg) {
  if (!person) return { ...lg };
  const season = shrink(ratesFromPitching(person.pitching.season), lg);
  const splitStat = batSide === 'L' ? person.pitching.vl : person.pitching.vr;
  return shrink(ratesFromPitching(splitStat), season);
}

/* Lado con el que batea vs una mano de pitcher (ambidiestros
   batean del lado contrario al brazo del pitcher). */
function effectiveBatSide(bats, pitchHand) {
  if (bats === 'S') return pitchHand === 'L' ? 'R' : 'L';
  return bats || 'R';
}

function boost(rates, f) {
  const out = { ...rates };
  for (const o of ['bb', 'hr', 'd3', 'd2', 's1']) out[o] *= f;
  return out;
}

/* BF promedio por apertura del abridor. */
function starterAvgBF(person) {
  const s = person && person.pitching.season;
  const gs = Number(s && s.gamesStarted) || 0;
  const bf = Number(s && s.battersFaced) || 0;
  if (!gs || !bf) return 18;
  return Math.max(14, Math.min(28, bf / gs));
}

/* ============================================================
   CONSTRUIR UN JUEGO: lineups reales (o equipo promedio),
   abridor vs cada bateador, bullpen, parque, clima.
   ============================================================ */
function buildSide(opts) {
  const { battingIds, teamBat, people, starter, oppBullpenRates, lg, isHome } = opts;
  const starterHand = (starter && starter.throws) || 'R';

  // 9 bateadores: lineup real o "equipo promedio" desde splits del club
  let lineup = [], lineupVsBpn = [], starterPerBatter = [];
  if (battingIds && battingIds.length >= 9) {
    for (const pid of battingIds.slice(0, 9)) {
      const b = people.get(pid);
      const f = isHome ? HOME_BAT_BOOST : AWAY_BAT_NERF;
      let vsStarter = boost(batterVs(b, starterHand, lg), f);
      let vsBpn = boost(b ? shrink(ratesFromHitting(b.hitting.season), lg) : { ...lg }, f);
      lineup.push(vsStarter);
      lineupVsBpn.push(vsBpn);
      const side = effectiveBatSide(b && b.bats, starterHand);
      starterPerBatter.push(starter ? pitcherVs(starter, side, lg) : { ...lg });
    }
  } else {
    // sin lineup confirmado: 9 clones del bateo del equipo vs esa mano
    const splitStat = starterHand === 'L' ? teamBat.vl : teamBat.vr;
    const rates = boost(shrink(ratesFromHitting(splitStat), lg), isHome ? HOME_BAT_BOOST : AWAY_BAT_NERF);
    lineup = Array(9).fill(rates);
    lineupVsBpn = Array(9).fill(rates);
    const genericPitcher = starter ? pitcherVs(starter, 'R', lg) : { ...lg };
    starterPerBatter = Array(9).fill(genericPitcher);
  }

  return {
    lineup,
    lineupVsBpn,
    starter: starterPerBatter,
    bullpen: oppBullpenRates,
    starterAvgBF: starterAvgBF(opts.starter),
  };
}

/* Info pública del abridor (datos que cualquiera ve en MLB.com). */
function publicPitcher(person, probable) {
  if (!probable) return null;
  const s = person && person.pitching.season;
  return {
    id: probable.id,
    name: probable.fullName,
    hand: (person && person.throws) || null,
    era: s ? s.era : null,
    record: s ? `${s.wins}-${s.losses}` : null,
    k9: s ? s.strikeoutsPer9Inn : null,
    ip: s ? s.inningsPitched : null,
  };
}

/* ============================================================
   DÍA COMPLETO: calendario → simulación → mercados por juego.
   ============================================================ */
async function buildDay(dateISO, opts = {}) {
  const season = opts.season || SEASON();
  const nSims = opts.nSims || N_SIMS;
  const games = await getSchedule(dateISO);
  if (!games.length) return { date: dateISO, games: [] };

  // liga
  let lg = FALLBACK_LEAGUE;
  try {
    const tot = await getLeagueHitting(season);
    const r = ratesFromHitting(tot);
    if (r && r.n > 50000) lg = r;
  } catch (e) { /* fallback embebido */ }

  // ids de personas: abridores + lineups
  const personIds = [];
  const teamIds = new Set();
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const t = g.teams[side];
      teamIds.add(t.team.id);
      if (t.probablePitcher) personIds.push(t.probablePitcher.id);
    }
    const lu = g.lineups || {};
    for (const p of (lu.homePlayers || [])) personIds.push(p.id);
    for (const p of (lu.awayPlayers || [])) personIds.push(p.id);
  }

  // datos en paralelo: personas + bullpen y bateo de cada equipo + mercado
  const teamList = [...teamIds];
  const [people, bullpens, teamBats, marketMap] = await Promise.all([
    getPeople(personIds, season),
    Promise.all(teamList.map(id => getTeamSplit(id, 'pitching', 'rp', season).catch(() => ({})))),
    Promise.all(teamList.map(id => getTeamSplit(id, 'hitting', 'vl,vr', season).catch(() => ({})))),
    getMarketMap(dateISO),
  ]);
  const bullpenByTeam = {}, teamBatByTeam = {};
  teamList.forEach((id, i) => {
    bullpenByTeam[id] = shrink(ratesFromPitching(bullpens[i].rp), lg);
    teamBatByTeam[id] = teamBats[i] || {};
  });

  const out = [];
  for (const g of games) {
    try {
      out.push(buildGame(g, { people, bullpenByTeam, teamBatByTeam, lg, nSims, dateISO, marketMap }));
    } catch (e) {
      out.push({
        gamePk: g.gamePk,
        error: 'Sin datos suficientes para simular este juego.',
        detail: String(e && e.message || e),
      });
    }
  }
  return { date: dateISO, league_runs_env: null, games: out };
}

function buildGame(g, ctx) {
  const { people, bullpenByTeam, teamBatByTeam, lg, nSims } = ctx;
  const homeT = g.teams.home, awayT = g.teams.away;
  const homeId = homeT.team.id, awayId = awayT.team.id;
  const park = parkFor(homeId);
  const wx = weatherMods(g.weather, park);
  const mods = { hrMult: (park.hr || 1) * wx.hrMult, hitMult: (1 + 0.5 * ((park.run || 1) - 1)) * wx.hitMult };

  const homeProb = homeT.probablePitcher || null;
  const awayProb = awayT.probablePitcher || null;
  const homeStarter = homeProb ? people.get(homeProb.id) : null;
  const awayStarter = awayProb ? people.get(awayProb.id) : null;

  const lu = g.lineups || {};
  const homeIds = (lu.homePlayers || []).map(p => p.id);
  const awayIds = (lu.awayPlayers || []).map(p => p.id);

  // el lado HOME batea contra el abridor AWAY y el bullpen AWAY
  const homeSide = buildSide({
    battingIds: homeIds, teamBat: teamBatByTeam[homeId], people,
    starter: awayStarter, oppBullpenRates: bullpenByTeam[awayId], lg, isHome: true,
  });
  const awaySide = buildSide({
    battingIds: awayIds, teamBat: teamBatByTeam[awayId], people,
    starter: homeStarter, oppBullpenRates: bullpenByTeam[homeId], lg, isHome: false,
  });

  // starterAvgBF de cada lado = el del pitcher que le lanza a ese lado
  const gamePre = {
    home: { grid: precomputeSide(homeSide, lg, mods), starterAvgBF: homeSide.starterAvgBF },
    away: { grid: precomputeSide(awaySide, lg, mods), starterAvgBF: awaySide.starterAvgBF },
  };

  const agg = simulateGame(gamePre, nSims, g.gamePk);
  const markets = marketsFromAgg(agg);

  /* mercado real (DraftKings vía ESPN): total y moneyline del día */
  const homeMeta0 = teamMeta(homeId, homeT.team.name);
  const awayMeta0 = teamMeta(awayId, awayT.team.name);
  const mkt = findMarket(ctx.marketMap || [], awayMeta0.abbr, homeMeta0.abbr, g.gameDate);
  let marketView = null;
  if (mkt && (mkt.total != null || mkt.ml_home_prob != null)) {
    const pOverMkt = mkt.total != null ? probOverHist(agg.totalHist, mkt.total, agg.n) : null;
    marketView = {
      provider: mkt.provider,
      total_line: mkt.total,
      p_over_mkt: pOverMkt,
      ml_home: mkt.ml_home, ml_away: mkt.ml_away,
      ml_home_prob: mkt.ml_home_prob, ml_away_prob: mkt.ml_away_prob,
    };
    if (pOverMkt != null) {
      markets.total_market = {
        line: mkt.total,
        over: Math.round(pOverMkt * 10000) / 10000,
        under: Math.round((1 - pOverMkt) * 10000) / 10000,
      };
    }
  }

  return {
    gamePk: g.gamePk,
    game_date: g.gameDate,
    status: g.status && g.status.detailedState,
    abstract_state: g.status && g.status.abstractGameState,
    day_night: g.dayNight,
    venue: park.park,
    roof: park.roof,
    home: {
      id: homeId,
      ...teamMeta(homeId, homeT.team.name),
      full_name: homeT.team.name,
      record: homeT.leagueRecord ? `${homeT.leagueRecord.wins}-${homeT.leagueRecord.losses}` : null,
      score: typeof homeT.score === 'number' ? homeT.score : null,
    },
    away: {
      id: awayId,
      ...teamMeta(awayId, awayT.team.name),
      full_name: awayT.team.name,
      record: awayT.leagueRecord ? `${awayT.leagueRecord.wins}-${awayT.leagueRecord.losses}` : null,
      score: typeof awayT.score === 'number' ? awayT.score : null,
    },
    pitchers: {
      home: publicPitcher(homeStarter, homeProb),
      away: publicPitcher(awayStarter, awayProb),
    },
    weather: {
      temp: wx.temp, wind: wx.windTxt, condition: wx.condition,
      applied: wx.applied, roof: park.roof,
    },
    lineups_confirmed: homeIds.length >= 9 && awayIds.length >= 9,
    market: marketView ? {
      provider: marketView.provider,
      total_line: marketView.total_line,
      ml_home: marketView.ml_home,
      ml_away: marketView.ml_away,
    } : null,
    markets,
    picks: derivePicks(markets),
    verdicts: buildVerdicts(markets, teamMeta(homeId, homeT.team.name), teamMeta(awayId, awayT.team.name), marketView),
    analysis: buildAnalysis({
      markets, park, wx,
      home: teamMeta(homeId, homeT.team.name), away: teamMeta(awayId, awayT.team.name),
      pHome: publicPitcher(homeStarter, homeProb), pAway: publicPitcher(awayStarter, awayProb),
    }),
  };
}

/* ============================================================
   VEREDICTOS — la vista "de cliente": qué apostar y qué no.
   bet (verde) / maybe (azul) / skip (rojo), sin números.
   Los umbrales salen de los mismos PICK_BAR + margen.
   ============================================================ */
function verdictFor(prob, bar) {
  if (prob >= bar + 0.04) return 'bet';
  if (prob >= bar - 0.03) return 'maybe';
  return 'skip';
}
function buildVerdicts(m, home, away, mv) {
  const homeFav = m.moneyline.home >= m.moneyline.away;
  const fav = homeFav ? home : away;
  const favML = Math.max(m.moneyline.home, m.moneyline.away);

  /* ML: con mercado real el veredicto es por EDGE (modelo - mercado
     sin vig), no por probabilidad absoluta. */
  let mlVerdict, mlEdge = null;
  if (mv && mv.ml_home_prob != null && mv.ml_away_prob != null) {
    const mktFavP = homeFav ? mv.ml_home_prob : mv.ml_away_prob;
    mlEdge = Math.round((favML - mktFavP) * 1000) / 1000;
    mlVerdict = (mlEdge >= 0.04 && favML <= 0.75) ? 'bet' : mlEdge >= 0.015 ? 'maybe' : 'skip';
    // Edge "demasiado bueno": casi siempre es información que el modelo
    // no tiene (lesión, cambio de abridor). Se respeta al mercado.
    if (mlEdge > 0.12 && mlVerdict === 'bet') mlVerdict = 'maybe';
  } else {
    mlVerdict = verdictFor(favML, PICK_BAR.ML);
  }

  /* TOTAL: con línea real del mercado, probabilidad push-aware en
     ESA línea y edge vs el breakeven de -110. */
  let totalLabel, totalProb, totalVerdict, totalEdge = null, totalLineTxt = null;
  if (mv && mv.p_over_mkt != null) {
    const overBest = mv.p_over_mkt >= 0.5;
    totalProb = overBest ? mv.p_over_mkt : 1 - mv.p_over_mkt;
    totalLabel = `${overBest ? 'Más' : 'Menos'} de ${mv.total_line} carreras`;
    totalEdge = Math.round((totalProb - BE_110) * 1000) / 1000;
    totalVerdict = totalProb >= BE_110 + 0.035 ? 'bet' : totalProb >= BE_110 + 0.01 ? 'maybe' : 'skip';
    // Divergencia extrema vs la línea (>2.5 carreras): suele ser un
    // abridor TBD o bullpen day que el modelo no ve. Tope: maybe.
    if (Math.abs(m.expected.total - mv.total_line) > 2.5 && totalVerdict === 'bet') totalVerdict = 'maybe';
    totalLineTxt = `línea ${mv.total_line} (${mv.provider})`;
  } else {
    const overBest = m.total.over >= m.total.under;
    totalProb = overBest ? m.total.over : m.total.under;
    totalLabel = `${overBest ? 'Más' : 'Menos'} de ${m.total.line} carreras`;
    totalVerdict = verdictFor(totalProb, PICK_BAR.TOTAL);
  }

  const f5HomeFav = m.f5.home >= m.f5.away;
  const f5Fav = f5HomeFav ? home : away;
  const f5Prob = Math.max(m.f5.home, m.f5.away);

  const nrfiBest = m.nrfi.no_run >= m.nrfi.run;
  const nrfiProb = Math.max(m.nrfi.no_run, m.nrfi.run);

  return [
    {
      market: 'ML',
      label: `Ganan los ${fav.name}`,
      verdict: mlVerdict,
      prob: favML,
      edge: mlEdge,
      line_txt: mv && mv.ml_home ? `mercado ${homeFav ? mv.ml_home : mv.ml_away}` : null,
    },
    {
      market: 'TOTAL',
      label: totalLabel,
      verdict: totalVerdict,
      prob: totalProb,
      edge: totalEdge,
      line_txt: totalLineTxt,
    },
    {
      market: 'F5',
      label: `${f5Fav.name} adelante en la 5ª entrada`,
      verdict: verdictFor(f5Prob, PICK_BAR.F5),
      prob: f5Prob,
    },
    {
      market: 'NRFI',
      label: nrfiBest ? 'Nadie anota en la 1ª entrada' : 'Hay carrera en la 1ª entrada',
      verdict: verdictFor(nrfiProb, PICK_BAR.NRFI),
      prob: nrfiProb,
    },
  ];
}

/* ============================================================
   ANÁLISIS EN ESPAÑOL — 2-3 frases generadas de los datos.
   Pensado para leerse como un amigo que sabe, no como tabla.
   ============================================================ */
function eraNum(p) { const e = p && parseFloat(p.era); return Number.isFinite(e) ? e : null; }

function buildAnalysis({ markets: m, park, wx, home, away, pHome, pAway }) {
  const s = [];
  const homeFav = m.moneyline.home >= m.moneyline.away;
  const fav = homeFav ? home : away;
  const dog = homeFav ? away : home;
  const pFav = homeFav ? pHome : pAway;
  const pDog = homeFav ? pAway : pHome;
  const favML = Math.max(m.moneyline.home, m.moneyline.away);
  const eF = eraNum(pFav), eD = eraNum(pDog);

  // 1) el ganador
  if (favML >= 0.65) {
    if (pFav && pDog && eF !== null && eD !== null && eD - eF >= 1.2) {
      s.push(`Los ${fav.name} llegan con ventaja clara: ${pFav.name} está lanzando muy bien y ${pDog.name} ha sufrido para frenar a los rivales.`);
    } else {
      s.push(`El modelo ve favoritos claros a los ${fav.name} en este cruce.`);
    }
  } else if (favML >= 0.57) {
    s.push(`Los ${fav.name} tienen la ventaja, pero no es un juego para confiarse: los ${dog.name} ganan este tipo de partidos seguido.`);
  } else {
    s.push('Juego muy parejo: el ganador puede caer de cualquier lado, así que el valor está en otros mercados.');
  }

  // 2) las carreras
  const t = m.expected.total;
  if (t >= 9.8) {
    let r = 'Pinta para juego de muchas carreras';
    if ((park.run || 1) >= 1.03) r += ': el parque ayuda a la ofensiva';
    if (wx && wx.applied && wx.hrMult > 1.05) r += ' y el clima empuja la pelota';
    s.push(r + '.');
  } else if (t <= 8.4) {
    let r = 'Pinta para duelo de pitcheo con pocas carreras';
    if ((park.run || 1) <= 0.97) r += ', en un parque que frena a los bateadores';
    s.push(r + '.');
  }

  // 3) la primera entrada, si hay señal
  if (m.nrfi.no_run >= 0.62) {
    s.push('Los dos abridores suelen empezar fuertes: la primera entrada pinta en ceros.');
  } else if (m.nrfi.run >= 0.60) {
    s.push('Ojo temprano: este juego pinta para carrera en la primera entrada.');
  }

  return s.join(' ');
}

/* Jugadas destacadas del modelo. Cada mercado tiene un umbral
   distinto (lo que el mercado típicamente cobra): un +1.5 al 65%
   no dice nada, un ML al 62% sí. La fuerza se normaliza sobre el
   umbral para poder comparar entre mercados. */
const PICK_BAR = {
  ML: 0.58, RL_MINUS: 0.46, RL_PLUS: 0.72,
  TOTAL: 0.57, F5: 0.52, F5_TOTAL: 0.60, NRFI: 0.60,
};
function derivePicks(m) {
  const home = 'home', away = 'away';
  const homeFav = m.moneyline.home >= m.moneyline.away;
  // el -1.5 solo tiene sentido para el favorito; el +1.5 solo para el underdog
  const favML = homeFav ? m.run_line.home_minus_1_5 : m.run_line.away_minus_1_5;
  const dogPL = homeFav ? m.run_line.away_plus_1_5 : m.run_line.home_plus_1_5;
  const cands = [
    { market: 'ML', bar: PICK_BAR.ML, sel: home, prob: m.moneyline.home },
    { market: 'ML', bar: PICK_BAR.ML, sel: away, prob: m.moneyline.away },
    { market: 'RL', bar: PICK_BAR.RL_MINUS, sel: `${homeFav ? home : away} -1.5`, prob: favML },
    { market: 'RL', bar: PICK_BAR.RL_PLUS, sel: `${homeFav ? away : home} +1.5`, prob: dogPL },
    { market: 'TOTAL', bar: PICK_BAR.TOTAL, sel: `Over ${m.total.line}`, prob: m.total.over },
    { market: 'TOTAL', bar: PICK_BAR.TOTAL, sel: `Under ${m.total.line}`, prob: m.total.under },
    { market: 'F5', bar: PICK_BAR.F5, sel: home, prob: m.f5.home },
    { market: 'F5', bar: PICK_BAR.F5, sel: away, prob: m.f5.away },
    { market: 'F5_TOTAL', bar: PICK_BAR.F5_TOTAL, sel: `Over ${m.f5.total.line}`, prob: m.f5.total.over },
    { market: 'F5_TOTAL', bar: PICK_BAR.F5_TOTAL, sel: `Under ${m.f5.total.line}`, prob: m.f5.total.under },
    { market: 'NRFI', bar: PICK_BAR.NRFI, sel: 'NRFI', prob: m.nrfi.no_run },
    { market: 'NRFI', bar: PICK_BAR.NRFI, sel: 'YRFI', prob: m.nrfi.run },
  ];
  return cands
    .map(c => ({ ...c, strength: (c.prob - c.bar) / (1 - c.bar) }))
    .filter(c => c.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map(c => ({
      market: c.market, sel: c.sel, prob: c.prob,
      strength: Math.round(c.strength * 1000) / 1000,
      fair_odds: c.prob > 0 ? Math.round(100 / c.prob) / 100 : null,
    }));
}

module.exports = { buildDay, buildGame, batterVs, pitcherVs, ratesFromHitting, ratesFromPitching, shrink };
