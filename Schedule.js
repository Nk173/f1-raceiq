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
/**
 * Reads Season Config, finds the next upcoming race that hasn't been
 * processed, and schedules three time-based triggers:
 *   1) rebuildChoicesLatestPerEmail — 10 min before race start (lock in final picks)
 *   2) fillResultsForNextRace      — ~2 h 15 min after race start (est. race end + buffer)
 *   3) emailScoresForNextRace      — ~3 h after race start
 *
 * Call once from the RaceIQ menu; after that the chain auto-continues
 * because emailScoresForNextRace() calls scheduleNextRace() when done.
 */
function scheduleNextRace() {
  const CHOICES_BEFORE_MINUTES = 10;   // lock choices before race start
  const RESULTS_AFTER_MINUTES  = 30;   // run fillResults 30 min after race start
  const EMAIL_AFTER_MINUTES    = 60;   // run emailScores 60 min after race start

  const { data, idx } = getSeasonConfigData_();
  const now = new Date();

  // Find the first upcoming round where results haven't been fetched
  let next = null;
  for (const row of data) {
    if (String(row[idx.ResultsFetched] || "").trim().toLowerCase() === "yes") continue;

    const raceDateTime = parseRaceDateTime_(row[idx.RaceDate], String(row[idx.RaceTimeUTC] || ""));
    if (!raceDateTime || raceDateTime < now) continue; // skip past races

    next = {
      round:    Number(row[idx.Round]),
      raceName: String(row[idx.RaceName] || ""),
      raceDateTime: raceDateTime
    };
    break;
  }

  if (!next) {
    Logger.log("No upcoming unprocessed races to schedule.");
    SpreadsheetApp.getActive().toast("All races have been processed or are in the past.", "RaceIQ");
    return;
  }

  // Compute trigger times
  const choicesTriggerAt  = new Date(next.raceDateTime.getTime() - CHOICES_BEFORE_MINUTES * 60000);
  const resultsTriggerAt  = new Date(next.raceDateTime.getTime() + RESULTS_AFTER_MINUTES * 60000);
  const emailTriggerAt    = new Date(next.raceDateTime.getTime() + EMAIL_AFTER_MINUTES * 60000);

  // Remove existing triggers for these handlers to avoid duplicates
  for (const t of ScriptApp.getProjectTriggers()) {
    const fn = t.getHandlerFunction();
    if (fn === "rebuildChoicesLatestPerEmail" || fn === "fillResultsForNextRace" || fn === "emailScoresForNextRace") {
      ScriptApp.deleteTrigger(t);
    }
  }

  // Create one-shot triggers
  ScriptApp.newTrigger("rebuildChoicesLatestPerEmail")
    .timeBased()
    .at(choicesTriggerAt)
    .create();

  ScriptApp.newTrigger("fillResultsForNextRace")
    .timeBased()
    .at(resultsTriggerAt)
    .create();

  ScriptApp.newTrigger("emailScoresForNextRace")
    .timeBased()
    .at(emailTriggerAt)
    .create();

  // Confirm in Results sheet
  const ss = SpreadsheetApp.getActive();
  const resultsSheet = ss.getSheetByName("Results") || ss.insertSheet("Results");
  resultsSheet.getRange(1, 1).setValue("Next race triggers scheduled ✅");
  resultsSheet.getRange(2, 1).setValue("Race");
  resultsSheet.getRange(2, 2).setValue(`Round ${next.round}: ${next.raceName}`);
  resultsSheet.getRange(3, 1).setValue("Race start (UTC)");
  resultsSheet.getRange(3, 2).setValue(next.raceDateTime);
  resultsSheet.getRange(4, 1).setValue("Choices trigger (-10 min)");
  resultsSheet.getRange(4, 2).setValue(choicesTriggerAt);
  resultsSheet.getRange(5, 1).setValue("Results trigger");
  resultsSheet.getRange(5, 2).setValue(resultsTriggerAt);
  resultsSheet.getRange(6, 1).setValue("Email trigger");
  resultsSheet.getRange(6, 2).setValue(emailTriggerAt);
}