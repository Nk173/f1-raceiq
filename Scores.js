function rebuildScores() {
  const ss = SpreadsheetApp.getActive();
  const formSh = ss.getSheetByName("Choices");
  const resSh = ss.getSheetByName("Results");
  const scoreSh = ss.getSheetByName("Scores") || ss.insertSheet("Scores");

  if (!formSh) throw new Error("Missing sheet: Choices");
  if (!resSh) throw new Error("Missing sheet: Results");

  // ----- Read Results (headers in row 6, data from row 7) -----
  const resHeaderRow = 6;
  const resDataStart = 7;
  const resLastCol = resSh.getLastColumn();
  const resLastRow = resSh.getLastRow();
  if (resLastRow < resDataStart) throw new Error("Results have not been updated.");

  const resHeaders = resSh.getRange(resHeaderRow, 1, 1, resLastCol).getValues()[0];
  const resData = resSh.getRange(resDataStart, 1, resLastRow - resDataStart + 1, resLastCol).getValues();

  const col = makeHeaderIndex_(resHeaders);

  // Required columns (by your header list)
  const req = ["Driver","Team","StartingPosition","FinalPosition","TotalLaps","PitStopCount",
               "PitLap1","PitLap2","PitLap3","PitLap4","PitLap5","PitLap6",
               "StartingTyre","TyreAfterPit1","TyreAfterPit2","TyreAfterPit3","TyreAfterPit4","TyreAfterPit5","TyreAfterPit6"];
  for (const k of req) {
    if (!(k in col)) throw new Error(`Results header missing: ${k} (check row 6 headers)`);
  }

  // Map results by normalized driver name
  const resultsByDriver = new Map();
  for (const r of resData) {
    const driver = String(r[col.Driver] || "").trim();
    if (!driver) continue;
    resultsByDriver.set(norm_(driver), {
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
    "Driver2_StartingTyre","Driver2_TyreAfterPit1","Driver2_TyreAfterPit2","Driver2_TyreAfterPit3",
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

    const r1 = resultsByDriver.get(norm_(d1Name));
    const r2 = resultsByDriver.get(norm_(d2Name));

    // Predictions (up to 3)
    const d1p = [num_(row[fr[h.d1p1]]), num_(row[fr[h.d1p2]]), num_(row[fr[h.d1p3]])].filter(v => v !== "");
    const d2p = [num_(row[fr[h.d2p1]]), num_(row[fr[h.d2p2]]), num_(row[fr[h.d2p3]])].filter(v => v !== "");

    // Positions + position points
    const d1Start = r1 ? r1.startPos : "";
    const d2Start = r2 ? r2.startPos : "";
    const d1Final = r1 ? r1.finalPos : "";
    const d2Final = r2 ? r2.finalPos : "";

    const d1PosPts = f1Points_(d1Final);
    const d2PosPts = f1Points_(d2Final);

    // Pit count points
    const d1PitCountPts = (r1 && d1p.length === r1.pitCount) ? 10 : 0;
    const d2PitCountPts = (r2 && d2p.length === r2.pitCount) ? 10 : 0;

    // Pit lap points (compare predicted pit#n to actual pit#n)
    const d1PitPts = [0,0,0];
    const d2PitPts = [0,0,0];

    for (let i=0; i<3; i++) {
      const pred = d1p[i] ?? "";
      const act = r1 ? r1.pitLaps[i] : "";
      d1PitPts[i] = pitLapPts_(pred, act);
    }
    for (let i=0; i<3; i++) {
      const pred = d2p[i] ?? "";
      const act = r2 ? r2.pitLaps[i] : "";
      d2PitPts[i] = pitLapPts_(pred, act);
    }

    // Tyres (start + after pits)
    const d1TyStart = r1 ? r1.tyres.start : "";
    const d1TyAfter = r1 ? r1.tyres.after : ["","","","","",""];
    const d2TyStart = r2 ? r2.tyres.start : "";
    const d2TyAfter = r2 ? r2.tyres.after : ["","","","","",""];

    const total =
      d1PosPts + d2PosPts +
      d1PitCountPts + d2PitCountPts +
      d1PitPts.reduce((a,b)=>a+b,0) +
      d2PitPts.reduce((a,b)=>a+b,0);

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
      d2TyStart, d2TyAfter[0] || "", d2TyAfter[1] || "", d2TyAfter[2] || "",
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

function num_(v) {
  if (v === null || v === undefined) return "";
  if (v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

function f1Points_(pos) {
  const p = Number(pos);
  if (!p || isNaN(p)) return 0;
  const map = {1:25,2:18,3:15,4:12,5:10,6:8,7:6,8:4,9:2,10:1};
  return map[p] || 0;
}

function pitLapPts_(pred, actual) {
  const p = Number(pred), a = Number(actual);
  if (!p || !a || isNaN(p) || isNaN(a)) return 0;
  const d = Math.abs(p - a);
  if (d === 0) return 20;
  if (d <= 1) return 10;
  if (d <= 3) return 5;
  return 0;
}