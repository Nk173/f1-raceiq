/**
 * Trigger-compatible entry point.
 * Finds the round that has results but hasn't been emailed yet,
 * sends the scores, marks it done, then chains to scheduleNextRace().
 */
function emailScoresForNextRace() {
  const { data, idx } = getSeasonConfigData_();

  let target = null;
  for (const row of data) {
    const fetched = String(row[idx.ResultsFetched] || "").trim().toLowerCase();
    const emailed = String(row[idx.ScoresEmailed] || "").trim().toLowerCase();
    if (fetched === "yes" && emailed !== "yes") {
      target = {
        round: Number(row[idx.Round]),
        raceName: String(row[idx.RaceName] || "")
      };
      break;
    }
  }

  if (!target) {
    Logger.log("No rounds pending email.");
    return;
  }

  emailScoresTable(target.raceName);
  markRoundStatus_(target.round, "ScoresEmailed", "Yes");

  try {
    scheduleNextRace();
  } catch (e) {
    Logger.log("scheduleNextRace after email: " + e);
  }
}

/**
 * Sends a compact Scores summary as an HTML email.
 * Columns sent:
 * - User / Email
 * - Driver Points
 * - Pit Stop Points
 * - Tyre Points
 * - Total Points
 */
function emailScoresTable(raceName) {
  const EMAIL_TO = "f1raceiqfantasy@gmail.com";
  const raceLabel = raceName || "Race";
  const SUBJECT = `RaceIQ Fantasy - ${raceLabel} - Final Scores`;

  const ss = SpreadsheetApp.getActive();
  const scoreSh = ss.getSheetByName("Scores");
  if (!scoreSh) throw new Error("Missing sheet: Scores");

  const lastRow = scoreSh.getLastRow();
  const lastCol = scoreSh.getLastColumn();
  if (lastRow < 2) throw new Error("Scores sheet is empty.");

  const values = scoreSh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const headers = values[0];
  const rows = values.slice(1);

  const h = makeHeaderIndex_(headers);

  const required = [
    "Email",
    "Driver1_RacePoints", "Driver2_RacePoints",
    "Driver1_PitCountPoints", "Driver2_PitCountPoints",
    "Driver1_PitLap1Points", "Driver1_PitLap2Points", "Driver1_PitLap3Points",
    "Driver2_PitLap1Points", "Driver2_PitLap2Points", "Driver2_PitLap3Points",
    "Driver1_Tyre1Points", "Driver1_Tyre2Points", "Driver1_Tyre3Points",
    "Driver2_Tyre1Points", "Driver2_Tyre2Points", "Driver2_Tyre3Points",
    "TotalPoints"
  ];

  required.forEach(name => {
    if (!(name in h)) {
      throw new Error(`Scores header missing: ${name}`);
    }
  });

  const compact = rows
    .filter(r => String(r[h.Email] || "").trim() !== "")
    .map(r => {
      const email = String(r[h.Email] || "").trim();

      const driverPoints =
        num_(r[h.Driver1_RacePoints]) +
        num_(r[h.Driver2_RacePoints]);

      const pitStopPoints =
        num_(r[h.Driver1_PitCountPoints]) +
        num_(r[h.Driver2_PitCountPoints]) +
        num_(r[h.Driver1_PitLap1Points]) +
        num_(r[h.Driver1_PitLap2Points]) +
        num_(r[h.Driver1_PitLap3Points]) +
        num_(r[h.Driver2_PitLap1Points]) +
        num_(r[h.Driver2_PitLap2Points]) +
        num_(r[h.Driver2_PitLap3Points]);

      const tyrePoints =
        num_(r[h.Driver1_Tyre1Points]) +
        num_(r[h.Driver1_Tyre2Points]) +
        num_(r[h.Driver1_Tyre3Points]) +
        num_(r[h.Driver2_Tyre1Points]) +
        num_(r[h.Driver2_Tyre2Points]) +
        num_(r[h.Driver2_Tyre3Points]);

      const totalPoints = num_(r[h.TotalPoints]);

      return [email, driverPoints, pitStopPoints, tyrePoints, totalPoints];
    })
    .sort((a, b) => b[4] - a[4]);

  const compactValues = [
    ["User / Email", "Driver Points", "Pit Stop Points", "Tyre Points", "Total Points"],
    ...compact
  ];

  const sheetUrl = ss.getUrl() + "#gid=" + scoreSh.getSheetId();
  const htmlTable = toPrettyHtmlTable_(compactValues);

  const htmlBody = `
    <p>Here are the final <b>Scores</b> for <b>${escapeHtml_(raceLabel)}</b>.</p>
    <p><a href="${sheetUrl}">Open the full Scores sheet</a></p>
    ${htmlTable}
  `;

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: SUBJECT,
    htmlBody: htmlBody
  });
}

function toPrettyHtmlTable_(values) {
  let html = `
    <table style="
      border-collapse: collapse;
      font-family: Arial, sans-serif;
      font-size: 13px;
      min-width: 700px;
      border: 1px solid #d9d9d9;
    ">
  `;

  values.forEach((row, r) => {
    html += "<tr>";
    row.forEach((cell, c) => {
      const isHeader = r === 0;
      const isNumeric = r > 0 && c > 0;

      const tag = isHeader ? "th" : "td";
      const style = isHeader
        ? `
          background: #111827;
          color: #ffffff;
          font-weight: bold;
          padding: 10px 12px;
          border: 1px solid #d9d9d9;
          text-align: left;
        `
        : `
          background: ${r % 2 === 0 ? "#f9fafb" : "#ffffff"};
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
          text-align: ${isNumeric ? "right" : "left"};
        `;

      html += `<${tag} style="${style}">${escapeHtml_(cell)}</${tag}>`;
    });
    html += "</tr>";
  });

  html += "</table>";
  return html;
}

function makeHeaderIndex_(headers) {
  const out = {};
  headers.forEach((h, i) => {
    out[String(h || "").trim()] = i;
  });
  return out;
}

function num_(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}