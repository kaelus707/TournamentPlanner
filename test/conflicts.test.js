/*
 * Tests for conflicts() — SPEC.md §7, validated against the 2026 fixture (§11).
 *
 * Two halves:
 *
 *   A. The fixture. 2026 is known-good, so it can only prove the quiet
 *      direction: conflicts() must report no errors on a schedule that really
 *      was played (§11). It cannot prove any check actually fires.
 *
 *   B. Hand-built bad data, one tiny world per check. Each asserts the exact
 *      set of codes produced, so a check that under-fires *or* over-fires
 *      fails the test.
 */
const ConflictsTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);
  const codesOf = list => [...new Set(list.map(i => i.code))].sort();

  const eqCodes = (list, want) => {
    const got = codesOf(list);
    assert(got.join(',') === [...want].sort().join(','),
      `erwartete Codes [${[...want].sort()}], bekommen [${got}]` +
      (list.length ? ` — ${list.map(i => i.message).join(' | ')}` : ''));
    return got.length ? got.join(', ') : 'keine Meldung';
  };

  // ------------------------------------------------------- builders for §B

  const team = (id, group, p1, p2) => ({ id, group, p1, p2 });

  const match = (nr, round, court, extra) => Object.assign({
    nr, round, court,
    phase: 'Gruppe', label: 'Test',
    aRef: '', bRef: '', aTeam: null, bTeam: null,
    sa: null, sb: null, status: 'open', wo: null,
  }, extra);

  /** A group-phase match between two known teams. */
  const pair = (nr, round, court, a, b, extra) =>
    match(nr, round, court, Object.assign({ aRef: `T:${a}`, bRef: `T:${b}`, aTeam: a, bTeam: b }, extra));

  // Four teams, one group, all surnames distinct so no §7 warning fires by accident.
  const FOUR = [
    team('A1', 'A', 'Adler Max', 'Berger Nina'),
    team('A2', 'A', 'Conrad Tom', 'Dorn Lea'),
    team('A3', 'A', 'Engel Ida', 'Frank Udo'),
    team('A4', 'A', 'Gross Ben', 'Huber Mia'),
  ];
  const SIX = FOUR.concat([
    team('A5', 'A', 'Immer Ken', 'Jung Ana'),
    team('A6', 'A', 'Klein Ova', 'Lang Piet'),
  ]);

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
    const teams = A.parseTeams(teamsText);
    const config = { courts: 5, matchMin: 10, groups: 4 };
    const found = E.conflicts(web.matches, teams, config);
    const errs = E.errors(found);
    const warns = E.warnings(found);

    summary.matches = web.matches.length;
    summary.teams = teams.length;
    summary.rounds = web.rounds;
    summary.errors = errs.length;
    summary.warnings = warns.length;
    summary.byCode = warns.reduce((a, w) => (a[w.code] = (a[w.code] || 0) + 1, a), {});
    summary.warningList = warns.map(w => w.message);

    test('Fixture: 30 Teams eingelesen', () => {
      eq(teams.length, 30, 'Teams');
      return '30 Teams';
    });

    test('Fixture: 131 Spiele eingelesen', () => {
      eq(web.matches.length, 131, 'Spiele');
      eq(web.meta.matches, 131, 'META-Spielzahl');
      return '131 Spiele, META stimmt überein';
    });

    test('Fixture: Runden aus Startzeiten rekonstruiert', () => {
      eq(web.rounds, 34, 'Runden');
      const perRound = new Map();
      for (const m of web.matches) perRound.set(m.round, (perRound.get(m.round) || 0) + 1);
      eq(Math.max(...perRound.values()), 5, 'größte Runde');
      return '34 Runden, höchstens 5 Spiele je Runde';
    });

    test('Fixture: alle Refs in symbolische Form übersetzt', () => {
      const bad = web.matches.filter(m =>
        [m.aRef, m.bRef].some(r => E.parseRef(r).kind === 'bad'));
      eq(bad.length, 0, 'nicht übersetzbare Refs');
      const unresolved = found.filter(i => i.code === 'ref-source-unknown');
      eq(unresolved.length, 0, 'Refs ohne auffindbare Quelle');
      return '262 Refs, alle auflösbar';
    });

    // The headline assertion of SPEC §11.
    test('Fixture: keine Fehler auf dem 2026-Spielplan (SPEC §11)', () => {
      assert(errs.length === 0,
        `${errs.length} Fehler: ${errs.slice(0, 5).map(e => e.message).join(' | ')}`);
      return 'conflicts() meldet 0 Fehler';
    });

    test('Fixture: keine Warnung zu Gruppengrößen (8/8/7/7)', () => {
      eq(warns.filter(w => w.code === 'group-size-spread').length, 0, 'Gruppengrößen-Warnungen');
      return 'Spannweite 1, wie erwartet';
    });

    // Proves the surname check actually ran against real data, not just that
    // the fixture stayed quiet: B2 "Gitschei senior" and B4 "Gitschei junior".
    test('Fixture: Nachnamen-Warnung für „Gitschei" in Gruppe B', () => {
      const hit = warns.find(w => w.code === 'duplicate-surname' && /Gruppe B.*Gitschei/.test(w.message));
      assert(hit, 'keine Warnung für Gitschei in Gruppe B gefunden');
      return hit.message;
    });

    // ---- B. hand-built bad data, one world per check -------------------

    test('Sauberer Mini-Spielplan meldet nichts', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 1, 2, 'A3', 'A4'),
        pair(3, 3, 1, 'A1', 'A3'),
        pair(4, 3, 2, 'A2', 'A4'),
      ], FOUR, { courts: 2 }), []));

    test('Team zweimal in derselben Runde → Fehler', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 1, 2, 'A1', 'A3'),
      ], FOUR, { courts: 2 }), ['team-twice-in-round']));

    test('Platz doppelt belegt → Fehler', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 1, 1, 'A3', 'A4'),
      ], FOUR, { courts: 2 }), ['court-double-booked']));

    test('Mehr Spiele als Plätze → Fehler', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 1, 2, 'A3', 'A4'),
        pair(3, 1, 3, 'A5', 'A6'),
      ], SIX, { courts: 2 }), ['round-over-capacity']));

    test('Team spielt in Folge-Runden → Warnung', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 2, 1, 'A1', 'A3'),
      ], FOUR, { courts: 2 }), ['consecutive-rounds']));

    test('W-Ref auf ein Spiel derselben Runde → Fehler', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        match(2, 1, 2, { phase: 'Platz', aRef: 'W:1' }),
      ], FOUR, { courts: 2 }), ['ref-not-decided']));

    test('Gruppen-Ref, solange die Gruppe noch spielt → Fehler', () => eqCodes(
      E.conflicts([
        pair(1, 1, 1, 'A1', 'A2'),
        pair(2, 2, 1, 'A3', 'A4'),
        match(3, 2, 2, { phase: 'Platz', aRef: 'G:A:1' }),
      ], FOUR, { courts: 2 }), ['ref-not-decided']));

    test('Unbekannte Ref-Form → Fehler', () => eqCodes(
      E.conflicts([match(1, 1, 1, { aRef: 'X:99' })], FOUR, { courts: 2 }), ['ref-malformed']));

    test('Ref auf ein Team, das es nicht gibt → Fehler', () => eqCodes(
      E.conflicts([match(1, 1, 1, { aRef: 'T:Z9' })], FOUR, { courts: 2 }), ['unknown-team']));

    test('Ref auf ein Spiel, das es nicht gibt → Warnung', () => eqCodes(
      E.conflicts([match(1, 1, 1, { aRef: 'W:999' })], FOUR, { courts: 2 }), ['ref-source-unknown']));

    test('Gruppenspiel zwischen zwei Gruppen → Fehler', () => eqCodes(
      E.conflicts([pair(1, 1, 1, 'A1', 'B1')], [
        team('A1', 'A', 'Adler Max', 'Berger Nina'),
        team('A2', 'A', 'Conrad Tom', 'Dorn Lea'),
        team('B1', 'B', 'Engel Ida', 'Frank Udo'),
        team('B2', 'B', 'Gross Ben', 'Huber Mia'),
      ], { courts: 2 }), ['cross-group-match']));

    test('Gruppengrößen weichen um mehr als eins ab → Warnung', () => eqCodes(
      E.conflicts([], FOUR.concat([
        team('B1', 'B', 'Meier Ute', 'Nolte Kai'),
        team('B2', 'B', 'Otto Sven', 'Peters Ria'),
      ]), { courts: 2 }), ['group-size-spread']));

    test('Gleicher Nachname in zwei Teams einer Gruppe → Warnung', () => eqCodes(
      E.conflicts([], [
        team('A1', 'A', 'Gitschei senior', 'Berger Nina'),
        team('A2', 'A', 'Gitschei junior', 'Dorn Lea'),
        team('A3', 'A', 'Engel Ida', 'Frank Udo'),
        team('A4', 'A', 'Gross Ben', 'Huber Mia'),
      ], { courts: 2 }), ['duplicate-surname']));

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ConflictsTests;
