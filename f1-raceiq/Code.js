const OPENF1_BASE = "https://api.openf1.org/v1";
const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

/**
 * Trigger-compatible entry point.
 * Reads Season Config to find the next unprocessed round and fills results.
 */
function fillResultsForNextRace() {
  const next = getNextUnprocessedRound_();
  if (!next) {
    Logger.log("All rounds have been processed.");
    return;
  }

  const season = getSeasonFromConfig_();
  const ok = fillResults(season, next.round, next.country);
  if (ok) {
    markRoundStatus_(next.round, "ResultsFetched", "Yes");
  }
}

/**
 * Generic results fetcher — works for any round in any season.
 * @param {number} season  e.g. 2026
 * @param {number|string} round  e.g. 1
 * @param {string} country  e.g. "Australia" (for OpenF1 tyre lookup)
 * @returns {boolean} true if results were successfully written
 */
function fillResults(season, round, country) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("Results") || ss.insertSheet("Results");

  sheet.getRange(1, 1).setValue(`Checking ${season} Round ${round}…`);

  try {
    // ---------- 1) Pull race results ----------
    const resultsJson = fetchJson_(`${JOLPICA_BASE}/${season}/${round}/results.json?limit=1000`);
    const race = resultsJson?.MRData?.RaceTable?.Races?.[0];
    const results = race?.Results || [];

    // If the race hasn't happened / no results posted yet: try OpenF1 fallback
    if (!race || results.length === 0) {
      // Try OpenF1 fallback
      let sessions = [];
      if (country) {
        sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${season}&country_name=${encodeURIComponent(country)}&session_name=Race`) || [];
      }
      if (sessions.length === 0) {
        sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${season}&session_name=Race`) || [];
        if (country) {
          sessions = sessions.filter(s =>
            String(s.country_name || "").toLowerCase() === country.toLowerCase()
          );
        }
      }
      if (sessions.length === 0) {
        sheet.getRange(2, 1).setValue("Race results not available yet (Jolpica & OpenF1). Will try again on next trigger run.");
        return false;
      }
      // Find the latest session with available /position data
      let raceSession = null;
      let sessionKey = null;
      let openDrivers = [];
      let positions = [];
      let stints = [];
      for (let i = sessions.length - 1; i >= 0; i--) {
        const s = sessions[i];
        const key = s.session_key;
        try {
          const pos = fetchJson_(`${OPENF1_BASE}/position?session_key=${key}`) || [];
          if (pos.length > 0) {
            raceSession = s;
            sessionKey = key;
            positions = pos;
            openDrivers = fetchJson_(`${OPENF1_BASE}/drivers?session_key=${sessionKey}`) || [];
            stints = fetchJson_(`${OPENF1_BASE}/stints?session_key=${sessionKey}`) || [];
            break;
          }
        } catch (e) {
          // skip sessions with errors
        }
      }
      if (!raceSession) {
        sheet.getRange(2, 1).setValue("Race results not available yet (OpenF1 fallback: no session with position data). Will try again on next trigger run.");
        return false;
      }
      // Map driver_number to driver info
      const driverByNum = new Map();
      for (const d of openDrivers) {
        driverByNum.set(String(d.driver_number), d);
      }
      // Map driver_number to max lap and all positions at that lap
      const maxLapByNum = new Map();
      const posAtMaxLapByNum = new Map();
      for (const p of positions) {
        if (p.lap_number && p.position) {
          const dn = String(p.driver_number);
          const lap = Number(p.lap_number);
          if (!maxLapByNum.has(dn) || lap > maxLapByNum.get(dn)) {
            maxLapByNum.set(dn, lap);
            posAtMaxLapByNum.set(dn, [Number(p.position)]);
          } else if (lap === maxLapByNum.get(dn)) {
            posAtMaxLapByNum.get(dn).push(Number(p.position));
          }
        }
      }
      // For each driver, ensure we have a final position at their max lap
      for (const [dn, d] of driverByNum.entries()) {
        if (!maxLapByNum.has(dn)) {
          Logger.log(`No max lap for driver_number ${dn} (${d.first_name} ${d.last_name})`);
        } else if (!posAtMaxLapByNum.has(dn) || posAtMaxLapByNum.get(dn).length === 0) {
          Logger.log(`No position at max lap for driver_number ${dn} (${d.first_name} ${d.last_name})`);
        }
      }
      // Tyres by stint
      const tyresByNumber = new Map();
      for (const s of stints) {
        const dn = s.driver_number != null ? String(s.driver_number) : null;
        const stintNo = Number(s.stint_number);
        if (!dn || !stintNo) continue;
        if (!tyresByNumber.has(dn)) tyresByNumber.set(dn, []);
        tyresByNumber.get(dn)[stintNo - 1] = s.compound || "";
      }
      // Safety car laps
      let scLaps = new Set();
      try {
        const rcMsgs = fetchJson_(`${OPENF1_BASE}/race_control?session_key=${sessionKey}`) || [];
        for (const msg of rcMsgs) {
          const lap = Number(msg.lap_number);
          if (!lap || isNaN(lap)) continue;
          const cat  = String(msg.category || "").toUpperCase();
          const flag = String(msg.flag || "").toUpperCase();
          const text = String(msg.message || "").toUpperCase();
          if (cat === "SAFETYCAR" || text.includes("SAFETY CAR") || text.includes("VSC")) {
            scLaps.add(lap);
            scLaps.add(lap + 1);
            scLaps.add(lap + 2);
          }
          if (flag === "YELLOW" || flag === "DOUBLE YELLOW") {
            scLaps.add(lap);
          }
        }
      } catch (e) {}
      // Build rows in same format as Jolpica
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
      const rows = [];
      for (const [dn, d] of driverByNum.entries()) {
        const driverName = [d.first_name, d.last_name].filter(Boolean).join(" ");
        const team = d.team_name || d.team || "";
        const grid = d.grid_position || "";
        // Final position: take the lowest position at max lap (should be 1 for winner, etc.)
        let finish = "";
        if (maxLapByNum.has(dn) && posAtMaxLapByNum.has(dn) && posAtMaxLapByNum.get(dn).length > 0) {
          const arr = posAtMaxLapByNum.get(dn);
          finish = Math.min(...arr);
        } else {
          Logger.log(`No final position for driver_number ${dn} (${d.first_name} ${d.last_name})`);
        }
        const laps = maxLapByNum.get(dn) || "";
        // Status: if max lap < max of all drivers, mark as DNF; else Finished
        const maxRaceLap = Math.max(...Array.from(maxLapByNum.values()));
        let status = "Finished";
        if (laps && laps < maxRaceLap) status = "DNF";
        if (d.status) status = d.status;
        // Pit stops: OpenF1 doesn't have direct pit lap data, so leave blank
        const pit6 = ["", "", "", "", "", ""];
        const pitCount = 0;
        // Tyres
        const tyreSeq = tyresByNumber.get(dn) || [];
        const tyreStart = tyreSeq[0] || "";
        const tyresAfter = Array.from({ length: 6 }, (_, i) => tyreSeq[i + 1] || "");
        // SC at pit: blank (no pit data)
        const scAtPit6 = ["", "", "", "", "", ""];
        const scLapStr = scLaps.size > 0 ? Array.from(scLaps).sort((a,b)=>a-b).join(",") : "";
        rows.push([
          raceSession.meeting_name || "", String(season), String(round),
          driverName, team,
          grid, finish,
          laps, status,
          pitCount,
          ...pit6,
          tyreStart,
          ...tyresAfter,
          ...scAtPit6,
          scLapStr
        ]);
      }
      sheet.clear();
      sheet.getRange(1, 1).setValue(`OK — Results for ${season} Round ${round}: ${raceSession.meeting_name || "(OpenF1)"}`);
      sheet.getRange(2, 1).setValue(`Round: ${round} | Race: ${raceSession.meeting_name || ""} | Date: ${raceSession.date_start || ""}`);
      sheet.getRange(3, 1).setValue("OpenF1 fallback used");
      const startRow = 6;
      sheet.getRange(startRow, 1, 1, header.length).setValues([header]);
      sheet.getRange(startRow + 1, 1, rows.length, header.length).setValues(rows);
      sheet.setFrozenRows(startRow);
      sheet.autoResizeColumns(1, header.length);
      try {
        rebuildChoicesLatestPerEmail();
        rebuildScores();
        sheet.getRange(4, 1).setValue("Scores updated successfully.");
      } catch (e) {
        sheet.getRange(4, 1).setValue("Scores update error: " + String(e));
      }
      return true;
    }

    // ---------- 2) Pull pit stops ----------
    const pitsJson = fetchJson_(`${JOLPICA_BASE}/${season}/${round}/pitstops.json?limit=5000`);
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

    // ---------- 3) OpenF1: tyres from stints (optional; may not exist yet) ----------
    let numByName = new Map();
    let tyresByNumber = new Map();
    let scLaps = new Set();  // laps with Safety Car / VSC / Yellow flag
    let openf1Info = "OpenF1: not attempted.";
    const countrySearch = country || "";

    try {
      let sessions = [];
      if (countrySearch) {
        sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${season}&country_name=${encodeURIComponent(countrySearch)}&session_name=Race`) || [];
      }
      if (sessions.length === 0) {
        sessions = fetchJson_(`${OPENF1_BASE}/sessions?year=${season}&session_name=Race`) || [];
        if (countrySearch) {
          sessions = sessions.filter(s =>
            String(s.country_name || "").toLowerCase() === countrySearch.toLowerCase()
          );
        }
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

        // ---------- Safety Car / VSC / Yellow flag data ----------
        try {
          const rcMsgs = fetchJson_(`${OPENF1_BASE}/race_control?session_key=${sessionKey}`) || [];
          for (const msg of rcMsgs) {
            const lap = Number(msg.lap_number);
            if (!lap || isNaN(lap)) continue;
            const cat  = String(msg.category || "").toUpperCase();
            const flag = String(msg.flag || "").toUpperCase();
            const text = String(msg.message || "").toUpperCase();

            if (cat === "SAFETYCAR" || text.includes("SAFETY CAR") || text.includes("VSC")) {
              scLaps.add(lap);
              // SC typically affects the deployment lap and a few after
              scLaps.add(lap + 1);
              scLaps.add(lap + 2);
            }
            if (flag === "YELLOW" || flag === "DOUBLE YELLOW") {
              scLaps.add(lap);
            }
          }
          if (scLaps.size > 0) {
            openf1Info += ` | SC/Yellow laps: ${Array.from(scLaps).sort((a,b)=>a-b).join(",")}`;
          }
        } catch (e) {
          openf1Info += " | race_control fetch failed (non-fatal).";
        }
      } else {
        openf1Info = `OpenF1: No Race session found for ${countrySearch} ${season} (ok pre-race).`;
      }
    } catch (e) {
      openf1Info = `OpenF1: error (non-fatal): ${String(e).slice(0, 150)}`;
    }

    sheet.getRange(3, 1).setValue(openf1Info);

    // ---------- 4) Build output ----------
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

      // Safety car at each pit stop? Check if pit lap is in SC window
      const scAtPit = pitLapsAll.slice(0, 6).map(lap => {
        // Check if any SC lap is within ±2 of the pit lap
        for (let offset = -2; offset <= 2; offset++) {
          if (scLaps.has(lap + offset)) return "Yes";
        }
        return "No";
      });
      const scAtPit6 = Array.from({ length: 6 }, (_, i) => scAtPit[i] || "");
      const scLapStr = scLaps.size > 0 ? Array.from(scLaps).sort((a,b)=>a-b).join(",") : "";

      return [
        race.raceName || "", String(season), String(round),
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
        ...tyresAfter,
        scAtPit6[0], scAtPit6[1], scAtPit6[2], scAtPit6[3], scAtPit6[4], scAtPit6[5],
        scLapStr
      ];
    });

    // ---------- 5) Write results ----------
    sheet.clear();

    sheet.getRange(1, 1).setValue(`OK — Results for ${season} Round ${round}: ${race.raceName || ""}`);
    sheet.getRange(2, 1).setValue(`Round: ${round} | Race: ${race.raceName || ""} | Date: ${race.date || ""}`);
    sheet.getRange(3, 1).setValue(openf1Info);

    const startRow = 6; // headers on row 6, data row 7
    sheet.getRange(startRow, 1, 1, header.length).setValues([header]);
    sheet.getRange(startRow + 1, 1, rows.length, header.length).setValues(rows);

    sheet.setFrozenRows(startRow);
    sheet.autoResizeColumns(1, header.length);

    try {
      rebuildChoicesLatestPerEmail();
      rebuildScores();
      sheet.getRange(4, 1).setValue("Scores updated successfully.");
    } catch (e) {
      sheet.getRange(4, 1).setValue("Scores update error: " + String(e));
    }

    return true;

  } catch (err) {
    sheet.getRange(1, 1).setValue("ERROR:");
    sheet.getRange(2, 1).setValue(String(err));
    return false;
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