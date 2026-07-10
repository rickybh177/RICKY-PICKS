#!/usr/bin/env node
/* ============================================================
   BACKTEST DEL MODELO MLB
   Reconstruye cada juego con la información disponible ANTES
   del juego (stats byDateRange hasta el día anterior — sin fuga
   de futuro) y compara las probabilidades contra los resultados.

   Uso:
     node scripts/mlb-backtest.js --start 2026-06-20 --end 2026-07-05
       [--sims 3000]            simulaciones por juego
       [--odds closing.csv]     CSV: date,away,home,ml_away,ml_home (momios
                                americanos de cierre) para calcular ROI

   Métricas: Brier, log-loss, calibración por bucket (moneyline),
   MAE del total, récord Over/Under a la línea del modelo, NRFI.

   Limitaciones documentadas (vs producción):
   - Sin splits vl/vr (byDateRange no los da) → sin platoon.
   - Bullpen con stats de temporada completa (leve fuga; la calidad
     de bullpen es estable).
   ============================================================ */

const { fetchJson, BASE } = require('../lib/mlb/statsapi');
const { parkFor, weatherMods } = require('../lib/mlb/parks');
const { FALLBACK_LEAGUE, precomputeSide, simulateGame, marketsFromAgg } = require('../lib/mlb/engine');
const { ratesFromHitting, ratesFromPitching, shrink } = require('../lib/mlb/model');
const fs = require('fs');

const HOME_BAT_BOOST = 1.015, AWAY_BAT_NERF = 0.985;
const SEASON_START = '2026-03-25';

/* ---- args ---- */
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const START = args.start, END = args.end;
const N_SIMS = Number(args.sims) || 3000;
if (!START || !END) {
  console.error('Uso: node scripts/mlb-backtest.js --start YYYY-MM-DD --end YYYY-MM-DD [--sims N] [--odds file.csv]');
  process.exit(1);
}

function* dateRange(a, b) {
  const d = new Date(a + 'T12:00:00Z');
  const end = new Date(b + 'T12:00:00Z');
  while (d <= end) { yield d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
}
function dayBefore(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ---- momios de cierre opcionales ---- */
function loadOdds(file) {
  if (!file || !fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
  const map = {};
  for (const r of rows) {
    const [date, away, home, mlAway, mlHome] = r.split(',').map(s => s.trim());
    map[`${date}|${away}|${home}`] = { mlAway: Number(mlAway), mlHome: Number(mlHome) };
  }
  return map;
}
function amToProb(am) { return am < 0 ? -am / (-am + 100) : 100 / (am + 100); }
function amPayout(am) { return am < 0 ? 100 / -am : am / 100; } // ganancia por unidad

/* ---- datos pregame de una fecha ---- */
async function loadDate(dateISO, cacheBullpen) {
  const cutoff = dayBefore(dateISO);
  const sched = await fetchJson(
    `${BASE}/schedule?sportId=1&date=${dateISO}&hydrate=probablePitcher,lineups,weather,linescore`,
    24 * 3600e3);
  const day = (sched.dates || []).find(d => d.date === dateISO);
  const games = (day ? day.games : []).filter(g =>
    g.status && g.status.codedGameState === 'F' && g.gameType === 'R');
  if (!games.length) return { games: [], byId: new Map(), teamRates: {}, lg: FALLBACK_LEAGUE };

  // bateo de los 30 equipos hasta el día anterior (1 llamada)
  const teamsJ = await fetchJson(
    `${BASE}/teams/stats?stats=byDateRange&group=hitting&startDate=${SEASON_START}&endDate=${cutoff}&season=2026&sportIds=1`,
    24 * 3600e3);
  const teamRates = {}, lgTot = {};
  for (const s of (teamsJ.stats || [])) {
    for (const sp of (s.splits || [])) {
      teamRates[sp.team.id] = ratesFromHitting(sp.stat);
      for (const k of ['plateAppearances', 'hits', 'doubles', 'triples', 'homeRuns', 'baseOnBalls', 'hitByPitch', 'strikeOuts']) {
        lgTot[k] = (lgTot[k] || 0) + (Number(sp.stat[k]) || 0);
      }
    }
  }
  const lg = ratesFromHitting(lgTot) || FALLBACK_LEAGUE;

  // personas (abridores + lineups) con stats hasta el día anterior
  const ids = new Set();
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const t = g.teams[side];
      if (t.probablePitcher) ids.add(t.probablePitcher.id);
    }
    for (const p of ((g.lineups || {}).homePlayers || [])) ids.add(p.id);
    for (const p of ((g.lineups || {}).awayPlayers || [])) ids.add(p.id);
  }
  const idList = [...ids];
  const byId = new Map();
  const hyd = `stats(group=%5Bhitting,pitching%5D,type=%5BbyDateRange%5D,startDate=${SEASON_START},endDate=${cutoff},season=2026)`;
  for (let i = 0; i < idList.length; i += 40) {
    const chunk = idList.slice(i, i + 40);
    const j = await fetchJson(`${BASE}/people?personIds=${chunk.join(',')}&hydrate=${hyd}`, 24 * 3600e3);
    for (const p of (j.people || [])) {
      const rec = { hitting: null, pitching: null, throws: (p.pitchHand || {}).code || 'R' };
      for (const s of (p.stats || [])) {
        const grp = s.group && s.group.displayName;
        const sp = (s.splits || [])[0];
        if (sp && grp) rec[grp] = sp.stat;
      }
      byId.set(p.id, rec);
    }
  }

  // bullpen (temporada, cacheado entre fechas)
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const tid = g.teams[side].team.id;
      if (!cacheBullpen.has(tid)) {
        const j = await fetchJson(
          `${BASE}/teams/${tid}/stats?stats=statSplits&group=pitching&season=2026&sitCodes=rp`,
          24 * 3600e3).catch(() => null);
        let stat = null;
        if (j) for (const s of (j.stats || [])) for (const sp of (s.splits || [])) stat = sp.stat;
        cacheBullpen.set(tid, stat);
      }
    }
  }

  return { games, byId, teamRates, lg };
}

/* ---- construir un lado del juego (modo backtest: sin platoon) ---- */
function buildSideBT(g, side, data, cacheBullpen) {
  const { byId, teamRates, lg } = data;
  const team = g.teams[side];
  const opp = g.teams[side === 'home' ? 'away' : 'home'];
  const isHome = side === 'home';
  const f = isHome ? HOME_BAT_BOOST : AWAY_BAT_NERF;

  const luIds = ((g.lineups || {})[side + 'Players'] || []).map(p => p.id);
  const teamR = shrink(teamRates[team.team.id], lg);
  let lineup;
  if (luIds.length >= 9) {
    lineup = luIds.slice(0, 9).map(pid => {
      const p = byId.get(pid);
      const r = p && p.hitting ? shrink(ratesFromHitting(p.hitting), teamR) : teamR;
      return boostR(r, f);
    });
  } else {
    lineup = Array(9).fill(boostR(teamR, f));
  }

  const prob = opp.probablePitcher && byId.get(opp.probablePitcher.id);
  const starterR = prob && prob.pitching
    ? shrink(ratesFromPitching(prob.pitching), lg) : { ...lg };
  const gs = Number(prob && prob.pitching && prob.pitching.gamesStarted) || 0;
  const bf = Number(prob && prob.pitching && prob.pitching.battersFaced) || 0;
  const avgBF = gs && bf ? Math.max(14, Math.min(28, bf / gs)) : 18;

  const bpnStat = cacheBullpen.get(opp.team.id);
  const bullpen = bpnStat ? shrink(ratesFromPitching(bpnStat), lg) : { ...lg };

  return { lineup, lineupVsBpn: lineup, starter: starterR, bullpen, starterAvgBF: avgBF };
}
function boostR(r, f) {
  const o = { ...r };
  for (const k of ['bb', 'hr', 'd3', 'd2', 's1']) o[k] *= f;
  return o;
}

/* ---- carreras de la 1ª entrada desde el linescore ---- */
function firstInningRuns(g) {
  const inn = g.linescore && g.linescore.innings && g.linescore.innings[0];
  if (!inn) return null;
  const h = inn.home && typeof inn.home.runs === 'number' ? inn.home.runs : null;
  const a = inn.away && typeof inn.away.runs === 'number' ? inn.away.runs : null;
  if (h === null || a === null) return null;
  return h + a;
}

/* ============================================================ */
(async function main() {
  const odds = loadOdds(args.odds);
  const cacheBullpen = new Map();
  const rows = [];
  let skipped = 0;

  for (const date of dateRange(START, END)) {
    let data;
    try { data = await loadDate(date, cacheBullpen); }
    catch (e) { console.error(date, 'error:', e.message); continue; }

    for (const g of data.games) {
      if (!g.teams.home.probablePitcher || !g.teams.away.probablePitcher) { skipped++; continue; }
      const hs = g.teams.home.score, as = g.teams.away.score;
      if (typeof hs !== 'number' || typeof as !== 'number' || hs === as) { skipped++; continue; }

      const park = parkFor(g.teams.home.team.id);
      const wx = weatherMods(g.weather, park);
      const mods = { hrMult: (park.hr || 1) * wx.hrMult, hitMult: (1 + 0.5 * ((park.run || 1) - 1)) * wx.hitMult };

      const homeSide = buildSideBT(g, 'home', data, cacheBullpen);
      const awaySide = buildSideBT(g, 'away', data, cacheBullpen);
      const pre = {
        home: { grid: precomputeSide(homeSide, data.lg, mods), starterAvgBF: homeSide.starterAvgBF },
        away: { grid: precomputeSide(awaySide, data.lg, mods), starterAvgBF: awaySide.starterAvgBF },
      };
      const m = marketsFromAgg(simulateGame(pre, N_SIMS, g.gamePk));

      rows.push({
        date, gamePk: g.gamePk,
        away: g.teams.away.team.id, home: g.teams.home.team.id,
        awayName: g.teams.away.team.name, homeName: g.teams.home.team.name,
        pHome: m.moneyline.home,
        expTotal: m.expected.total, line: m.total.line, pOver: m.total.over,
        pNoRun1: m.nrfi.no_run,
        homeWon: hs > as ? 1 : 0,
        actualTotal: hs + as,
        inn1: firstInningRuns(g),
      });
    }
    process.stdout.write(`\r${date}: ${rows.length} juegos acumulados…   `);
  }
  console.log('\n');

  if (!rows.length) { console.log('Sin juegos en el rango.'); return; }

  /* ---- métricas moneyline ---- */
  const n = rows.length;
  let brier = 0, ll = 0, favHits = 0;
  for (const r of rows) {
    brier += (r.pHome - r.homeWon) ** 2;
    const p = Math.min(0.999, Math.max(0.001, r.homeWon ? r.pHome : 1 - r.pHome));
    ll += -Math.log(p);
    const fav = r.pHome >= 0.5 ? 1 : 0;
    if (fav === r.homeWon) favHits++;
  }
  const homeRate = rows.reduce((a, r) => a + r.homeWon, 0) / n;
  const brierConst = rows.reduce((a, r) => a + (homeRate - r.homeWon) ** 2, 0) / n;

  /* calibración por bucket */
  const buckets = {};
  for (const r of rows) {
    const b = Math.min(0.85, Math.max(0.35, Math.floor(r.pHome * 10) / 10));
    (buckets[b.toFixed(1)] = buckets[b.toFixed(1)] || []).push(r);
  }

  /* ---- totales ---- */
  let mae = 0, ouBets = 0, ouWins = 0, ouPush = 0;
  for (const r of rows) {
    mae += Math.abs(r.expTotal - r.actualTotal);
    const betOver = r.pOver >= 0.5;
    if (r.actualTotal === r.line) { ouPush++; continue; }
    ouBets++;
    if ((betOver && r.actualTotal > r.line) || (!betOver && r.actualTotal < r.line)) ouWins++;
  }

  /* ---- NRFI ---- */
  const nr = rows.filter(r => r.inn1 !== null);
  let nrfiBrier = 0, yrfiRate = 0;
  for (const r of nr) {
    const noRun = r.inn1 === 0 ? 1 : 0;
    nrfiBrier += (r.pNoRun1 - noRun) ** 2;
    yrfiRate += 1 - noRun;
  }
  const pNoRunAvg = nr.reduce((a, r) => a + r.pNoRun1, 0) / (nr.length || 1);

  /* ---- ROI vs momios de cierre (opcional) ---- */
  let roiTxt = 'sin archivo de momios (--odds) — ROI vs cierre no calculado';
  if (odds) {
    let staked = 0, ret = 0, bets = 0;
    for (const r of rows) {
      const o = odds[`${r.date}|${r.awayName}|${r.homeName}`];
      if (!o) continue;
      const imp = { home: amToProb(o.mlHome), away: amToProb(o.mlAway) };
      const s = imp.home + imp.away; // quitar el vig
      imp.home /= s; imp.away /= s;
      // apostar donde el modelo ve más probabilidad que el cierre
      const EDGE = 0.02;
      let side = null;
      if (r.pHome - imp.home > EDGE) side = 'home';
      else if ((1 - r.pHome) - imp.away > EDGE) side = 'away';
      if (!side) continue;
      bets++; staked++;
      const won = (side === 'home') === !!r.homeWon;
      if (won) ret += 1 + amPayout(side === 'home' ? o.mlHome : o.mlAway);
    }
    roiTxt = bets
      ? `${bets} apuestas | ROI ${(100 * (ret - staked) / staked).toFixed(1)}%`
      : 'sin cruces entre el modelo y el archivo de momios';
  }

  /* ---- reporte ---- */
  console.log('════════ BACKTEST', START, '→', END, `(${n} juegos, ${N_SIMS} sims c/u, ${skipped} saltados) ════════`);
  console.log('\nMONEYLINE');
  console.log(`  Brier score          ${(brier / n).toFixed(4)}   (0.25 = azar; siempre-local ${brierConst.toFixed(4)})`);
  console.log(`  Log-loss             ${(ll / n).toFixed(4)}   (0.693 = azar)`);
  console.log(`  Acierto del favorito ${(100 * favHits / n).toFixed(1)}%  (libros suelen andar 57-58%)`);
  console.log(`  % real de locales    ${(100 * homeRate).toFixed(1)}%`);
  console.log('\n  Calibración (prob. local del modelo → % real de victorias local)');
  for (const k of Object.keys(buckets).sort()) {
    const rs = buckets[k];
    const won = rs.reduce((a, r) => a + r.homeWon, 0);
    const avg = rs.reduce((a, r) => a + r.pHome, 0) / rs.length;
    console.log(`   ${k}s  n=${String(rs.length).padStart(3)}  modelo ${(100 * avg).toFixed(1)}%  real ${(100 * won / rs.length).toFixed(1)}%`);
  }
  console.log('\nTOTALES');
  console.log(`  MAE del total        ${(mae / n).toFixed(2)} carreras`);
  console.log(`  O/U a línea modelo   ${ouWins}-${ouBets - ouWins} (${(100 * ouWins / (ouBets || 1)).toFixed(1)}%), ${ouPush} push`);
  console.log('\nNRFI');
  console.log(`  Brier 1ª entrada     ${(nrfiBrier / (nr.length || 1)).toFixed(4)}`);
  console.log(`  Modelo NRFI prom.    ${(100 * pNoRunAvg).toFixed(1)}%  | real ${(100 * (1 - yrfiRate / (nr.length || 1))).toFixed(1)}%`);
  console.log('\nROI vs CIERRE');
  console.log('  ' + roiTxt);

  const outFile = args.out || 'mlb-backtest-results.json';
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  console.log(`\nDetalle por juego: ${outFile}`);
})().catch(e => { console.error(e); process.exit(1); });
