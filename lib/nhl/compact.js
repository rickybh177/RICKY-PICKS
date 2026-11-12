/* ============================================================
   NHL — formato compacto de un juego terminado. Lo comparten el
   histórico (scripts/nhl-history.js → lib/nhl/data/games-<año>.json)
   y el runtime (lib/nhl/season.js: capa estática + delta en el KV),
   así las dos capas se funden sin traducir nada.
   ============================================================ */

/* orden de cada arreglo */
const GAME_COLS = ['id', 'date', 'seasontype', 'neutral', 'home', 'away', 'hs', 'as', 'hp', 'ap',
  'hsog', 'asog', 'hmiss', 'amiss', 'hblk', 'ablk', 'hppg', 'appg', 'hppo', 'appo', 'hen', 'aen', 'hgoalie', 'agoalie', 'close', 'open'];

/* fila compacta a partir del juego del scoreboard + summary (+ cierre).
   g.home.gk = id del portero titular según el scoreboard. */
function compactGame(g, s, o) {
  const th = (s && s.team && s.team[g.home.abbr]) || {}, ta = (s && s.team && s.team[g.away.abbr]) || {};
  const nn = v => (v != null ? v : null);
  const gkOf = side => side.gk || (side.goalie && side.goalie.id) || null;
  /* portero TITULAR: el que ESPN marca como portero del juego en el
     scoreboard. No se usa "el que más minutos jugó": si al titular lo
     sacan por goleada, el suplente termina con más minutos y el dato
     delataría el resultado. Solo si el scoreboard no lo trae se cae al
     de más minutos. */
  const gl = (t, gk) => {
    const list = t.goalies || [];
    const x = (gk && list.find(q => String(q.id) === String(gk))) || list[0];
    return x ? [x.id, x.name, x.ga, x.sa, x.toi] : null;
  };
  return [
    g.id, g.date, g.seasontype, g.neutral ? 1 : 0, g.home.abbr, g.away.abbr, g.home.score, g.away.score, g.home.p, g.away.p,
    nn(th.sog), nn(ta.sog), nn(th.miss), nn(ta.miss), nn(th.blk), nn(ta.blk), nn(th.ppg), nn(ta.ppg), nn(th.ppo), nn(ta.ppo),
    s && s.hasPlays ? (th.en || 0) : null, s && s.hasPlays ? (ta.en || 0) : null,
    gl(th, gkOf(g.home)), gl(ta, gkOf(g.away)),
    o ? [o.ml_home, o.ml_away, o.pl, o.pl_home_odds, o.pl_away_odds, o.total, o.over_odds, o.under_odds] : null,
    o && (o.open_ml_home != null || o.open_total != null) ? [o.open_ml_home, o.open_ml_away, o.open_total] : null,
  ];
}

/* fila compacta → objeto (la forma que leen core.js, fit.js y los scripts) */
function gameObj(a, season) {
  const side = (k) => {
    const p = a[8 + k] || [];
    const g = a[22 + k];
    return {
      abbr: a[4 + k], score: a[6 + k], p,
      reg: p.length >= 3 ? p[0] + p[1] + p[2] : a[6 + k],  // goles en tiempo reglamentario
      sog: a[10 + k], miss: a[12 + k], blk: a[14 + k], ppg: a[16 + k], ppo: a[18 + k], en: a[20 + k] || 0,
      goalie: g ? { id: String(g[0]), name: g[1], ga: g[2], sa: g[3], toi: g[4] } : null,
    };
  };
  const hp = a[8] || [];
  return {
    id: String(a[0]), date: a[1], seasontype: a[2], neutral: !!a[3],
    home: side(0), away: side(1),
    ot: hp.length > 3,            // se fue a tiempo extra
    so: hp.length > 4,            // se definió en penales
    close: a[24] ? { ml_home: a[24][0], ml_away: a[24][1], pl: a[24][2], pl_home_odds: a[24][3], pl_away_odds: a[24][4], total: a[24][5], over_odds: a[24][6], under_odds: a[24][7] } : null,
    open: a[25] ? { ml_home: a[25][0], ml_away: a[25][1], total: a[25][2] } : null,
    season,
  };
}

module.exports = { GAME_COLS, compactGame, gameObj };
