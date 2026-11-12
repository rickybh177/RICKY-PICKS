/* ============================================================
   NBA — regla de veredictos y PICK PRINCIPAL por partido.

   Problema que resuelve (dueño, 11-nov-2026): con la barra original
   (PICK solo con EV ≥ 4% y nunca sin momios) la mayoría de los
   partidos salía sin ningún PICK, y quien entraba a la página se iba
   igual de confundido. Ahora cada partido termina en UNA conclusión
   clara: un pick principal, o un "este se deja pasar" con su razón.

   Función pura (sin red ni priors): la usan el runtime
   (lib/nba/model.js) y el backtest (scripts/nba-backtest.js), así lo
   que se valida es exactamente lo que se publica.

   Candidatos de un partido: el lado del modelo en hándicap, total y
   ganador. Para cada uno:
     p     probabilidad del modelo
     imp   prob implícita del precio a tomar (con vig) o null sin momios
     pMkt  prob del mercado sin vig (devig) o null
     guarded  el mercado está muy lejos del modelo (≥7 pts de hándicap
              o ≥12 de total): sabe algo que el modelo no → nunca PICK

   1. Veredicto de cada mercado:
      - con momios: EV sobre la prob encogida hacia el mercado
        (BLEND); PICK si EV ≥ BET_EV, MAYBE si ≥ MAYBE_EV;
      - sin momios: solo el GANADOR dice algo (las líneas del modelo
        son 50/50 por construcción): PICK si el modelo le da ≥ WIN_BAR,
        MAYBE si ≥ WIN_MAYBE.
   2. PICK PRINCIPAL — si ningún mercado llegó a PICK:
      a) el de mejor EV, si es ≥ PROMO_EV (nunca con EV negativo);
      b) si no, el GANADOR cuando el modelo lo ve ≥ WIN_BAR y el
         mercado no lo contradice (EV ≥ −WIN_EV_TOL): es "el resultado
         más probable", sin ventaja de precio — se dice tal cual;
      c) si no, no hay pick: partido parejo o mercado lejos del modelo.
   El `kind` distingue 'valor' (hay ventaja contra el precio) de
   'probable' (es lo más probable, el precio es justo).
   ============================================================ */

const RULES = {
  BLEND: 0.4,        // encogimiento hacia el mercado
  BET_EV: 0.04,      // PICK directo por valor
  MAYBE_EV: 0.015,
  PROMO_EV: 0.01,    // EV mínimo para ser el pick principal del partido
  WIN_BAR: 0.62,     // ganador como pick por probabilidad (bucket 60-70% acierta 71% en el backtest)
  WIN_MAYBE: 0.55,
  WIN_EV_TOL: 0.03,  // cuánto puede "pagar de menos" el ganador probable
  FLOOR: 0.25,       // nunca PICK a algo que el modelo ve por debajo de 25%
  /* El GANADOR por valor es el mercado más ruidoso: el mismo desacuerdo
     con el mercado se expresa mejor en el hándicap (misma idea, menos
     varianza). Por eso el ganador pide más EV para ser PICK directo y
     no entra a la promoción (a); solo llega por (b), como "probable". */
  ML_BET_EV: 0.06,   // backtest: con 0.06 y fuera de la promoción, ROI al cierre −0.5% → +0.3% (2025-26) y −2.3% → −1.8% (2024-25)
  ML_IN_PROMO: false,
};

const round3 = x => { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; };

/* cands: [{ market, p, imp, pMkt, guarded }]
   → { rows: [{ verdict, ev, kind }], main: índice | null, reason } */
function decide(cands, R = RULES) {
  const rows = cands.map(c => {
    if (c.p == null) return { verdict: 'skip', ev: null, kind: null, pb: null };
    if (c.imp != null && c.imp > 0) {
      const pb = c.pMkt != null ? (1 - R.BLEND) * c.p + R.BLEND * c.pMkt : c.p;
      const ev = pb / c.imp - 1;
      let verdict = 'skip';
      if (pb >= R.FLOOR && ev >= (c.market === 'moneyline' ? R.ML_BET_EV : R.BET_EV)) verdict = 'bet';
      else if (pb >= R.FLOOR && ev >= R.MAYBE_EV) verdict = 'maybe';
      if (c.guarded && verdict === 'bet') verdict = 'maybe';
      return { verdict, ev: round3(ev), kind: verdict === 'bet' ? 'valor' : null, pb };
    }
    // sin momios: solo el ganador
    if (c.market === 'moneyline') {
      if (c.p >= R.WIN_BAR) return { verdict: 'bet', ev: null, kind: 'probable', pb: c.p };
      if (c.p >= R.WIN_MAYBE) return { verdict: 'maybe', ev: null, kind: null, pb: c.p };
    }
    return { verdict: 'skip', ev: null, kind: null, pb: c.p };
  });

  let reason = null;
  if (!rows.some(r => r.verdict === 'bet')) {
    // a) mejor EV con precio, no vigilado
    let best = -1;
    cands.forEach((c, i) => {
      const r = rows[i];
      if (c.guarded || r.ev == null || r.pb < R.FLOOR || r.ev < R.PROMO_EV) return;
      if (c.market === 'moneyline' && !R.ML_IN_PROMO) return;
      if (best < 0 || r.ev > rows[best].ev) best = i;
    });
    if (best >= 0) { rows[best].verdict = 'bet'; rows[best].kind = 'valor'; }
    else {
      // b) ganador probable que el mercado no contradice
      const i = cands.findIndex(c => c.market === 'moneyline');
      const c = cands[i], r = rows[i];
      if (c && !c.guarded && c.p >= R.WIN_BAR && r.ev != null && r.ev >= -R.WIN_EV_TOL) { r.verdict = 'bet'; r.kind = 'probable'; }
      else reason = cands.some(x => x.guarded) ? 'mercado_lejos' : (cands.some(x => x.imp != null) ? 'parejo' : 'sin_momios');
    }
  }

  // el principal: valor (mayor EV) antes que probable
  let main = null;
  rows.forEach((r, i) => {
    if (r.verdict !== 'bet') return;
    if (main == null) { main = i; return; }
    const m = rows[main];
    const rank = x => (x.kind === 'valor' ? 1 : 0);
    if (rank(r) > rank(m) || (rank(r) === rank(m) && (r.ev || 0) > (m.ev || 0))) main = i;
  });
  for (const r of rows) delete r.pb;
  return { rows, main, reason };
}

/* Texto de la conclusión para cuando NO hay pick. */
const NO_PICK_TXT = {
  mercado_lejos: 'Sin pick: el mercado está muy lejos de lo que calcula el modelo. Casi siempre es una baja que el reporte de lesiones aún no trae. Mejor dejarlo pasar.',
  parejo: 'Sin pick: el modelo y el mercado ven el partido igual, y nada paga de más. Este se deja pasar.',
  sin_momios: 'Sin pick todavía: el partido es parejo y aún no hay momios. En cuanto se publiquen, el modelo vuelve a calcular.',
};

module.exports = { decide, RULES, NO_PICK_TXT };
