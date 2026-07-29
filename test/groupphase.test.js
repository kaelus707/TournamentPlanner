/*
 * Tests for groupPhase(), draw() and circleMethod() — SPEC.md §5.3, validated
 * against the 2026 fixture (§11).
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. The generator cannot reproduce the 2026 schedule line for
 *      line — the draw is random and the packing is one legal one of many —
 *      but it must reproduce its *shape*: the same 98 pairings from the same
 *      four groups, in 20 rounds on 5 courts, with nobody playing two rounds in
 *      a row.
 *
 *   B. Hand-built for the parts the fixture cannot show: the circle method
 *      itself, the seeded draw, determinism, and every supported team and court
 *      count run through conflicts().
 */
const GroupPhaseTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  const pairKey = (a, b) => [a, b].sort().join('|');
  const pairsOf = matches => new Set(matches.map(m => pairKey(m.aTeam, m.bTeam)));

  /** Synthetic teams for the counts the fixture does not cover. */
  const madeUpTeams = n => Array.from({ length: n }, (_, i) => ({
    id: 'T' + String(i + 1).padStart(2, '0'),
    p1: `Vorname${i + 1} Nachname${i + 1}`,
    p2: `Partner${i + 1} Zuname${i + 1}`,
  }));

  const sizesOf = teams => {
    const counts = new Map();
    for (const t of teams) counts.set(t.group, (counts.get(t.group) || 0) + 1);
    return [...counts.keys()].sort().map(g => counts.get(g));
  };

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
    const fixtureGroupMatches = web.matches.filter(m => m.phase === 'Gruppe');

    const CFG = { courts: 5, seed: 2026 };
    const built = E.groupPhase(teams2026, CFG);
    const problems = E.conflicts(built.matches, teams2026, CFG);

    summary.built = built;
    summary.errors = E.errors(problems);
    summary.warnings = E.warnings(problems);
    summary.perRound = [];
    for (const m of built.matches) {
      summary.perRound[m.round - 1] = (summary.perRound[m.round - 1] || 0) + 1;
    }

    test('Fixture: die Gruppen von 2026 ergeben 98 Spiele', () => {
      eq(built.matches.length, 98, 'Spiele');
      eq(fixtureGroupMatches.length, 98, 'Gruppenspiele im Fixture');
      return '28 + 28 + 21 + 21';
    });

    test('Fixture: auf 5 Plätzen sind es 20 Runden', () => {
      eq(built.rounds, 20, 'Runden');
      return 'genau die Runden 1–20 des Spielplans 2026';
    });

    test('Fixture: es entstehen genau die Paarungen von 2026', () => {
      const mine = pairsOf(built.matches);
      const theirs = pairsOf(fixtureGroupMatches);
      eq(mine.size, 98, 'erzeugte Paarungen');
      eq(theirs.size, 98, 'Paarungen im Fixture');
      const missing = [...theirs].filter(p => !mine.has(p));
      eq(missing.length, 0,
        'fehlende Paarungen' + (missing.length ? ' — ' + missing.slice(0, 3).join(', ') : ''));
      return 'dieselbe Jeder-gegen-jeden-Runde, nur anders sortiert';
    });

    test('Fixture: conflicts() findet keinen Fehler', () => {
      eq(summary.errors.length, 0,
        'Fehler' + (summary.errors.length ? ' — ' + summary.errors[0].message : ''));
      return '§7 hat nichts zu beanstanden';
    });

    test('Fixture: kein Team spielt zwei Runden hintereinander', () => {
      eq(built.missedBreaks, 0, 'Teams ohne Pause');
      eq(summary.warnings.filter(w => w.code === 'consecutive-rounds').length, 0, 'Warnungen');
      return 'die Pausenregel aus §5.3, am Team gemessen';
    });

    test('Fixture: 19 volle Runden, dann der Rest', () => {
      eq(summary.perRound.filter(n => n > 5).length, 0, 'überbuchte Runden');
      eq(summary.perRound.slice(0, 19).filter(n => n !== 5).length, 0, 'nicht volle Runden');
      eq(summary.perRound[19], 3, 'letzte Runde');
      return '19 × 5 + 3 = 98, kein Platz bleibt unnötig leer';
    });

    test('Fixture: jedes Team spielt gegen jeden aus seiner Gruppe', () => {
      const played = new Map();
      for (const m of built.matches) {
        for (const id of [m.aTeam, m.bTeam]) played.set(id, (played.get(id) || 0) + 1);
      }
      const sizes = new Map();
      for (const t of teams2026) sizes.set(t.group, (sizes.get(t.group) || 0) + 1);
      for (const t of teams2026) {
        eq(played.get(t.id), sizes.get(t.group) - 1, `Spiele von ${t.id} (Gruppe ${t.group})`);
      }
      return 'Achtergruppen 7 Spiele, Siebenergruppen 6';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Der Kreis lässt jedes Paar genau einmal antreten', () => {
      for (const m of [4, 5, 6, 7, 8]) {
        const ids = Array.from({ length: m }, (_, i) => 'T' + i);
        const rounds = E.circleMethod(ids);
        eq(rounds.length, m % 2 === 0 ? m - 1 : m, `${m} Teams, Gruppenrunden`);

        const seen = new Set();
        for (const r of rounds) {
          eq(r.length, Math.floor(m / 2), `${m} Teams, Spiele je Gruppenrunde`);
          const inRound = new Set();
          for (const pair of r) {
            const a = pair[0], b = pair[1];
            assert(!seen.has(pairKey(a, b)), `${m} Teams: ${a}/${b} kommt doppelt vor`);
            assert(!inRound.has(a) && !inRound.has(b), `${m} Teams: Team zweimal in einer Gruppenrunde`);
            seen.add(pairKey(a, b));
            inRound.add(a);
            inRound.add(b);
          }
        }
        eq(seen.size, (m * (m - 1)) / 2, `${m} Teams, Paarungen`);
      }
      return '4 bis 8 Teams, gerade wie ungerade';
    });

    test('Die Auslosung füllt die Gruppengrößen aus §5.1', () => {
      for (let n = 16; n <= 32; n++) {
        const drawn = E.draw(madeUpTeams(n), { seed: 3 });
        const want = E.allocation({ teams: n, courts: 5 }).groups.map(g => g.size);
        eq(sizesOf(drawn).slice().sort((a, b) => b - a).join('/'),
           want.slice().sort((a, b) => b - a).join('/'), `${n} Teams, Gruppengrößen`);
        eq(drawn.filter(t => !t.group).length, 0, `${n} Teams ohne Gruppe`);
      }
      return '17 Teamzahlen, jedes Team in genau einer Gruppe';
    });

    test('Dieselbe Saat ergibt dieselbe Auslosung, eine andere nicht', () => {
      const first = E.draw(madeUpTeams(24), { seed: 5 }).map(t => t.group).join('');
      const again = E.draw(madeUpTeams(24), { seed: 5 }).map(t => t.group).join('');
      const other = E.draw(madeUpTeams(24), { seed: 6 }).map(t => t.group).join('');
      eq(first, again, 'gleiche Saat');
      assert(first !== other, 'eine andere Saat ergibt dieselbe Auslosung');
      return 'eine Neuauslosung nach einem Tippfehler gibt dieselben Gruppen zurück';
    });

    test('Dieselbe Saat ergibt denselben Spielplan', () => {
      const teams = E.draw(madeUpTeams(24), { seed: 9 });
      const one = E.groupPhase(teams, { courts: 4, seed: 9 });
      const two = E.groupPhase(teams, { courts: 4, seed: 9 });
      eq(JSON.stringify(one.matches), JSON.stringify(two.matches), 'Spielplan');
      return 'derselbe Spielplan, nicht nur dieselbe Länge';
    });

    test('Die Spiele sehen aus wie in §3.3 und §4 beschrieben', () => {
      const teams = E.draw(madeUpTeams(20), { seed: 4 });
      const byId = new Map(teams.map(t => [t.id, t]));
      const plan = E.groupPhase(teams, { courts: 4, seed: 4 });

      plan.matches.forEach((m, i) => {
        eq(m.nr, i + 1, 'Nummer');
        eq(m.phase, 'Gruppe', `Spiel ${m.nr}, Phase`);
        eq(m.label, `Gruppe ${byId.get(m.aTeam).group}`, `Spiel ${m.nr}, Bezeichnung`);
        eq(m.aRef, `T:${m.aTeam}`, `Spiel ${m.nr}, aRef`);
        eq(m.bRef, `T:${m.bTeam}`, `Spiel ${m.nr}, bRef`);
        eq(m.sa, null, `Spiel ${m.nr}, sa`);
        eq(m.sb, null, `Spiel ${m.nr}, sb`);
        eq(m.status, 'open', `Spiel ${m.nr}, Status`);
        eq(m.wo, null, `Spiel ${m.nr}, wo`);
        eq(m.doneAt, '', `Spiel ${m.nr}, doneAt`);
        assert(m.court >= 1 && m.court <= 4, `Spiel ${m.nr} steht auf Platz ${m.court}`);
      });
      return 'aRef und bRef sind T:-Referenzen, das Ergebnis ist leer';
    });

    test('Jede Teamzahl und Platzzahl ergibt einen fehlerfreien Spielplan', () => {
      const rows = [];
      for (let n = 16; n <= 32; n++) {
        for (const courts of [3, 4, 5, 6]) {
          const teams = E.draw(madeUpTeams(n), { seed: n });
          const cfg = { courts, seed: n };
          const plan = E.groupPhase(teams, cfg);
          const found = E.errors(E.conflicts(plan.matches, teams, cfg));

          eq(plan.matches.length, E.allocation({ teams: n, courts }).groupMatches,
             `${n} Teams auf ${courts} Plätzen, Spiele`);
          eq(found.length, 0,
             `${n} Teams auf ${courts} Plätzen, Fehler` + (found.length ? ' — ' + found[0].message : ''));
          rows.push({ teams: n, courts, rounds: plan.rounds, missed: plan.missedBreaks });
        }
      }
      summary.sweep = rows;
      summary.rough = rows.filter(r => r.missed > 0);
      return `${rows.length} Kombinationen ohne Fehler, davon ${summary.rough.length} mit fehlender Pause`;
    });

    test('Ohne Gruppen gibt es keinen Spielplan', () => {
      const plan = E.groupPhase(madeUpTeams(20), { courts: 4 });
      eq(plan.matches.length, 0, 'Spiele');
      eq(plan.rounds, 0, 'Runden');
      return 'die Auslosung kommt zuerst';
    });

    test('Ein Platz ergibt einen Spielplan, nur einen langen', () => {
      const teams = E.draw(madeUpTeams(16), { seed: 2 });
      const plan = E.groupPhase(teams, { courts: 1, seed: 2 });
      eq(plan.matches.length, 24, 'Spiele');
      eq(plan.rounds, 24, 'Runden');
      eq(E.errors(E.conflicts(plan.matches, teams, { courts: 1 })).length, 0, 'Fehler');
      return '24 Spiele nacheinander';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GroupPhaseTests;
