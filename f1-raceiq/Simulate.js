/**
 * Simulate.js
 *
 * End-to-end test: generates simulated race results using the 2026 grid,
 * scores against real Choices, writes "Simulated Results" + "Simulated Scores",
 * and emails the simulated scores.
 *
 * Run from the RaceIQ menu → "Run Full Simulation".
 */

// ---------- 2026 Driver Grid ----------
const SIM_DRIVERS_ = [
  { name: "Max Verstappen",    team: "Red Bull Racing",    number: 1  },
  { name: "Liam Lawson",       team: "Red Bull Racing",    number: 30 },
  { name: "Lewis Hamilton",    team: "Ferrari",            number: 44 },
  { name: "Charles Leclerc",   team: "Ferrari",            number: 16 },
  { name: "Lando Norris",      team: "McLaren",            number: 4  },
  { name: "Oscar Piastri",     team: "McLaren",            number: 81 },
  { name: "George Russell",    team: "Mercedes",           number: 63 },
  { name: "Andrea Kimi Antonelli", team: "Mercedes",       number: 12 },
  { name: "Fernando Alonso",   team: "Aston Martin",       number: 14 },
  { name: "Lance Stroll",      team: "Aston Martin",       number: 18 },
  { name: "Pierre Gasly",      team: "Alpine",             number: 10 },
  { name: "Jack Doohan",       team: "Alpine",             number: 7  },
  { name: "Yuki Tsunoda",      team: "RB",                 number: 22 },
  { name: "Isack Hadjar",      team: "RB",                 number: 6  },
  { name: "Nico Hulkenberg",   team: "Sauber",             number: 27 },
  { name: "Gabriel Bortoleto", team: "Sauber",             number: 5  },
  { name: "Alexander Albon",   team: "Williams",           number: 23 },
  { name: "Carlos Sainz",      team: "Williams",           number: 55 },
  { name: "Esteban Ocon",      team: "Haas",               number: 31 },
  { name: "Oliver Bearman",    team: "Haas",               number: 87 },
];

const SIM_TYRES_ = ["SOFT", "MEDIUM", "HARD"];

/**
 * Runs the full simulation pipeline:
 *  1. Build Choices (dedup from Form Responses)
 *  2. Generate Simulated Results sheet
 *  3. Score Choices against Simulated Results → Simulated Scores sheet
 *  4. Email the Simulated Scores
 */
function runFullSimulation() {
  // Step 1: Ensure Choices are up to date
  try {
    rebuildChoicesLatestPerEmail();
  } catch (e) {
    Logger.log("rebuildChoices in simulation: " + e);
  }

  // Step 2: Generate simulated results
  generateSimulatedResults_();

  // Step 3: Score against simulated results
  rebuildSimulatedScores_();

  // Step 4: Email
  emailSimulatedScores_();

  SpreadsheetApp.getActive().toast(
    "Simulation complete — check your email!",
    "RaceIQ Simulation"
  );
}

/* ================================================================
   STEP 2 — Generate "Simulated Results" sheet
   ================================================================ */

function generateSimulatedResults_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("Simulated Results") || ss.insertSheet("Simulated Results");
  sheet.clear();

  const TOTAL_LAPS = 58;

  // Shuffle drivers for random finishing order
  const drivers = SIM_DRIVERS_.slice();
  shuffleArray_(drivers);

  // Grid order = another shuffle
  const gridOrder = SIM_DRIVERS_.slice();
  shuffleArray_(gridOrder);
  const gridMap = new Map();
  gridOrder.forEach((d, i) => gridMap.set(d.name, i + 1));

  const header = [
    "Race","Season","Round",
    "Driver","Team",
    "StartingPosition","FinalPosition",
    "TotalLaps","Status",
    "PitStopCount",
    "PitLap1","PitLap2","PitLap3","PitLap4","PitLap5","PitLap6",
    "StartingTyre",
    "TyreAfterPit1","TyreAfterPit2","TyreAfterPit3","TyreAfterPit4","TyreAfterPit5","TyreAfterPit6",
    "SCAtPit1","SCAtPit2","SCAtPit3","SCAtPit4","SCAtPit5","SCAtPit6",
    "SafetyCarLaps"
  ];

  // Simulate 0-2 safety car periods (30% chance for each)
  const scLaps = new Set();
  const scPeriods = [];
  for (let p = 0; p < 2; p++) {
    if (Math.random() < 0.30) {
      const start = randInt_(5, TOTAL_LAPS - 10);
      const duration = randInt_(2, 5);
      for (let l = start; l <= start + duration && l <= TOTAL_LAPS; l++) scLaps.add(l);
      scPeriods.push(`${start}-${start + duration}`);
    }
  }
  const scLapStr = scLaps.size > 0 ? Array.from(scLaps).sort((a,b)=>a-b).join(",") : "";

  const rows = drivers.map((d, idx) => {
    const finalPos = idx + 1;
    const gridPos = gridMap.get(d.name);
    const status = finalPos <= 18 ? "Finished" : (Math.random() > 0.5 ? "Retired" : "DNF");
    const laps = status === "Finished" ? TOTAL_LAPS : randInt_(20, TOTAL_LAPS - 5);

    // Random 2-3 pit stops at plausible laps
    const pitCount = randInt_(2, 3);
    const pitLaps = generatePitLaps_(pitCount, TOTAL_LAPS);

    // Random tyre strategy
    const tyreStart = randomTyre_();
    const tyresAfter = [];
    for (let i = 0; i < pitCount; i++) tyresAfter.push(randomTyre_());

    // Pad to 6 slots
    const pit6  = padArray_(pitLaps, 6, "");
    const tyre6 = padArray_(tyresAfter, 6, "");

    return [
      "Simulated Grand Prix", "2026", "SIM",
      d.name, d.team,
      gridPos, finalPos,
      laps, status,
      pitCount,
      pit6[0], pit6[1], pit6[2], pit6[3], pit6[4], pit6[5],
      tyreStart,
      tyre6[0], tyre6[1], tyre6[2], tyre6[3], tyre6[4], tyre6[5],
      ...Array.from({ length: 6 }, (_, i) => {
        const lap = pitLaps[i];
        if (!lap) return "";
        for (let off = -2; off <= 2; off++) { if (scLaps.has(lap + off)) return "Yes"; }
        return "No";
      }),
      scLapStr
    ];
  });

  // Write with same layout as real Results sheet (info rows 1-5, headers row 6, data row 7+)
  sheet.getRange(1, 1).setValue("SIMULATED — Results for testing purposes");
  sheet.getRange(2, 1).setValue("Round: SIM | Race: Simulated Grand Prix");
  sheet.getRange(3, 1).setValue("Generated: " + new Date().toISOString());

  const startRow = 6;
  sheet.getRange(startRow, 1, 1, header.length).setValues([header]).setFontWeight("bold");
  sheet.getRange(startRow + 1, 1, rows.length, header.length).setValues(rows);

  sheet.setFrozenRows(startRow);
  sheet.autoResizeColumns(1, header.length);
}

/* ================================================================
   STEP 3 — Score Choices against "Simulated Results"
   Mirrors rebuildScores() but reads from "Simulated Results"
   and writes to "Simulated Scores"
   ================================================================ */

function rebuildSimulatedScores_() {
  const ss = SpreadsheetApp.getActive();
  const formSh = ss.getSheetByName("Choices");
  const resSh  = ss.getSheetByName("Simulated Results");
  const scoreSh = ss.getSheetByName("Simulated Scores") || ss.insertSheet("Simulated Scores");

  if (!formSh) throw new Error("Missing sheet: Choices. Run rebuildChoicesLatestPerEmail first.");
  if (!resSh) throw new Error("Missing sheet: Simulated Results. Run generateSimulatedResults_ first.");

  // ----- Read Simulated Results (headers row 6, data row 7) -----
  const resHeaderRow = 6;
  const resDataStart = 7;
  const resLastCol = resSh.getLastColumn();
  const resLastRow = resSh.getLastRow();
  if (resLastRow < resDataStart) throw new Error("Simulated Results has no data rows.");

  const resHeaders = resSh.getRange(resHeaderRow, 1, 1, resLastCol).getValues()[0];
  const resData = resSh.getRange(resDataStart, 1, resLastRow - resDataStart + 1, resLastCol).getValues();
  const col = makeHeaderIndex_(resHeaders);

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

  // ----- Build Simulated Scores -----
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
    const d1Name = extractName_(String(row[fr[h.d1]] || ""));
    const d2Name = extractName_(String(row[fr[h.d2]] || ""));

    const r1 = resultsByDriver.get(norm_(d1Name));
    const r2 = resultsByDriver.get(norm_(d2Name));

    const d1p = [num_(row[fr[h.d1p1]]), num_(row[fr[h.d1p2]]), num_(row[fr[h.d1p3]])].filter(v => v !== "");
    const d2p = [num_(row[fr[h.d2p1]]), num_(row[fr[h.d2p2]]), num_(row[fr[h.d2p3]])].filter(v => v !== "");

    const d1Start = r1 ? r1.startPos : "";
    const d2Start = r2 ? r2.startPos : "";
    const d1Final = r1 ? r1.finalPos : "";
    const d2Final = r2 ? r2.finalPos : "";

    const totalDrivers = resultsByDriver.size;
    const d1PosPts = positionPoints_(d1Final, d1Start, totalDrivers);
    const d2PosPts = positionPoints_(d2Final, d2Start, totalDrivers);

    const d1PitCountPts = r1 ? pitCountPts_(d1p.length, r1.pitCount) : 0;
    const d2PitCountPts = r2 ? pitCountPts_(d2p.length, r2.pitCount) : 0;

    const d1PitPts = [0,0,0];
    const d2PitPts = [0,0,0];
    const simScLaps = Array.from(scLaps); // race-wide SC laps from simulation
    for (let i = 0; i < 3; i++) {
      d1PitPts[i] = pitLapPts_(d1p[i] ?? "", r1 ? r1.pitLaps[i] : "", simScLaps);
      d2PitPts[i] = pitLapPts_(d2p[i] ?? "", r2 ? r2.pitLaps[i] : "", simScLaps);
    }

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
      d1PitPts.reduce((a,b) => a+b, 0) +
      d2PitPts.reduce((a,b) => a+b, 0) +
      d1TyrePts.reduce((a,b) => a+b, 0) +
      d2TyrePts.reduce((a,b) => a+b, 0);

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

  // Sort by TotalPoints descending for a leaderboard feel
  out.sort((a, b) => b[b.length - 1] - a[a.length - 1]);

  scoreSh.clear();
  scoreSh.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight("bold");
  if (out.length) scoreSh.getRange(2, 1, out.length, outHeaders.length).setValues(out);
  scoreSh.setFrozenRows(1);
  scoreSh.autoResizeColumns(1, outHeaders.length);
}

/* ================================================================
   STEP 4 — Email Simulated Scores
   ================================================================ */

function emailSimulatedScores_() {
  const EMAIL_TO = "f1raceiqfantasy@gmail.com";
  const SUBJECT  = "RaceIQ Fantasy - Simulated Grand Prix - Test Scores";

  const ss = SpreadsheetApp.getActive();
  const scoreSh = ss.getSheetByName("Simulated Scores");
  if (!scoreSh) throw new Error("Missing sheet: Simulated Scores");

  const lastRow = scoreSh.getLastRow();
  const lastCol = scoreSh.getLastColumn();
  if (lastRow < 2) throw new Error("Simulated Scores sheet is empty.");

  const values = scoreSh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const sheetUrl = ss.getUrl() + "#gid=" + scoreSh.getSheetId();

  const htmlTable = toHtmlTable_(values);

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;">
      <h2 style="color:#E10600;">🏁 RaceIQ Fantasy — Simulated Results</h2>
      <p>Here are your results for the week.</p>
      <p><a href="${sheetUrl}">Open the full Simulated Scores sheet</a></p>
      ${htmlTable}
      <br>
      <p style="color:#888;font-size:11px;">
        This is a <b>test email</b> with simulated data. No real race results were used.
      </p>
    </div>
  `;

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: SUBJECT,
    htmlBody: htmlBody
  });
}

/* ================================================================
   Simulation helpers
   ================================================================ */

/**
 * Extracts the plain driver name from a form choice string.
 * Handles both plain names ("Max Verstappen") and the priced format
 * used by CreateForm.js ("Max Verstappen — 30m").
 *
 * @param {string} choice  raw value from the form response
 * @returns {string}
 */
function extractName_(choice) {
  const s = String(choice || "").trim();
  const sep = s.indexOf(" — ");
  return sep >= 0 ? s.slice(0, sep).trim() : s;
}

function shuffleArray_(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function randInt_(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomTyre_() {
  return SIM_TYRES_[Math.floor(Math.random() * SIM_TYRES_.length)];
}

function generatePitLaps_(count, totalLaps) {
  // Generate realistic-ish pit stop laps spread across the race
  const laps = [];
  const window = Math.floor(totalLaps / (count + 1));
  for (let i = 1; i <= count; i++) {
    const base = window * i;
    const jitter = randInt_(-3, 3);
    laps.push(Math.max(1, Math.min(totalLaps - 1, base + jitter)));
  }
  laps.sort((a, b) => a - b);
  return laps;
}

function padArray_(arr, len, fill) {
  const result = arr.slice(0, len);
  while (result.length < len) result.push(fill);
  return result;
}
