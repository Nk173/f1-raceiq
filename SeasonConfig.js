/**
 * SeasonConfig.js
 *
 * Fetches the full F1 season schedule from the Jolpica (Ergast) API
 * and writes it to a "Season Config" sheet.
 *
 * Run once at the start of the season, or whenever you need to refresh.
 */

function buildSeasonConfig(season) {
  season = season || new Date().getFullYear();

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("Season Config") || ss.insertSheet("Season Config");

  // ---------- 1) Fetch schedule from Jolpica ----------
  const url = `${JOLPICA_BASE}/${season}.json?limit=100`;
  const json = fetchJson_(url);
  const races = json?.MRData?.RaceTable?.Races || [];

  if (races.length === 0) {
    sheet.clear();
    sheet.getRange(1, 1).setValue(`No races found for ${season}. The schedule may not be published yet.`);
    return;
  }

  // ---------- 2) Build rows ----------
  const headers = [
    "Round",
    "RaceName",
    "Country",
    "Circuit",
    "Locality",
    "RaceDate",
    "RaceTimeUTC",
    "QualifyingDate",
    "QualifyingTimeUTC",
    "SprintDate",
    "SprintTimeUTC",
    "FP1Date",
    "FP1TimeUTC",
    "IsSprint",
    "FormURL",
    "FormCloseTime",
    "ResultsFetched",
    "ScoresEmailed"
  ];

  const rows = races.map(r => {
    const circuit = r.Circuit || {};
    const loc = circuit.Location || {};

    const raceDate = r.date || "";
    const raceTime = r.time || "";
    const qualDate = r.Qualifying?.date || "";
    const qualTime = r.Qualifying?.time || "";
    const sprintDate = r.Sprint?.date || "";
    const sprintTime = r.Sprint?.time || "";
    const fp1Date = r.FirstPractice?.date || "";
    const fp1Time = r.FirstPractice?.time || "";
    const isSprint = sprintDate ? "Yes" : "No";

    // Default form close = race start (editable manually)
    const formClose = raceDate && raceTime
      ? toSheetDateTime_(raceDate, raceTime)
      : raceDate || "";

    return [
      Number(r.round),
      r.raceName || "",
      loc.country || "",
      circuit.circuitName || "",
      loc.locality || "",
      raceDate,
      raceTime.replace("Z", ""),
      qualDate,
      qualTime.replace("Z", ""),
      sprintDate,
      sprintTime.replace("Z", ""),
      fp1Date,
      fp1Time.replace("Z", ""),
      isSprint,
      "",          // FormURL — to be filled by form-generation script
      formClose,   // FormCloseTime — default to race start, adjust as needed
      "No",        // ResultsFetched
      "No"         // ScoresEmailed
    ];
  });

  // ---------- 3) Write to sheet ----------
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);

  // Light formatting
  const roundRange = sheet.getRange(2, 1, rows.length, 1);
  roundRange.setHorizontalAlignment("center");

  const sprintCol = headers.indexOf("IsSprint") + 1;
  sheet.getRange(2, sprintCol, rows.length, 1).setHorizontalAlignment("center");

  const statusCols = ["ResultsFetched", "ScoresEmailed"];
  for (const colName of statusCols) {
    const ci = headers.indexOf(colName) + 1;
    sheet.getRange(2, ci, rows.length, 1).setHorizontalAlignment("center");
  }

  SpreadsheetApp.getUi().alert(
    `Season Config built for ${season}: ${rows.length} races loaded.`
  );
}

/**
 * Convenience wrapper — builds config for the current year.
 * Attach this to a custom menu or run manually.
 */
function buildSeasonConfig_2026() {
  buildSeasonConfig(2026);
}

/* ---------- Helpers ---------- */

/**
 * Combines an ISO date string and a UTC time string into a
 * human-readable date-time for the sheet.
 * e.g. "2026-03-15" + "05:00:00Z" → "2026-03-15 05:00:00"
 */
function toSheetDateTime_(dateStr, timeStr) {
  if (!dateStr) return "";
  const t = (timeStr || "").replace("Z", "");
  return t ? `${dateStr} ${t}` : dateStr;
}

/* ---------- Season Config helpers (used by Code, Schedule, Email) ---------- */

/**
 * Reads the "Season Config" sheet and returns headers, data, and a column index.
 */
function getSeasonConfigData_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Season Config");
  if (!sh) throw new Error("Missing sheet: Season Config. Run Build Season Config first.");

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) throw new Error("Season Config is empty.");

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const idx = {};
  headers.forEach((h, i) => { idx[String(h).trim()] = i; });

  return { sheet: sh, headers, data, idx, startDataRow: 2 };
}

/**
 * Returns the season year from the first RaceDate in the Season Config.
 */
function getSeasonFromConfig_() {
  const { data, idx } = getSeasonConfigData_();
  const val = data[0][idx.RaceDate];
  if (val instanceof Date) return val.getFullYear();
  const year = parseInt(String(val || "").substring(0, 4), 10);
  if (isNaN(year)) throw new Error("Cannot determine season from Season Config RaceDate.");
  return year;
}

/**
 * Returns the first round in Season Config where ResultsFetched ≠ "Yes".
 * @returns {{ round: number, raceName: string, country: string, raceDate: *, raceTime: string }|null}
 */
function getNextUnprocessedRound_() {
  const { data, idx } = getSeasonConfigData_();

  for (const row of data) {
    if (String(row[idx.ResultsFetched] || "").trim().toLowerCase() === "yes") continue;

    return {
      round:    Number(row[idx.Round]),
      raceName: String(row[idx.RaceName] || ""),
      country:  String(row[idx.Country] || ""),
      raceDate: row[idx.RaceDate],
      raceTime: String(row[idx.RaceTimeUTC] || "")
    };
  }
  return null;
}

/**
 * Updates a status column for a given round in the Season Config sheet.
 * @param {number} round
 * @param {string} columnName  e.g. "ResultsFetched" or "ScoresEmailed"
 * @param {string} value       e.g. "Yes"
 */
function markRoundStatus_(round, columnName, value) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Season Config");
  if (!sh) return;

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const roundIdx = headers.findIndex(h => String(h).trim() === "Round");
  const colIdx   = headers.findIndex(h => String(h).trim() === columnName);
  if (roundIdx < 0 || colIdx < 0) return;

  for (let i = 0; i < data.length; i++) {
    if (Number(data[i][roundIdx]) === Number(round)) {
      sh.getRange(i + 2, colIdx + 1).setValue(value);
      return;
    }
  }
}

/**
 * Parses a RaceDate + RaceTimeUTC from the Season Config into a Date object.
 * Handles both string dates ("2026-03-15") and Sheets Date objects.
 */
function parseRaceDateTime_(dateVal, timeStr) {
  if (!dateVal) return null;
  let dateStr;
  if (dateVal instanceof Date) {
    dateStr = Utilities.formatDate(dateVal, "UTC", "yyyy-MM-dd");
  } else {
    dateStr = String(dateVal);
  }
  const t = String(timeStr || "00:00:00").replace("Z", "");
  const dt = new Date(`${dateStr}T${t}Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

/* ---------- Custom menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("RaceIQ")
    .addItem("Build Season Config (2026)", "buildSeasonConfig_2026")
    .addSeparator()
    .addItem("Schedule Next Race", "scheduleNextRace")
    .addSeparator()
    .addItem("Rebuild Choices (latest per email)", "rebuildChoicesLatestPerEmail")
    .addItem("Fill Results (next race)", "fillResultsForNextRace")
    .addItem("Rebuild Scores", "rebuildScores")
    .addItem("Email Scores", "emailScoresForNextRace")
    .addSeparator()
    .addItem("🧪 Run Full Simulation", "runFullSimulation")
    .addToUi();
}
