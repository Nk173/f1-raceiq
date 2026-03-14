/**
 * Choices.js
 *
 * Reads from the active race's response sheet ("Race 2", "Race 3", etc.),
 * keeps only the latest submission per email address, and writes the
 * de-duplicated rows to a "Choices" sheet for scoring.
 *
 * The active round is read from the WF_ACTIVE_ROUND Script Property
 * (set via RaceIQ menu → "Set Active Round (Web Form)").
 * Falls back to "Form Responses 1" if no active round is set, so the
 * original Google Forms workflow still works.
 */
function rebuildChoicesLatestPerEmail() {
  const ss = SpreadsheetApp.getActive();

  // Determine which response sheet to read from
  const props       = PropertiesService.getScriptProperties();
  const activeRound = parseInt(props.getProperty('WF_ACTIVE_ROUND') || '0', 10);
  const sourceName  = activeRound > 0 ? 'Race ' + activeRound : 'Form Responses 1';

  const sourceSh = ss.getSheetByName(sourceName);
  if (!sourceSh) {
    throw new Error('Missing sheet: ' + sourceName +
      (activeRound > 0
        ? '. Run the web form or check that WF_ACTIVE_ROUND is set correctly.'
        : '. Run "Rebuild Choices" after the form has received at least one response.'));
  }

  const lastRow = sourceSh.getLastRow();
  const lastCol = sourceSh.getLastColumn();
  if (lastRow < 2) {
    throw new Error(sourceName + ' has no data rows yet.');
  }

  const data    = sourceSh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const rows    = data.slice(1);

  // Build column index from header row
  const headerIndex = {};
  headers.forEach(function (h, i) {
    headerIndex[String(h).trim()] = i;
  });

  if (headerIndex['Timestamp'] === undefined) {
    throw new Error('Missing column "Timestamp" in ' + sourceName);
  }
  if (headerIndex['Email Address'] === undefined) {
    throw new Error('Missing column "Email Address" in ' + sourceName);
  }

  const tsCol    = headerIndex['Timestamp'];
  const emailCol = headerIndex['Email Address'];

  // Keep only the latest submission per email
  const latestByEmail = new Map();

  for (const row of rows) {
    const email = String(row[emailCol] || '').trim().toLowerCase();
    if (!email) continue;

    const tsValue = row[tsCol];
    const ts      = tsValue instanceof Date ? tsValue : new Date(tsValue);
    if (isNaN(ts.getTime())) continue;

    const existing = latestByEmail.get(email);
    if (!existing || ts > existing.timestamp) {
      latestByEmail.set(email, { timestamp: ts, row: row });
    }
  }

  // Sort by submission time so the Choices sheet is in chronological order
  const outputRows = Array.from(latestByEmail.values())
    .sort(function (a, b) { return a.timestamp - b.timestamp; })
    .map(function (x) { return x.row; });

  // Write to "Choices" sheet
  const targetSh = ss.getSheetByName('Choices') || ss.insertSheet('Choices');
  targetSh.clear();
  targetSh.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (outputRows.length > 0) {
    targetSh.getRange(2, 1, outputRows.length, headers.length).setValues(outputRows);
  }

  targetSh.setFrozenRows(1);
  targetSh.autoResizeColumns(1, headers.length);

  Logger.log('Choices rebuilt from "' + sourceName + '": ' +
             outputRows.length + ' unique entries.');
}
