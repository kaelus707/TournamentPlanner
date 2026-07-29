/*
 * Tests for endPhase() and schedule() — SPEC.md §5.5, §5.6 and §6.3, validated
 * against the 2026 fixture (§11).
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. 2026 is a complete oracle for the endrunde structure: the
 *      same 33 matches carrying the same 33 labels and the same phases, in the
 *      same 14 rounds on the three courts it actually used, ending semi-final,
 *      semi-final, third place, final — each alone on court 1.
 *
 *   B. Hand-built for what the fixture cannot show: the bracket of every
 *      supported bucket size, the singleton merge, and the B: ordering check
 *      that §7 left open until this step.
 */
const EndPhaseTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  /** The en-dash in a label is data, not decoration — compared literally. */
  const labelsOf = matches => matches.map(m => m.label).sort();

  const phaseCount = matches => {
    const out = {};
    for (const m of matches) out[m.phase] = (out[m.phase] || 0) + 1;
    return out;
  };

  const byRound = matches => {
    const rounds = new Map();
    for (const m of matches) {
      if (!rounds.has(m.round)) rounds.set(m.round, []);
      rounds.get(m.round).push(m);
    }
    return rounds;
  };

  const madeUpTeams = n => Array.from({ length: n }, (_, i) => ({
    id: 'T' + String(i + 1).padStart(2, '0'),
    p1: `Vorname${i + 1} Nachname${i + 1}`,
    p2: `Partner${i + 1} Zuname${i + 1}`,
  }));

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
    const fixtureEnd = web.matches.filter(m => m.phase !== 'Gruppe');

    // The endrunde of 2026 ran on three courts, picking up after the twenty
    // rounds and 98 matches of the group phase.
    const end = E.endPhase(teams2026, { courts: 3, fromRound: 20, fromNr: 98 });
    const rounds = byRound(end.matches);

    summary.end = end;
    summary.rounds = [...rounds].sort((a, b) => a[0] - b[0]);

    test('Fixture: 33 Endrundenspiele in 14 Runden auf 3 Plätzen', () => {
      eq(end.matches.length, 33, 'Spiele');
      eq(fixtureEnd.length, 33, 'Endrundenspiele im Fixture');
      eq(end.rounds, 14, 'Runden');
      return 'genau die Runden 21–34 des Spielplans 2026';
    });

    test('Fixture: dieselben 33 Bezeichnungen wie 2026', () => {
      const mine = labelsOf(end.matches);
      const theirs = labelsOf(fixtureEnd);
      const off = theirs.filter((l, i) => l !== mine[i]);
      eq(off.length, 0,
        'abweichende Bezeichnungen' + (off.length ? ' — ' + off.slice(0, 3).join(', ') : ''));
      return 'Viertelfinale, Platzierungsrunden, Spiele um Platz, Halbfinale, Finale';
    });

    test('Fixture: dieselbe Verteilung der Phasen', () => {
      const mine = phaseCount(end.matches);
      const theirs = phaseCount(fixtureEnd);
      for (const phase of ['VF', 'HF', 'Finale', 'Platz']) {
        eq(mine[phase], theirs[phase], `Phase ${phase}`);
      }
      return '4 VF, 2 HF, 1 Finale, 26 Platz';
    });

    test('Fixture: die Nummerierung setzt die Gruppenphase fort', () => {
      eq(end.matches[0].nr, 99, 'erstes Spiel');
      eq(end.matches[end.matches.length - 1].nr, 131, 'letztes Spiel');
      eq(end.matches[0].round, 21, 'erste Runde');
      return 'Spiel 99 bis 131, Runden 21 bis 34';
    });

    test('Fixture: der Tag endet mit HF, HF, Platz 3, Finale — jedes allein', () => {
      const tail = [31, 32, 33, 34].map(r => rounds.get(r));
      for (const ms of tail) eq(ms.length, 1, 'Spiele in der Runde');
      eq(tail.map(ms => ms[0].label).join(' · '),
         'Halbfinale 1 · Halbfinale 2 · Spiel um Platz 3 · Finale', 'Reihenfolge');
      for (const ms of tail) eq(ms[0].court, 1, `${ms[0].label}, Platz`);
      return 'genau die Runden 31–34 von 2026';
    });

    test('Fixture: das Finale ist das letzte Spiel des Tages', () => {
      const last = end.matches[end.matches.length - 1];
      eq(last.phase, 'Finale', 'Phase');
      eq(last.round, 34, 'Runde');
      return 'kein Spiel danach';
    });

    test('Fixture: das ganze Turnier läuft fehlerfrei durch conflicts()', () => {
      const all = E.schedule(teams2026, { courts: 5, seed: 2026 });
      const found = E.errors(E.conflicts(all.matches, teams2026, { courts: 5 }));
      eq(all.matches.length, 131, 'Spiele');
      eq(found.length, 0, 'Fehler' + (found.length ? ' — ' + found[0].message : ''));
      summary.whole = all;
      return `131 Spiele, ${all.rounds} Runden auf 5 Plätzen`;
    });

    test('Fixture: jede Referenz lässt sich nach §6.3 lesen', () => {
      for (const m of end.matches) {
        for (const raw of [m.aRef, m.bRef]) {
          const ref = E.parseRef(raw);
          assert(ref.kind === 'B' || ref.kind === 'W' || ref.kind === 'L',
            `Spiel ${m.nr}: „${raw}" ist keine Referenz aus §6.3`);
        }
      }
      return 'B: für den Einstieg, W: und L: für den Verlauf';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Die Töpfe kennen ihre Mitglieder', () => {
      const list = E.buckets(E.allocation({ teams: 30, courts: 5 }).groups);
      eq(list[0].id, 1, 'Kennung des ersten Topfs');
      eq(list[0].members.map(m => `${m.rank}${m.group}`).join(' '),
         '1A 1B 1C 1D 2A 2B 2C 2D', 'Mitglieder des ersten Topfs');
      const last = list[list.length - 1];
      eq(last.members.map(m => `${m.rank}${m.group}`).join(' '), '8A 8B', 'Mitglieder des letzten Topfs');
      return 'nach Rang, dann nach Gruppe — das ist die Setzung hinter B:';
    });

    test('Im zusammengelegten Topf ist der Fünfte der Sechstplatzierte', () => {
      // 21 Teams sind 6/5/5/5, auf Rang 6 steht nur ein Team.
      const list = E.buckets(E.allocation({ teams: 21, courts: 5 }).groups);
      const merged = list[list.length - 1];
      eq(merged.size, 5, 'Topfgröße');
      eq(merged.members.map(m => `${m.rank}${m.group}`).join(' '), '5A 5B 5C 5D 6A', 'Mitglieder');
      return 'B:5:5 ist der 6. der Gruppe A — ohne Punktvergleich über Gruppen hinweg';
    });

    test('Ein Zweiertopf ist ein Spiel, ein Dreiertopf sind drei nacheinander', () => {
      const two = E.endPhase(E.draw(madeUpTeams(18), { seed: 1 }), { courts: 6 });
      eq(two.matches.filter(m => m.label === 'Spiel um Platz 17').length, 1, 'Spiele im Zweiertopf');

      const three = E.endPhase(E.draw(madeUpTeams(19), { seed: 1 }), { courts: 6 });
      const rr = three.matches.filter(m => m.label === 'Platzierungsrunde Platz 17–19');
      eq(rr.length, 3, 'Spiele im Dreiertopf');
      eq(new Set(rr.map(m => m.round)).size, 3, 'Runden des Dreiertopfs');
      return 'drei Teams teilen sich ihre Gegner, also nacheinander';
    });

    test('Der Fünfertopf endet mit dem Fünften gegen den Vierten', () => {
      const end21 = E.endPhase(E.draw(madeUpTeams(21), { seed: 1 }), { courts: 6 });
      const bucket = end21.buckets[end21.buckets.length - 1];
      const p = bucket.firstPlace;
      eq(bucket.size, 5, 'Topfgröße');

      const decider = end21.matches.find(m => m.label === `Spiel um Platz ${p + 3}`);
      assert(decider, `Spiel um Platz ${p + 3} fehlt`);
      eq(decider.aRef, `B:${bucket.id}:5`, 'aRef');
      assert(decider.bRef.indexOf('L:') === 0, `bRef ist ${decider.bRef}, erwartet einen Verlierer`);
      return `B:${bucket.id}:5 gegen den Verlierer des Spiels um Platz ${p + 2}`;
    });

    test('Der Achtertopf hat die Struktur von 2026', () => {
      const end24 = E.endPhase(E.draw(madeUpTeams(24), { seed: 1 }), { courts: 6 });
      const want = ['Viertelfinale 1', 'Viertelfinale 2', 'Viertelfinale 3', 'Viertelfinale 4',
        'Platzierungsrunde Platz 5–8', 'Platzierungsrunde Platz 5–8',
        'Halbfinale 1', 'Halbfinale 2',
        'Spiel um Platz 5', 'Spiel um Platz 7', 'Spiel um Platz 3', 'Finale'];
      const got = end24.matches.filter(m => want.indexOf(m.label) >= 0);
      eq(got.length, 12, 'Spiele im Achtertopf');
      eq(labelsOf(got).join('|'), want.slice().sort().join('|'), 'Bezeichnungen');
      return '4 Viertelfinale, 5–8-Runde, 2 Halbfinale, Platz 5, 7, 3 und das Finale';
    });

    test('Jede Teamzahl und Platzzahl ergibt eine fehlerfreie Endrunde', () => {
      const rows = [];
      for (let n = 16; n <= 32; n++) {
        for (const courts of [3, 4, 5, 6]) {
          const teams = E.draw(madeUpTeams(n), { seed: n });
          const cfg = { courts, seed: n };
          const all = E.schedule(teams, cfg);
          const found = E.errors(E.conflicts(all.matches, teams, cfg));

          eq(all.matches.length, E.allocation({ teams: n, courts }).matches,
             `${n} Teams auf ${courts} Plätzen, Spiele`);
          eq(found.length, 0, `${n} Teams auf ${courts} Plätzen, Fehler` +
            (found.length ? ' — ' + found[0].message : ''));

          const last = all.matches[all.matches.length - 1];
          eq(last.phase, 'Finale', `${n} Teams auf ${courts} Plätzen, letztes Spiel`);
          eq(last.round, all.rounds, `${n} Teams auf ${courts} Plätzen, Runde des Finales`);
          rows.push({ teams: n, courts, rounds: all.rounds, end: all.endRounds });
        }
      }
      summary.sweep = rows;
      return `${rows.length} Kombinationen, jedes Mal endet der Tag mit dem Finale`;
    });

    test('Halbfinale, Spiel um Platz 3 und Finale stehen immer allein', () => {
      for (let n = 16; n <= 32; n += 4) {
        for (const courts of [3, 5, 6]) {
          const all = E.schedule(E.draw(madeUpTeams(n), { seed: n }), { courts, seed: n });
          const rounds2 = byRound(all.matches);
          const alone = all.matches.filter(m =>
            m.phase === 'HF' || m.phase === 'Finale' || m.label === 'Spiel um Platz 3');
          eq(alone.length, 4, `${n} Teams, Spiele allein auf Platz 1`);
          for (const m of alone) {
            eq(rounds2.get(m.round).length, 1, `${n} Teams auf ${courts} Plätzen, ${m.label}`);
            eq(m.court, 1, `${n} Teams, ${m.label}, Platz`);
          }
        }
      }
      return 'auch auf sechs Plätzen bleiben diese vier Runden einzeln';
    });

    test('Jede W:- und L:-Referenz zeigt auf ein früheres Spiel', () => {
      const teams = E.draw(madeUpTeams(27), { seed: 3 });
      const all = E.schedule(teams, { courts: 4, seed: 3 });
      const byNr = new Map(all.matches.map(m => [m.nr, m]));
      for (const m of all.matches) {
        for (const raw of [m.aRef, m.bRef]) {
          const ref = E.parseRef(raw);
          if (ref.kind !== 'W' && ref.kind !== 'L') continue;
          const src = byNr.get(ref.src);
          assert(src, `Spiel ${m.nr}: „${raw}" zeigt ins Leere`);
          assert(src.round < m.round,
            `Spiel ${m.nr} in Runde ${m.round} hängt von Spiel ${src.nr} in Runde ${src.round} ab`);
        }
      }
      return 'kein Spiel wartet auf ein Ergebnis, das es noch nicht gibt';
    });

    test('§7: eine B:-Referenz vor dem Ende der Gruppenphase ist ein Fehler', () => {
      const teams = E.draw(madeUpTeams(24), { seed: 8 });
      const all = E.schedule(teams, { courts: 4, seed: 8 });
      const lastGroupRound = Math.max(...all.matches.filter(m => m.phase === 'Gruppe').map(m => m.round));

      // Ein Platzierungsspiel mitten in die Gruppenphase geschoben.
      const early = all.matches.find(m => m.aRef.indexOf('B:') === 0);
      const moved = all.matches.map(m =>
        m.nr === early.nr ? Object.assign({}, m, { round: lastGroupRound, court: 4 }) : m);

      const found = E.errors(E.conflicts(moved, teams, { courts: 4 }));
      const wanted = found.filter(p => p.code === 'ref-not-decided' && p.matches.indexOf(early.nr) >= 0);
      assert(wanted.length > 0, 'kein ref-not-decided für die B:-Referenz');
      return wanted[0].message;
    });

    test('Dieselbe Eingabe ergibt dieselbe Endrunde', () => {
      const teams = E.draw(madeUpTeams(26), { seed: 11 });
      const one = E.endPhase(teams, { courts: 4 });
      const two = E.endPhase(teams, { courts: 4 });
      eq(JSON.stringify(one.matches), JSON.stringify(two.matches), 'Endrunde');
      return 'die Endrunde hängt an den Gruppengrößen, nicht am Zufall';
    });

    test('Ohne Gruppen gibt es keine Endrunde', () => {
      const end0 = E.endPhase(madeUpTeams(20), { courts: 4 });
      eq(end0.matches.length, 0, 'Spiele');
      eq(end0.rounds, 0, 'Runden');
      return 'die Auslosung kommt zuerst';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EndPhaseTests;
