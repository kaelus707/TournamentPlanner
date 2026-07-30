/*
 * Tests for the template builder — SPEC.md §3, sheet/Vorlage.gs.
 *
 * The point of these is one thing: **the template the script writes has to be a
 * template the app can read.** Vorlage.gs and sheet.js agree on nothing but a
 * handful of column and key names, and nothing at runtime would notice if they
 * stopped agreeing — a renamed header shows up as "Im Blatt „Teams“ fehlt die
 * Kopfzeile" on a Saturday morning. So the headers are compared against
 * sheet.js's own TEAM_COLUMNS and MATCH_COLUMNS, and the generated Config is put
 * through parseConfig and checked value by value.
 *
 * Node only, and the one suite that is. Vorlage.gs is an Apps Script file read
 * off disk; a browser test page opened over file:// cannot fetch it, so there is
 * no vorlage.test.html beside this file.
 *
 * Nothing here calls into SpreadsheetApp. Only the pure parts of Vorlage.gs are
 * pulled out — the row builders and the token — and those are the parts that
 * carry the contract.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const S = require('../sheet.js');

/**
 * The pure declarations of an Apps Script file.
 *
 * Vorlage.gs has no module system — it is a script Google loads as globals. Its
 * source is evaluated in a function scope instead, and only the declarations
 * that touch no Sheets API are handed back. `new Function` rather than eval
 * because the file opens with 'use strict', under which eval'd `var`s would not
 * survive into this scope.
 */
function loadVorlage() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sheet', 'Vorlage.gs'), 'utf8');
  const pick = 'return { TEMPLATE_TABS, TEAM_HEADER, PLAN_HEADER,'
    + ' templateConfigRows, templateAnleitung, newToken };';
  return new Function(source + '\n' + pick)();
}

const VorlageTests = (() => {
  'use strict';

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);
  const same = (got, want, what) => eq(JSON.stringify(got), JSON.stringify(want), what);

  /** SPEC §3.1, in the order of its table. */
  const CONFIG_KEYS = ['title', 'logo', 'start', 'courts', 'matchMin', 'semiMin',
    'finalMode', 'groups', 'walkover', 'token', 'endpoint'];

  function run() {
    const results = [];

    const test = (name, fn) => {
      try {
        const detail = fn();
        results.push({ name, pass: true, detail: detail || '' });
      } catch (err) {
        results.push({ name, pass: false, detail: err.message });
      }
    };

    const V = loadVorlage();
    const config = V.templateConfigRows();
    const keys = config.map(row => row[0]);

    // ---------------------------------------------------------------- §3 tabs

    test('die fünf Blätter von §3, in der Reihenfolge der Spezifikation', () => {
      same(V.TEMPLATE_TABS, ['Config', 'Teams', 'Spielplan', 'WEB', 'Anleitung'], 'Blätter');
    });

    // -------------------------------------------------------------- §3.1 Config

    test('Config enthält genau die Schlüssel aus §3.1', () => {
      same(keys, CONFIG_KEYS, 'Schlüssel');
    });

    test('jeder Config-Wert ist Text', () => {
      // Column B is formatted '@' before writing. A number here would be written
      // as a number, and the format would be a lie.
      config.forEach(([key, value]) =>
        assert(typeof value === 'string', `${key} ist ${typeof value}, nicht string`));
      return config.length + ' Zeilen';
    });

    test('keine Pausen-Zeile vorbelegt', () => {
      // A forgotten example break shifts every round after it (§6.1).
      eq(keys.indexOf('break'), -1, 'break-Zeile');
    });

    test('parseConfig() liest die Vorlage als §4-Config', () => {
      const c = S.parseConfig(config);
      eq(c.title, 'Bonsai Cup', 'title');
      eq(c.start, '09:00', 'start');
      eq(c.courts, 5, 'courts');
      eq(c.matchMin, 10, 'matchMin');
      eq(c.semiMin, 12, 'semiMin');
      eq(c.groups, 4, 'groups');
      eq(c.finalMode, 'set', 'finalMode');
      eq(c.walkover, '2:0', 'walkover');
      eq(c.logo, '', 'logo');
      eq(c.endpoint, '', 'endpoint');
      same(c.breaks, [], 'breaks');
    });

    test('start und walkover überleben als Text, nicht als Uhrzeit', () => {
      // The two values Sheets would read as times if column B were automatic.
      const c = S.parseConfig(config);
      assert(/^\d{2}:\d{2}$/.test(c.start), `start ist „${c.start}“`);
      assert(/^\d+:\d+$/.test(c.walkover), `walkover ist „${c.walkover}“`);
    });

    // ---------------------------------------------------------------- §2 token

    test('das Kennwort ist gesetzt, lang genug und gut abzulesen', () => {
      const token = S.parseConfig(config).token;
      eq(token.length, 20, 'Länge');
      assert(/^[a-z2-9]+$/.test(token), `Zeichen: „${token}“`);
      assert(!/[lio01]/.test(token), `verwechselbares Zeichen in „${token}“`);
      return token.replace(/./g, '·');
    });

    test('zwei Kennwörter sind nicht dasselbe', () => {
      const seen = new Set();
      for (let i = 0; i < 50; i++) seen.add(V.newToken());
      eq(seen.size, 50, 'verschiedene Kennwörter');
    });

    // ------------------------------------------------ §3.2 / §3.3 header rows

    test('die Kopfzeile von Teams ist die, die sheet.js sucht', () => {
      same(V.TEAM_HEADER, S.TEAM_COLUMNS, 'Teams-Kopfzeile');
    });

    test('die Kopfzeile von Spielplan ist die, die sheet.js sucht', () => {
      same(V.PLAN_HEADER, S.MATCH_COLUMNS, 'Spielplan-Kopfzeile');
    });

    test('parseTeams() liest ein Team unter der erzeugten Kopfzeile', () => {
      const teams = S.parseTeams([V.TEAM_HEADER, ['T01', 'Muster Anna', 'Muster Ben', 'A', '']]);
      eq(teams.length, 1, 'Teams');
      eq(teams[0].id, 'T01', 'id');
      eq(teams[0].p2, 'Muster Ben', 'p2');
      eq(teams[0].group, 'A', 'group');
      eq('decider' in teams[0], false, 'decider bleibt weg, wenn die Zelle leer ist');
    });

    test('die leere Vorlage hat null Teams, nicht ein leeres', () => {
      // §3.2 via sheet.js: a row without an id is a blank line. The template
      // ships no example team precisely so that this holds.
      same(S.parseTeams([V.TEAM_HEADER]), [], 'Teams');
    });

    test('parseMatches() liest ein Spiel unter der erzeugten Kopfzeile', () => {
      const row = ['1', '1', '3', 'Gruppe', 'Gruppe A', 'T:T01', 'T:T02',
        'T01', 'T02', '2', '1', 'done', '', '09:14'];
      const matches = S.parseMatches([V.PLAN_HEADER, row]);
      eq(matches.length, 1, 'Spiele');
      eq(matches[0].nr, 1, 'nr');
      eq(matches[0].court, 3, 'court');
      eq(matches[0].sa, 2, 'sa');
      eq(matches[0].status, 'done', 'status');
      eq(matches[0].doneAt, '09:14', 'doneAt');
    });

    test('der leere Spielplan ist leer', () => {
      same(S.parseMatches([V.PLAN_HEADER]), [], 'Spiele');
    });

    // --------------------------------------------------------- §3.5 Anleitung

    test('die Anleitung ist Text, eine Zeile je Zelle', () => {
      const lines = V.templateAnleitung();
      assert(lines.length > 10, `nur ${lines.length} Zeilen`);
      lines.forEach((line, i) =>
        assert(typeof line === 'string', `Zeile ${i + 1} ist kein Text`));
      assert(lines[0].trim() !== '', 'die erste Zeile ist leer');
      return lines.length + ' Zeilen';
    });

    test('die Anleitung passt in die Spaltenbreite', () => {
      // 620px at the default font is a little over 100 characters. A wrapped line
      // is not wrong in itself, but this text holds two columns apart with
      // spaces, and wrapping is what destroys that.
      const long = V.templateAnleitung().filter(line => line.length > 95);
      same(long, [], 'zu lange Zeilen');
    });

    test('die Anleitung erklärt das Pausen-Format, das Config nicht vorbelegt', () => {
      const text = V.templateAnleitung().join('\n');
      assert(text.indexOf('break') >= 0, '„break“ kommt nicht vor');
      assert(/nach Runde \| Minuten \| Text/.test(text), 'das Format fehlt');
    });

    return { results, summary: { keys, tabs: V.TEMPLATE_TABS } };
  }

  return { run };
})();

module.exports = VorlageTests;
