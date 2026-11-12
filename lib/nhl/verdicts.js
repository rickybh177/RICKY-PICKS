/* ============================================================
   NHL — regla de veredictos y PICK PRINCIPAL por partido (misma idea
   que lib/nba/verdicts.js: cada partido termina en UNA conclusión
   clara — un pick principal, o un "este se deja pasar" con su razón).

   Función pura (sin red ni priors): la usan el runtime
   (lib/nhl/model.js) y el backtest (scripts/nhl-backtest.js), así lo
   que se valida es exactamente lo que se publica.

   Mercados con precio del consenso: ganador (con tiempo extra), línea
   de gol (±1.5) y total. De cada uno entran LOS DOS lados:
     p     probabilidad del modelo
     imp   prob implícita del precio a tomar (con vig) o null sin momios
     pMkt  prob del mercado sin vig (devig) o null

   1. Lado de cada mercado: con momios, el de mejor valor si alguno
      paga de más (EV ≥ MAYBE_EV); si ninguno, el más probable (es
      hacia donde se inclina el modelo). En hockey el valor vive muchas
      veces del lado que NO es favorito (+1.5, o el visitante a +140):
      por eso se miran los dos.
   2. Veredicto: EV sobre la prob encogida hacia el mercado (BLEND);
      PICK si EV ≥ BET_EV del mercado, MAYBE si ≥ MAYBE_EV. Nunca PICK
      a algo que el modelo ve por debajo de FLOOR. Sin momios solo el
      GANADOR dice algo: PICK si el modelo le da ≥ WIN_BAR.
   3. PICK PRINCIPAL — si ningún mercado llegó a PICK:
      a) el de mejor EV entre los mercados de PROMO, si es ≥ PROMO_EV;
      b) si no, el GANADOR cuando el modelo lo ve ≥ WIN_BAR y el mercado
         no lo contradice (EV ≥ −WIN_EV_TOL): "el resultado más
         probable", sin ventaja de precio — se dice tal cual;
      c) si no, no hay pick.
   Guardián: si la probabilidad del ganador del modelo está a ≥
   GUARD_PROB de la del mercado, el mercado sabe algo (un portero o una
   baja que el modelo no ve) → nunca PICK.
   ============================================================ */

const RULES = {
  BLEND: 0.5,          // encogimiento hacia el mercado
  BET_EV: { ml: 0.04, pl: 0.04, total: 0.06 },   // PICK directo por valor
  MAYBE_EV: 0.015,
  PROMO: { ml: true, pl: true, total: false },    // quién puede ser promovido a pick principal
  PROMO_EV: 0.01,      // EV mínimo para ser el pick principal del partido
  WIN_BAR: 0.57,       // ganador como pick por probabilidad (en hockey un 57% ya es un favorito claro)
  WIN_MAYBE: 0.54,
  WIN_EV_TOL: 0.03,    // cuánto puede "pagar de menos" el ganador probable
  FLOOR: { ml: 0.3, pl: 0.25, total: 0.3 },
  GUARD_PROB: 0.15,
};

const round3 = x => { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; };
const KEYS = ['ml', 'pl', 'total'];

/* input: { ml: [a, b], pl: [a, b], total: [a, b] } con cada lado
   { side, p, imp, pMkt } (a = local / over; b = visita / under).
   → { rows: { ml, pl, total: { side, p, verdict, ev, kind, priced } },
       main: 'ml' | 'pl' | 'total' | null, reason, guarded } */
function decide(input, R = RULES) {
  const evOf = s => {
    if (s.p == null || s.imp == null || !(s.imp > 0)) return null;
    const pb = s.pMkt != null ? (1 - R.BLEND) * s.p + R.BLEND * s.pMkt : s.p;
    return { pb, ev: pb / s.imp - 1 };
  };
  const mlPair = input.ml || [];
  const guarded = mlPair.length === 2 && mlPair[0].pMkt != null && Math.abs(mlPair[0].p - mlPair[0].pMkt) >= R.GUARD_PROB;

  const rows = {};
  for (const k of KEYS) {
    const pair = (input[k] || []).filter(s => s && s.p != null);
    if (!pair.length) { rows[k] = null; continue; }
    const scored = pair.map(s => ({ s, e: evOf(s) }));
    const priced = scored.every(x => x.e);
    const likely = scored.slice().sort((x, y) => y.s.p - x.s.p)[0];
    let pick = likely;
    if (priced) {
      const best = scored.slice().sort((x, y) => y.e.ev - x.e.ev)[0];
      if (best.e.ev >= R.MAYBE_EV && best.e.pb >= R.FLOOR[k]) pick = best;
    }
    let verdict = 'skip', kind = null, ev = null;
    if (priced) {
      ev = pick.e.ev;
      if (pick.e.pb >= R.FLOOR[k] && ev >= R.BET_EV[k]) { verdict = 'bet'; kind = 'valor'; }
      else if (pick.e.pb >= R.FLOOR[k] && ev >= R.MAYBE_EV) verdict = 'maybe';
      if (guarded && verdict === 'bet') { verdict = 'maybe'; kind = null; }
    } else if (k === 'ml') {
      if (pick.s.p >= R.WIN_BAR) { verdict = 'bet'; kind = 'probable'; }
      else if (pick.s.p >= R.WIN_MAYBE) verdict = 'maybe';
    }
    rows[k] = { side: pick.s.side, p: pick.s.p, imp: pick.s.imp != null ? pick.s.imp : null, pMkt: pick.s.pMkt != null ? pick.s.pMkt : null, verdict, ev: ev != null ? round3(ev) : null, kind, priced, _ev: ev, _fav: likely, _favE: likely.e };
  }

  let reason = null;
  const live = KEYS.filter(k => rows[k]);
  if (!live.some(k => rows[k].verdict === 'bet')) {
    // a) mejor EV con precio entre los mercados de promoción
    let best = null;
    if (!guarded) for (const k of live) {
      const r = rows[k];
      if (!R.PROMO[k] || !r.priced || r._ev == null || r._ev < R.PROMO_EV) continue;
      if (!best || r._ev > rows[best]._ev) best = k;
    }
    if (best) { rows[best].verdict = 'bet'; rows[best].kind = 'valor'; }
    else {
      // b) el ganador más probable, si el mercado no lo contradice
      const r = rows.ml;
      const fav = r && r._fav;
      if (r && r.priced && !guarded && fav.s.p >= R.WIN_BAR && fav.e.ev >= -R.WIN_EV_TOL) {
        rows.ml = { ...r, side: fav.s.side, p: fav.s.p, imp: fav.s.imp, pMkt: fav.s.pMkt, verdict: 'bet', ev: round3(fav.e.ev), kind: 'probable', _ev: fav.e.ev };
      } else reason = guarded ? 'mercado_lejos' : (live.some(k => rows[k].priced) ? 'parejo' : 'sin_momios');
    }
  }

  // el principal: valor (mayor EV) antes que probable
  let main = null;
  const rank = r => (r.kind === 'valor' ? 1 : 0);
  for (const k of live) {
    const r = rows[k];
    if (r.verdict !== 'bet') continue;
    if (main == null) { main = k; continue; }
    const m = rows[main];
    if (rank(r) > rank(m) || (rank(r) === rank(m) && (r._ev || 0) > (m._ev || 0))) main = k;
  }
  for (const k of live) { delete rows[k]._ev; delete rows[k]._fav; delete rows[k]._favE; }
  return { rows, main, reason, guarded };
}

/* Lados de cada mercado a partir de los mercados del motor (mk, ya
   calculados EN LAS LÍNEAS del mercado) y los precios del consenso:
   px = { ml_home_imp, ml_away_imp, pl, pl_home_imp, pl_away_imp,
          total, total_over_imp, total_under_imp } (cualquiera null). */
function sidesOf(mk, px) {
  const dv = (a, b) => (a != null && b != null && a + b > 0 ? [a / (a + b), b / (a + b)] : [null, null]);
  const P = px || {};
  const m = dv(P.ml_home_imp, P.ml_away_imp);
  const out = {
    ml: [
      { side: 'home', p: mk.moneyline.home, imp: m[0] != null ? P.ml_home_imp : null, pMkt: m[0] },
      { side: 'away', p: mk.moneyline.away, imp: m[1] != null ? P.ml_away_imp : null, pMkt: m[1] },
    ],
  };
  const hasPl = P.pl != null;
  const s = hasPl ? dv(P.pl_home_imp, P.pl_away_imp) : [null, null];
  out.pl = [
    { side: 'home', p: mk.puck_line.home_cover, imp: s[0] != null ? P.pl_home_imp : null, pMkt: s[0] },
    { side: 'away', p: 1 - mk.puck_line.home_cover, imp: s[1] != null ? P.pl_away_imp : null, pMkt: s[1] },
  ];
  const hasT = P.total != null;
  const t = hasT ? dv(P.total_over_imp, P.total_under_imp) : [null, null];
  out.total = [
    { side: 'over', p: mk.total.over, imp: t[0] != null ? P.total_over_imp : null, pMkt: t[0] },
    { side: 'under', p: 1 - mk.total.over, imp: t[1] != null ? P.total_under_imp : null, pMkt: t[1] },
  ];
  return out;
}

/* Texto de la conclusión para cuando NO hay pick. */
const NO_PICK_TXT = {
  mercado_lejos: 'Sin pick: el mercado está muy lejos de lo que calcula el modelo. Casi siempre es un portero o una baja que el modelo todavía no ve. Mejor dejarlo pasar.',
  parejo: 'Sin pick: el modelo y el mercado ven el partido igual, y nada paga de más. Este se deja pasar.',
  sin_momios: 'Sin pick todavía: el partido es parejo y aún no hay momios. En cuanto se publiquen, el modelo vuelve a calcular.',
};

module.exports = { decide, sidesOf, RULES, NO_PICK_TXT };
