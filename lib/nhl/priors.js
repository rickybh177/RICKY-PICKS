/* ============================================================
   PRIORS NHL 2026-27 — generado por scripts/build-nhl-priors.js
   el 2026-11-12 desde 2022-23 → 2025-26 (5592 juegos, ESPN),
   ajustados por rival (lib/nhl/fit.js, half-life 300 días, 10
   pseudo-juegos), con el segundo juego en dos noches descontado, y
   regresados a la media (carry 0.8). att/def en escala log vs
   promedio de liga (def positivo = concede menos). NO editar a mano:
   regenerar. Nada de esto sale al navegador.
   ============================================================ */
/* mu = log de goles LIMPIOS (tiempo reglamentario, sin puerta vacía)
   por equipo; hfa = localía (log, total entre los dos lados); conv =
   goles limpios por tiro a puerta. */
const LEAGUE = {"mu":1.0237,"hfa":0.0367,"conv":{"sog":0.09861}};

/* Parámetros validados en scripts/nhl-backtest.js (walk-forward 2025-26 y 2024-25). */
const PARAMS = {
  "CARRY": 0.8,
  "K": 0.025,
  "SHOTS_W": 0.7,
  "SHOT_KIND": "sog",
  "EN_OUT": 1,
  "MU_SHIFT_N": 150,
  "G_C": 0.75,
  "G_N0": 1500,
  "REST": {
    "b2b_att": -0.0372,
    "b2b_def": 0.0408
  }
};
/* segundo juego en dos noches: n=1093 equipo-juegos, crudo ataque -0.0474 / concede 0.052 */

/* Dispersión del motor, FUERA DE MUESTRA (3936 juegos; 869 con tiempo
   extra = 22.1%, el local gana 52.5% de ellos). */
const DISP = {
  "MARGIN_W": [
    1.354,
    1.057,
    0.873,
    0.834
  ],
  "EN": {
    "1": [
      0.395,
      0.08
    ],
    "2": [
      0.65,
      0.015
    ],
    "3": [
      0.328,
      0
    ],
    "4": [
      0.022,
      0
    ]
  },
  "OT_S": 0.48,
  "OT_HOME": 0.017,
  "P1_SHARE": 0.3161
};

const PRIORS = {
  "ANA": {
    "att": 0.0177,
    "def": -0.0599
  },
  "BOS": {
    "att": -0.017,
    "def": -0.0159
  },
  "BUF": {
    "att": 0.0293,
    "def": -0.011
  },
  "CAR": {
    "att": 0.0887,
    "def": 0.0954
  },
  "CBJ": {
    "att": 0.0206,
    "def": -0.0355
  },
  "CGY": {
    "att": -0.0137,
    "def": -0.0238
  },
  "CHI": {
    "att": -0.0954,
    "def": -0.0636
  },
  "COL": {
    "att": 0.1003,
    "def": 0.0596
  },
  "DAL": {
    "att": -0.003,
    "def": 0.037
  },
  "DET": {
    "att": -0.0144,
    "def": -0.0082
  },
  "EDM": {
    "att": 0.0677,
    "def": 0.0039
  },
  "FLA": {
    "att": 0.0326,
    "def": 0.0301
  },
  "LA": {
    "att": -0.0114,
    "def": 0.0417
  },
  "MIN": {
    "att": 0.0148,
    "def": -0.0167
  },
  "MTL": {
    "att": -0.0299,
    "def": -0.0129
  },
  "NJ": {
    "att": 0.008,
    "def": 0.0155
  },
  "NSH": {
    "att": -0.0047,
    "def": -0.0327
  },
  "NYI": {
    "att": -0.0039,
    "def": -0.0003
  },
  "NYR": {
    "att": -0.02,
    "def": -0.0049
  },
  "OTT": {
    "att": 0.0265,
    "def": 0.0389
  },
  "PHI": {
    "att": -0.0445,
    "def": 0.0412
  },
  "PIT": {
    "att": 0.037,
    "def": -0.0152
  },
  "SEA": {
    "att": -0.0459,
    "def": -0.0145
  },
  "SJ": {
    "att": -0.0514,
    "def": -0.082
  },
  "STL": {
    "att": -0.0436,
    "def": 0.0027
  },
  "TB": {
    "att": 0.0245,
    "def": 0.035
  },
  "TOR": {
    "att": -0.004,
    "def": -0.0572
  },
  "UTAH": {
    "att": -0.0018,
    "def": 0.0061
  },
  "VAN": {
    "att": -0.0594,
    "def": -0.0374
  },
  "VGK": {
    "att": 0.0282,
    "def": 0.053
  },
  "WPG": {
    "att": -0.0247,
    "def": 0.023
  },
  "WSH": {
    "att": -0.007,
    "def": 0.0086
  }
};

/* Porteros: tiros recibidos y goles evitados sobre el promedio,
   decaídos entre temporadas (id de ESPN). */
const GOALIES = {
  2346: {"n":"Marc-Andre Fleury","sa":629,"gsa":-1.89},
  3634: {"n":"Jonathan Quick","sa":906,"gsa":-6.43},
  3759: {"n":"Semyon Varlamov","sa":393,"gsa":3.13},
  3870: {"n":"James Reimer","sa":697,"gsa":-6.54},
  5096: {"n":"Martin Jones","sa":257,"gsa":-1.24},
  5111: {"n":"Jake Allen","sa":1289,"gsa":-0.02},
  5452: {"n":"Jacob Markstrom","sa":1660,"gsa":-12.58},
  5473: {"n":"Jack Campbell","sa":165,"gsa":-2.7},
  5524: {"n":"Calvin Pickard","sa":703,"gsa":-6.23},
  5571: {"n":"Sergei Bobrovsky","sa":2204,"gsa":-6.9},
  5619: {"n":"Petr Mrazek","sa":1044,"gsa":-8.04},
  5622: {"n":"Scott Wedgewood","sa":1222,"gsa":13.29},
  5657: {"n":"Philipp Grubauer","sa":1097,"gsa":-3.77},
  5734: {"n":"Cam Talbot","sa":1317,"gsa":-5.94},
  2517899: {"n":"Frederik Andersen","sa":1301,"gsa":-8.8},
  2590824: {"n":"John Gibson","sa":1704,"gsa":-1.33},
  2590874: {"n":"Jordan Binnington","sa":1789,"gsa":-12.41},
  2610321: {"n":"Darcy Kuemper","sa":1679,"gsa":0.35},
  2976847: {"n":"Andrei Vasilevskiy","sa":2266,"gsa":20.89},
  3020225: {"n":"Connor Hellebuyck","sa":2331,"gsa":15.45},
  3025540: {"n":"Casey DeSmith","sa":1009,"gsa":3.16},
  3026526: {"n":"Laurent Brossoit","sa":213,"gsa":2.1},
  3036851: {"n":"Anton Forsberg","sa":1111,"gsa":2.42},
  3037703: {"n":"Antti Raanta","sa":198,"gsa":-2.49},
  3042020: {"n":"Tristan Jarry","sa":1314,"gsa":-10.29},
  3042057: {"n":"Eric Comrie","sa":719,"gsa":-3.71},
  3042069: {"n":"Spencer Martin","sa":338,"gsa":-9.51},
  3042109: {"n":"Juuse Saros","sa":2286,"gsa":-5.05},
  3067313: {"n":"Anthony Stolarz","sa":1010,"gsa":6.97},
  3067862: {"n":"Matt Murray","sa":179,"gsa":1.33},
  3069266: {"n":"Joonas Korpisalo","sa":1217,"gsa":-9.09},
  3069285: {"n":"Linus Ullmark","sa":1771,"gsa":7.12},
  3095330: {"n":"Pheonix Copley","sa":173,"gsa":-1.36},
  3095975: {"n":"Charlie Lindgren","sa":1129,"gsa":-8.04},
  3096217: {"n":"Thatcher Demko","sa":971,"gsa":0.83},
  3114994: {"n":"Alex Nedeljkovic","sa":1203,"gsa":-1.24},
  3114996: {"n":"Vitek Vanecek","sa":886,"gsa":-11.24},
  3115546: {"n":"Jonas Johansson","sa":747,"gsa":-10},
  3151038: {"n":"Elvis Merzlikins","sa":1420,"gsa":-17.92},
  3151137: {"n":"Ville Husso","sa":754,"gsa":-8.38},
  3151297: {"n":"Igor Shesterkin","sa":2195,"gsa":21.33},
  3151341: {"n":"Kaapo Kahkonen","sa":387,"gsa":-3.67},
  3151981: {"n":"Ilya Sorokin","sa":2176,"gsa":15.97},
  3654006: {"n":"Alex Lyon","sa":1281,"gsa":3.19},
  3900505: {"n":"Ilya Samsonov","sa":718,"gsa":-3.25},
  3904177: {"n":"Mackenzie Blackwood","sa":1542,"gsa":6.39},
  3939714: {"n":"Adin Hill","sa":1302,"gsa":-5.14},
  3942065: {"n":"Karel Vejmelka","sa":2039,"gsa":-8.92},
  3942073: {"n":"Joey Daccord","sa":1647,"gsa":3.07},
  3942459: {"n":"Dan Vladar","sa":1434,"gsa":2.59},
  3942685: {"n":"Ivan Fedotov","sa":215,"gsa":-5.58},
  3942714: {"n":"Sam Montembeault","sa":1445,"gsa":-9.26},
  4063288: {"n":"David Rittich","sa":902,"gsa":-4.27},
  4063522: {"n":"Connor Ingram","sa":1171,"gsa":-4.09},
  4064582: {"n":"Carter Hart","sa":1006,"gsa":1.51},
  4196914: {"n":"Jake Oettinger","sa":2412,"gsa":8.2},
  4233889: {"n":"Ukko-Pekka Luukkonen","sa":1590,"gsa":-5.13},
  4239677: {"n":"Alexandar Georgiev","sa":1180,"gsa":-9.77},
  4268767: {"n":"Stuart Skinner","sa":2107,"gsa":-12.54},
  4271575: {"n":"Joseph Woll","sa":1423,"gsa":2.65},
  4272674: {"n":"Filip Gustavsson","sa":1948,"gsa":12.87},
  4272888: {"n":"Logan Thompson","sa":1910,"gsa":20.39},
  4319911: {"n":"Devin Cooley","sa":495,"gsa":3.22},
  4341584: {"n":"Kevin Lankinen","sa":1396,"gsa":-17.51},
  4393408: {"n":"Justus Annunen","sa":761,"gsa":-1.15},
  4565234: {"n":"Spencer Knight","sa":1387,"gsa":0.17},
  4565259: {"n":"Pyotr Kochetkov","sa":859,"gsa":-0.77},
  4576894: {"n":"Arturs Silovs","sa":839,"gsa":-10.18},
  4587815: {"n":"Samuel Ersson","sa":1123,"gsa":-23.16},
  4587845: {"n":"Akira Schmid","sa":608,"gsa":-7.34},
  4587855: {"n":"Cayden Primeau","sa":276,"gsa":-6.7},
  4587909: {"n":"Joel Hofer","sa":1186,"gsa":7.56},
  4587952: {"n":"Dustin Wolf","sa":1576,"gsa":0.27},
  4587994: {"n":"Daniil Tarasov","sa":970,"gsa":-7.26},
  4588165: {"n":"Lukas Dostal","sa":1979,"gsa":-17.11},
  4697394: {"n":"Yaroslav Askarov","sa":938,"gsa":-14.91},
  4697683: {"n":"Nico Daws","sa":210,"gsa":0.42},
  4697686: {"n":"Jakub Dobes","sa":1211,"gsa":4.17},
  4712036: {"n":"Jeremy Swayman","sa":2116,"gsa":9.2},
  4736758: {"n":"Colten Ellis","sa":248,"gsa":1.09},
  4874737: {"n":"Jesper Wallstedt","sa":844,"gsa":8.82},
  4894366: {"n":"Jet Greaves","sa":1095,"gsa":10.41},
  4894487: {"n":"Devon Levi","sa":253,"gsa":-2.56},
  4894703: {"n":"Leevi Merilainen","sa":371,"gsa":-8.6},
  4894729: {"n":"Arvid Soderblom","sa":1069,"gsa":-14.62},
  4996097: {"n":"Brandon Bussi","sa":588,"gsa":-3.22},
  5174160: {"n":"Dennis Hildeby","sa":334,"gsa":-0.67},
  5188437: {"n":"Jacob Fowler","sa":269,"gsa":1.91},
  5188534: {"n":"Nikita Tolopilo","sa":329,"gsa":-7.5},
};
/* Nivel de la mezcla de porteros con la que cada equipo ganó su rating. */
const TEAM_REF = {"ANA":-0.00429,"BOS":0.00143,"BUF":0.00055,"CAR":-0.00317,"CBJ":0.00267,"CGY":0.001,"CHI":-0.00079,"COL":0.0052,"DAL":0.00277,"DET":0.00003,"EDM":-0.00197,"FLA":-0.00282,"LA":0.0011,"MIN":0.00527,"MTL":0.00158,"NJ":-0.00143,"NSH":-0.00173,"NYI":0.00477,"NYR":0.00318,"OTT":0.00027,"PHI":-0.00146,"PIT":-0.00471,"SEA":0.00049,"SJ":-0.00307,"STL":0.00036,"TB":0.00534,"TOR":0.00222,"UTAH":-0.00251,"VAN":-0.00509,"VGK":0.00067,"WPG":0.00441,"WSH":0.00513};

module.exports = { PRIORS, LEAGUE, PARAMS, DISP, GOALIES, TEAM_REF };
