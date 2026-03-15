function rebuildScores() {
  const ss = SpreadsheetApp.getActive();

  // Write per-race scores to "Scores {round}" (e.g. "Scores 2")
  const props       = PropertiesService.getScriptProperties();
  const activeRound = parseInt(props.getProperty('WF_ACTIVE_ROUND') || '0', 10);
  const scoresName  = activeRound > 0 ? 'Scores ' + activeRound : 'Scores';
  const resultsName = activeRound > 0 ? 'Results ' + activeRound : 'Results 2';

  const formSh  = ss.getSheetByName("Choices");
  const resSh   = ss.getSheetByName(resultsName);
  const scoreSh = ss.getSheetByName(scoresName) || ss.insertSheet(scoresName);

  if (!formSh) throw new Error("Missing sheet: Choices");
  if (!resSh)  throw new Error("Missing sheet: " + resultsName);

  // ----- Read Results -----
  const resHeaderRow = 1;
  const resDataStart = 2;
  const resLastCol = resSh.getLastColumn();
  const resLastRow = resSh.getLastRow();
  if (resLastRow < resDataStart) throw new Error("Results have not been updated.");

  const resHeaders = resSh.getRange(resHeaderRow, 1, 1, resLastCol).getValues()[0];
  const resData = resSh.getRange(resDataStart, 1, resLastRow - resDataStart + 1, resLastCol).getValues();

  const col = makeHeaderIndex_(resHeaders);

  // Parse race-wide SC laps from the first data row (same value for all rows)
  const scAllLaps = (() => {
    if (!("SafetyCarAllLaps" in col)) return [];
    const raw = String(resData[0]?.[col.SafetyCarAllLaps] || "").trim();
    if (!raw) return [];
    return raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  })();

  const req = [
    "Driver","Team","StartingPosition","FinalPosition","TotalLaps","PitStopCount",
    "PitLap1","PitLap2","PitLap3","PitLap4","PitLap5","PitLap6",
    "StartingTyre","TyreAfterPit1","TyreAfterPit2","TyreAfterPit3","TyreAfterPit4","TyreAfterPit5","TyreAfterPit6",
    "SCAtPit1","SCAtPit2","SCAtPit3","SCAtPit4","SCAtPit5","SCAtPit6"
  ];
  for (const k of req) {
    if (!(k in col)) throw new Error(`Results header missing: ${k}`);
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
        isYes_(r[col.SCAtPit1]),
        isYes_(r[col.SCAtPit2]),
        isYes_(r[col.SCAtPit3]),
        isYes_(r[col.SCAtPit4]),
        isYes_(r[col.SCAtPit5]),
        isYes_(r[col.SCAtPit6]),
      ],
      tyres: {
        start: String(r[col.StartingTyre] || "").trim(),
        after: [
          String(r[col.TyreAfterPit1] || "").trim(),
          String(r[col.TyreAfterPit2] || "").trim(),
          String(r[col.TyreAfterPit3] || "").trim(),
          String(r[col.TyreAfterPit4] || "").trim(),
          String(r[col.TyreAfterPit5] || "").trim(),
          String(r[col.TyreAfterPit6] || "").trim()
        ]
      }
    });
  }

  // ----- Read Choices -----
  const frLastRow = formSh.getLastRow();
  const frLastCol = formSh.getLastColumn();
  if (frLastRow < 2) throw new Error("Choices has no submissions.");

  const frHeaders = formSh.getRange(1, 1, 1, frLastCol).getValues()[0];
  const fr = makeHeaderIndex_(frHeaders);

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
    "Driver1_PitLap1Actual","Driver1_PitLap2Actual","Driver1_PitLap3Actual",
    "Driver1_PitLap1SC","Driver1_PitLap2SC","Driver1_PitLap3SC",
    "Driver1_PitLap1Pts","Driver1_PitLap2Pts","Driver1_PitLap3Pts",

    "Driver2_PitLap1Pred","Driver2_PitLap2Pred","Driver2_PitLap3Pred",
    "Driver2_PitLap1Actual","Driver2_PitLap2Actual","Driver2_PitLap3Actual",
    "Driver2_PitLap1SC","Driver2_PitLap2SC","Driver2_PitLap3SC",
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
  const totalDrivers = resultsByDriver.size;

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

    // Predictions
    const d1p = [
      num_(row[fr[h.d1p1]]),
      num_(row[fr[h.d1p2]]),
      num_(row[fr[h.d1p3]])
    ].filter(v => v !== "");

    const d2p = [
      num_(row[fr[h.d2p1]]),
      num_(row[fr[h.d2p2]]),
      num_(row[fr[h.d2p3]])
    ].filter(v => v !== "");

    const d1TyrePred = [
      String(row[fr[h.d1t1]] || "").trim(),
      String(row[fr[h.d1t2]] || "").trim(),
      String(row[fr[h.d1t3]] || "").trim()
    ];

    const d2TyrePred = [
      String(row[fr[h.d2t1]] || "").trim(),
      String(row[fr[h.d2t2]] || "").trim(),
      String(row[fr[h.d2t3]] || "").trim()
    ];

    // Position points
    const d1Start = r1 ? r1.startPos : "";
    const d2Start = r2 ? r2.startPos : "";
    const d1Final = r1 ? r1.finalPos : "";
    const d2Final = r2 ? r2.finalPos : "";

    const d1PosPts = positionPoints_(d1Final, d1Start, totalDrivers);
    const d2PosPts = positionPoints_(d2Final, d2Start, totalDrivers);

    // Pit count points
    const d1PitCountPts = r1 ? pitCountPts_(d1p.length, r1.pitCount) : 0;
    const d2PitCountPts = r2 ? pitCountPts_(d2p.length, r2.pitCount) : 0;

    // Pit actuals / SC flags
    const d1PitActual = r1 ? r1.pitLaps.slice(0, 3) : ["","",""];
    const d2PitActual = r2 ? r2.pitLaps.slice(0, 3) : ["","",""];
    const d1SC = r1 ? r1.scAtPit.slice(0, 3) : [false, false, false];
    const d2SC = r2 ? r2.scAtPit.slice(0, 3) : [false, false, false];

    // Pit lap points
    const d1PitPts = [0, 0, 0];
    const d2PitPts = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
      d1PitPts[i] = pitLapPts_(d1p[i] ?? "", d1PitActual[i] ?? "", scAllLaps);
    }

    for (let i = 0; i < 3; i++) {
      d2PitPts[i] = pitLapPts_(d2p[i] ?? "", d2PitActual[i] ?? "", scAllLaps);
    }

    // Tyres
    const d1TyStart = r1 ? r1.tyres.start : "";
    const d2TyStart = r2 ? r2.tyres.start : "";
    const d1TyAfter = r1 ? r1.tyres.after : ["","","","","",""];
    const d2TyAfter = r2 ? r2.tyres.after : ["","","","","",""];

    const d1TyrePts = [0, 0, 0];
    const d2TyrePts = [0, 0, 0];

    for (let i = 0; i < 3; i++) {
      d1TyrePts[i] = tyrePts_(d1TyrePred[i], d1TyAfter[i]);
      d2TyrePts[i] = tyrePts_(d2TyrePred[i], d2TyAfter[i]);
    }

    const total =
      d1PosPts + d2PosPts +
      d1PitCountPts + d2PitCountPts +
      sum_(d1PitPts) + sum_(d2PitPts) +
      sum_(d1TyrePts) + sum_(d2TyrePts);

    out.push([
      email, teamName,
      d1Name, d2Name,
      d1Start, d2Start,
      d1Final, d2Final,
      d1PosPts, d2PosPts,
      d1p.length, d2p.length,
      d1PitCountPts, d2PitCountPts,

      d1p[0] ?? "", d1p[1] ?? "", d1p[2] ?? "",
      d1PitActual[0] ?? "", d1PitActual[1] ?? "", d1PitActual[2] ?? "",
      d1SC[0] ? "YES" : "", d1SC[1] ? "YES" : "", d1SC[2] ? "YES" : "",
      d1PitPts[0], d1PitPts[1], d1PitPts[2],

      d2p[0] ?? "", d2p[1] ?? "", d2p[2] ?? "",
      d2PitActual[0] ?? "", d2PitActual[1] ?? "", d2PitActual[2] ?? "",
      d2SC[0] ? "YES" : "", d2SC[1] ? "YES" : "", d2SC[2] ? "YES" : "",
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

  // Sort by total desc
  out.sort((a, b) => Number(b[b.length - 1] || 0) - Number(a[a.length - 1] || 0));

  scoreSh.clear();
  scoreSh.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]);
  if (out.length) {
    scoreSh.getRange(2, 1, out.length, outHeaders.length).setValues(out);
  }
  scoreSh.setFrozenRows(1);
  scoreSh.autoResizeColumns(1, outHeaders.length);

  // Always rebuild the cumulative leaderboard after updating a race's scores
  rebuildLeaderboard();
}

// ---------------------------------------------------------------------------
// Cumulative leaderboard — aggregates TotalPoints across all "Scores N" sheets
// ---------------------------------------------------------------------------

/**
 * Scans every sheet named "Scores {number}" (e.g. "Scores 1", "Scores 2", …),
 * sums TotalPoints per team, and writes a ranked "Leaderboard" sheet.
 *
 * Columns: Rank | Email | TeamName | Race 1 | Race 2 | … | Total
 */
function rebuildLeaderboard() {
  const ss = SpreadsheetApp.getActive();

  // Collect all "Scores N" sheets, sorted by round number
  const scoreSheets = ss.getSheets()
    .map(function (sh) {
      const m = sh.getName().match(/^Scores\s+(\d+)$/i);
      return m ? { round: parseInt(m[1], 10), sheet: sh } : null;
    })
    .filter(Boolean)
    .sort(function (a, b) { return a.round - b.round; });

  if (scoreSheets.length === 0) {
    Logger.log('rebuildLeaderboard: no Scores N sheets found.');
    return;
  }

  // For each sheet read Email, TeamName, TotalPoints
  // Map: email → { teamName, roundPoints: { round: pts } }
  const teamData = new Map();

  for (const { round, sheet } of scoreSheets) {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) continue;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    const emailCol = headers.indexOf('Email');
    const teamCol  = headers.indexOf('TeamName');
    const ptsCol   = headers.indexOf('TotalPoints');
    if (emailCol < 0 || ptsCol < 0) continue;

    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (const row of data) {
      const email = String(row[emailCol] || '').trim().toLowerCase();
      if (!email) continue;
      const teamName = teamCol >= 0 ? String(row[teamCol] || '').trim() : '';
      const pts      = Number(row[ptsCol]) || 0;

      if (!teamData.has(email)) {
        teamData.set(email, { teamName, roundPoints: {} });
      }
      const entry = teamData.get(email);
      // Keep the most recent team name in case it changed
      if (teamName) entry.teamName = teamName;
      entry.roundPoints[round] = pts;
    }
  }

  // Build output
  const rounds      = scoreSheets.map(function (s) { return s.round; });
  const raceHeaders = rounds.map(function (r) { return 'Race ' + r; });
  const outHeaders  = ['Rank', 'Email', 'TeamName'].concat(raceHeaders).concat(['Total']);

  const rows = [];
  for (const [email, entry] of teamData) {
    const racePts = rounds.map(function (r) { return entry.roundPoints[r] || 0; });
    const total   = racePts.reduce(function (a, b) { return a + b; }, 0);
    rows.push([null, email, entry.teamName].concat(racePts).concat([total]));
  }

  // Sort by total descending, then assign rank
  rows.sort(function (a, b) { return b[b.length - 1] - a[a.length - 1]; });
  rows.forEach(function (r, i) { r[0] = i + 1; });

  const lbSh = ss.getSheetByName('Leaderboard') || ss.insertSheet('Leaderboard');
  lbSh.clear();
  lbSh.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight('bold');
  if (rows.length) {
    lbSh.getRange(2, 1, rows.length, outHeaders.length).setValues(rows);
  }
  lbSh.setFrozenRows(1);
  lbSh.autoResizeColumns(1, outHeaders.length);

  Logger.log('Leaderboard rebuilt: ' + rows.length + ' teams across ' + rounds.length + ' race(s).');
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
  const t = String(s || "").trim();
  if (!t) return "";
  return t.replace(/\s*[—–-]\s*\d+\s*$/, "").trim();
}

function norm_(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normWithAlias_(name) {
  const norm = norm_(name);
  return DRIVER_ALIASES[norm] || norm;
}

function num_(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return isNaN(n) ? "" : n;
}

function isYes_(v) {
  return String(v || "").trim().toUpperCase() === "YES";
}

function sum_(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * Position points
 * = drivers behind + positions gained/lost
 * = (totalDrivers - finalPos) + (startPos - finalPos)
 */
function positionPoints_(finalPos, startPos, totalDrivers) {
  const f = Number(finalPos);
  const s = Number(startPos);
  const n = Number(totalDrivers);

  if (!f || isNaN(f) || !n || isNaN(n)) return 0;

  const carsBehind = Math.max(0, n - f);
  const posChange = (!isNaN(s) && s) ? (s - f) : 0;
  return carsBehind + posChange;
}

/**
 * Pit count points
 * 1 correct = 10
 * 2 correct = 15
 * 3 correct = 25
 */
function pitCountPts_(predictedCount, actualCount) {
  const p = Number(predictedCount);
  const a = Number(actualCount);
  if (!p || !a || isNaN(p) || isNaN(a) || p !== a) return 0;
  const map = { 1: 10, 2: 15, 3: 25 };
  return map[p] || 0;
}

/**
 * Pit lap points
 * Normal:
 *   exact = 25
 *   ±1    = 20
 *   ±2    = 15
 *
 * SC/VSC contingency:
 *   If any SC/VSC lap falls within [predicted − 5, predicted + 2],
 *   the player gets 15 points (exact / ±1 / ±2 still take priority).
 *
 * @param {number|string} pred      predicted pit lap
 * @param {number|string} actual    actual pit lap
 * @param {number[]}      scLaps    all SC/VSC laps in the race
 */
function pitLapPts_(pred, actual, scLaps) {
  const p = Number(pred);
  const a = Number(actual);
  if (!p || !a || isNaN(p) || isNaN(a)) return 0;

  const d = Math.abs(p - a);
  if (d === 0) return 25;
  if (d <= 1)  return 20;
  if (d <= 2)  return 15;

  // SC/VSC contingency: any SC lap in [pred-5, pred+2] → 15 pts
  if (Array.isArray(scLaps) && scLaps.length > 0) {
    const lo = p - 5;
    const hi = p + 2;
    if (scLaps.some(lap => lap >= lo && lap <= hi)) return 15;
  }

  return 0;
}

/**
 * Tyre points
 * 10 points for exact compound match after each predicted stop
 */
function tyrePts_(predTyre, actualTyre) {
  const p = String(predTyre || "").trim().toUpperCase();
  const a = String(actualTyre || "").trim().toUpperCase();
  if (!p || !a) return 0;
  return p === a ? 10 : 0;
}

// Driver nickname / alias mapping
const DRIVER_ALIASES = {
  "checo perez": "sergio perez",
  "gabriel bortoletto": "gabriel bortoleto"
};