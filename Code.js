const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

function fillResults_2026_Australia() {
  const SEASON = 2026; // <-- change later if you want
  const RACE_NAME_MATCH = "australian grand prix";

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("Results") || ss.insertSheet("Results");

  // Write a small status without wiping the sheet
  sheet.getRange(1, 1).setValue(`Checking ${SEASON} Australian GP…`);

  try {
    // ---------- 1) Find the round in Jolpica schedule ----------
    const races = fetchJson_(`${JOLPICA_BASE}/${SEASON}.json?limit=1000`)
      ?.MRData?.RaceTable?.Races || [];

    const ausRace = races.find(r => (r.raceName || "").toLowerCase().includes(RACE_NAME_MATCH));
    if (!ausRace) {
      sheet.getRange(2, 1).setValue(`No Australian GP found in Jolpica schedule for ${SEASON}.`);
      return;
    }

    const round = ausRace.round;
    sheet.getRange(2, 1).setValue(`Jolpica round: ${round} | Race date: ${ausRace.date}`);

    // ---------- 2) Try to pull race results ----------
    const resultsJson = fetchJson_(`${JOLPICA_BASE}/${SEASON}/${round}/results.json?limit=1000`);
    const race = resultsJson?.MRData?.RaceTable?.Races?.[0];
    const results = race?.Results || [];

    // If the race hasn't happened / no results posted yet: do NOT clear the sheet.
    if (!race || results.length === 0) {
      sheet.getRange(3, 1).setValue("Race results not available yet. Will try again on next trigger run.");
      return;
    }

    // ---------- 3) Pull pit stops ----------
    const pitsJson = fetchJson_(`${JOLPICA_BASE}/${SEASON}/${round}/pitstops.json?limit=5000`);
    const pitR = pitsJson?.MRData?.RaceTable?.Races?.[0];
    const pitStops = pitR?.PitStops || [];

    const pitLapsByDriverId = new Map();
    for (const p of pitStops) {
      const driverId = p.driverId;
      const lap = Number(p.lap);
      if (!driverId || !lap) continue;
      if (!pitLapsByDriverId.has(driverId)) pitLapsByDriverId.set(driverId, []);
      pitLapsByDriverId.get(driverId).push(lap);
    }
    for (const [k, arr] of pitLapsByDriverId) arr.sort((a, b) => a - b);

    // ---------- 4) OpenF1: tyres from stints (optional; may not exist yet) ----------
    let numByName = new Map();
    let tyresByNumber = new Map();
    let openf1Info = "OpenF1: not attempted.";

    try {
      // Find race session for Australia 2026
      let sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${SEASON}&country_name=Australia&session_name=Race`) || [];
      if (sessions.length === 0) {
        sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${SEASON}&session_name=Race`) || [];
        sessions = sessions.filter(s => String(s.country_name || "").toLowerCase() === "australia");
      }

      if (sessions.length > 0) {
        sessions.sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)));
        const raceSession = sessions[sessions.length - 1];
        const sessionKey = raceSession.session_key;
        openf1Info = `OpenF1 session_key: ${sessionKey} | ${raceSession.meeting_name || ""} | ${raceSession.date_start || ""}`;

        const openDrivers = fetchJson_(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`) || [];
        const stints = fetchJson_(`${OPENF1_BASE}/stints?session_key=${sessionKey}`) || [];

        // name -> driver_number
        for (const d of openDrivers) {
          const full = normName_(d.full_name || [d.first_name, d.last_name].filter(Boolean).join(" "));
          if (full) numByName.set(full, String(d.driver_number));
        }

        // tyres: driver_number -> compounds by stint_number
        for (const s of stints) {
          const dn = s.driver_number != null ? String(s.driver_number) : null;
          const stintNo = Number(s.stint_number);
          if (!dn || !stintNo) continue;
          if (!tyresByNumber.has(dn)) tyresByNumber.set(dn, []);
          tyresByNumber.get(dn)[stintNo - 1] = s.compound || "";
        }
      } else {
        openf1Info = "OpenF1: No Race session found yet for Australia 2026 (ok pre-race).";
      }
    } catch (e) {
      openf1Info = `OpenF1: error (non-fatal): ${String(e).slice(0, 150)}`;
    }

    sheet.getRange(3, 1).setValue(openf1Info);

    // ---------- 5) Build output ----------
    const header = [
      "Race","Season","Round",
      "Driver","Team",
      "StartingPosition","FinalPosition",
      "TotalLaps","Status",
      "PitStopCount",
      "PitLap1","PitLap2","PitLap3","PitLap4","PitLap5","PitLap6",
      "StartingTyre",
      "TyreAfterPit1","TyreAfterPit2","TyreAfterPit3","TyreAfterPit4","TyreAfterPit5","TyreAfterPit6"
    ];

    const rows = results.map(r => {
      const driverId = r.Driver.driverId;
      const driverName = `${r.Driver.givenName} ${r.Driver.familyName}`.trim();
      const team = r.Constructor?.name || "";
      const grid = r.grid ? Number(r.grid) : "";
      const finish = r.position ? Number(r.position) : "";
      const laps = r.laps ? Number(r.laps) : "";
      const status = r.status || "";

      const pitLapsAll = pitLapsByDriverId.get(driverId) || [];
      const pitCount = pitLapsAll.length;
      const pit6 = pitLapsAll.slice(0, 6);

      // tyres via OpenF1 (may be blank pre-race or if OpenF1 missing)
      const dn = numByName.get(normName_(driverName)) || "";
      const tyreSeq = dn ? (tyresByNumber.get(dn) || []) : [];
      const tyreStart = tyreSeq[0] || "";
      const tyresAfter = Array.from({ length: 6 }, (_, i) => tyreSeq[i + 1] || "");

      return [
        race.raceName || "Australian Grand Prix", String(SEASON), round,
        driverName, team,
        grid, finish,
        laps, status,
        pitCount,
        pit6[0] ?? "",
        pit6[1] ?? "",
        pit6[2] ?? "",
        pit6[3] ?? "",
        pit6[4] ?? "",
        pit6[5] ?? "",
        tyreStart,
        ...tyresAfter
      ];
    });

    // ---------- 6) Only now clear & write (so you don’t wipe it pre-race) ----------
    sheet.clear();

    sheet.getRange(1, 1).setValue(`OK — Results populated for ${SEASON} Australian GP.`);
    sheet.getRange(2, 1).setValue(`Round: ${round} | Race: ${race.raceName || ""} | Date: ${race.date || ""}`);
    sheet.getRange(3, 1).setValue(openf1Info);

    const startRow = 6; // headers on row 6, data row 7
    sheet.getRange(startRow, 1, 1, header.length).setValues([header]);
    sheet.getRange(startRow + 1, 1, rows.length, header.length).setValues(rows);

    sheet.setFrozenRows(startRow);
    sheet.autoResizeColumns(1, header.length);

    try {
      rebuildScores();
      sheet.getRange(4, 1).setValue("Scores updated successfully.");
    } catch (e) {
      sheet.getRange(4, 1).setValue("Scores update error:");
      sheet.getRange(4, 2).setValue(String(e));
    }

    PropertiesService.getScriptProperties().setProperty("AUS_LAST_SUCCESS", `${SEASON}-${round}`);

  } catch (err) {
    // Don’t nuke the sheet; just show error at the top
    sheet.getRange(1, 1).setValue("ERROR:");
    sheet.getRange(2, 1).setValue(String(err));
  }
}

function fetchJson_(url) {
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`HTTP ${code} for ${url} :: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

function normName_(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}