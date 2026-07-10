/* ============================================================
   GET /api/mlb-record
   Récord del modelo MLB: toma los picks que el modelo genera
   para los últimos días, los compara contra los marcadores
   reales y devuelve SOLO el dashboard agregado:
   { wins, losses, pushes, pct, days }.

   Mismo gate que mlb-picks (admin mientras sea beta privada).
   Los días ya calificados se cachean en memoria (no cambian).
   ============================================================ */
const { buildDay } = require('../lib/mlb/model');
const { fetchJson, BASE } = require('../lib/mlb/statsapi');

const DAYS = 7;

const _graded = new Map(); // date -> { wins, losses, pushes }

function todayET() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* suma de carreras de las entradas 1..n del linescore */
function runsThrough(linescore, n, side) {
  const inns = (linescore && linescore.innings) || [];
  let sum = 0;
  for (let i = 0; i < Math.min(n, inns.length); i++) {
    const r = inns[i][side] && inns[i][side].runs;
    if (typeof r === 'number') sum += r;
  }
  return sum;
}

/* califica un pick contra el resultado real: 1 gana, 0 pierde, null push */
function gradePick(pick, ctx) {
  const { hs, as, linescore } = ctx;
  const total = hs + as;
  switch (pick.market) {
    case 'ML':
      return (pick.sel === 'home') === (hs > as) ? 1 : 0;
    case 'RL': {
      const margin = pick.sel.startsWith('home') ? hs - as : as - hs;
      return pick.sel.includes('-1.5') ? (margin >= 2 ? 1 : 0) : (margin >= -1 ? 1 : 0);
    }
    case 'TOTAL': {
      const line = parseFloat(pick.sel.split(' ')[1]);
      return pick.sel.startsWith('Over') ? (total > line ? 1 : 0) : (total < line ? 1 : 0);
    }
    case 'F5': {
      if (!linescore) return null;
      const h5 = runsThrough(linescore, 5, 'home'), a5 = runsThrough(linescore, 5, 'away');
      if (h5 === a5) return null; // empate en la 5ª = push
      return (pick.sel === 'home') === (h5 > a5) ? 1 : 0;
    }
    case 'F5_TOTAL': {
      if (!linescore) return null;
      const line = parseFloat(pick.sel.split(' ')[1]);
      const t5 = runsThrough(linescore, 5, 'home') + runsThrough(linescore, 5, 'away');
      return pick.sel.startsWith('Over') ? (t5 > line ? 1 : 0) : (t5 < line ? 1 : 0);
    }
    case 'NRFI': {
      if (!linescore) return null;
      const i1 = runsThrough(linescore, 1, 'home') + runsThrough(linescore, 1, 'away');
      return (pick.sel === 'NRFI') === (i1 === 0) ? 1 : 0;
    }
  }
  return null;
}

async function gradeDate(dateISO) {
  if (_graded.has(dateISO)) return _graded.get(dateISO);

  // marcadores + linescore reales del día
  const sched = await fetchJson(
    `${BASE}/schedule?sportId=1&date=${dateISO}&hydrate=linescore`, 24 * 3600e3);
  const dayGames = (((sched.dates || [])[0] || {}).games || [])
    .filter(g => g.status && g.status.codedGameState === 'F');
  const byPk = new Map(dayGames.map(g => [g.gamePk, g]));
  if (!byPk.size) { const z = { wins: 0, losses: 0, pushes: 0 }; _graded.set(dateISO, z); return z; }

  // picks del modelo para ese día (sims reducidas: es un agregado)
  const day = await buildDay(dateISO, { nSims: 4000 });
  const out = { wins: 0, losses: 0, pushes: 0 };
  for (const g of (day.games || [])) {
    if (g.error) continue;
    const real = byPk.get(g.gamePk);
    if (!real) continue;
    const hs = real.teams.home.score, as = real.teams.away.score;
    if (typeof hs !== 'number' || typeof as !== 'number') continue;
    const ctx = { hs, as, linescore: real.linescore };
    for (const p of (g.picks || [])) {
      const r = gradePick(p, ctx);
      if (r === 1) out.wins++;
      else if (r === 0) out.losses++;
      else out.pushes++;
    }
  }
  _graded.set(dateISO, out);
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  // Público: solo devuelve agregados (W-L-%), nunca picks.
  try {
    const today = todayET();
    const totals = { wins: 0, losses: 0, pushes: 0 };
    for (let i = 1; i <= DAYS; i++) {
      const d = shiftDate(today, -i);
      const g = await gradeDate(d).catch(() => null);
      if (!g) continue;
      totals.wins += g.wins; totals.losses += g.losses; totals.pushes += g.pushes;
    }
    const decided = totals.wins + totals.losses;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      days: DAYS,
      wins: totals.wins,
      losses: totals.losses,
      pushes: totals.pushes,
      pct: decided ? Math.round(1000 * totals.wins / decided) / 10 : null,
    });
  } catch (e) {
    console.error('mlb-record:', e);
    return res.status(500).json({ error: 'No se pudo calcular el récord.' });
  }
};
