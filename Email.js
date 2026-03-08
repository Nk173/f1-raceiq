function emailScoresTable() {
  const EMAIL_TO = "f1raceiqfantasy@gmail.com"; // <-- change this
  const SUBJECT = "RaceIQ Fantasy - Final Scores";
  
  const ss = SpreadsheetApp.getActive();
  const scoreSh = ss.getSheetByName("Scores");
  if (!scoreSh) throw new Error("Missing sheet: Scores");

  const lastRow = scoreSh.getLastRow();
  const lastCol = scoreSh.getLastColumn();
  if (lastRow < 2) throw new Error("Scores sheet is empty.");

  const values = scoreSh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const sheetUrl = ss.getUrl() + "#gid=" + scoreSh.getSheetId();

  const htmlTable = toHtmlTable_(values);

  const htmlBody = `
    <p>Here are the final <b>Scores</b> for the race.</p>
    <p><a href="${sheetUrl}">Open the Scores sheet</a></p>
    ${htmlTable}
  `;

  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: SUBJECT,
    htmlBody: htmlBody
  });
}

function toHtmlTable_(values) {
  let html = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;">';

  values.forEach((row, r) => {
    html += "<tr>";
    row.forEach(cell => {
      const tag = r === 0 ? "th" : "td";
      const style = r === 0
        ? ' style="background:#f2f2f2;font-weight:bold;"'
        : "";
      html += `<${tag}${style}>${escapeHtml_(cell)}</${tag}>`;
    });
    html += "</tr>";
  });

  html += "</table>";
  return html;
}

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function scheduleTriggerAtRaceEnd_AUS_2026() {
  const CALENDAR_ID = "38bfdc6a35a5bb015082c5c9e9f4ebb1f80ae86d0bc299a658130cca300b505e@group.calendar.google.com";
  const RESULTS_BUFFER_MINUTES = 5;
  const EMAIL_BUFFER_MINUTES = 60;

  const MUST_CONTAIN = [
    "AUSTRALIAN GRAND PRIX 2026",
    "RACE"
  ];

  const ss = SpreadsheetApp.getActive();
  const resultsSheet = ss.getSheetByName("Results") || ss.insertSheet("Results");

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error(`Calendar not found: ${CALENDAR_ID}`);

  const start = new Date(Date.UTC(2026, 1, 15)); // Feb 15 2026
  const end   = new Date(Date.UTC(2026, 3, 15)); // Apr 15 2026

  const events = cal.getEvents(start, end);

  const norm = (s) => String(s || "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const matches = events.filter(e => {
    const t = norm(e.getTitle());
    return MUST_CONTAIN.every(token => t.includes(token));
  });

  if (matches.length === 0) {
    resultsSheet.clear();
    resultsSheet.getRange(1,1).setValue("No matching AUS 2026 Race event found in Formula 1 calendar.");
    const rows = events.slice(0, 200).map(e => [e.getTitle(), e.getStartTime(), e.getEndTime()]);
    if (rows.length) resultsSheet.getRange(3,1, rows.length, 3).setValues(rows);
    throw new Error("Race calendar event not found.");
  }

  matches.sort((a, b) => a.getStartTime() - b.getStartTime());
  const raceEvent = matches[0];

  const endTime = raceEvent.getEndTime();
  const resultsTriggerTime = new Date(endTime.getTime() + RESULTS_BUFFER_MINUTES * 60 * 1000);
  const emailTriggerTime = new Date(endTime.getTime() + EMAIL_BUFFER_MINUTES * 60 * 1000);

  // Delete old triggers for these handlers
  for (const t of ScriptApp.getProjectTriggers()) {
    const fn = t.getHandlerFunction();
    if (fn === "fillResults_2026_Australia" || fn === "emailScoresTable") {
      ScriptApp.deleteTrigger(t);
    }
  }

  ScriptApp.newTrigger("fillResults_2026_Australia")
    .timeBased()
    .at(resultsTriggerTime)
    .create();

  ScriptApp.newTrigger("emailScoresTable")
    .timeBased()
    .at(emailTriggerTime)
    .create();

  resultsSheet.clear();
  resultsSheet.getRange(1,1).setValue("Triggers scheduled ✅");
  resultsSheet.getRange(2,1).setValue("Matched event");
  resultsSheet.getRange(2,2).setValue(raceEvent.getTitle());
  resultsSheet.getRange(3,1).setValue("Race ends");
  resultsSheet.getRange(3,2).setValue(endTime);
  resultsSheet.getRange(4,1).setValue("Results trigger");
  resultsSheet.getRange(4,2).setValue(resultsTriggerTime);
  resultsSheet.getRange(5,1).setValue("Email trigger");
  resultsSheet.getRange(5,2).setValue(emailTriggerTime);
}
