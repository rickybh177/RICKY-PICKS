/* ============================================================
   CHAMPIONS — piezas compartidas por scripts/ucl-backtest.js y
   scripts/build-ucl-priors.js (solo scripts, nunca runtime):
   carga etiquetada del histórico conjunto, ancla del debutante
   europeo y parámetros de liga del runtime a partir del ajuste.
   ============================================================ */

const { LEAGUES } = require('../lib/euro/leagues');
const { getHistory } = require('./euro-history');
const { FALLBACK_ANCHOR, gameWeight } = require('../lib/euro/fit');
const { lambdas } = require('../lib/euro/core');

const byDate = (a, b) => new Date(a.date) - new Date(b.date);
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/* Carga y etiqueta el histórico de la Champions y de todo lo que entra
   al ajuste conjunto (cfg.fitWith): comp 'uefa' para las copas
   europeas, 'dom' para las ligas; league = id del catálogo. La final
   europea cuenta como sede neutral (ESPN no la marca).
   statsFor: ligas cuyo histórico se pide con summaries (córneres). */
async function loadAll(cfg, log, { statsFor = [] } = {}) {
  const out = [];
  for (const id of ['ucl', ...cfg.fitWith]) {
    const lc = LEAGUES[id];
    if (!lc) throw new Error(`Liga desconocida en fitWith: ${id}`);
    const games = await getHistory(id, { withStats: statsFor.includes(id), log });
    for (const g of games) out.push({
      ...g, league: id, comp: lc.comp === 'uefa' ? 'uefa' : 'dom',
      neutral: !!g.neutral || g.seasonSlug === 'final',
    });
  }
  out.sort(byDate);
  return out;
}

/* Ancla del debutante europeo: promedio de att/def de los clubes que
   en el ajuste SOLO tienen partidos europeos (su liga no está en
   ESPN). Es el perfil típico del "chico" que llega a la fase de liga.
   Respaldo si no hubiera ninguno: FALLBACK_ANCHOR. */
function debutAnchor(fit, fitSet) {
  const dom = new Set(), uefa = new Set();
  for (const g of fitSet) {
    const s = g.comp === 'uefa' ? uefa : dom;
    s.add(g.home.id); s.add(g.away.id);
  }
  const only = [...uefa].filter(t => !dom.has(t) && fit.ratings[t]);
  if (!only.length) return { anchor: { ...FALLBACK_ANCHOR }, n: 0 };
  return {
    anchor: { att: +mean(only.map(t => fit.ratings[t].att)).toFixed(4), def: +mean(only.map(t => fit.ratings[t].def)).toFixed(4) },
    n: only.length,
  };
}

/* Parámetros de liga del runtime de la Champions a partir del ajuste:
   arriba los europeos (lo que se predice), comps.dom los domésticos
   (de lo que también se aprende); muShift solo con partidos europeos. */
function leagueParams(fit) {
  return {
    mu: +(fit.mu + fit.muUefa).toFixed(4), hfa: fit.hfaUefa, rho: fit.rho, conversion: fit.conversion,
    scale: fit.scaleUefa != null ? fit.scaleUefa : 1,          // escala europea (lib/euro/fit.js, paso 3)
    comps: { dom: { mu: fit.mu, hfa: fit.hfa, scale: 1 } },
    muShiftComp: 'uefa',
  };
}

/* Nivel goleador PROPIO de la Champions. El ajuste conjunto estima un
   solo desplazamiento para las tres copas europeas (muUefa) y con
   todas las temporadas; pero la fase de liga (desde 2024-25) anota
   más que los grupos viejos y que Europa/Conference, y el backtest
   sin esto predecía ~0.2 goles de menos por partido en dos temporadas
   seguidas (y por eso empates de más). Corrección en forma cerrada:
   log(goles observados / goles predichos) sobre los partidos de
   Champions del set de ajuste, ponderados por la misma recencia del
   fit y encogidos con n/(n+shrinkN) (n = peso acumulado). Se suma a
   LEAGUE.mu; en temporada muShift sigue corrigiendo encima. */
function uclLevel(fit, LG, fitSet, { asOf, halfLife, shrinkN = 80 } = {}) {
  let obs = 0, pred = 0, n = 0;
  for (const g of fitSet) {
    if (g.league !== 'ucl' || !fit.ratings[g.home.id] || !fit.ratings[g.away.id]) continue;
    const w = gameWeight(g, asOf, halfLife);
    const L = lambdas(fit.ratings, g, LG);
    obs += w * (g.home.score + g.away.score);
    pred += w * (L.lh + L.la);
    n += w;
  }
  if (!pred || !n) return { level: 0, n: 0, obsPerGame: null, predPerGame: null };
  const raw = Math.log(obs / pred);
  return { level: +(raw * (n / (n + shrinkN))).toFixed(4), n: +n.toFixed(1), obsPerGame: +(obs / n).toFixed(3), predPerGame: +(pred / n).toFixed(3) };
}

module.exports = { loadAll, debutAnchor, leagueParams, uclLevel, byDate, mean };
