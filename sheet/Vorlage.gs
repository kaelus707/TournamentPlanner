/*
 * The template builder — SPEC.md §3.
 *
 * ANLEITUNG.md used to open with "copy the template from Google Drive", which
 * assumed a template already existed. This file is that template: run once from
 * the menu on an empty spreadsheet, it produces the five tabs of §3 with their
 * headers, sensible defaults and a random token.
 *
 * Deliberately **not** part of Code.gs. Code.gs is the deployed write endpoint
 * and has to be re-versioned on every edit (ANLEITUNG.md §4); this runs from the
 * menu and is never deployed. Once a tournament is set up, this file may be
 * deleted from the script project without affecting anything.
 *
 * It writes only into empty tabs, so running it twice cannot destroy a filled-in
 * Teams list.
 *
 * This file owns onOpen. Code.gs has none.
 */
'use strict';

/** §3, in the order the tabs should appear. */
var TEMPLATE_TABS = ['Config', 'Teams', 'Spielplan', 'WEB', 'Anleitung'];

/**
 * §3.1. Every key the app knows, including the ones left empty on purpose —
 * an organizer who can see `logo` in column A does not have to read the spec to
 * find out it exists.
 *
 * `break` rows are not pre-filled. A leftover example pause would quietly
 * lengthen the day and shift every round after it, which is a bad trade for the
 * one thing it would demonstrate; the Anleitung tab shows the format instead.
 */
function templateConfigRows() {
  return [
    ['title', 'Bonsai Cup'],
    ['logo', ''],
    ['start', '09:00'],
    ['courts', '5'],
    ['matchMin', '10'],
    ['semiMin', '12'],
    ['finalMode', 'set'],
    ['groups', '4'],
    ['walkover', '2:0'],
    ['token', newToken()],
    ['endpoint', ''],
  ];
}

/** §3.2 and §3.3 — the header rows sheet.js looks its columns up by name in. */
var TEAM_HEADER = ['id', 'p1', 'p2', 'group', 'decider'];

var PLAN_HEADER = ['nr', 'round', 'court', 'phase', 'label', 'aRef', 'bRef',
  'aTeam', 'bTeam', 'sa', 'sb', 'status', 'wo', 'doneAt'];

/**
 * A token nobody has to think up (§2).
 *
 * No i/l/1/0/o: this ends up in the admin URL, and a token that survives being
 * read off one screen and typed into another phone is worth more than four extra
 * bits of entropy. Twenty characters of this alphabet is far past what a club
 * tournament needs — the threat model is honest people, not attackers.
 */
function newToken() {
  var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 20; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

// ------------------------------------------------------------------- plumbing

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Turnier')
    .addItem('Tabelle einrichten', 'setUpTemplate')
    .addToUi();
}

/** The tab, made if it is not there yet. */
function tabNamed(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Empty means never written to: getLastRow is 0 on a fresh tab. */
function isBlank(sheet) {
  return sheet.getLastRow() === 0;
}

function writeHeader(sheet, header) {
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/** 1-based position, so the tabs end up in the order of §3. */
function moveTo(ss, sheet, position) {
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(position);
}

/** The value of a Config key, by display value, or '' if the key is not there. */
function templateConfigValue(sheet, key) {
  if (isBlank(sheet)) return '';
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), 2).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === key) return String(rows[i][1]).trim();
  }
  return '';
}

// ------------------------------------------------------------------- the tabs

/**
 * Column B holds text, always.
 *
 * `09:00` and `2:0` are both read by Sheets as times if the column is left on
 * automatic, and then reach the phone as an ISO timestamp from 1899 — the same
 * trap Code.gs avoids by reading display values. Formatting comes before
 * writing, because a cell that is already a time cannot be talked out of it.
 */
function fillConfig(sheet) {
  sheet.getRange('B:B').setNumberFormat('@');
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 320);

  if (isBlank(sheet)) {
    var rows = templateConfigRows();
    sheet.getRange(1, 1, rows.length, 2).setValues(rows);
    return 'angelegt';
  }
  return addMissingConfigKeys(sheet);
}

/**
 * Append keys the app knows and this Config does not.
 *
 * For a sheet set up before a key existed. Present-but-empty counts as present,
 * so a `token` row the organizer deliberately cleared stays cleared — that is
 * how §2 turns writing off, and re-enabling it behind their back would be a
 * surprise of the worst kind.
 */
function addMissingConfigKeys(sheet) {
  var have = {};
  sheet.getRange(1, 1, sheet.getLastRow(), 1).getDisplayValues().forEach(function (row) {
    have[String(row[0]).trim().toLowerCase()] = true;
  });

  var missing = templateConfigRows().filter(function (row) {
    return !have[row[0].toLowerCase()];
  });
  if (!missing.length) return 'unverändert';

  sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  return missing.length + ' Schlüssel ergänzt';
}

/**
 * Header only — no example teams.
 *
 * sheet.js reads every row that has an `id` as a team, so a `T01 Muster Anna`
 * left in place would enter the draw as a real pair. The format belongs in the
 * Anleitung, where forgetting to delete it costs nothing.
 */
function fillTeams(sheet) {
  sheet.getRange('A:A').setNumberFormat('@');   // T01 stays T01, and 01 stays 01
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 180);

  // A warning, not a rule: the draw writes this column itself, and validation
  // that rejects values would make the app's own write fail.
  sheet.getRange('D2:D').setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['A', 'B', 'C', 'D'], true)
      .setAllowInvalid(true)
      .build());

  if (!isBlank(sheet)) return 'unverändert';
  writeHeader(sheet, TEAM_HEADER);
  return 'angelegt';
}

/**
 * The generator overwrites this tab wholesale, header included. It is written
 * here anyway: an organizer opening a fresh sheet should be able to see what
 * the schedule will look like before there is one.
 */
function fillPlan(sheet) {
  var doneAt = PLAN_HEADER.indexOf('doneAt') + 1;
  sheet.getRange(1, doneAt, sheet.getMaxRows()).setNumberFormat('@');  // §3.3: HH:MM

  if (!isBlank(sheet)) return 'unverändert';
  writeHeader(sheet, PLAN_HEADER);
  return 'angelegt';
}

/** §3.4. Generated output, so there is nothing to put in it. */
function fillWeb(sheet) {
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.setColumnWidth(1, 520);
  return isBlank(sheet) ? 'angelegt' : 'unverändert';
}

/**
 * §3.5. The short version on purpose.
 *
 * ANLEITUNG.md is the full text and stays the full text; copying all 170 lines
 * in here would be two guides drifting apart from the day after this is written.
 * What belongs in the sheet is what someone needs while looking at the sheet.
 */
function templateAnleitung() {
  return [
    'Kurzanleitung',
    '',
    'Diese Tabelle ist der Speicher für ein Turnier. Gerechnet wird alles in der App.',
    '',
    'DIE FÜNF BLÄTTER',
    'Config      Einstellungen. Schlüssel in Spalte A, Wert in Spalte B.',
    'Teams       Ein Team je Zeile.',
    'Spielplan   Schreibt die App. Einzelne Zellen dürfen von Hand korrigiert werden.',
    'WEB         Schreibt die App. Nicht von Hand ändern, wird jedes Mal neu erzeugt.',
    'Anleitung   Dieser Text.',
    '',
    'VOR DEM ERSTEN TURNIER',
    '1. In Config "title", "start" und "courts" anpassen.',
    '2. Teams eintragen, zwischen 16 und 32. "group" leer lassen, die Auslosung füllt sie.',
    '3. Erweiterungen -> Apps Script -> Bereitstellen -> Neue Bereitstellung -> Web-App,',
    '   "Ausführen als: Ich", "Zugriff: Jeder".',
    '4. Die angezeigte URL (endet auf /exec) in Config bei "endpoint" eintragen.',
    '5. Datei -> Freigeben -> Im Web veröffentlichen, dort nur das Blatt WEB auswählen.',
    '',
    'DIE BEIDEN ADRESSEN',
    'Zuschauer        .../index.html?id=TABELLEN-ID',
    'Turnierleitung   .../round.html?id=TABELLEN-ID&k=KENNWORT',
    'Die Tabellen-ID steht in der Adresszeile: /spreadsheets/d/DIESE-ID/edit',
    '',
    'DAS KENNWORT',
    'Steht in Config bei "token" und wurde beim Einrichten zufällig erzeugt.',
    'Es darf geändert werden; dann ändert sich auch die Adresse der Turnierleitung.',
    'Ist die Zeile leer, wird nichts in die Tabelle geschrieben.',
    'Die Adresse der Turnierleitung enthält das Kennwort im Klartext — nicht weitergeben.',
    '',
    'PAUSEN',
    'Als zusätzliche Zeilen in Config: Schlüssel "break", Wert "nach Runde | Minuten | Text",',
    'zum Beispiel   6 | 5 | Platzpflege',
    'Pausen hängen an Runden, nicht an Uhrzeiten.',
    '',
    'NACH JEDER ÄNDERUNG AM SKRIPT',
    'Bereitstellen -> Bereitstellungen verwalten -> Bearbeiten -> Neue Version.',
    'Sonst läuft weiter der alte Stand.',
    '',
    'Die ausführliche Anleitung steht in ANLEITUNG.md im Ordner der App.',
  ];
}

function fillAnleitung(sheet) {
  sheet.setColumnWidth(1, 620);
  if (!isBlank(sheet)) return 'unverändert';

  var lines = templateAnleitung().map(function (line) { return [line]; });
  sheet.getRange(1, 1, lines.length, 1).setValues(lines);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return 'angelegt';
}

/**
 * The tab a new spreadsheet arrives with — "Tabellenblatt1", or "Sheet1", or
 * whatever the account language calls it.
 *
 * Only ever an untouched tab that is none of the five, so there is nothing in it
 * to lose. Anything the organizer has typed into keeps the sheet alive.
 */
function dropEmptyExtraTabs(ss) {
  ss.getSheets().forEach(function (sheet) {
    if (TEMPLATE_TABS.indexOf(sheet.getName()) >= 0) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) ss.deleteSheet(sheet);
  });
}

// ------------------------------------------------------------------ the entry

/** Build the template. Safe to run again on a sheet that is already set up. */
function setUpTemplate() {
  var ss = SpreadsheetApp.getActive();
  var fill = {
    Config: fillConfig,
    Teams: fillTeams,
    Spielplan: fillPlan,
    WEB: fillWeb,
    Anleitung: fillAnleitung,
  };

  var report = [];
  TEMPLATE_TABS.forEach(function (name, i) {
    var sheet = tabNamed(ss, name);
    report.push(name + ': ' + fill[name](sheet));
    moveTo(ss, sheet, i + 1);
  });

  dropEmptyExtraTabs(ss);

  var config = ss.getSheetByName('Config');
  var token = templateConfigValue(config, 'token');
  ss.setActiveSheet(config);

  var ui = SpreadsheetApp.getUi();
  ui.alert('Tabelle eingerichtet',
    report.join('\n')
      + '\n\nKennwort: ' + (token || '— keines, es wird nichts geschrieben')
      + '\n\nWeiter mit Schritt 2 im Blatt „Anleitung“: Titel, Startzeit und Plätze'
      + ' in „Config“ anpassen, dann die Teams eintragen.',
    ui.ButtonSet.OK);
}
