/**
 * CreateWebForm.js — RaceIQ Web App (Option B)
 *
 * Serves a custom HTML prediction form via Google Apps Script Web App.
 * Responses are written directly to "Form Responses 1" using the same
 * column headers that Choices.js / Simulate.js already expect, so all
 * downstream scoring continues to work unchanged.
 *
 * One-time setup:
 *  1. In the Apps Script editor: Deploy → New deployment → Web App
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  2. Copy the Web App URL — this is the permanent form URL to share.
 *  3. Before each race weekend: RaceIQ menu → "Set Active Round (Web Form)"
 *
 * Google Drive "Assets" folder must contain:
 *   {round}.png   — race cover photo  (e.g. "2.png")
 *   line-up.png   — driver line-up graphic
 *   Pricing.xlsx  — columns "Driver" and "Value"
 *
 * CreateForm.js (Google Forms approach) is left untouched as a fallback.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WF_BUDGET_LIMIT_   = 50;
const WF_ASSETS_FOLDER_  = 'Assets';
const WF_TYRES_    = ['Soft', 'Medium', 'Hard', 'Intermediate', 'Wet'];
const WF_MAX_LAPS_ = 80;
// Sheet name is computed per-round: "Race 2", "Race 3", etc.

/**
 * Column headers written to the per-race sheet.
 * Round and Race are included so each sheet is self-contained.
 * Remaining columns match the h-object in Simulate.js.
 */
const WF_RESPONSE_HEADERS_ = [
  'Timestamp',
  'Email Address',
  'Round',
  'Race',
  'Team Name',
  'Driver 1',
  'Driver 2',
  'Driver 1 \u2014 Pit lap for stop 1',
  'Driver 1 \u2014 Tyre after stop 1',
  'Driver 1 \u2014 Pit lap for stop 2',
  'Driver 1 \u2014 Tyre after stop 2',
  'Driver 1 \u2014 Pit lap for stop 3',
  'Driver 1 \u2014 Tyre after stop 3',
  'Driver 2 \u2014 Pit lap for stop 1',
  'Driver 2 \u2014 Tyre after stop 1',
  'Driver 2 \u2014 Pit lap for stop 2',
  'Driver 2 \u2014 Tyre after stop 2',
  'Driver 2 \u2014 Pit lap for stop 3',
  'Driver 2 \u2014 Tyre after stop 3',
];

/** Fallback prices used when Pricing.xlsx cannot be read. */
const WF_DEFAULT_PRICES_ = {
  'Max Verstappen': 30,    'Liam Lawson': 15,
  'Lewis Hamilton': 28,    'Charles Leclerc': 27,
  'Lando Norris': 29,      'Oscar Piastri': 26,
  'George Russell': 24,    'Andrea Kimi Antonelli': 18,
  'Fernando Alonso': 20,   'Lance Stroll': 14,
  'Pierre Gasly': 16,      'Jack Doohan': 12,
  'Yuki Tsunoda': 17,      'Isack Hadjar': 13,
  'Nico Hulkenberg': 16,   'Gabriel Bortoleto': 13,
  'Alexander Albon': 16,   'Carlos Sainz': 22,
  'Esteban Ocon': 14,      'Oliver Bearman': 13,
};

// ---------------------------------------------------------------------------
// Web App entry point
// ---------------------------------------------------------------------------

/**
 * Serves the HTML form. Called automatically when someone opens the Web App URL.
 */
function doGet(e) {
  const config = wfBuildConfig_();

  const tpl = HtmlService.createTemplateFromFile('WebForm');

  // Lean JSON config sent to the client (no images — those go as template vars)
  tpl.configJson = JSON.stringify({
    round:    config.round,
    raceName: config.raceName,
    closeStr: config.closeStr,
    budget:   WF_BUDGET_LIMIT_,
    maxLaps:  WF_MAX_LAPS_,
    tyres:    WF_TYRES_,
    drivers:  config.drivers,   // [{name, price, label}]
  });

  // Images passed directly as template variables to avoid bloating the JSON
  tpl.coverImg  = config.coverImg  || '';
  tpl.lineupImg = config.lineupImg || '';

  return tpl.evaluate()
    .setTitle('RaceIQ \u2014 Round ' + config.round + ': ' + config.raceName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function wfBuildConfig_() {
  const props       = PropertiesService.getScriptProperties();
  const activeRound = parseInt(props.getProperty('WF_ACTIVE_ROUND') || '0', 10);

  const { data, idx } = getSeasonConfigData_();

  let round     = 0;
  let raceName  = 'Unknown Race';
  let closeTime = '';

  for (const row of data) {
    const r = Number(row[idx['Round']]);
    if (activeRound > 0 ? r === activeRound : r > 0) {
      round     = r;
      raceName  = String(row[idx['RaceName']]   || '');
      closeTime = row[idx['FormCloseTime']]      || '';
      break;
    }
  }

  const pricing = wfLoadPricing_();
  const drivers = wfBuildDriverList_(pricing);

  return {
    round,
    raceName,
    closeStr:  wfFormatCloseTime_(closeTime, -30),
    drivers,
    coverImg:  wfGetImageBase64_(round + '.png'),
    lineupImg: wfGetImageBase64_('line-up.png'),
  };
}

// ---------------------------------------------------------------------------
// Form submission handler — called via google.script.run from the browser
// ---------------------------------------------------------------------------

/**
 * Validates submitted data and appends a row to a per-race sheet ("Race 2", etc.).
 * Round and Race are looked up server-side from Script Properties + Season Config.
 *
 * @param {Object} data  Fields from the client (see WebForm.html submitForm())
 * @returns {{ ok: boolean, error?: string }}
 */
function submitFormResponse(data) {
  // Server-side budget guard
  const d1Price = Number(data.d1Price) || 0;
  const d2Price = Number(data.d2Price) || 0;
  if (d1Price + d2Price > WF_BUDGET_LIMIT_) {
    return {
      ok: false,
      error: 'Budget exceeded: ' + (d1Price + d2Price) + 'm > ' +
             WF_BUDGET_LIMIT_ + 'm. Please go back and choose a valid combination.',
    };
  }

  if (!data.email || !data.teamName || !data.driver1 || !data.driver2) {
    return { ok: false, error: 'Missing required fields.' };
  }
  if (!data.d1p1 || !data.d1t1 || !data.d2p1 || !data.d2t1) {
    return { ok: false, error: 'Stop 1 details are required for both drivers.' };
  }

  // Look up the active round and race name server-side
  const props       = PropertiesService.getScriptProperties();
  const activeRound = parseInt(props.getProperty('WF_ACTIVE_ROUND') || '0', 10);
  let   raceName    = '';
  if (activeRound > 0) {
    try {
      const { data: cfgData, idx } = getSeasonConfigData_();
      for (const row of cfgData) {
        if (Number(row[idx['Round']]) === activeRound) {
          raceName = String(row[idx['RaceName']] || '');
          break;
        }
      }
    } catch (_) {}
  }

  // Sheet name: "Race 2", "Race 3", etc.
  const sheetName = activeRound > 0 ? 'Race ' + activeRound : 'Race Responses';

  const ss = SpreadsheetApp.getActive();
  let   sh = ss.getSheetByName(sheetName);

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.getRange(1, 1, 1, WF_RESPONSE_HEADERS_.length)
      .setValues([WF_RESPONSE_HEADERS_])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, WF_RESPONSE_HEADERS_.length)
      .setValues([WF_RESPONSE_HEADERS_])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  sh.appendRow([
    new Date(),
    String(data.email    || '').trim(),
    activeRound || '',
    raceName,
    String(data.teamName || '').trim(),
    String(data.driver1  || ''),
    String(data.driver2  || ''),
    String(data.d1p1     || ''),
    String(data.d1t1     || ''),
    String(data.d1p2     || ''),
    String(data.d1t2     || ''),
    String(data.d1p3     || ''),
    String(data.d1t3     || ''),
    String(data.d2p1     || ''),
    String(data.d2t1     || ''),
    String(data.d2p2     || ''),
    String(data.d2t2     || ''),
    String(data.d2p3     || ''),
    String(data.d2t3     || ''),
  ]);

  Logger.log('Response recorded in "' + sheetName + '" for ' + data.email +
             ' | ' + data.driver1 + ' + ' + data.driver2 +
             ' (' + (d1Price + d2Price) + 'm)');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Menu action — set active round
// ---------------------------------------------------------------------------

/**
 * Prompts for a round number and stores it so the web form shows that race.
 * Run from RaceIQ menu → "Set Active Round (Web Form)".
 */
function setActiveRoundForWebForm() {
  const ui  = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Set Active Round — Web Form',
    'Enter the round number to display on the web form:',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const round = parseInt(res.getResponseText().trim(), 10);
  if (isNaN(round) || round < 1) {
    ui.alert('Invalid round number. Please enter a positive integer.');
    return;
  }

  PropertiesService.getScriptProperties()
    .setProperty('WF_ACTIVE_ROUND', String(round));

  SpreadsheetApp.getActive().toast(
    'Web form now shows Round ' + round + '. ' +
    'Open your deployed Web App URL to verify.',
    'RaceIQ'
  );
}

// ---------------------------------------------------------------------------
// Image helper
// ---------------------------------------------------------------------------

/**
 * Returns a data: URL (base64) for the named file in the Drive Assets folder.
 * Returns an empty string if the file cannot be found.
 *
 * @param {string} filename  e.g. "2.png" or "line-up.png"
 * @returns {string}
 */
function wfGetImageBase64_(filename) {
  try {
    const folders = DriveApp.getFoldersByName(WF_ASSETS_FOLDER_);
    if (!folders.hasNext()) {
      Logger.log('Drive folder "' + WF_ASSETS_FOLDER_ + '" not found.');
      return '';
    }
    const files = folders.next().getFilesByName(filename);
    if (!files.hasNext()) {
      Logger.log('File not found in Assets folder: ' + filename);
      return '';
    }
    const blob = files.next().getBlob();
    const ext  = filename.split('.').pop().toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
    return 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (err) {
    Logger.log('wfGetImageBase64_(' + filename + '): ' + err);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

function wfLoadPricing_() {
  try {
    const folders = DriveApp.getFoldersByName(WF_ASSETS_FOLDER_);
    if (!folders.hasNext()) {
      Logger.log('wfLoadPricing_: Assets folder not found — using defaults.');
      return new Map(Object.entries(WF_DEFAULT_PRICES_));
    }
    const folder = folders.next();

    // Prefer a native Google Sheet named "Pricing" (convert Pricing.xlsx in Drive
    // via: open it → File → Save as Google Sheets, then delete the .xlsx copy).
    // Falls back to opening Pricing.xlsx directly if the native sheet isn't found.
    const wb = wfOpenPricingSheet_(folder);
    if (!wb) {
      Logger.log('wfLoadPricing_: no Pricing sheet found — using defaults.');
      return new Map(Object.entries(WF_DEFAULT_PRICES_));
    }

    const sh      = wb.getSheets()[0];
    const data    = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const headers = data[0].map(h => String(h).trim());
    const dCol    = headers.indexOf('Driver');
    const vCol    = headers.indexOf('Value');

    if (dCol < 0 || vCol < 0) {
      Logger.log('wfLoadPricing_: "Driver"/"Value" columns not found — using defaults.');
      return new Map(Object.entries(WF_DEFAULT_PRICES_));
    }

    const pricing = new Map();
    for (let i = 1; i < data.length; i++) {
      const driver = String(data[i][dCol] || '').trim();
      const value  = Number(data[i][vCol]);
      if (driver && !isNaN(value)) pricing.set(driver, value);
    }
    Logger.log('wfLoadPricing_: loaded ' + pricing.size + ' drivers.');
    return pricing;

  } catch (err) {
    Logger.log('wfLoadPricing_: ' + err + ' — using defaults.');
    return new Map(Object.entries(WF_DEFAULT_PRICES_));
  }
}

/**
 * Tries to open the Pricing spreadsheet from the given Drive folder.
 * Checks for a native Google Sheet named "Pricing" first, then "Pricing.xlsx".
 *
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet|null}
 */
function wfOpenPricingSheet_(folder) {
  // 1. Native Google Sheet (MimeType = Sheets)
  const SHEETS_MIME = 'application/vnd.google-apps.spreadsheet';
  const natives = folder.getFilesByType(SHEETS_MIME);
  while (natives.hasNext()) {
    const f = natives.next();
    if (f.getName().toLowerCase().replace(/\.xlsx$/i, '') === 'pricing') {
      try { return SpreadsheetApp.openById(f.getId()); } catch (_) {}
    }
  }

  // 2. Excel file — SpreadsheetApp.openById works only if Drive has
  //    auto-converted it or the account has conversion enabled.
  const excels = folder.getFilesByName('Pricing.xlsx');
  if (excels.hasNext()) {
    try { return SpreadsheetApp.openById(excels.next().getId()); } catch (_) {}
  }

  return null;
}

function wfBuildDriverList_(pricing) {
  return Array.from(pricing.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, price]) => ({ name, price, label: name + ' \u2014 ' + price + 'm' }));
}

function wfFormatCloseTime_(rawTime, offsetMinutes) {
  if (!rawTime) return 'race start';
  try {
    const dt = rawTime instanceof Date
      ? new Date(rawTime.getTime())
      : new Date(String(rawTime).replace(' ', 'T') + 'Z');
    if (isNaN(dt.getTime())) return String(rawTime);
    if (offsetMinutes) dt.setMinutes(dt.getMinutes() + offsetMinutes);
    const hh    = String(dt.getUTCHours()).padStart(2, '0');
    const mm    = String(dt.getUTCMinutes()).padStart(2, '0');
    const day   = dt.getUTCDate();
    const month = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December']
                  [dt.getUTCMonth()];
    return hh + ':' + mm + ' GMT on ' + day + ' ' + month;
  } catch (err) {
    return String(rawTime);
  }
}
