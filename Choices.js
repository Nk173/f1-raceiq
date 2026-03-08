function rebuildChoicesLatestPerEmail() {
  const ss = SpreadsheetApp.getActive();
  const sourceSh = ss.getSheetByName("Form Responses 1");
  const targetSh = ss.getSheetByName("Choices") || ss.insertSheet("Choices");

  if (!sourceSh) throw new Error("Missing sheet: Form Responses 1");

  const lastRow = sourceSh.getLastRow();
  const lastCol = sourceSh.getLastColumn();
  if (lastRow < 2) throw new Error("Form Responses 1 has no data.");

  const data = sourceSh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const rows = data.slice(1);

  const headerIndex = {};
  headers.forEach((h, i) => {
    headerIndex[String(h).trim()] = i;
  });

  if (headerIndex["Timestamp"] === undefined) {
    throw new Error("Missing column: Timestamp");
  }
  if (headerIndex["Email Address"] === undefined) {
    throw new Error("Missing column: Email Address");
  }

  const tsCol = headerIndex["Timestamp"];
  const emailCol = headerIndex["Email Address"];

  const latestByEmail = new Map();

  for (const row of rows) {
    const email = String(row[emailCol] || "").trim().toLowerCase();
    if (!email) continue;

    const tsValue = row[tsCol];
    const ts = tsValue instanceof Date ? tsValue : new Date(tsValue);
    if (isNaN(ts.getTime())) continue;

    const existing = latestByEmail.get(email);
    if (!existing || ts > existing.timestamp) {
      latestByEmail.set(email, {
        timestamp: ts,
        row: row
      });
    }
  }

  const outputRows = Array.from(latestByEmail.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(x => x.row);

  targetSh.clear();
  targetSh.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (outputRows.length > 0) {
    targetSh.getRange(2, 1, outputRows.length, headers.length).setValues(outputRows);
  }

  targetSh.setFrozenRows(1);
  targetSh.autoResizeColumns(1, headers.length);
}
