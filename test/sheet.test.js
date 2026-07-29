/*
 * Tests for webFormat() and the sheet seam — SPEC.md §3 and §8, build step 9.
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. The 2026 file is a WEB dump, so it is a direct oracle for
 *      the writer: its 30 G lines and 30 E lines are exactly what webFormat()
 *      has to produce from the same matches. They are compared character for
 *      character. The M lines cannot be — v1 wrote a clock time where v2 writes
 *      a round — so they are compared field by field instead.
 *
 *   B. Hand-built rows for the mapping of §3.1–3.3: what a blank cell means,
 *      what a hand-inserted column does, and that a schedule survives the round
 *      trip through the sheet unchanged.
 */
const SheetTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const S = (typeof TournamentSheet !== 'undefined') ? TournamentSheet : require('../sheet.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  const CFG = {
    title: 'Bonsai Cup 2026', logo: '',
    start: '09:00', courts: 5, matchMin: 10, semiMin: 12,
    finalMode: 'set', walkover: '2:0',
    breaks: [{ afterRound: 20, min: 5, label: 'Platzpflege' }],
  };

  const tagged = (lines, tag) => lines.filter(l => l.split('|')[0] === tag);

  // ---------------------------------------------------------- builders for B

  const team = (id, group) => ({ id, group, p1: id + ' Vorne', p2: id + ' Hinten' });

  const match = (nr, extra) => Object.assign({
    nr, round: 1, court: 1, phase: 'Gruppe', label: 'Gruppe A',
    aRef: '', bRef: '', aTeam: null, bTeam: null,
    sa: null, sb: null, status: 'open', wo: null, doneAt: '',
  }, extra);

  function run(webText, teamsText) {
    const results = [];
    const summary = {};

    const test = (name, fn) => {
      try {
        results.push({ name, pass: true, detail: fn() || '' });
      } catch (err) {
        results.push({ name, pass: false, detail: err.message });
      }
    };

    // ---- A. the 2026 fixture ------------------------------------------

    const web = A.parseWeb(webText);
    const teams = A.parseTeams(teamsText);
    const lines = E.webFormat(web.matches, teams, CFG);

    summary.lines = lines;
    summary.counts = {
      M: tagged(lines, 'M').length,
      G: tagged(lines, 'G').length,
      E: tagged(lines, 'E').length,
      P: tagged(lines, 'P').length,
    };

    const wanted = webText.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    test('Fixture: die Zeilen sind vollständig und richtig ausgezählt', () => {
      eq(summary.counts.M, 131, 'M-Zeilen');
      eq(summary.counts.G, 30, 'G-Zeilen');
      eq(summary.counts.E, 30, 'E-Zeilen');
      eq(summary.counts.P, 1, 'P-Zeilen');
      eq(lines[0], 'META|Bonsai Cup 2026|30|131|', 'META');
      return '131 Spiele, 4 Gruppentabellen, 30 Plätze';
    });

    test('Fixture: die C-Zeile trägt die Zeitwerte und kein Kennwort', () => {
      eq(lines[1], 'C|09:00|10|12|set', 'C-Zeile');
      assert(!lines.some(l => /token|endpoint/i.test(l)), 'Ein Geheimnis steht im WEB-Blatt.');
      return '§8: nur start, matchMin, semiMin, finalMode';
    });

    /*
     * The strongest check in the suite. The 2026 sheet computed its own group
     * tables with formulas; these come out of standings() and are written by
     * webFormat(). If one number differed, one of the two would be wrong — and
     * §11 says it is not the fixture.
     */
    summary.gWrong = [];
    const gotG = tagged(lines, 'G').slice().sort();
    const wantG = tagged(wanted, 'G').slice().sort();
    for (let i = 0; i < Math.max(gotG.length, wantG.length); i++) {
      if (gotG[i] !== wantG[i]) summary.gWrong.push({ got: gotG[i], want: wantG[i] });
    }

    test('Fixture: alle 30 G-Zeilen stimmen Zeichen für Zeichen mit dem Blatt von 2026', () => {
      eq(summary.gWrong.length, 0, 'abweichende G-Zeilen' + (summary.gWrong.length
        ? ` — „${summary.gWrong[0].got}“ statt „${summary.gWrong[0].want}“` : ''));
      return 'Sp, S, U, N, Diff und Pkt, in vier Gruppentabellen';
    });

    summary.eWrong = [];
    const gotE = tagged(lines, 'E');
    const byPlace = new Map(tagged(wanted, 'E').map(l => [l.split('|')[1], l]));
    for (const l of gotE) {
      const want = byPlace.get(l.split('|')[1]);
      if (l !== want) summary.eWrong.push({ got: l, want });
    }

    test('Fixture: alle 30 E-Zeilen stimmen Zeichen für Zeichen mit dem Blatt von 2026', () => {
      eq(summary.eWrong.length, 0, 'abweichende E-Zeilen' + (summary.eWrong.length
        ? ` — „${summary.eWrong[0].got}“ statt „${summary.eWrong[0].want}“` : ''));
      return 'Platz, Team, Gruppe und Herkunft, 1 bis 30';
    });

    /*
     * M lines cannot be compared as text: v1 wrote a clock time where v2 writes
     * a round, and its phases were the long German words. Everything the two
     * versions do share is compared field by field.
     */
    summary.mWrong = [];
    const wantM = new Map(tagged(wanted, 'M').map(l => [l.split('|')[1], l.split('|')]));
    for (const l of tagged(lines, 'M')) {
      const got = l.split('|');
      const want = wantM.get(got[1]);
      if (!want) { summary.mWrong.push({ nr: got[1], what: 'fehlt im Blatt' }); continue; }
      const same = [[3, 'Platz'], [5, 'Label'], [7, 'Team A'], [9, 'Team B'],
        [10, 'Satz A'], [11, 'Satz B'], [12, 'Code A'], [13, 'Code B']];
      for (const [i, what] of same) {
        if (got[i] !== want[i]) summary.mWrong.push({ nr: got[1], what, got: got[i], want: want[i] });
      }
      if (got[14] !== 'done') summary.mWrong.push({ nr: got[1], what: 'Status', got: got[14], want: 'done' });
    }

    test('Fixture: jede M-Zeile trägt dieselben Namen, Codes und Ergebnisse wie 2026', () => {
      eq(summary.mWrong.length, 0, 'abweichende Felder' + (summary.mWrong.length
        ? ` — Spiel ${summary.mWrong[0].nr} ${summary.mWrong[0].what}: `
          + `„${summary.mWrong[0].got}“ statt „${summary.mWrong[0].want}“` : ''));
      return '131 × 8 Felder plus Status';
    });

    test('Die Runde ersetzt die Uhrzeit, wie §8 es verlangt', () => {
      const first = tagged(lines, 'M')[0].split('|');
      const last = tagged(lines, 'M')[130].split('|');
      eq(first[2], '1', 'Runde von Spiel 1');
      eq(last[2], String(web.rounds), 'Runde des letzten Spiels');
      return `Runde 1 bis ${web.rounds} statt 09:00 bis ${web.roundStarts[web.rounds - 1]}`;
    });

    test('Die P-Zeile trägt Runde, Länge und Text', () => {
      eq(tagged(lines, 'P')[0], 'P|20|5|Platzpflege', 'P-Zeile');
      return '§8: an eine Runde gebunden, nicht an eine Uhrzeit';
    });

    test('Ein Walkover erscheint als der konfigurierte Spielstand', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const one = [match(1, { aRef: 'T:A1', bRef: 'T:A2', aTeam: 'A1', bTeam: 'A2',
        sa: 1, sb: 5, status: 'done', wo: 'a' })];
      const f = tagged(E.webFormat(one, t, CFG), 'M')[0].split('|');
      eq(f[10] + ':' + f[11], '2:0', 'Spielstand');
      return '§5.4: das Blatt zeigt, was die Tabelle zählt';
    });

    test('Ein Strich im Namen zerlegt keine Zeile', () => {
      const t = [{ id: 'A1', group: 'A', p1: 'Meier | Sepp', p2: 'Huber' }, team('A2', 'A')];
      const one = [match(1, { aRef: 'T:A1', bRef: 'T:A2', aTeam: 'A1', bTeam: 'A2' })];
      const f = tagged(E.webFormat(one, t, CFG), 'M')[0];
      eq(f.split('|').length, 15, 'Felder');
      eq(f.split('|')[7], 'Meier   Sepp / Huber', 'Name');
      return 'der Strich wird zum Leerzeichen, das Format bleibt heil';
    });

    // ---- B. die Tabellenblätter ----------------------------------------

    test('Config liest Schlüssel, Zahlen und wiederholte Pausen', () => {
      const cfg = S.parseConfig([
        ['title', 'Bonsai Cup 2027'],
        ['start', '09:00'],
        ['courts', '5'],
        ['break', '6 | 5 | Platzpflege'],
        ['break', '12 | 10 | Reserveblock'],
        ['', ''],
        ['notiz', 'nicht anfassen'],
      ]);
      eq(cfg.title, 'Bonsai Cup 2027', 'title');
      eq(cfg.courts, 5, 'courts');
      eq(typeof cfg.start, 'string', 'start bleibt Text');
      eq(cfg.breaks.length, 2, 'Pausen');
      eq(cfg.breaks[1].afterRound, 12, 'Runde der zweiten Pause');
      eq(cfg.breaks[1].min, 10, 'Länge der zweiten Pause');
      eq(cfg.breaks[1].label, 'Reserveblock', 'Text der zweiten Pause');
      eq(cfg.notiz, 'nicht anfassen', 'unbekannter Schlüssel');
      return '§3.1, Pausen an Runden gebunden';
    });

    test('Eine Pause ohne Runde wird nicht zur Pause in Runde 0', () => {
      eq(S.parseConfig([['break', ' | 5 | Kaputt']]).breaks.length, 0, 'Pausen');
      return 'lieber keine Pause als eine an der falschen Stelle';
    });

    test('Teams liest die Kopfzeile, nicht die Spaltenreihenfolge', () => {
      // Der Organisator hat sich eine eigene Spalte dazwischengeschoben.
      const list = S.parseTeams([
        ['id', 'Bezahlt', 'p1', 'p2', 'group', 'decider'],
        ['T01', 'ja', 'Muster Anna', 'Muster Ben', 'A', ''],
        ['T02', 'nein', 'Beispiel Cem', 'Beispiel Dana', 'B', '3'],
        ['', '', '', '', '', ''],
      ]);
      eq(list.length, 2, 'Teams');
      eq(list[0].p1, 'Muster Anna', 'p1');
      eq('decider' in list[0], false, 'leerer Entscheid');
      eq(list[1].decider, 3, 'gesetzter Entscheid');
      return 'Spalten nach Namen, §3.2';
    });

    test('Eine leere Ergebniszelle ist kein 0:0', () => {
      const ms = S.parseMatches([
        S.MATCH_COLUMNS,
        ['1', '1', '1', 'Gruppe', 'Gruppe A', 'T:T01', 'T:T02', 'T01', 'T02', '', '', '', '', ''],
        ['2', '1', '2', 'Gruppe', 'Gruppe A', 'T:T03', 'T:T04', 'T03', 'T04', '0', '0', 'done', '', '09:14'],
      ]);
      eq(ms[0].sa, null, 'offenes Spiel');
      eq(ms[0].status, 'open', 'Status ohne Angabe');
      eq(ms[1].sa, 0, 'eingetragene Null');
      eq(ms[1].doneAt, '09:14', 'Stempel');
      return '§5.4: das Spiel zählt erst mit beiden Ständen';
    });

    test('Ein unbekannter Status oder Walkover fällt auf den sicheren Wert zurück', () => {
      const ms = S.parseMatches([
        S.MATCH_COLUMNS,
        ['1', '1', '1', 'Gruppe', 'Gruppe A', '', '', '', '', '', '', 'verschoben', 'x', ''],
      ]);
      eq(ms[0].status, 'open', 'Status');
      eq(ms[0].wo, null, 'Walkover');
      return '§6.2: „verschoben“ ist kein Zustand, den das Blatt kennt';
    });

    test('Ein ganzer Spielplan übersteht den Weg durch das Blatt unverändert', () => {
      const list = [];
      for (const g of ['A', 'B', 'C', 'D']) for (let i = 1; i <= 5; i++) list.push(team(`${g}${i}`, g));
      const plan = E.schedule(list, Object.assign({}, CFG, { seed: 7 }));
      const before = E.resolve(plan.matches, list, CFG);

      // Field by field, not JSON.stringify: the sheet has no key order to
      // preserve, and comparing one would test the builder, not the mapping.
      const same = (got, want, keys, what) => {
        eq(got.length, want.length, what);
        got.forEach((row, i) => keys.forEach(k =>
          eq(row[k] == null ? '' : row[k], want[i][k] == null ? '' : want[i][k],
            `${what} ${i + 1}, ${k}`)));
      };

      same(S.parseMatches(S.matchGrid(before)), before, S.MATCH_COLUMNS, 'Spiele');
      same(S.parseTeams(S.teamGrid(list)), list, ['id', 'p1', 'p2', 'group'], 'Teams');
      return `${before.length} Spiele und 20 Teams, Feld für Feld gleich`;
    });

    test('Die Aktualisierung schickt jede Zeile mit ihrer Nummer', () => {
      const patches = S.matchPatches([
        match(2, { aTeam: 'A1', sa: 3, sb: 1, status: 'done', doneAt: '09:14' }),
        match(1),
      ]);
      eq(patches.length, 2, 'Zeilen');
      eq(patches[0].nr, 1, 'sortiert nach nr');
      eq(patches[1].sa, 3, 'Ergebnis');
      eq(patches[1].wo, '', 'leeres Feld statt null');
      return 'nr adressiert die Zeile, der Rest sind Zellen';
    });

    test('Das WEB-Blatt bekommt eine Zeile je Zeile', () => {
      const rows = S.webGrid(['META|x|1|1|', 'M|1|1|1|Gruppe|Gruppe A|||||||||open']);
      eq(rows.length, 2, 'Zeilen');
      eq(rows[0].length, 1, 'Spalten');
      return 'eine Spalte, so wie 2026';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SheetTests;
