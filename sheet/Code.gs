/*
 * The write endpoint — SPEC.md §2 and build step 9.
 *
 * This script is bound to the spreadsheet, so a copy of the template carries
 * its own endpoint (§2). The organizer deploys it once and pastes the URL into
 * `Config`.
 *
 * **It computes nothing.** Standings, brackets, times and the WEB projection
 * are all worked out in the browser by engine.js and arrive here as finished
 * values. That is SPEC's first design principle read literally — the sheet is
 * storage, not the engine — and it is also the only way to keep one engine
 * rather than two that drift apart between tournaments.
 *
 * So the whole job is: check the token, take the lock, write the ranges.
 *
 * Deploy: Bereitstellen -> Neue Bereitstellung -> Web-App,
 *         "Ausführen als: Ich", "Zugriff: Jeder".
 * See ANLEITUNG.md next to this file.
 */
'use strict';

var TAB = { config: 'Config', teams: 'Teams', plan: 'Spielplan', web: 'WEB' };

/* A write waits this long for another one to finish before giving up. Two
 * devices entering results in the same second is the case this is for; a whole
 * minute of queueing on tournament day is not. */
var LOCK_MS = 20000;

// ------------------------------------------------------------------ plumbing

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetNamed(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('Das Blatt „' + name + '“ fehlt in dieser Tabelle.');
  return sheet;
}

/**
 * A whole tab as the strings it shows.
 *
 * getDisplayValues rather than getValues on purpose: a cell formatted as a time
 * comes back from getValues as a Date in the script's own time zone, and
 * "09:14" then reaches the phone as an ISO timestamp from 1899. The app parses
 * text anyway (§3.3 stores HH:MM), so the display value is both the safer and
 * the truer answer to "what does the sheet say".
 */
function grid(name) {
  var sheet = sheetNamed(name);
  var rows = sheet.getLastRow();
  var cols = sheet.getLastColumn();
  if (rows < 1 || cols < 1) return [];
  return sheet.getRange(1, 1, rows, cols).getDisplayValues();
}

function configValue(key) {
  var rows = grid(TAB.config);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === key) return String(rows[i][1]).trim();
  }
  return '';
}

// ---------------------------------------------------------------------- read

/**
 * The three human-written tabs, raw.
 *
 * `token` is dropped. doGet is public — that is what "Zugriff: Jeder" means —
 * so handing the admin secret to anyone who knows the URL would make the token
 * check below decorative. The endpoint is left in: whoever is reading this is
 * already talking to it.
 */
function doGet() {
  try {
    var config = grid(TAB.config).filter(function (row) {
      return String(row[0]).trim().toLowerCase() !== 'token';
    });
    return json({ ok: true, config: config, teams: grid(TAB.teams), plan: grid(TAB.plan) });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// --------------------------------------------------------------------- write

/**
 * Replace a tab's contents with `rows`, padded to a rectangle.
 *
 * clearContents, not clear: the organizer's column widths, colours and frozen
 * header survive a regenerated schedule. Only the values are ours.
 */
function replace(name, rows, textColumns) {
  var sheet = sheetNamed(name);
  sheet.clearContents();
  if (!rows || !rows.length) return 0;

  var width = 0;
  for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
  if (!width) return 0;

  var padded = rows.map(function (row) {
    var out = row.slice();
    while (out.length < width) out.push('');
    return out;
  });

  // Format before writing, or Sheets has already read "09:14" as a time by the
  // time the column is told to hold text.
  var header = padded[0] || [];
  (textColumns || []).forEach(function (wanted) {
    for (var c = 0; c < header.length; c++) {
      if (String(header[c]).trim() === wanted) {
        sheet.getRange(1, c + 1, sheet.getMaxRows()).setNumberFormat('@');
      }
    }
  });

  sheet.getRange(1, 1, padded.length, width).setValues(padded);
  return padded.length - 1;
}

/**
 * Patch rows of `Spielplan` addressed by `nr`, and by column name.
 *
 * Read everything, change it in memory, write it back in one call. Cell by cell
 * would be one API round trip per field — 131 matches resolve into some 1800 of
 * them, which is a minute of an organizer standing in the sun.
 *
 * That the whole range is rewritten is safe because the caller holds the
 * document lock: within it, read-modify-write is the transaction. Between the
 * app and a person typing into the sheet in the same second it is not, and
 * nothing here pretends otherwise.
 */
function patch(rows) {
  var sheet = sheetNamed(TAB.plan);
  var height = sheet.getLastRow();
  var width = sheet.getLastColumn();
  if (height < 2 || width < 1) throw new Error('Der Spielplan ist leer.');

  var range = sheet.getRange(1, 1, height, width);
  var values = range.getValues();

  var header = values[0].map(function (h) { return String(h).trim(); });
  var nrAt = header.indexOf('nr');
  if (nrAt < 0) throw new Error('Im Spielplan fehlt die Spalte „nr“.');

  var rowOf = {};
  for (var i = 1; i < values.length; i++) {
    var nr = String(values[i][nrAt]).trim();
    if (nr) rowOf[nr] = i;
  }

  var written = 0, missing = 0;
  (rows || []).forEach(function (row) {
    var i = rowOf[String(row.nr).trim()];
    if (i == null) { missing++; return; }
    for (var key in row) {
      if (key === 'nr' || !row.hasOwnProperty(key)) continue;
      var c = header.indexOf(key);
      if (c < 0) continue;
      values[i][c] = row[key] == null ? '' : row[key];
      written++;
    }
  });

  range.setValues(values);
  return { written: written, missing: missing };
}

/**
 * Every write comes through here: token first, then the lock, then the ranges.
 *
 * An empty `token` in Config rejects everything. A template nobody has
 * configured must not be a spreadsheet the whole internet can write to.
 */
function doPost(e) {
  var lock = LockService.getDocumentLock();
  try {
    lock.waitLock(LOCK_MS);
  } catch (err) {
    return json({ ok: false, error: 'Die Tabelle wird gerade beschrieben. Bitte noch einmal senden.' });
  }

  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = configValue('token');

    if (!token) {
      return json({ ok: false, error: 'In „Config“ steht kein Kennwort („token“). Es wird nichts geschrieben.' });
    }
    if (String(req.token || '') !== token) {
      return json({ ok: false, error: 'Falsches oder fehlendes Kennwort.' });
    }

    if (req.action === 'ping') {
      return json({ ok: true, title: configValue('title') });
    }

    if (req.action === 'plan') {
      var teams = replace(TAB.teams, req.teams, req.text);
      var plan = replace(TAB.plan, req.plan, req.text);
      replace(TAB.web, req.web, []);
      return json({ ok: true, teams: teams, matches: plan });
    }

    if (req.action === 'save') {
      var result = patch(req.rows);
      replace(TAB.web, req.web, []);
      return json({ ok: true, cells: result.written, missing: result.missing });
    }

    return json({ ok: false, error: 'Unbekannter Auftrag „' + String(req.action) + '“.' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
