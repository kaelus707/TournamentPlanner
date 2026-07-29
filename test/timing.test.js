/*
 * Tests for timeline() / currentRound() — SPEC.md §6.1, validated against the
 * 2026 fixture (§11).
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. The v1 files still carry the clock time of every round, so
 *      2026 is a complete oracle for the planned-time half: all 34 round
 *      starts must fall out of start, matchMin, semiMin and seven breaks. The
 *      fixture carries no `doneAt` stamps, so it also exercises the fallback
 *      path and must show zero drift throughout.
 *
 *   B. Hand-built data for everything the fixture cannot show: a round that
 *      overruns, one that finishes early, the open-ended final, and which
 *      round counts as current.
 */
const TimingTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  const at = (rows, round) => {
    const r = rows.find(x => x.round === round);
    assert(r, `Runde ${round} fehlt`);
    return r;
  };

  /*
   * The 2026 configuration, reconstructed from the fixture's own clock times.
   * Rounds ran 10 minutes, the two semi-finals 12, the final open-ended, with
   * seven breaks anchored to round indices — the v1 file wrote those as clock
   * ranges ("11:00–11:05"), which is exactly what §3.1 replaces.
   */
  const CFG_2026 = {
    start: '09:00', courts: 5, matchMin: 10, semiMin: 12, finalMode: 'set',
    breaks: [
      { afterRound: 12, min: 5,  label: 'Platzpflege' },
      { afterRound: 20, min: 5,  label: 'Platzpflege nach Gruppenphase' },
      { afterRound: 20, min: 10, label: 'Reserveblock' },
      { afterRound: 22, min: 5,  label: 'Platzpflege' },
      { afterRound: 31, min: 5,  label: 'Platzpflege' },
      { afterRound: 32, min: 5,  label: 'Platzpflege' },
      { afterRound: 33, min: 5,  label: 'Platzpflege vor dem Finale' },
    ],
  };

  // ------------------------------------------------------- builders for §B

  /** A match in a round. Pass { status, doneAt, phase } for the live cases. */
  const match = (nr, round, extra) => Object.assign({
    nr, round, court: 1, phase: 'Gruppe', label: 'Test',
    aRef: '', bRef: '', aTeam: null, bTeam: null,
    sa: null, sb: null, status: 'open', wo: null, doneAt: '',
  }, extra);

  const done = (nr, round, doneAt, extra) =>
    match(nr, round, Object.assign({ status: 'done', sa: 6, sb: 3, doneAt }, extra));

  const PLAIN = { start: '09:00', courts: 2, matchMin: 10, semiMin: 12, finalMode: 'set' };

  // ------------------------------------------------------------------ suite

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
    const rows = E.timeline(web.matches, CFG_2026);

    summary.roundCount = rows.length;
    summary.expected = web.roundStarts;
    summary.got = rows.map(r => E.hhmm(r.planned));
    summary.mismatches = summary.got
      .map((t, i) => ({ round: i + 1, got: t, want: web.roundStarts[i] }))
      .filter(x => x.got !== x.want);
    summary.rows = rows;

    test('Fixture: 34 Runden', () => {
      eq(rows.length, 34, 'Runden');
      return '34 Runden aus 131 Spielen';
    });

    test('Fixture: alle 34 Startzeiten stimmen mit dem Spielplan 2026 überein', () => {
      eq(summary.mismatches.length, 0,
        'Abweichungen' + (summary.mismatches.length
          ? ' — ' + summary.mismatches.map(x => `R${x.round}: ${x.got} statt ${x.want}`).join(', ')
          : ''));
      return `09:00 … ${summary.got[summary.got.length - 1]}, keine Abweichung`;
    });

    test('Fixture: die Pause nach Runde 12 verschiebt Runde 13 auf 11:05', () => {
      eq(E.hhmm(at(rows, 12).planned), '10:50', 'Start Runde 12');
      eq(E.hhmm(at(rows, 13).planned), '11:05', 'Start Runde 13');
      return '10:50 + 10 Min Spiel + 5 Min Platzpflege';
    });

    test('Fixture: die zwei Pausen nach Runde 20 ergeben zusammen 15 Minuten', () => {
      eq(E.hhmm(at(rows, 20).planned), '12:15', 'Start Runde 20');
      eq(E.hhmm(at(rows, 21).planned), '12:40', 'Start Runde 21');
      return '12:15 + 10 + 5 + 10 = 12:40';
    });

    test('Fixture: die Halbfinalrunden dauern 12 Minuten statt 10', () => {
      eq(at(rows, 31).duration, 12, 'Dauer Runde 31');
      eq(at(rows, 32).duration, 12, 'Dauer Runde 32');
      eq(at(rows, 33).duration, 10, 'Dauer Runde 33');
      eq(E.hhmm(at(rows, 32).planned), '14:42', 'Start Runde 32');
      return 'HF 12 Min, Spiel um Platz 3 wieder 10';
    });

    test('Fixture: das Finale bleibt offen', () => {
      const final = at(rows, 34);
      eq(final.duration, null, 'Dauer');
      eq(final.end, null, 'Ende');
      eq(final.open, true, 'offen');
      eq(E.hhmm(final.planned), '15:14', 'Start');
      return 'finalMode "set" → 15:14 ohne berechnetes Ende';
    });

    test('Fixture: ohne doneAt-Stempel entsteht kein Verzug', () => {
      const drifted = rows.filter(r => r.delta !== 0);
      eq(drifted.length, 0, 'Runden mit Verzug');
      return 'Rückfall auf die berechnete Dauer, wie vorgesehen';
    });

    test('Fixture: alle Runden gelten als gespielt, es gibt keine aktuelle Runde', () => {
      eq(rows.filter(r => !r.complete).length, 0, 'offene Runden');
      eq(E.currentRound(rows), null, 'aktuelle Runde');
      return 'ein abgeschlossenes Turnier hat kein „Jetzt“';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Ohne Ergebnisse laufen geplante und echte Zeit gleich', () => {
      const t = E.timeline([match(1, 1), match(2, 2)], PLAIN);
      eq(E.hhmm(at(t, 1).start), '09:00', 'Runde 1');
      eq(E.hhmm(at(t, 2).start), '09:10', 'Runde 2');
      eq(at(t, 2).delta, 0, 'Verzug');
      return '09:00 / 09:10';
    });

    test('Eine überzogene Runde schiebt die folgende nach hinten', () => {
      // Runde 1 ist um 09:14 fertig statt um 09:10.
      const t = E.timeline([done(1, 1, '09:14'), match(2, 2)], PLAIN);
      eq(E.hhmm(at(t, 1).end), '09:14', 'Ende Runde 1');
      eq(E.hhmm(at(t, 2).start), '09:14', 'Start Runde 2');
      eq(at(t, 2).delta, 4, 'Verzug');
      return '+4 Min';
    });

    test('Die zuletzt eingetragene Zeit der Runde zählt', () => {
      const t = E.timeline([
        done(1, 1, '09:11'), done(2, 1, '09:17'), done(3, 1, '09:08'),
        match(4, 2),
      ], PLAIN);
      eq(E.hhmm(at(t, 1).end), '09:17', 'Ende Runde 1');
      return 'das späteste Ergebnis schließt die Runde';
    });

    test('Eine früh beendete Runde zieht die nächste nicht vor', () => {
      // Runde 1 ist schon um 09:06 fertig, Runde 2 startet trotzdem planmäßig.
      const t = E.timeline([done(1, 1, '09:06'), match(2, 2)], PLAIN);
      eq(E.hhmm(at(t, 2).start), '09:10', 'Start Runde 2');
      eq(at(t, 2).delta, 0, 'Verzug');
      return 'max(Plan, Ende der Vorrunde) — nie vor dem Plan';
    });

    test('Eine unvollständige Runde bekommt keinen Stempel', () => {
      const t = E.timeline([done(1, 1, '09:14'), match(2, 1)], PLAIN);
      eq(at(t, 1).complete, false, 'vollständig');
      eq(E.hhmm(at(t, 1).end), '09:10', 'Ende');
      return 'ein Ergebnis von zweien ist keine fertige Runde';
    });

    test('Verzug pflanzt sich fort, bis eine Pause ihn auffängt', () => {
      const cfg = Object.assign({}, PLAIN, {
        breaks: [{ afterRound: 2, min: 15, label: 'Pause' }],
      });
      const t = E.timeline([done(1, 1, '09:16'), done(2, 2, '09:26'), match(3, 3)], cfg);
      eq(at(t, 2).delta, 6, 'Verzug Runde 2');
      // Plan für Runde 3: 09:00 + 10 + 10 + 15 Pause = 09:35, echtes Ende 09:26.
      eq(E.hhmm(at(t, 3).start), '09:35', 'Start Runde 3');
      eq(at(t, 3).delta, 0, 'Verzug Runde 3');
      return 'die Pause schluckt die 6 Minuten';
    });

    test('Ein Finale mit Minutenangabe ist nicht offen', () => {
      const cfg = Object.assign({}, PLAIN, { finalMode: '20' });
      const t = E.timeline([match(1, 1, { phase: 'Finale' })], cfg);
      eq(at(t, 1).duration, 20, 'Dauer');
      eq(E.hhmm(at(t, 1).end), '09:20', 'Ende');
      eq(at(t, 1).open, false, 'offen');
      return 'finalMode "20" → 20 Minuten';
    });

    test('Die aktuelle Runde ist die erste unfertige, nicht die erste späte', () => {
      // Runde 1 ist gespielt, Runde 2 hat ein offenes Spiel, Runde 3 ist fertig.
      const t = E.timeline([
        done(1, 1, '09:10'),
        done(2, 2, '09:20'), match(3, 2),
        done(4, 3, '09:30'),
      ], PLAIN);
      eq(E.currentRound(t).round, 2, 'aktuelle Runde');
      return 'genau der 2026-Bug: ein offenes Spiel bestimmt „Jetzt“';
    });

    test('Ohne Startzeit gibt es keine Zeiten, aber weiter Runden', () => {
      const t = E.timeline([match(1, 1), match(2, 2)], { matchMin: 10 });
      eq(t.length, 2, 'Runden');
      eq(at(t, 1).planned, null, 'geplant');
      eq(E.hhmm(at(t, 1).planned), '', 'Anzeige');
      return 'fehlende Konfiguration erfindet keine Uhrzeit';
    });

    test('hhmm rechnet nicht über Mitternacht hinweg weg', () => {
      eq(E.hhmm(E.toMinutes('09:05')), '09:05', 'Hin und zurück');
      eq(E.hhmm(1510), '25:10', 'nach Mitternacht');
      eq(E.toMinutes('Unfug'), null, 'unlesbar');
      return '25:10 statt 01:10';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TimingTests;
