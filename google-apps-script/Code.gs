/**
 * KSU Crown — Google Sheets export target.
 *
 * The registration database (PostgreSQL, via Prisma) is the source of truth. This
 * script no longer stores registrations, decides whether one is a duplicate, or
 * holds the tournament settings: the admin console pushes rows here when an
 * organiser wants a spreadsheet to filter and pivot, and that is all.
 *
 *   GET  <web app>?action=ping            → reachability and row count
 *   GET  <web app>?action=list            → every row currently in the sheet
 *   POST <web app>  {"action":"append"}   → append one row per person
 *
 * Every request must carry the shared secret (see `setSharedSecret`), because a
 * deployed web app is reachable by anyone who knows its URL.
 *
 * Setup, once:
 *   1. Extensions → Apps Script, paste this file, Save.
 *   2. Run setupSheet()      — creates the header row, formatting and rules.
 *   3. Run setSharedSecret() — prints the value for SHEET_WEBHOOK_SECRET in .env.
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me    Who has access: Anyone
 *   5. Put the /exec URL in SHEET_WEBHOOK_URL in .env.
 *
 * Pasting this file changes nothing until you deploy a new version.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

var SHEET_NAME = 'Registrations';
var TIMEZONE = 'Asia/Riyadh';
var SECRET_PROPERTY = 'SHARED_SECRET';
var SPREADSHEET_PROPERTY = 'SPREADSHEET_ID';

/**
 * Bumped whenever the request/response contract changes.
 *
 * v5: the script became an export target only. Duplicate detection, reference
 *     codes and the tournament config all moved into the app's database, so the
 *     `register`, `config` and `saveConfig` actions were removed and the Role
 *     values changed from STARTER / ALTERNATE to STARTER / SUBSTITUTE / COACH.
 */
var SCRIPT_VERSION = 5;

/**
 * Must match PLAYER_COLUMNS in src/lib/sheets.ts, in the same order.
 *
 * Every person carries their own institution and contact details because a
 * roster may legitimately mix universities, so those columns repeat on each row
 * instead of being a single team-level value.
 */
var COLUMNS = [
  'Reference',
  'Submitted At',
  'Tournament',
  'Team Name',
  'Division',
  'Game',
  'Roster Size',
  'Player #',
  'Player Name',
  'Game Tag',
  'University',
  'Region',
  'Player Email',
  'Student ID',
  'Discord',
  'Phone',
  'Role',
  'Is Leader',
  'Team Leader',
  'Additional Requirements',
  'Flags',
];

/** One push can carry a whole tournament, so the cap is generous but bounded. */
var MAX_ROWS_PER_REQUEST = 2000;

var BRAND_DARK = '#243035';
var BRAND_CYAN = '#67FEFE';
var WARN_BG = '#4a1010';
var WARN_FG = '#ff9b9b';

/* -------------------------------------------------------------------------- */
/* Web app entry points                                                       */
/* -------------------------------------------------------------------------- */

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    requireSecret_(params);
    var action = String(params.action || 'list').toLowerCase();

    if (action === 'ping') {
      return json_({ ok: true, sheet: SHEET_NAME, players: countPlayers_(), version: SCRIPT_VERSION });
    }
    if (action === 'list') {
      return json_({ ok: true, columns: COLUMNS, rows: readRows_(), version: SCRIPT_VERSION });
    }

    throw new Error('Unknown action "' + action + '"');
  } catch (error) {
    return json_({ ok: false, error: messageOf_(error) });
  }
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  try {
    requireSecret_(params);

    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(payload.action || 'append').toLowerCase();

    if (action === 'append') return json_(append_(payload));

    throw new Error('Unknown action "' + action + '"');
  } catch (error) {
    return json_({ ok: false, error: messageOf_(error) });
  }
}

/* -------------------------------------------------------------------------- */
/* Appending                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Append rows to the mirror.
 *
 * The app reads the sheet first and only sends rows that are not there yet, so
 * this stays a plain append. It is deliberately not idempotent by itself: a
 * retry after a lost response would double the rows, which is why the caller
 * re-reads and decides instead of blindly repeating.
 */
function append_(payload) {
  var rows = payload.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No rows to append');
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    throw new Error('Too many rows in one request (limit ' + MAX_ROWS_PER_REQUEST + ')');
  }

  // Two pushes at once must not compute the same start row.
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var sheet = sheet_();
    ensureHeaders_(sheet);
    appendRows_(sheet, rows);
    return { ok: true, status: 'created', appended: rows.length, version: SCRIPT_VERSION };
  } finally {
    lock.releaseLock();
  }
}

function appendRows_(sheet, rows) {
  if (rows.length === 0) return;

  var startRow = sheet.getLastRow() + 1;
  var matrix = rows.map(function (row, offset) {
    return toMatrixRow_(row, startRow + offset);
  });

  sheet.getRange(startRow, 1, matrix.length, COLUMNS.length).setValues(matrix);

  // Student IDs and timestamps are text, not numbers — never let Sheets eat a
  // leading zero or reformat them.
  sheet
    .getRange(startRow, indexOfColumn_('Student ID') + 1, matrix.length, 1)
    .setNumberFormat('@');
  sheet
    .getRange(startRow, indexOfColumn_('Submitted At') + 1, matrix.length, 1)
    .setNumberFormat('@');
}

/* -------------------------------------------------------------------------- */
/* Setup helpers — run these by hand from the Apps Script editor               */
/* -------------------------------------------------------------------------- */

/** Create (or repair) the header row, formatting, validation and warning rules. */
function setupSheet() {
  var sheet = sheet_();

  var existingHeader = String(sheet.getRange(1, 1, 1, 1).getValue() || '');
  if (sheet.getLastRow() > 1 && existingHeader && existingHeader !== COLUMNS[0]) {
    Logger.log('Note: the header row is being replaced by the current layout.');
  }
  if (sheet.getLastRow() > 1 && existingHeader === COLUMNS[0]) {
    var current = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0].join('|');
    if (current !== COLUMNS.join('|')) {
      Logger.log('WARNING: "' + SHEET_NAME + '" already contains ' + (sheet.getLastRow() - 1) + ' data row(s).');
      Logger.log('         The layout may have changed, so older rows will no longer line up.');
      Logger.log('         Clear or archive them first — clearSheet() empties the mirror.');
    }
  }

  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  styleHeaders_(sheet);

  // Student IDs and timestamps stay exactly as written.
  sheet.getRange(2, indexOfColumn_('Student ID') + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, indexOfColumn_('Submitted At') + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');

  applyValidation_(sheet);
  applyDuplicateRules_(sheet);

  var existingFilter = sheet.getFilter();
  if (!existingFilter) sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).createFilter();

  refreshFlags();
  Logger.log('Sheet "' + SHEET_NAME + '" is ready. Next: run setSharedSecret().');
  return sheet.getName();
}

/**
 * Show the shared secret the app must send, generating it on first run.
 *
 * Deliberately idempotent: re-running this does NOT rotate an existing secret,
 * because rotating it silently breaks the app until `.env` is updated too —
 * which shows up as a confusing "Unauthorised". Pass `true` only when you
 * intend to invalidate the current pairing:
 *
 *   setSharedSecret()        // show the existing secret (or create the first one)
 *   setSharedSecret(true)    // rotate — remember to update SHEET_WEBHOOK_SECRET
 */
function setSharedSecret(rotate) {
  var properties = PropertiesService.getScriptProperties();
  var existing = properties.getProperty(SECRET_PROPERTY);

  if (existing && rotate !== true) {
    Logger.log('Secret already configured — unchanged. Add to the app .env:');
    Logger.log('  SHEET_WEBHOOK_SECRET=' + existing);
    Logger.log('(Pass setSharedSecret(true) only if you mean to rotate it.)');
    return existing;
  }

  var secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  properties.setProperty(SECRET_PROPERTY, secret);

  Logger.log(
    existing
      ? 'Secret ROTATED. Update the app .env now, or exports will fail with "Unauthorised":'
      : 'Secret created. Add to the app .env:',
  );
  Logger.log('  SHEET_WEBHOOK_SECRET=' + secret);
  return secret;
}

/**
 * Rebuild the Flags formula on every row. Safe to run after editing the sheet by
 * hand — it only touches the Flags column.
 */
function refreshFlags() {
  var sheet = sheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var count = lastRow - 1;
  var formulas = [];
  for (var i = 0; i < count; i++) formulas.push([flagFormula_(i + 2)]);

  sheet.getRange(2, indexOfColumn_('Flags') + 1, count, 1).setFormulas(formulas);
  return count;
}

/**
 * Print everything needed to pair the app with this script, without going over
 * HTTP. Run this when an export fails: it is the fastest way to see the exact
 * secret value to paste into `.env`.
 */
function diagnose() {
  var sheet = sheet_();
  var secret = secret_();

  Logger.log('——— KSU Crown sheet export ———');
  Logger.log('spreadsheet  : ' + sheet.getParent().getName());
  /* The document's own address. Printed because the app cannot work it out: only the
     Apps Script deployment URL is configured there, and the spreadsheet's id lives here
     on Google's side. Copy the line below into SHEET_URL to get an "Open the sheet" link
     in the organiser console next to "Push to Sheet". */
  Logger.log('spreadsheet URL (copy this into .env as SHEET_URL):');
  Logger.log('  SHEET_URL="' + sheet.getParent().getUrl() + '"');
  Logger.log('sheet        : ' + sheet.getName());
  Logger.log('script ver   : ' + SCRIPT_VERSION);
  Logger.log('players      : ' + countPlayers_());
  Logger.log('header row   : ' + sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0].join(' | '));
  Logger.log('');
  Logger.log(secret ? 'SECRET (copy this into .env):' : 'SECRET: not set — run setSharedSecret() first');
  if (secret) Logger.log('  SHEET_WEBHOOK_SECRET="' + secret + '"');
  Logger.log('');
  Logger.log('Remember: saving this file does not update the live web app.');
  Logger.log('Deploy → Manage deployments → Edit → Version: New version');
}

/**
 * Delete every row belonging to one reference code — for tidying up after a test
 * entry, or a team the organisers have disqualified.
 *
 *   removeReference('KSU-26-MBUWMX')
 *
 * This edits the mirror only. Removing the registration itself is done in the
 * admin console; otherwise the next export writes the team straight back.
 *
 * Rows are deleted from the bottom up so the remaining indexes stay valid.
 */
function removeReference(reference) {
  var needle = String(reference || '').trim();
  if (!needle) throw new Error('Pass a reference code, e.g. removeReference("KSU-26-ABCDEF")');

  var sheet = sheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(2, indexOfColumn_('Reference') + 1, lastRow - 1, 1).getValues();
  var removed = 0;

  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0] || '').trim() !== needle) continue;
    sheet.deleteRow(i + 2);
    removed++;
  }

  Logger.log('Removed ' + removed + ' row(s) for ' + needle);
  if (removed > 0) refreshFlags();
  return removed;
}

/** Empty the mirror. The database is unaffected and the next export refills it. */
function clearSheet() {
  var sheet = sheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var count = lastRow - 1;
  sheet.getRange(2, 1, count, COLUMNS.length).clearContent();
  Logger.log('Cleared ' + count + ' row(s). Run setupSheet() to restore the formatting.');
  return count;
}

/* -------------------------------------------------------------------------- */
/* Sheet plumbing                                                             */
/* -------------------------------------------------------------------------- */

function sheet_() {
  var sheet = spreadsheet_().getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet_().insertSheet(SHEET_NAME);
  return sheet;
}

/** The bound spreadsheet, or the one named in script properties. */
function spreadsheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (spreadsheet) return spreadsheet;

  var id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_PROPERTY);
  if (!id) {
    throw new Error('No spreadsheet found. Bind this script to the sheet, or set ' + SPREADSHEET_PROPERTY + '.');
  }
  return SpreadsheetApp.openById(id);
}

function ensureHeaders_(sheet) {
  var current = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), COLUMNS.length))
    .getValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });

  var matches = COLUMNS.every(function (column, index) {
    return current[index] === column;
  });
  if (matches) return;

  // Rewriting headers under existing data would misalign every column.
  if (sheet.getLastRow() > 1) {
    throw new Error(
      'The header row of "' + SHEET_NAME + '" is out of date (this app expects the v5 layout, ' +
        'with Game Tag / University / Region / Discord / Phone per person). Run setupSheet() once ' +
        'and try again — if the sheet already holds rows, clear or archive them first.',
    );
  }

  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
  styleHeaders_(sheet);
  applyValidation_(sheet);
  applyDuplicateRules_(sheet);
}

function styleHeaders_(sheet) {
  var header = sheet.getRange(1, 1, 1, COLUMNS.length);
  header
    .setFontWeight('bold')
    .setFontColor(BRAND_CYAN)
    .setBackground(BRAND_DARK)
    .setVerticalAlignment('middle');
  header.setNote(
    'Exported from the KSU Crown registration database — one row per person.\n' +
      'This sheet is a mirror: edits here are not written back, and an export only ' +
      'adds rows that are not already present.\n' +
      'Red rows are flagged in the "Flags" column: the same email, student ID or team ' +
      'name also appears under a different reference code.',
  );

  sheet.setFrozenRows(1);

  // Reference … Flags — keep in step with COLUMNS above.
  var widths = [
    110, 130, 140, 160, 80, 130, 80, 70, 170, 130, 220, 110, 230, 120, 140, 140, 90, 80, 160, 240, 170,
  ];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
}

function applyValidation_(sheet) {
  var roleColumn = indexOfColumn_('Role') + 1;
  var divisionColumn = indexOfColumn_('Division') + 1;
  var rows = sheet.getMaxRows() - 1;

  sheet.getRange(2, roleColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      // Matches the values the app exports, which mirror the database.
      .requireValueInList(['STARTER', 'SUBSTITUTE', 'COACH'], true)
      .setAllowInvalid(true)
      .build(),
  );
  sheet.getRange(2, divisionColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Male', 'Female'], true).setAllowInvalid(true).build(),
  );
}

/**
 * Highlight a whole row when its email, student ID or team name is also used by
 * a *different* reference code.
 *
 * The database enforces these rules, so this should never fire on a clean
 * export. It stays because the sheet is the artefact organisers actually read: a
 * person appearing twice under different references is exactly the thing worth
 * seeing at a glance, and conditional formatting covers rows typed in by hand in
 * a way a single formula cell would not.
 */
function applyDuplicateRules_(sheet) {
  var range = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), COLUMNS.length);

  // Player Email (M), Student ID (N) and Team Name (D).
  var checks = ['M', 'N', 'D'];

  var rules = checks.map(function (letter) {
    var formula =
      '=AND($' +
      letter +
      '2<>"",COUNTIFS($' +
      letter +
      '$2:$' +
      letter +
      ',$' +
      letter +
      '2,$A$2:$A,"<>"&$A2)>0)';

    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground(WARN_BG)
      .setFontColor(WARN_FG)
      .setRanges([range])
      .build();
  });

  sheet.setConditionalFormatRules(rules);
}

function readRows_(sheet) {
  sheet = sheet || sheet_();
  ensureHeaders_(sheet);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var headerRow = sheet.getRange(1, 1, 1, COLUMNS.length).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();

  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var row = {};
    var empty = true;

    for (var c = 0; c < COLUMNS.length; c++) {
      var value = values[r][c];
      var text =
        value instanceof Date
          ? Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd HH:mm')
          : String(value === null || value === undefined ? '' : value).trim();
      row[headerRow[c] || COLUMNS[c]] = text;
      if (text) empty = false;
    }

    // Skip blank spacer rows organisers leave behind.
    if (!empty) rows.push(row);
  }

  return rows;
}

/** Cheap row count for the `ping` probe — reads one column, not the whole sheet. */
function countPlayers_() {
  var sheet = sheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(2, indexOfColumn_('Reference') + 1, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim()) count++;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Row shaping                                                                */
/* -------------------------------------------------------------------------- */

function toMatrixRow_(row, rowNumber) {
  return COLUMNS.map(function (column) {
    if (column === 'Flags') return flagFormula_(rowNumber);
    if (column === 'Submitted At') return formatSubmittedAt_(row[column]);
    return sanitise_(row[column]);
  });
}

/** Never let a player name like `=HYPERLINK(...)` become a live formula. */
function sanitise_(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function formatSubmittedAt_(value) {
  if (!value) return '';
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function flagFormula_(rowNumber) {
  // M = Player Email, N = Student ID, D = Team Name, A = Reference.
  var body =
    '=IF(AND($M{r}<>"",COUNTIFS($M$2:$M,$M{r},$A$2:$A,"<>"&$A{r})>0),"DUPLICATE EMAIL",' +
    'IF(AND($N{r}<>"",COUNTIFS($N$2:$N,$N{r},$A$2:$A,"<>"&$A{r})>0),"DUPLICATE STUDENT ID",' +
    'IF(AND($D{r}<>"",COUNTIFS($D$2:$D,$D{r},$A$2:$A,"<>"&$A{r})>0),"TEAM NAME CLASH","")))';
  return body.replace(/\{r\}/g, String(rowNumber));
}

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

function indexOfColumn_(name) {
  var index = COLUMNS.indexOf(name);
  if (index === -1) throw new Error('Unknown column "' + name + '"');
  return index;
}

function requireSecret_(params) {
  var expected = secret_();
  if (!expected) {
    throw new Error('No shared secret configured. Run setSharedSecret() in the Apps Script editor.');
  }
  // Trimmed on both sides: a stray space or newline pasted into .env is a far
  // more common cause of "Unauthorised" than a genuinely wrong secret.
  if (!params || String(params.secret || '').trim() !== expected) throw new Error('Unauthorised');
}

function secret_() {
  var secret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  return secret ? String(secret).trim() : '';
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function messageOf_(error) {
  if (!error) return 'Unknown error';
  return String(error.message || error);
}
