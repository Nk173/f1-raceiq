function rebuildScores() {
  const ss = SpreadsheetApp.getActive();
  const formSh = ss.getSheetByName("Choices");
  const resSh = ss.getSheetByName("Results 2");
  const scoreSh = ss.getSheetByName("Scores") || ss.insertSheet("Scores");

  if (!formSh) throw new Error("Missing sheet: Choices");
  if (!resSh) throw new Error("Missing sheet: Results");

  // ----- Read Results (headers in row 6, data from row 7) -----
  const resHeaderRow = 1;
  const resDataStart = 2;
  const resLastCol = resSh.getLastColumn();
  const resLastRow = resSh.getLastRow();
  if (resLastRow < resDataStart) throw new Error("Results have not been updated.");

  const resHeaders = resSh.getRange(resHeaderRow, 1, 1, resLastCol).getValues()[0];
  const resData = resSh.getRange(resDataStart, 1, resLastRow - resDataStart + 1, resLastCol).getValues();

  const col = makeHeaderIndex_(resHeaders);

  // Required columns (by your header list)
  const req = ["Driver","Team","StartingPosition","FinalPosition","TotalLaps","PitStopCount",
               "PitLap1","PitLap2","PitLap3","PitLap4","PitLap5","PitLap6",
               "StartingTyre","TyreAfterPit1","TyreAfterPit2","TyreAfterPit3","TyreAfterPit4","TyreAfterPit5","TyreAfterPit6",
               "SCAtPit1","SCAtPit2","SCAtPit3","SCAtPit4","SCAtPit5","SCAtPit6"];
  for (const k of req) {
    if (!(k in col)) throw new Error(`Results header missing: ${k} (check row 6 headers)`);
  }

  // Map results by normalized driver name
  const resultsByDriver = new Map();
  for (const r of resData) {
    const driver = String(r[col.Driver] || "").trim();
    if (!driver) continue;
    resultsByDriver.set(normWithAlias_(driver), {
      driver,
      team: r[col.Team],
      startPos: num_(r[col.StartingPosition]),
      finalPos: num_(r[col.FinalPosition]),
      laps: num_(r[col.TotalLaps]),
      pitCount: num_(r[col.PitStopCount]),
      pitLaps: [
        num_(r[col.PitLap1]), num_(r[col.PitLap2]), num_(r[col.PitLap3]),
        num_(r[col.PitLap4]), num_(r[col.PitLap5]), num_(r[col.PitLap6]),
      ],
      scAtPit: [
        String(r[col.SCAtPit1] || "").trim().toUpperCase() === "YES",
        String(r[col.SCAtPit2] || "").trim().toUpperCase() === "YES",
        String(r[col.SCAtPit3] || "").trim().toUpperCase() === "YES",
        String(r[col.SCAtPit4] || "").trim().toUpperCase() === "YES",
        String(r[col.SCAtPit5] || "").trim().toUpperCase() === "YES",
        String(r[col.SCAtPit6] || "").trim().toUpperCase() === "YES",
      ],
      tyres: {
        start: r[col.StartingTyre] || "",
        after: [
          r[col.TyreAfterPit1] || "",
          r[col.TyreAfterPit2] || "",
          r[col.TyreAfterPit3] || "",
          r[col.TyreAfterPit4] || "",
          r[col.TyreAfterPit5] || "",
          r[col.TyreAfterPit6] || ""
        ]
      }
    });
  }

  // ----- Read Form Responses 1 -----
  const frLastRow = formSh.getLastRow();
  const frLastCol = formSh.getLastColumn();
  if (frLastRow < 2) throw new Error("Choices has no submissions.");

  const frHeaders = formSh.getRange(1, 1, 1, frLastCol).getValues()[0];
  const fr = makeHeaderIndex_(frHeaders);

  // We’ll use the columns you pasted (exact header text)
  const h = {
    email: "Email Address",
    team: "Team Name",
    d1: "Driver 1",
    d2: "Driver 2",
    d1p1: "Driver 1 — Pit lap for stop 1",
    d1p2: "Driver 1 — Pit lap for stop 2",
    d1p3: "Driver 1 — Pit lap for stop 3",
    d2p1: "Driver 2 — Pit lap for stop 1",
    d2p2: "Driver 2 — Pit lap for stop 2",
    d2p3: "Driver 2 — Pit lap for stop 3",
    d1t1: "Driver 1 — Tyre after stop 1",
    d1t2: "Driver 1 — Tyre after stop 2",
    d1t3: "Driver 1 — Tyre after stop 3",
    d2t1: "Driver 2 — Tyre after stop 1",
    d2t2: "Driver 2 — Tyre after stop 2",
    d2t3: "Driver 2 — Tyre after stop 3",
  };

  for (const key of Object.values(h)) {
    if (!(key in fr)) throw new Error(`Choices header missing: ${key}`);
  }

  const frData = formSh.getRange(2, 1, frLastRow - 1, frLastCol).getValues();

  // ----- Build Scores output -----
  const outHeaders = [
    "Email","TeamName",
    "Driver1","Driver2",
    "Driver1_InitialPos","Driver2_InitialPos",
    "Driver1_FinalPos","Driver2_FinalPos",
    "Driver1_PositionPts","Driver2_PositionPts",
    "Driver1_PitCountPred","Driver2_PitCountPred",
    "Driver1_PitCountPts","Driver2_PitCountPts",
    "Driver1_PitLap1Pred","Driver1_PitLap2Pred","Driver1_PitLap3Pred",
    "Driver1_PitLap1Pts","Driver1_PitLap2Pts","Driver1_PitLap3Pts",
    "Driver2_PitLap1Pred","Driver2_PitLap2Pred","Driver2_PitLap3Pred",
    "Driver2_PitLap1Pts","Driver2_PitLap2Pts","Driver2_PitLap3Pts",
    "Driver1_StartingTyre","Driver1_TyreAfterPit1","Driver1_TyreAfterPit2","Driver1_TyreAfterPit3",
    "Driver1_TyrePred1","Driver1_TyrePred2","Driver1_TyrePred3",
    "Driver1_TyrePts1","Driver1_TyrePts2","Driver1_TyrePts3",
    "Driver2_StartingTyre","Driver2_TyreAfterPit1","Driver2_TyreAfterPit2","Driver2_TyreAfterPit3",
    "Driver2_TyrePred1","Driver2_TyrePred2","Driver2_TyrePred3",
    "Driver2_TyrePts1","Driver2_TyrePts2","Driver2_TyrePts3",
    "TotalPoints"
  ];

  const out = [];
  for (const row of frData) {
    const email = String(row[fr[h.email]] || "").trim();
    if (!email) continue;

    const teamName = String(row[fr[h.team]] || "").trim();

    const d1Raw = String(row[fr[h.d1]] || "");
    const d2Raw = String(row[fr[h.d2]] || "");
    const d1Name = extractName_(d1Raw);
    const d2Name = extractName_(d2Raw);

    const r1 = resultsByDriver.get(normWithAlias_(d1Name));
    const r2 = resultsByDriver.get(normWithAlias_(d2Name));

    // Predictions (up to 3)
    const d1p = [num_(row[fr[h.d1p1]]), num_(row[fr[h.d1p2]]), num_(row[fr[h.d1p3]])].filter(v => v !== "");
    const d2p = [num_(row[fr[h.d2p1]]), num_(row[fr[h.d2p2]]), num_(row[fr[h.d2p3]])].filter(v => v !== "");

    // Positions + position points
    const d1Start = r1 ? r1.startPos : "";
    const d2Start = r2 ? r2.startPos : "";
    const d1Final = r1 ? r1.finalPos : "";
    const d2Final = r2 ? r2.finalPos : "";

    const totalDrivers = resultsByDriver.size;
    const d1PosPts = positionPoints_(d1Final, d1Start, totalDrivers);
    const d2PosPts = positionPoints_(d2Final, d2Start, totalDrivers);

    // Pit count points (tiered: 1→10, 2→15, 3→25)
    const d1PitCountPts = r1 ? pitCountPts_(d1p.length, r1.pitCount) : 0;
    const d2PitCountPts = r2 ? pitCountPts_(d2p.length, r2.pitCount) : 0;

    // Pit lap points (compare predicted pit#n to actual pit#n)
    const d1PitPts = [0,0,0];
    const d2PitPts = [0,0,0];

    for (let i=0; i<3; i++) {
      const pred = d1p[i] ?? "";
      const act = r1 ? r1.pitLaps[i] : "";
      const sc  = r1 ? r1.scAtPit[i] : false;
      d1PitPts[i] = pitLapPts_(pred, act, sc);
    }
    for (let i=0; i<3; i++) {
      const pred = d2p[i] ?? "";
      const act = r2 ? r2.pitLaps[i] : "";
      const sc  = r2 ? r2.scAtPit[i] : false;
      d2PitPts[i] = pitLapPts_(pred, act, sc);
    }

    // Tyres (start + after pits) — actual from results
    const d1TyStart = r1 ? r1.tyres.start : "";
    const d1TyAfter = r1 ? r1.tyres.after : ["","","","","",""];
    const d2TyStart = r2 ? r2.tyres.start : "";
    const d2TyAfter = r2 ? r2.tyres.after : ["","","","","",""];

    // Tyre predictions from form
    const d1TyrePred = [
      String(row[fr[h.d1t1]] || ""),
      String(row[fr[h.d1t2]] || ""),
      String(row[fr[h.d1t3]] || "")
    ];
    const d2TyrePred = [
      String(row[fr[h.d2t1]] || ""),
      String(row[fr[h.d2t2]] || ""),
      String(row[fr[h.d2t3]] || "")
    ];

    // Tyre points — 10 per correct compound after each pit
    const d1TyrePts = [0, 0, 0];
    const d2TyrePts = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      d1TyrePts[i] = tyrePts_(d1TyrePred[i], d1TyAfter[i]);
      d2TyrePts[i] = tyrePts_(d2TyrePred[i], d2TyAfter[i]);
    }

    const total =
      d1PosPts + d2PosPts +
      d1PitCountPts + d2PitCountPts +
      d1PitPts.reduce((a,b)=>a+b,0) +
      d2PitPts.reduce((a,b)=>a+b,0) +
      d1TyrePts.reduce((a,b)=>a+b,0) +
      d2TyrePts.reduce((a,b)=>a+b,0);

    out.push([
      email, teamName,
      d1Name, d2Name,
      d1Start, d2Start,
      d1Final, d2Final,
      d1PosPts, d2PosPts,
      d1p.length, d2p.length,
      d1PitCountPts, d2PitCountPts,
      d1p[0] ?? "", d1p[1] ?? "", d1p[2] ?? "",
      d1PitPts[0], d1PitPts[1], d1PitPts[2],
      d2p[0] ?? "", d2p[1] ?? "", d2p[2] ?? "",
      d2PitPts[0], d2PitPts[1], d2PitPts[2],
      d1TyStart, d1TyAfter[0] || "", d1TyAfter[1] || "", d1TyAfter[2] || "",
      d1TyrePred[0], d1TyrePred[1], d1TyrePred[2],
      d1TyrePts[0], d1TyrePts[1], d1TyrePts[2],
      d2TyStart, d2TyAfter[0] || "", d2TyAfter[1] || "", d2TyAfter[2] || "",
      d2TyrePred[0], d2TyrePred[1], d2TyrePred[2],
      d2TyrePts[0], d2TyrePts[1], d2TyrePts[2],
      total
    ]);
  }

  // ----- Write Scores -----
  scoreSh.clear();
  scoreSh.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]);
  if (out.length) scoreSh.getRange(2, 1, out.length, outHeaders.length).setValues(out);
  scoreSh.setFrozenRows(1);
  scoreSh.autoResizeColumns(1, outHeaders.length);
}

/* ---------------- Helpers ---------------- */

function makeHeaderIndex_(headers) {
  const m = {};
  headers.forEach((h, i) => {
    const key = String(h || "").trim();
    if (key) m[key] = i;
  });
  return m;
}

function extractName_(s) {
  // "Charles Leclerc — 32" or "Charles Leclerc - 32" -> "Charles Leclerc"
  const t = String(s || "").trim();
  if (!t) return "";
  return t.replace(/\s*[—–-]\s*\d+\s*$/, "").trim();
}

function norm_(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normWithAlias_(name) {
  const norm = norm_(name);
  return DRIVER_ALIASES[norm] || norm;
}

function num_(v) {
  if (v === null || v === undefined) return "";
  if (v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

/**
 * Position points = (cars behind) + (positions gained or lost).
 * Cars behind      = totalDrivers - finalPos
 * Position change  = startPos - finalPos  (positive = gained, negative = lost)
 */
function positionPoints_(finalPos, startPos, totalDrivers) {
  const f = Number(finalPos), s = Number(startPos), n = Number(totalDrivers);
  if (!f || isNaN(f) || !n || isNaN(n)) return 0;
  const carsBehind = Math.max(0, n - f);
  const posChange = (s && !isNaN(s)) ? (s - f) : 0;
  return carsBehind + posChange;
}

/**
 * Pit lap points.
 * Normal:     exact = 25, ±1 = 20, ±2 = 15
 * Safety Car: if predicted is within -2 to +5 of actual → 15 pts
 * @param {*} pred  Predicted pit lap
 * @param {*} actual  Actual pit lap
 * @param {boolean} [safetyCar=false]  Whether SC/VSC/Yellow was active at this stop
 */
function pitLapPts_(pred, actual, safetyCar) {
  const p = Number(pred), a = Number(actual);
  if (!p || !a || isNaN(p) || isNaN(a)) return 0;
  const d = Math.abs(p - a);

  // Normal scoring first
  if (d === 0) return 25;
  if (d <= 1) return 20;
  if (d <= 2) return 15;

  // Safety Car relaxed window: predicted within -2 to +5 of actual
  if (safetyCar) {
    const diff = p - a;  // positive = predicted later than actual
    if (diff >= -2 && diff <= 5) return 15;
  }

  return 0;
}

/**
 * Pit count points — tiered by number of stops predicted correctly.
 * 1 stop correct = 10, 2 stops correct = 15, 3 stops correct = 25.
 */
function pitCountPts_(predictedCount, actualCount) {
  if (predictedCount !== actualCount) return 0;
  const map = { 1: 10, 2: 15, 3: 25 };
  return map[predictedCount] || 0;
}

/**
 * Tyre points — 10 pts per correct tyre compound after each pit.
 */
function tyrePts_(predTyre, actualTyre) {
  if (!predTyre || !actualTyre) return 0;
  return String(predTyre).trim().toUpperCase() === String(actualTyre).trim().toUpperCase() ? 10 : 0;
}

// --- Driver alias mapping for nicknames/variants ---
const DRIVER_ALIASES = {
  "checo perez": "sergio perez",
  "gabriel bortoletto": "gabriel bortoleto",
  // Add more as needed
};