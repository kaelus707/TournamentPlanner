/*
 * Tests for allocation() and its parts — SPEC.md §5.1, §5.2, §5.5, validated
 * against the 2026 fixture (§11).
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. 2026 is a full oracle: 30 teams must split 8/8/7/7 into 98
 *      group matches and 33 endrunde matches, and the round counts must come
 *      out at the ones the day actually used. The fixture ran its group phase
 *      on 5 courts and its endrunde on 3 — see the court numbers in the M
 *      lines — so each half is asked at the court count it really had.
 *
 *   B. Hand-built for what the fixture cannot show: the other team counts, the
 *      singleton merge, the refusal outside 16–32, and what the finish time
 *      does when courts are added.
 */
const AllocationTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  const sizesOf = p => p.groups.map(g => g.size).join('/');
  const bucketSizes = p => p.buckets.map(b => b.size).join('/');

  /* The 2026 configuration, the same one timing.test.js reconstructs. */
  const CFG_2026 = {
    start: '09:00', matchMin: 10, semiMin: 12, finalMode: 'set',
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

  const PLAIN = { start: '09:00', matchMin: 10, semiMin: 12, finalMode: 'set' };

  const plan = (teams, courts, config) =>
    E.allocation(Object.assign({ teams, courts }, config || PLAIN));

  /*
   * SPEC §5.1. The match column is the rule printed one line below that table
   * read out loud — Σ m(m-1)/2 over the four groups — not a second source.
   */
  const SPEC_TABLE = [
    { teams: 21, sizes: '6/5/5/5', matches: 45 },
    { teams: 22, sizes: '6/6/5/5', matches: 50 },
    { teams: 23, sizes: '6/6/6/5', matches: 55 },
    { teams: 24, sizes: '6/6/6/6', matches: 60 },
    { teams: 30, sizes: '8/8/7/7', matches: 98 },
  ];

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
    const teams2026 = A.parseTeams(teamsText);

    const fixtureSizes = new Map();
    for (const t of teams2026) fixtureSizes.set(t.group, (fixtureSizes.get(t.group) || 0) + 1);
    const fixtureGroupMatches = web.matches.filter(m => m.phase === 'Gruppe').length;
    const fixtureEndMatches = web.matches.length - fixtureGroupMatches;

    const wide = plan(30, 5, CFG_2026);     // the group phase, as it ran
    const narrow = plan(30, 3, CFG_2026);   // the endrunde, as it ran

    summary.wide = wide;
    summary.narrow = narrow;

    test('Fixture: 30 Teams ergeben die Gruppen 8/8/7/7', () => {
      eq(sizesOf(wide), '8/8/7/7', 'Gruppengrößen');
      eq([...fixtureSizes.keys()].sort().join(''), 'ABCD', 'Gruppen im Fixture');
      for (const g of wide.groups) eq(fixtureSizes.get(g.group), g.size, `Gruppe ${g.group} im Fixture`);
      return 'gerechnet und im Fixture gleich';
    });

    test('Fixture: 98 Gruppenspiele', () => {
      eq(wide.groupMatches, 98, 'Gruppenspiele');
      eq(fixtureGroupMatches, 98, 'Gruppenspiele im Fixture');
      return '28 + 28 + 21 + 21';
    });

    test('Fixture: 33 Endrundenspiele, zusammen 131', () => {
      eq(wide.endMatches, 33, 'Endrundenspiele');
      eq(fixtureEndMatches, 33, 'Endrundenspiele im Fixture');
      eq(wide.matches, web.matches.length, 'Spiele gesamt');
      return '12 + 4×5 + 1 = 33';
    });

    test('Fixture: die Gruppenphase braucht auf 5 Plätzen 20 Runden', () => {
      eq(wide.groupRounds, 20, 'Runden der Gruppenphase');
      return 'genau die Runden 1–20 des Spielplans 2026';
    });

    test('Fixture: die Endrunde braucht auf 3 Plätzen 14 Runden', () => {
      eq(narrow.endRounds, 14, 'Runden der Endrunde');
      return 'genau die Runden 21–34 des Spielplans 2026';
    });

    test('Fixture: die Töpfe teilen die Plätze 1–30 lückenlos auf', () => {
      eq(bucketSizes(wide), '8/4/4/4/4/4/2', 'Topfgrößen');
      const ranges = wide.buckets.map(b => `${b.firstPlace}–${b.lastPlace}`).join(', ');
      eq(ranges, '1–8, 9–12, 13–16, 17–20, 21–24, 25–28, 29–30', 'Platzbereiche');
      eq(web.placements.length, 30, 'Platzierungen im Fixture');
      return ranges;
    });

    test('Fixture: 34 Runden enden mit einem Finale ab 15:14', () => {
      // Die echten 34 Runden von 2026, nicht die geschätzten.
      const clock = E.plannedFinish(34, CFG_2026);
      eq(E.hhmm(clock.finalStart), '15:14', 'Start des Finales');
      eq(clock.finish, null, 'Ende');
      return 'dieselbe Zeit, die timeline() aus dem echten Spielplan zieht';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Die Gruppentabelle aus §5.1 stimmt Zeile für Zeile', () => {
      for (const row of SPEC_TABLE) {
        const p = plan(row.teams, 5);
        eq(sizesOf(p), row.sizes, `${row.teams} Teams, Gruppen`);
        eq(p.groupMatches, row.matches, `${row.teams} Teams, Gruppenspiele`);
      }
      return SPEC_TABLE.map(r => `${r.teams}: ${r.sizes}`).join(', ');
    });

    test('§5.5: 24 Teams ergeben 28 Endrundenspiele', () => {
      const p = plan(24, 5);
      eq(bucketSizes(p), '8/4/4/4/4', 'Topfgrößen');
      eq(p.endMatches, 28, 'Endrundenspiele');
      return '12 + 4 + 4 + 4 + 4';
    });

    test('Ein einzelnes Team im letzten Topf rutscht nach oben', () => {
      // 21 Teams sind 6/5/5/5, also steht auf Rang 6 nur ein Team.
      const p = plan(21, 5);
      eq(bucketSizes(p), '8/4/4/5', 'Topfgrößen');
      eq(p.buckets[3].ranks.join('+'), '5+6', 'Ränge im letzten Topf');
      eq(p.buckets[3].matches, 5, 'Spiele im letzten Topf');
      eq(p.endMatches, 25, 'Endrundenspiele');
      return 'aus 4 + 1 wird der Fünfer-Spielplan';
    });

    test('Jede Teamzahl von 16 bis 32 wird vollständig auf Töpfe verteilt', () => {
      for (let n = 16; n <= 32; n++) {
        const p = plan(n, 5);
        eq(p.ok, true, `${n} Teams akzeptiert`);
        eq(p.buckets.reduce((total, b) => total + b.size, 0), n, `${n} Teams in Töpfen`);
        eq(p.buckets.filter(b => b.matches == null).length, 0, `${n} Teams ohne Spielplan`);
        eq(p.buckets[p.buckets.length - 1].lastPlace, n, `${n} Teams, letzter Platz`);
      }
      return '17 Teamzahlen, kein Topf ohne Spielplan';
    });

    test('Unter 16 und über 32 Teams lehnt die Auslosung ab', () => {
      for (const n of [15, 33, 0, 24.5]) {
        const p = plan(n, 5);
        eq(p.ok, false, `${n} Teams`);
        eq(E.errors(p.problems).length, 1, `${n} Teams, Fehler`);
        eq(p.rounds, undefined, `${n} Teams, keine Rundenzahl`);
      }
      return 'kein Zeitplan für ein Turnier, das dieses Format nicht spielen kann';
    });

    test('Ohne Platz gibt es keinen Plan', () => {
      const p = plan(24, 0);
      eq(p.ok, false, 'planbar');
      eq(p.problems[0].code, 'no-courts', 'Code');
      return 'die Rundenzahl wäre sonst eine Division durch null';
    });

    test('Mehr Plätze verkürzen die Gruppenphase', () => {
      eq(plan(30, 4).groupRounds, 25, '4 Plätze');
      eq(plan(30, 6).groupRounds, 17, '6 Plätze');
      return '98 Spiele: 25 Runden auf 4 Plätzen, 17 auf 6';
    });

    test('Bei kleinen Gruppen bremst die Pausenregel, nicht die Platzzahl', () => {
      // 16 Teams sind 4×4, also 24 Spiele — auf 6 Plätzen rechnerisch 4 Runden.
      // Eine Vierergruppe spielt 3 Gruppenrunden, und die müssen je zwei globale
      // Runden auseinanderliegen (§5.3): 1, 3, 5.
      const p = plan(16, 6);
      eq(p.groupMatches, 24, 'Gruppenspiele');
      eq(p.groupRounds, 5, 'Runden der Gruppenphase');
      return '5 statt 4 Runden, weil jedes Team seine Pause bekommt';
    });

    test('Halbfinale, Spiel um Platz 3 und Finale bleiben vier eigene Runden', () => {
      // Auf sehr vielen Plätzen schrumpft alles andere, diese vier nicht.
      const p = plan(24, 12);
      eq(p.endMatches, 28, 'Endrundenspiele');
      eq(p.endRounds, 7, 'Runden der Endrunde');
      return '24 geteilte Spiele in 3 Runden plus HF, HF, Platz 3, Finale';
    });

    test('Ein offenes Finale hat einen Anfang, aber kein Ende', () => {
      const p = plan(24, 5);
      assert(p.finalStart != null, 'Start des Finales fehlt');
      eq(p.finish, null, 'Ende');
      return `Finale ab ${E.hhmm(p.finalStart)}, Dauer offen`;
    });

    test('Ein Finale mit Minutenangabe ergibt eine Endzeit', () => {
      const p = plan(24, 5, Object.assign({}, PLAIN, { finalMode: '20' }));
      eq(p.finish, p.finalStart + 20, 'Ende');
      return `${E.hhmm(p.finalStart)} + 20 Min = ${E.hhmm(p.finish)}`;
    });

    test('Ohne Startzeit gibt es Runden, aber keine Uhrzeiten', () => {
      const p = plan(24, 5, { matchMin: 10, semiMin: 12, finalMode: 'set' });
      assert(p.rounds > 0, 'Runden fehlen');
      eq(p.finalStart, null, 'Start des Finales');
      eq(E.hhmm(p.finalStart), '', 'Anzeige');
      return 'eine fehlende Startzeit erfindet keine Endzeit';
    });

    test('Eine Pause hinter der letzten Runde zählt nicht mit', () => {
      const late = Object.assign({}, PLAIN, {
        breaks: [{ afterRound: 500, min: 60, label: 'nie' }],
      });
      eq(plan(24, 5, late).finalStart, plan(24, 5).finalStart, 'Start des Finales');
      return 'eine Pause nach Runde 500 verschiebt nichts';
    });

    test('Plätze dazu machen den Tag kürzer — die Zahl, um die es geht', () => {
      const rows = [3, 4, 5, 6].map(courts => {
        const p = plan(30, courts, CFG_2026);
        return { courts, rounds: p.rounds, finalStart: E.hhmm(p.finalStart) };
      });
      summary.courts = rows;
      for (let i = 1; i < rows.length; i++) {
        assert(rows[i].rounds < rows[i - 1].rounds,
          `${rows[i].courts} Plätze sind nicht schneller als ${rows[i - 1].courts}`);
      }
      return rows.map(r => `${r.courts} Plätze: ${r.rounds} Runden, Finale ${r.finalStart}`).join(' · ');
    });

    /*
     * The preview itself — this is what the allocation screen of §5.2 puts on
     * screen. It is carried in the summary rather than asserted: the numbers
     * above pin the parts down, and the organizer needs to see the whole range
     * at once to make the duration decision.
     */
    summary.preview = [];
    for (let n = 16; n <= 32; n++) {
      const p = plan(n, 5, CFG_2026);
      summary.preview.push({
        teams: n,
        sizes: sizesOf(p),
        buckets: bucketSizes(p),
        groupMatches: p.groupMatches,
        endMatches: p.endMatches,
        rounds: p.rounds,
        finalStart: E.hhmm(p.finalStart),
      });
    }

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AllocationTests;
