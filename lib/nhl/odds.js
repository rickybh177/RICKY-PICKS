/* ============================================================
   NHL — momios reales (The Odds API, FUENTE ÚNICA).

   Consenso multi-casas (mediana) de h2h, spreads y totals del sport
   key `icehockey_nhl`, con la caché en dos niveles de
   lib/odds/theoddsapi.js (3 créditos por consulta, TTL 30 min,
   perezoso: solo al haber visitas). Sin key o sin cobertura, el juego
   queda SIN mercado y el modelo lo dice.

   OJO — en hockey el `h2h` de la región europea MEZCLA dos mercados
   distintos y hay que separarlos casa por casa:
   - casas de 2 vías (Pinnacle, William Hill, 888, Betsson…): el
     GANADOR con tiempo extra y penales. Su línea de gol (±1.5) y su
     total también cuentan el tiempo extra: es el mercado que calcula
     el motor y el que ve el cliente en su casa.
   - casas de 3 vías (Unibet, Winamax, Betclic, Tipico…): traen un
     tercer resultado "Draw" y pagan el resultado a 60 MINUTOS; sus
     totales y hándicaps suelen liquidarse también a 60 minutos.
   Mezclarlas (la mediana genérica de lib/odds/theoddsapi.js) da un
   "moneyline" con los dos lados en positivo y un EV inventado de +20%.
   Aquí el ganador, la línea de gol y el total salen SOLO de las casas
   de 2 vías, y el h2h de las de 3 vías alimenta el mercado de
   "60 minutos".
   ============================================================ */
const { fetchSport, consensus, isPreGame, amToProb, probToAm, devigPair } = require('../odds/theoddsapi');
const { abbrFromFull } = require('./teams');

const SPORT = 'icehockey_nhl';

const MIN_BOOKS = 3; // menos casas que esto no es un consenso

/* Separa las casas de un evento y arma los dos consensos. */
function splitConsensus(ev) {
  const two = [], three = [];
  for (const bk of ev.bookmakers || []) {
    const h2h = (bk.markets || []).find(m => m.key === 'h2h');
    if (!h2h) continue;
    if ((h2h.outcomes || []).some(o => o.name === 'Draw')) three.push({ ...bk, markets: [h2h] });
    else two.push(bk);
  }
  const c2 = consensus({ ...ev, bookmakers: two }, false);   // excluye las casas de intercambio
  const c3 = consensus({ ...ev, bookmakers: three }, true);
  return {
    ...c2,
    books: c2.books,
    reg: c3.books >= MIN_BOOKS && c3.ml_home != null && c3.ml_draw != null && c3.ml_away != null
      ? { books: c3.books, home: c3.ml_home, draw: c3.ml_draw, away: c3.ml_away } : null,
  };
}

/* Lista de consensos pre-juego con nuestras abbr. null = sin key / API caído. */
async function getNhlOdds() {
  const events = await fetchSport(SPORT, 'h2h,spreads,totals');
  if (!events) return null;
  return events.filter(isPreGame)
    .map(ev => ({ ...splitConsensus(ev), event_id: ev.id, home: abbrFromFull(ev.home_team), away: abbrFromFull(ev.away_team) }))
    .filter(e => e.home && e.away);
}

/* El consenso de un juego (abbr + fecha ±30 h: los equipos juegan cada
   dos días). */
function findNhlOdds(list, homeAbbr, awayAbbr, dateISO) {
  if (!list) return null;
  const t = new Date(dateISO).getTime();
  const c = list
    .filter(e => e.home === homeAbbr && e.away === awayAbbr && Math.abs(new Date(e.commence).getTime() - t) < 30 * 3600e3)
    .sort((x, y) => Math.abs(new Date(x.commence) - t) - Math.abs(new Date(y.commence) - t))[0];
  if (!c) return null;
  const mlOk = c.books >= MIN_BOOKS && c.ml_home != null && c.ml_away != null;
  if (!mlOk && !c.reg) return null;
  /* la línea de gol solo cuenta si es de las de hockey (±1.5 / ±2.5):
     algunas casas europeas publican hándicaps asiáticos (−0.5, −1) que
     no son el mercado que el cliente ve en su casa */
  const plOk = mlOk && c.rl_point != null && [1.5, 2.5].includes(Math.abs(c.rl_point)) && c.rl_home_odds != null && c.rl_away_odds != null;
  const totOk = mlOk && c.total_line != null && c.total_over_odds != null && c.total_under_odds != null;
  return {
    source: 'consenso ' + (mlOk ? c.books : c.reg.books) + ' casas',
    odds_event_id: c.event_id,
    ml_home_imp: mlOk ? amToProb(c.ml_home) : null, ml_away_imp: mlOk ? amToProb(c.ml_away) : null,
    pl: plOk ? c.rl_point : null,       // línea de gol del LOCAL
    pl_home_imp: plOk ? amToProb(c.rl_home_odds) : null, pl_away_imp: plOk ? amToProb(c.rl_away_odds) : null,
    total: totOk ? c.total_line : null,
    total_over_imp: totOk ? amToProb(c.total_over_odds) : null, total_under_imp: totOk ? amToProb(c.total_under_odds) : null,
    /* resultado a 60 minutos (casas de 3 vías) */
    reg_home_imp: c.reg ? amToProb(c.reg.home) : null, reg_draw_imp: c.reg ? amToProb(c.reg.draw) : null, reg_away_imp: c.reg ? amToProb(c.reg.away) : null,
  };
}

module.exports = { getNhlOdds, findNhlOdds, splitConsensus, amToProb, probToAm, devigPair, SPORT };
