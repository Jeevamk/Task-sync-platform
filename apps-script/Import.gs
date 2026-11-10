/**
 * Task Sync – create Trello cards from the "Import" tab.
 * Menu: Task Sync → Set up Import tab / Create Trello cards
 * Script properties needed: API_URL, SYNC_SECRET
 */
const IMPORT_TAB = 'Import';
const IMPORT_HEADERS = ['Title', 'Description', 'List', 'Assignee', 'Due Date', 'Labels', 'Status', 'Trello Card', 'Row Key'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Sync')
    .addItem('Create Trello cards', 'createTrelloCards')
    .addSeparator()
    .addItem('Set up Import tab', 'setupImportTab')
    .addToUi();
}

/** Creates the Import tab with its headers (safe to run again). */
function setupImportTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(IMPORT_TAB) || ss.insertSheet(IMPORT_TAB);
  sheet.getRange(1, 1, 1, IMPORT_HEADERS.length).setValues([IMPORT_HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('E2:E').setNumberFormat('yyyy-mm-dd');
  sheet.getRange(1, 7).setNote('Filled by Task Sync. Clear it to create the row again.');
  sheet.getRange(1, 9).setNote('Filled by Task Sync. Do not edit.');
  ss.toast('Import tab is ready. Fill Title (required) and the other columns, then Task Sync → Create Trello cards.', 'Task Sync', 8);
}

/** Sends every row that has a Title and is not created yet to the backend. */
function createTrelloCards() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const apiUrl = (props.getProperty('API_URL') || '').replace(/\/$/, '');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) {
    ui.alert('Set the script properties API_URL and SYNC_SECRET first (Extensions → Apps Script → Project Settings).');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(IMPORT_TAB);
  if (!sheet) {
    ui.alert('No "Import" tab. Use Task Sync → Set up Import tab first.');
    return;
  }

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  const col = (name) => header.indexOf(name);
  for (const name of IMPORT_HEADERS) {
    if (col(name) === -1) {
      ui.alert(`Column "${name}" is missing in the Import tab. Use Task Sync → Set up Import tab.`);
      return;
    }
  }

  const tz = ss.getSpreadsheetTimeZone();
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const title = text(r[col('Title')]);
    const status = text(r[col('Status')]);
    if (!title || status.indexOf('✅') === 0) continue; // empty or already created

    let key = text(r[col('Row Key')]);
    if (!key) {
      key = Utilities.getUuid();
      sheet.getRange(i + 1, col('Row Key') + 1).setValue(key);
    }
    const due = r[col('Due Date')];
    rows.push({
      rowNumber: i + 1,
      key: key,
      title: title,
      description: text(r[col('Description')]),
      list: text(r[col('List')]),
      assignee: text(r[col('Assignee')]),
      dueDate: due instanceof Date ? Utilities.formatDate(due, tz, 'yyyy-MM-dd') : text(due),
      labels: text(r[col('Labels')]),
    });
  }

  if (!rows.length) {
    ui.alert('Nothing to create: every row is empty or already created.');
    return;
  }

  ss.toast(`Creating ${rows.length} card(s)…`, 'Task Sync', 5);
  const res = UrlFetchApp.fetch(apiUrl + '/webhooks/sheets/import', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Secret': secret, 'ngrok-skip-browser-warning': 'true' },
    payload: JSON.stringify({
      sheetId: ss.getId(),
      editorEmail: Session.getActiveUser().getEmail(),
      rows: rows,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  let body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (e) {
    ui.alert(`The backend did not answer correctly (HTTP ${code}). Is it running and is API_URL right?\n\n${res.getContentText().slice(0, 300)}`);
    return;
  }
  if (code !== 200) {
    ui.alert(`Import refused (HTTP ${code}): ${body.message || res.getContentText()}`);
    return;
  }

  for (const r of body.results) {
    let status;
    if (r.status === 'created') status = r.warnings ? `✅ Created (${r.warnings.join('; ')})` : '✅ Created';
    else if (r.status === 'already-created') status = '✅ Already created';
    else status = `❌ ${r.error}`;
    sheet.getRange(r.rowNumber, col('Status') + 1).setValue(status);
    if (r.cardUrl) sheet.getRange(r.rowNumber, col('Trello Card') + 1).setValue(r.cardUrl);
  }
  ss.toast(`${body.created} created, ${body.failed} failed.`, 'Task Sync', 8);
}
