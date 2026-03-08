function listMyCalendars_toResults() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Results") || ss.insertSheet("Results");
  sh.clear();

  const cals = CalendarApp.getAllCalendars();
  sh.getRange(1,1).setValue("Calendar Name");
  sh.getRange(1,2).setValue("Calendar ID");

  const rows = cals.map(c => [c.getName(), c.getId()]);
  sh.getRange(2,1, rows.length, 2).setValues(rows);
}
function scheduleTriggerAtRaceEnd_AUS_2026() {
  const CALENDAR_ID = "38bfdc6a35a5bb015082c5c9e9f4ebb1f80ae86d0bc299a658130cca300b505e@group.calendar.google.com";
  const END_BUFFER_MINUTES = 5;

  // robust match tokens (avoid relying on emoji / punctuation)
  const MUST_CONTAIN = [
    "AUSTRALIAN GRAND PRIX 2026",
    "RACE"
  ];

  const ss = SpreadsheetApp.getActive();
  const resultsSheet = ss.getSheetByName("Results") || ss.insertSheet("Results");

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error(`Calendar not found: ${CALENDAR_ID}`);

  // Wide window around likely race date
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
    resultsSheet.getRange(2,1).setValue("Here are events in the search window (title, start, end):");

    const rows = events.slice(0, 200).map(e => [e.getTitle(), e.getStartTime(), e.getEndTime()]);
    if (rows.length) resultsSheet.getRange(4,1, rows.length, 3).setValues(rows);

    throw new Error("Race calendar event not found. Check title tokens or widen date window.");
  }

  // If multiple, pick the earliest start time
  matches.sort((a, b) => a.getStartTime() - b.getStartTime());
  const raceEvent = matches[0];

  const endTime = raceEvent.getEndTime();
  const triggerTime = new Date(endTime.getTime() + END_BUFFER_MINUTES * 60 * 1000);

  // Delete existing triggers for this handler (avoid duplicates)
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "fillResults_2026_Australia") {
      ScriptApp.deleteTrigger(t);
    }
  }

  // Create one-time trigger
  ScriptApp.newTrigger("fillResults_2026_Australia")
    .timeBased()
    .at(triggerTime)
    .create();

  // Confirm in Results sheet
  resultsSheet.clear();
  resultsSheet.getRange(1,1).setValue("Trigger scheduled ✅");
  resultsSheet.getRange(2,1).setValue("Matched event title");
  resultsSheet.getRange(2,2).setValue(raceEvent.getTitle());
  resultsSheet.getRange(3,1).setValue("Event starts");
  resultsSheet.getRange(3,2).setValue(raceEvent.getStartTime());
  resultsSheet.getRange(4,1).setValue("Event ends");
  resultsSheet.getRange(4,2).setValue(endTime);
  resultsSheet.getRange(5,1).setValue("Trigger will run at (+5 min buffer)");
  resultsSheet.getRange(5,2).setValue(triggerTime);
  resultsSheet.getRange(6,1).setValue("Calendar used");
  resultsSheet.getRange(6,2).setValue("Formula 1");
}