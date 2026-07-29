/*
 * Tests for standings() — SPEC.md §5.4, validated against the 2026 fixture (§11).
 *
 * Two halves, same split as conflicts.test.js:
 *
 *   A. The fixture. 2026 recorded its own four group tables, so unlike
 *      conflicts() this half is a real oracle: every Sp/S/U/N/Diff/Pkt and
 *      every rank must come back identical, including the A2/A4 and B2/B7
 *      ties the spec singles out (§11).
 *
 *   B. Hand-built data, one tiny world per rule. The fixture happens to
 *      contain no walkover, no manual decider and no unresolved tie, so the
 *      only way to prove those paths work is to build them.
 */
const StandingsTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  /** The row for one team, or a clear failure if the table does not have it. */
  const row = (table, id) => {
    const r = table.find(x => x.id === id);
    assert(r, `${id} steht nicht in der Tabelle`);
    return r;
  };

  /** Team ids of one group, in rank order. */
  const order = (table, group) =>
    table.filter(r => r.group === group).sort((a, b) => a.rank - b.rank).map(r => r.id);

  // ------------------------------------------------------- builders for §B

  const team = (id, group, extra) =>
    Object.assign({ id, group, p1: `${id} Vorne`, p2: `${id} Hinten` }, extra);

  /** A played group match. Pass { wo } or omit the scores for the open cases. */
  const played = (nr, a, b, sa, sb, extra) => Object.assign({
    nr, round: nr, court: 1, phase: 'Gruppe', label: 'Gruppe A',
    aRef: `T:${a}`, bRef: `T:${b}`, aTeam: a, bTeam: b,
    sa, sb, status: 'done', wo: null,
  }, extra);

  const FOUR = ['A1', 'A2', 'A3', 'A4'].map(id => team(id, 'A'));
  const SIX = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(id => team(id, 'A'));
  const CFG = { courts: 2, walkover: '2:0' };

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
    const config = { courts: 5, matchMin: 10, groups: 4, walkover: '2:0' };
    const table = E.standings(web.matches, teams, config);

    // The fixture's own G lines, keyed the same way, are the thing to match.
    const expected = new Map(web.standings.map(g => [g.team, g]));

    summary.rows = table.length;
    summary.groups = [...new Set(table.map(r => r.group))].sort();
    summary.tied = table.filter(r => r.tied).map(r => r.id);
    summary.tables = summary.groups.map(g => ({
      group: g,
      rows: table.filter(r => r.group === g).sort((a, b) => a.rank - b.rank),
    }));

    test('Fixture: 30 Zeilen, Gruppen 8/8/7/7', () => {
      eq(table.length, 30, 'Zeilen');
      const sizes = summary.groups.map(g => table.filter(r => r.group === g).length);
      eq(sizes.join('/'), '8/8/7/7', 'Gruppengrößen');
      return 'A:8 B:8 C:7 D:7';
    });

    test('Fixture: Sp/S/U/N/Diff/Pkt stimmen für alle 30 Teams', () => {
      for (const r of table) {
        const want = expected.get(r.id);
        assert(want, `${r.id} kommt in den G-Zeilen des Fixtures nicht vor`);
        for (const key of ['sp', 's', 'u', 'n', 'diff', 'pkt']) {
          eq(r[key], want[key], `${r.id} ${key.toUpperCase()}`);
        }
      }
      return '30 Teams × 6 Werte identisch';
    });

    test('Fixture: Platzierung stimmt in allen vier Gruppen', () => {
      for (const g of summary.groups) {
        const want = web.standings
          .filter(x => x.group === g)
          .sort((a, b) => a.rank - b.rank)
          .map(x => x.team);
        eq(order(table, g).join(' '), want.join(' '), `Reihenfolge Gruppe ${g}`);
      }
      return summary.groups.map(g => `${g}: ${order(table, g).join(' ')}`).join(' · ');
    });

    test('Fixture: A4 vor A2 — punktgleich, entschieden auf Differenz (§11)', () => {
      const a4 = row(table, 'A4'), a2 = row(table, 'A2');
      eq(a4.pkt, a2.pkt, 'Punkte A4/A2');
      assert(a4.diff > a2.diff, `A4 muss die bessere Differenz haben (${a4.diff} vs ${a2.diff})`);
      eq(a4.rank, 1, 'Platz A4');
      eq(a2.rank, 2, 'Platz A2');
      return `beide ${a4.pkt} Pkt, Differenz ${a4.diff} vs ${a2.diff}`;
    });

    test('Fixture: B7 vor B2 — punktgleich, entschieden auf Differenz (§11)', () => {
      const b7 = row(table, 'B7'), b2 = row(table, 'B2');
      eq(b7.pkt, b2.pkt, 'Punkte B7/B2');
      assert(b7.diff > b2.diff, `B7 muss die bessere Differenz haben (${b7.diff} vs ${b2.diff})`);
      eq(b7.rank, 1, 'Platz B7');
      eq(b2.rank, 2, 'Platz B2');
      return `beide ${b7.pkt} Pkt, Differenz ${b7.diff} vs ${b2.diff}`;
    });

    test('Fixture: kein Gleichstand bleibt offen', () => {
      eq(summary.tied.length, 0, 'ungebrochene Gleichstände');
      return 'jeder Gleichstand wird von der Differenz gelöst';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Sieg 3, Unentschieden 1, Niederlage 0', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 6, 3),
        played(2, 'A3', 'A4', 5, 5),
      ], FOUR, CFG);
      eq(row(t, 'A1').pkt, 3, 'Sieger');
      eq(row(t, 'A2').pkt, 0, 'Verlierer');
      eq(row(t, 'A3').pkt, 1, 'Unentschieden');
      eq(row(t, 'A1').s, 1, 'S');
      eq(row(t, 'A2').n, 1, 'N');
      eq(row(t, 'A3').u, 1, 'U');
      return '3 / 1 / 0';
    });

    test('Differenz ist Tore für minus Tore gegen', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 6, 3),
        played(2, 'A1', 'A3', 2, 4),
      ], FOUR, CFG);
      const a1 = row(t, 'A1');
      eq(a1.sp, 2, 'Sp');
      eq(a1.diff, 1, 'Diff');       // (6+2) - (3+4)
      eq(row(t, 'A2').diff, -3, 'Diff A2');
      return 'A1 8:7 → +1';
    });

    test('Kampflos zählt mit dem konfigurierten Ergebnis', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', null, null, { wo: 'a' }),
      ], FOUR, { walkover: '2:0' });
      eq(row(t, 'A1').pkt, 3, 'Punkte Sieger');
      eq(row(t, 'A1').diff, 2, 'Differenz Sieger');
      eq(row(t, 'A2').diff, -2, 'Differenz Verlierer');
      eq(row(t, 'A2').sp, 1, 'Sp Verlierer');
      return '2:0 wie ein normales Ergebnis';
    });

    test('Kampflos sticht ein eingetragenes Ergebnis', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 9, 1, { wo: 'b' }),
      ], FOUR, { walkover: '2:0' });
      eq(row(t, 'A2').pkt, 3, 'Punkte A2');
      eq(row(t, 'A1').gf, 0, 'Tore A1');
      return 'A2 gewinnt 2:0, die 9:1 werden verworfen';
    });

    test('Kampflos ohne Konfiguration fällt auf 2:0 zurück', () => {
      eq(E.walkoverScore({}).join(':'), '2:0', 'Vorgabe');
      eq(E.walkoverScore({ walkover: '3:1' }).join(':'), '3:1', 'konfiguriert');
      return 'leer → 2:0';
    });

    test('Spiel ohne beide Ergebnisse zählt nicht', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 6, null),
        played(2, 'A3', 'A4', null, null, { status: 'playing' }),
      ], FOUR, CFG);
      for (const id of ['A1', 'A2', 'A3', 'A4']) eq(row(t, id).sp, 0, `Sp ${id}`);
      return 'halb eingetragen ist nicht gespielt';
    });

    test('Nur Gruppenspiele zählen', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 6, 3),
        played(2, 'A1', 'A3', 9, 0, { phase: 'Platz', label: 'Spiel um Platz 3' }),
      ], FOUR, CFG);
      eq(row(t, 'A1').sp, 1, 'Sp A1');
      eq(row(t, 'A1').diff, 3, 'Diff A1');
      return 'die Platzierungsrunde bleibt draußen';
    });

    test('Punktgleich → die Differenz entscheidet', () => {
      const t = E.standings([
        played(1, 'A1', 'A2', 7, 1),
        played(2, 'A3', 'A4', 4, 3),
      ], FOUR, CFG);
      eq(order(t, 'A').join(' '), 'A1 A3 A4 A2', 'Reihenfolge');
      return 'A1 (+6) vor A3 (+1)';
    });

    test('Punkt- und differenzgleich → die Siege entscheiden', () => {
      /*
       * Gleiche Punkte bei gleicher Differenz und verschiedener Siegzahl geht
       * nur mit verschiedener Spielzahl: bei gleich vielen Spielen legt die
       * Punktzahl die Siegzahl bereits fest. Die Spielzahl ist kein
       * Sortierkriterium (§5.4), das ist hier also erlaubt.
       *
       *   A1: Sieg 4:2, Niederlage 2:4        → 3 Pkt, Diff 0, 1 Sieg
       *   A2: drei Unentschieden 3:3          → 3 Pkt, Diff 0, 0 Siege
       */
      const t = E.standings([
        played(1, 'A1', 'A5', 4, 2),
        played(2, 'A1', 'A6', 2, 4),
        played(3, 'A2', 'A3', 3, 3),
        played(4, 'A2', 'A4', 3, 3),
        played(5, 'A2', 'A5', 3, 3),
      ], SIX, CFG);
      const a1 = row(t, 'A1'), a2 = row(t, 'A2');
      eq(a1.pkt, a2.pkt, 'Punkte');
      eq(a1.diff, a2.diff, 'Differenz');
      eq(a1.s, 1, 'Siege A1');
      eq(a2.s, 0, 'Siege A2');
      assert(a1.rank < a2.rank, `A1 muss vor A2 stehen (${a1.rank} vs ${a2.rank})`);
      eq(a1.tied, false, 'A1 gilt als entschieden');
      return `beide ${a1.pkt} Pkt und Diff ${a1.diff}, A1 gewinnt auf Siege`;
    });

    test('Alles gleich, aber ein manueller Entscheid → er sticht', () => {
      const teamsWithDecider = [
        team('A1', 'A'), team('A2', 'A', { decider: 1 }),
        team('A3', 'A'), team('A4', 'A'),
      ];
      const t = E.standings([
        played(1, 'A1', 'A3', 4, 2),
        played(2, 'A2', 'A4', 4, 2),
      ], teamsWithDecider, CFG);
      const a1 = row(t, 'A1'), a2 = row(t, 'A2');
      eq(a1.pkt, a2.pkt, 'Punkte');
      eq(a1.diff, a2.diff, 'Differenz');
      eq(a2.rank, 1, 'Platz A2');
      eq(a1.rank, 2, 'Platz A1');
      eq(a2.tied, false, 'A2 gilt als entschieden');
      return 'A2 steht vor A1, weil der Entscheid gesetzt ist';
    });

    test('Alles gleich, kein Entscheid → Gleichstand wird gemeldet', () => {
      const t = E.standings([
        played(1, 'A1', 'A3', 4, 2),
        played(2, 'A2', 'A4', 4, 2),
      ], FOUR, CFG);
      eq(row(t, 'A1').tied, true, 'A1 markiert');
      eq(row(t, 'A2').tied, true, 'A2 markiert');
      eq(order(t, 'A').join(' '), 'A1 A2 A3 A4', 'stabile Reihenfolge nach Code');
      return 'gemeldet statt still sortiert';
    });

    test('Noch kein Spiel → Nullzeilen ohne Gleichstandsmeldung', () => {
      const t = E.standings([], FOUR, CFG);
      eq(t.length, 4, 'Zeilen');
      eq(t.filter(r => r.tied).length, 0, 'Meldungen');
      eq(row(t, 'A1').sp, 0, 'Sp');
      return 'vor dem ersten Ergebnis ist nichts strittig';
    });

    test('Team ohne Gruppe steht in keiner Tabelle', () => {
      const t = E.standings([], FOUR.concat([team('X1', '')]), CFG);
      eq(t.length, 4, 'Zeilen');
      assert(!t.some(r => r.id === 'X1'), 'X1 darf nicht auftauchen');
      return 'ohne Gruppe keine Zeile';
    });

    test('Spiel mit unbekanntem Team zählt nicht', () => {
      const t = E.standings([played(1, 'A1', 'Z9', 6, 0)], FOUR, CFG);
      eq(row(t, 'A1').sp, 0, 'Sp A1');
      return 'conflicts() meldet es, standings() ignoriert es';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StandingsTests;
