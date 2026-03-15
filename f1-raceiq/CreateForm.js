/**
 * CreateForm.js
 *
 * Creates a new Google Form for the next unprocessed race, links its
 * responses to the "Form Responses 1" sheet, and writes the form URL
 * back to the Season Config.
 *
 * Prerequisites:
 *  - A Google Drive folder named "RaceIQ Assets" containing:
 *      {round}.png   — race cover photo (e.g. "2.png" for Round 2)
 *      line-up.png   — driver line-up graphic
 *  - A "Pricing" sheet in this spreadsheet with columns "Driver" and "Value"
 *    (import from assets/Pricing.xlsx before running).
 *
 * Run from the RaceIQ menu → "Create Form for Next Race".
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LAPS_         = 80;
const BUDGET_LIMIT_     = 50;
const FORM_TYRES_       = ["SOFT", "MEDIUM", "HARD"];

/** Fallback prices used when no Pricing sheet exists. */
const DEFAULT_PRICES_ = {
  "Max Verstappen": 30,    "Liam Lawson": 15,
  "Lewis Hamilton": 28,    "Charles Leclerc": 27,
  "Lando Norris": 29,      "Oscar Piastri": 26,
  "George Russell": 24,    "Andrea Kimi Antonelli": 18,
  "Fernando Alonso": 20,   "Lance Stroll": 14,
  "Pierre Gasly": 16,      "Jack Doohan": 12,
  "Yuki Tsunoda": 17,      "Isack Hadjar": 13,
  "Nico Hulkenberg": 16,   "Gabriel Bortoleto": 13,
  "Alexander Albon": 16,   "Carlos Sainz": 22,
  "Esteban Ocon": 14,      "Oliver Bearman": 13,
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Reads Season Config, finds the first round with no FormURL, creates the
 * form, and writes the published URL back to Season Config.
 */
/**
 * Prompts for a round number then creates (or recreates) the form for that round.
 * Always overwrites any existing FormURL for the chosen round.
 * Run this from the RaceIQ menu.
 */
function createFormForNextRace() {
  const ui       = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Create Race Form",
    "Enter the round number to create (or recreate) the form for:",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const round = parseInt(response.getResponseText().trim(), 10);
  if (isNaN(round) || round < 1) {
    ui.alert("Invalid round number. Please enter a positive integer.");
    return;
  }

  createFormForRound_(round);
}

/**
 * Creates or recreates the form for the given round number,
 * always overwriting any existing FormURL in Season Config.
 *
 * @param {number} targetRoundNum
 */
function createFormForRound_(targetRoundNum) {
  const { sheet, data, idx, startDataRow } = getSeasonConfigData_();

  let targetRowIndex = -1;
  let targetRound    = null;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (Number(row[idx.Round]) !== targetRoundNum) continue;

    targetRowIndex = i;
    targetRound = {
      round:     targetRoundNum,
      raceName:  String(row[idx.RaceName]  || "Unknown Race"),
      closeTime: row[idx.FormCloseTime]     || "",
    };
    break;
  }

  if (!targetRound) {
    SpreadsheetApp.getActive().toast(
      `Round ${targetRoundNum} not found in Season Config.`, "RaceIQ"
    );
    return;
  }

  const formUrl = createRaceForm_(
    targetRound.raceName,
    targetRound.round,
    targetRound.closeTime
  );

  // Write URL back to Season Config (overwrites existing if recreating)
  sheet.getRange(startDataRow + targetRowIndex, idx.FormURL + 1).setValue(formUrl);

  SpreadsheetApp.getActive().toast(
    `Form created for Round ${targetRound.round}: ${targetRound.raceName}`, "RaceIQ"
  );
  Logger.log(`Form URL: ${formUrl}`);
}

// ---------------------------------------------------------------------------
// Core form builder
// ---------------------------------------------------------------------------

/**
 * Builds the full Google Form for one race.
 *
 * Page structure:
 *   Page 1  — Cover image · Welcome · Line-up image · Driver selection
 *             instructions · Race (locked) · Round (locked) · Team Name
 *             · Driver 1 · Driver 2
 *   Page 2  — Driver 1 Strategy: Stop 1 & 2, then "Add stop 3?" branch
 *   Page 3  — Driver 1 Stop 3 (only if "Yes" on previous page)
 *   Page 4  — Driver 2 Strategy: Stop 1 & 2, then "Add stop 3?" branch
 *   Page 5  — Driver 2 Stop 3 (only if "Yes" on previous page)
 *
 * @param {string} raceName   e.g. "Chinese Grand Prix"
 * @param {number} round      e.g. 2
 * @param {*}      closeTime  FormCloseTime value from Season Config
 * @returns {string} Published form URL
 */
function createRaceForm_(raceName, round, closeTime) {
  const pricing      = loadPricing_();
  const driverChoices = buildDriverChoices_(pricing);
  const lapValues    = lapChoices_();
  const closeStr     = formatCloseTime_(closeTime);

  const form = FormApp.create(`RaceIQ Fantasy — Round ${round}: ${raceName}`);
  form.setCollectEmail(true);
  form.setAllowResponseEdits(true);
  form.setLimitOneResponsePerUser(false); // de-dup by latest timestamp in Choices.js
  form.setShowLinkToRespondAgain(true);

  // ── PAGE 1: Welcome · Driver selection ────────────────────────────────────
  // NOTE: Add the cover photo and line-up image manually in the form editor
  // after this script runs. Insert them above and below the welcome text
  // respectively using the image icon in the Google Forms toolbar.

  // Block 1 — welcome text
  form.addSectionHeaderItem()
    .setTitle(`Round ${round}: ${raceName}`)
    .setHelpText(
      `Pick 2 drivers within a total budget of ${BUDGET_LIMIT_}. ` +
      `Then predict pit strategy for each driver.\n\n` +
      `Submissions close at ${closeStr}.\n\n` +
      `Let's go racing!`
    );

  // Block 3 — driver selection instructions
  form.addSectionHeaderItem()
    .setTitle("Driver Selection")
    .setHelpText(
      `Start by selecting 2 drivers for this race. ` +
      `You have a budget of ${BUDGET_LIMIT_}m to spend across the driver tiers.\n\n` +
      `⚠️ NOTE: If your team value exceeds ${BUDGET_LIMIT_}, the 2nd driver and their ` +
      `strategy will be replaced by a random affordable driver with a random strategy ` +
      `(randomised to suit circuit and picked from among the recommended set of ` +
      `3-4 strategies for each race).`
    );

  // Locked Race & Round (single-option dropdowns)
  form.addListItem()
    .setTitle("Race")
    .setHelpText("Pre-filled — cannot be changed.")
    .setChoiceValues([raceName])
    .setRequired(true);

  form.addListItem()
    .setTitle("Round")
    .setHelpText("Pre-filled — cannot be changed.")
    .setChoiceValues([String(round)])
    .setRequired(true);

  // Team Name
  form.addTextItem()
    .setTitle("Team Name")
    .setHelpText("Your fantasy team name (shown on the leaderboard).")
    .setRequired(true);

  // Driver 1
  form.addListItem()
    .setTitle("Driver 1")
    .setHelpText("Select your first driver. Price shown in brackets.")
    .setChoiceValues(driverChoices)
    .setRequired(true);

  // Driver 2
  form.addListItem()
    .setTitle("Driver 2")
    .setHelpText(
      `Select your second driver. ` +
      `Combined value of Driver 1 + Driver 2 must not exceed ${BUDGET_LIMIT_}m.`
    )
    .setChoiceValues(driverChoices)
    .setRequired(true);

  // ── PAGE 2: Driver 1 Strategy ─────────────────────────────────────────────

  form.addPageBreakItem().setTitle("Driver 1 Strategy");

  form.addSectionHeaderItem()
    .setTitle("Driver 1 Strategy — Pit Stops")
    .setHelpText(
      `Predict the number of pit stops and the pit strategy in the race for Driver 1 ` +
      `based on the driver you picked. You can set as many as 3 stops per racer!`
    );

  // Stop 1 (required — every driver pits at least once)
  form.addListItem()
    .setTitle("Driver 1 — Pit lap for stop 1")
    .setHelpText("Which lap does Driver 1 make their first pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("Driver 1 — Tyre after stop 1")
    .setHelpText("Which compound does Driver 1 fit after stop 1?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(true);

  // Stop 2
  form.addListItem()
    .setTitle("Driver 1 — Pit lap for stop 2")
    .setHelpText("Which lap does Driver 1 make their second pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle("Driver 1 — Tyre after stop 2")
    .setHelpText("Which compound does Driver 1 fit after stop 2?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(false);

  // Branch — add stop 3?
  const d1AddStop = form.addMultipleChoiceItem()
    .setTitle("Add another pitstop for Driver 1?")
    .setRequired(true);

  // ── PAGE 3: Driver 1 Stop 3 ───────────────────────────────────────────────

  const d1Stop3Page = form.addPageBreakItem().setTitle("Driver 1 — Stop 3");

  form.addListItem()
    .setTitle("Driver 1 — Pit lap for stop 3")
    .setHelpText("Which lap does Driver 1 make their third pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle("Driver 1 — Tyre after stop 3")
    .setHelpText("Which compound does Driver 1 fit after stop 3?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(false);

  // ── PAGE 4: Driver 2 Strategy ─────────────────────────────────────────────

  const d2StratPage = form.addPageBreakItem().setTitle("Driver 2 Strategy");

  form.addSectionHeaderItem()
    .setTitle("Driver 2 Strategy — Pit Stops")
    .setHelpText(
      `Predict the number of pit stops and the pit strategy in the race for Driver 2 ` +
      `based on the driver you picked. You can set as many as 3 stops per racer!`
    );

  // Stop 1
  form.addListItem()
    .setTitle("Driver 2 — Pit lap for stop 1")
    .setHelpText("Which lap does Driver 2 make their first pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("Driver 2 — Tyre after stop 1")
    .setHelpText("Which compound does Driver 2 fit after stop 1?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(true);

  // Stop 2
  form.addListItem()
    .setTitle("Driver 2 — Pit lap for stop 2")
    .setHelpText("Which lap does Driver 2 make their second pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle("Driver 2 — Tyre after stop 2")
    .setHelpText("Which compound does Driver 2 fit after stop 2?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(false);

  // Branch — add stop 3?
  const d2AddStop = form.addMultipleChoiceItem()
    .setTitle("Add another pitstop for Driver 2?")
    .setRequired(true);

  // ── PAGE 5: Driver 2 Stop 3 ───────────────────────────────────────────────

  const d2Stop3Page = form.addPageBreakItem().setTitle("Driver 2 — Stop 3");

  form.addListItem()
    .setTitle("Driver 2 — Pit lap for stop 3")
    .setHelpText("Which lap does Driver 2 make their third pit stop?")
    .setChoiceValues(lapValues)
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle("Driver 2 — Tyre after stop 3")
    .setHelpText("Which compound does Driver 2 fit after stop 3?")
    .setChoiceValues(FORM_TYRES_)
    .setRequired(false);

  // ── Wire up page navigation ───────────────────────────────────────────────

  // D1 "Add another stop?":  Yes → D1 Stop 3 page,  No → D2 Strategy page
  d1AddStop.setChoices([
    d1AddStop.createChoice("Yes", d1Stop3Page),
    d1AddStop.createChoice("No",  d2StratPage),
  ]);

  // D1 Stop 3 page flows to D2 Strategy (it is the next page in sequence,
  // but setting it explicitly keeps behaviour predictable if pages are reordered)
  d1Stop3Page.setGoToPage(d2StratPage);

  // D2 "Add another stop?":  Yes → D2 Stop 3 page,  No → Submit
  d2AddStop.setChoices([
    d2AddStop.createChoice("Yes", d2Stop3Page),
    d2AddStop.createChoice("No",  FormApp.PageNavigationType.SUBMIT),
  ]);

  // D2 Stop 3 is the last page — it submits automatically after "Next".

  // ── Link responses to the spreadsheet ────────────────────────────────────

  const ss = SpreadsheetApp.getActive();
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  // Responses land in "Form Responses 1" — the name Choices.js already expects.

  // ── Budget validation trigger ─────────────────────────────────────────────
  // Remove any existing budget triggers for this script to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "onRaceFormSubmit_") ScriptApp.deleteTrigger(t);
  });
  // Fire onRaceFormSubmit_ whenever this form receives a response
  ScriptApp.newTrigger("onRaceFormSubmit_")
    .forForm(form)
    .onFormSubmit()
    .create();

  return form.getPublishedUrl();
}

// ---------------------------------------------------------------------------
// Budget validation — runs on every form submission
// ---------------------------------------------------------------------------

/**
 * Installed onFormSubmit trigger.
 * If Driver 1 + Driver 2 combined price exceeds BUDGET_LIMIT_, the response
 * is deleted and the respondent receives an email asking them to resubmit.
 *
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function onRaceFormSubmit_(e) {
  const response = e.response;
  const form     = e.source; // e.source is the Form — response.getForm() does not exist

  let d1Choice = "";
  let d2Choice = "";

  for (const itemResponse of response.getItemResponses()) {
    const title = itemResponse.getItem().getTitle();
    if (title === "Driver 1") d1Choice = String(itemResponse.getResponse());
    if (title === "Driver 2") d2Choice = String(itemResponse.getResponse());
  }

  const d1Price = extractPrice_(d1Choice);
  const d2Price = extractPrice_(d2Choice);
  const total   = d1Price + d2Price;

  Logger.log(`Budget check — ${d1Choice} (${d1Price}m) + ${d2Choice} (${d2Price}m) = ${total}m`);

  if (total <= BUDGET_LIMIT_) return; // valid — do nothing

  // Over budget: delete from the form response list
  form.deleteResponse(response.getId());

  // Also delete the row from the linked spreadsheet sheet
  deleteResponseRowFromSheet_(response.getRespondentEmail(), response.getTimestamp());

  // Notify the respondent so they know to resubmit
  const email = response.getRespondentEmail();
  if (email) {
    MailApp.sendEmail({
      to: email,
      subject: "RaceIQ Fantasy — Submission rejected: budget exceeded",
      htmlBody:
        `<p>Hi,</p>` +
        `<p>Your submission was <strong>not accepted</strong> because your selected ` +
        `drivers exceed the budget limit:</p>` +
        `<ul>` +
        `<li>${escapeHtml_(d1Choice)}</li>` +
        `<li>${escapeHtml_(d2Choice)}</li>` +
        `</ul>` +
        `<p><strong>Combined value: ${total}m — limit is ${BUDGET_LIMIT_}m.</strong></p>` +
        `<p>Please resubmit with a valid combination. ` +
        `<a href="${form.getPublishedUrl()}">Open the form</a></p>`,
    });
  }

  Logger.log(`Budget exceeded (${total}m) for ${email} — response deleted.`);
}

/**
 * Removes the matching row from "Form Responses 1" in the spreadsheet.
 * Matches on email + timestamp (within a 10-second window to handle clock skew).
 *
 * @param {string} email
 * @param {Date}   timestamp
 */
function deleteResponseRowFromSheet_(email, timestamp) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Form Responses 1");
  if (!sh || sh.getLastRow() < 2) return;

  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const tsCol   = headers.indexOf("Timestamp");
  const emCol   = headers.indexOf("Email Address");
  if (tsCol < 0 || emCol < 0) return;

  const targetEmail = String(email || "").trim().toLowerCase();
  const targetTs    = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();

  // Iterate from the bottom so row deletion doesn't shift indices
  for (let i = data.length - 1; i >= 1; i--) {
    const rowEmail = String(data[i][emCol] || "").trim().toLowerCase();
    const rowTs    = data[i][tsCol] instanceof Date
      ? data[i][tsCol].getTime()
      : new Date(data[i][tsCol]).getTime();

    if (rowEmail === targetEmail && Math.abs(rowTs - targetTs) < 10000) {
      sh.deleteRow(i + 1); // +1 because data is 0-indexed but sheet rows are 1-indexed
      Logger.log(`Deleted sheet row ${i + 1} for ${email}`);
      return;
    }
  }
}

/**
 * Extracts the numeric price from a driver choice string.
 * e.g. "Max Verstappen — 30m" → 30
 *
 * @param {string} choice
 * @returns {number}
 */
function extractPrice_(choice) {
  const match = String(choice).match(/—\s*(\d+)m\s*$/i);
  return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Helpers — pricing
// ---------------------------------------------------------------------------

/**
 * Reads driver prices from Pricing.xlsx in the Drive "Assets" folder.
 * Expects columns named "Driver" and "Value" on the first sheet.
 *
 * Falls back to DEFAULT_PRICES_ if the file cannot be found or parsed.
 *
 * @returns {Map<string, number>} driver name → price
 */
function loadPricing_() {
  try {
    const folders = DriveApp.getFoldersByName(DRIVE_ASSETS_FOLDER_);
    if (!folders.hasNext()) {
      Logger.log(`Drive folder "${DRIVE_ASSETS_FOLDER_}" not found — using default prices.`);
      return new Map(Object.entries(DEFAULT_PRICES_));
    }

    const files = folders.next().getFilesByName("Pricing.xlsx");
    if (!files.hasNext()) {
      Logger.log(`Pricing.xlsx not found in "${DRIVE_ASSETS_FOLDER_}" — using default prices.`);
      return new Map(Object.entries(DEFAULT_PRICES_));
    }

    // SpreadsheetApp can open .xlsx files stored in Drive directly
    const wb = SpreadsheetApp.openById(files.next().getId());
    const sh = wb.getSheets()[0];
    const data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();

    const headers   = data[0].map(h => String(h).trim());
    const driverCol = headers.indexOf("Driver");
    const valueCol  = headers.indexOf("Value");

    if (driverCol < 0 || valueCol < 0) {
      Logger.log('Pricing.xlsx missing "Driver" or "Value" columns — using defaults.');
      return new Map(Object.entries(DEFAULT_PRICES_));
    }

    const pricing = new Map();
    for (let i = 1; i < data.length; i++) {
      const driver = String(data[i][driverCol] || "").trim();
      const value  = Number(data[i][valueCol]);
      if (driver && !isNaN(value)) pricing.set(driver, value);
    }

    Logger.log(`Loaded ${pricing.size} driver prices from Pricing.xlsx.`);
    return pricing;

  } catch (e) {
    Logger.log(`Error reading Pricing.xlsx: ${e} — using default prices.`);
    return new Map(Object.entries(DEFAULT_PRICES_));
  }
}

/**
 * Builds the dropdown choice strings, sorted by price descending.
 * Format: "Max Verstappen — 30m"
 *
 * The scoring code uses extractName_() (defined in Simulate.js) to recover
 * the plain driver name by splitting on " — " and taking the first part.
 *
 * @param {Map<string, number>} pricing
 * @returns {string[]}
 */
function buildDriverChoices_(pricing) {
  return Array.from(pricing.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, price]) => `${name} — ${price}m`);
}

// ---------------------------------------------------------------------------
// Helpers — lap choices & close-time formatting
// ---------------------------------------------------------------------------

/**
 * Returns an array of strings "1" … MAX_LAPS_ for the pit-lap dropdowns.
 * @returns {string[]}
 */
function lapChoices_() {
  const laps = [];
  for (let i = 1; i <= MAX_LAPS_; i++) laps.push(String(i));
  return laps;
}

/**
 * Formats the FormCloseTime value from Season Config into a human-readable
 * string, e.g. "03:30 GMT on 8 March".
 *
 * @param {Date|string} rawTime  value from Season Config FormCloseTime cell
 * @returns {string}
 */
function formatCloseTime_(rawTime) {
  if (!rawTime) return "race start";
  try {
    const dt = rawTime instanceof Date
      ? rawTime
      : new Date(String(rawTime).replace(" ", "T") + "Z");
    if (isNaN(dt.getTime())) return String(rawTime);

    const hh    = String(dt.getUTCHours()).padStart(2, "0");
    const mm    = String(dt.getUTCMinutes()).padStart(2, "0");
    const day   = dt.getUTCDate();
    const month = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"]
                  [dt.getUTCMonth()];
    return `${hh}:${mm} GMT on ${day} ${month}`;
  } catch (e) {
    return String(rawTime);
  }
}
