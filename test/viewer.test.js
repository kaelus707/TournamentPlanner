/*
 * Tests for the viewer's data layer — SPEC.md §8 and §9.1, build step 10.
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture, round-tripped through the contract. The 2026 matches are
 *      written out as §8 v2 lines by webFormat() and read back by parseWeb(),
 *      so both halves of the seam are tested against each other on real data.
 *      The oracle for the times is the v1 file itself: it recorded a clock time
 *      per round, and the viewer must land on the same 34.
 *
 *      The seven breaks are the sharpest case. v1 wrote them as clock ranges
 *      ("11:00–11:05"), which is exactly what §3.1 replaces with a round index
 *      and a length — so recomputing those ranges from `P|afterRound|min` is a
 *      direct check that no time was lost in the change.
 *
 *   B. Hand-built lines for the decisions the viewer makes on its own: which
 *      round is current, how a blank status is read, and what an undecided slot
 *      is called before its source is played.
 */
const ViewerTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const V = (typeof TournamentViewer !== 'undefined') ? TournamentViewer : require('../viewer.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  /* The 2026 configuration of timing.test.js, which reproduces all 34 starts. */
  const CFG = {
    title: 'Bonsai Cup 2026', logo: '',
    start: '09:00', courts: 5, matchMin: 10, semiMin: 12,
    finalMode: 'set', walkover: '2:0',
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

  /* The clock ranges the v1 file printed for its seven breaks, in order. */
  const BREAKS_2026 = [
    '11:00–11:05', '12:25–12:30', '12:30–12:40', '13:00–13:05',
    '14:37–14:42', '14:54–14:59', '15:09–15:14',
  ];

  // ---------------------------------------------------------- builders for B

  const lines = list => list.join('\n');

  /** A minimal WEB document: a C line plus whatever M/P lines are given. */
  const doc = (...body) => lines(['META|Test|4|1|', 'C|09:00|10|12|set', ...body]);

  /** `M|nr|round|court|phase|label|aRef|aTeam|bRef|bTeam|sa|sb|aCode|bCode|status` */
  const m = (nr, round, sa, sb, status, extra) => {
    const f = Object.assign({
      court: 1, phase: 'Gruppe', label: 'Gruppe A',
      aRef: 'T:A1', aTeam: 'Anna / Berta', bRef: 'T:A2', bTeam: 'Cem / Dora',
      aCode: 'A1', bCode: 'A2',
    }, extra);
    return ['M', nr, round, f.court, f.phase, f.label,
      f.aRef, f.aTeam, f.bRef, f.bTeam,
      sa == null ? '' : sa, sb == null ? '' : sb,
      f.aCode, f.bCode, status].join('|');
  };

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

    // ---- A. the 2026 fixture, through the §8 seam ----------------------

    const fixture = A.parseWeb(webText);
    const teams = A.parseTeams(teamsText);

    /* webFormat() writes the contract; parseWeb() reads it. */
    const text2 = E.webFormat(fixture.matches, teams, CFG).join('\n');
    const data = V.parseWeb(text2);
    const bs = V.blocks(data);
    const sum = V.summary(data);

    const roundBlocks = bs.filter(b => b.kind === 'round');
    const breakBlocks = bs.filter(b => b.kind === 'break');

    summary.rounds = roundBlocks.length;
    summary.matches = data.matches.length;
    summary.expected = fixture.roundStarts;
    summary.got = roundBlocks.map(b => b.time);
    summary.mismatches = summary.got
      .map((t, i) => ({ round: i + 1, got: t, want: fixture.roundStarts[i] }))
      .filter(x => x.got !== x.want);
    summary.breaks = breakBlocks.map(b => `${b.from}–${b.to}`);

    test('Fixture: alle 131 Spiele überstehen den Weg durch das WEB-Format', () => {
      eq(data.matches.length, 131, 'Spiele');
      eq(data.matches.filter(x => x.round > 0).length, 131, 'mit Runde');
      return '131 Spiele, jedes mit Runde';
    });

    test('Fixture: 34 Runden', () => {
      eq(roundBlocks.length, 34, 'Runden');
      return '34 Runden aus 131 Spielen';
    });

    test('Fixture: alle 34 Startzeiten stimmen mit dem Spielplan 2026 überein', () => {
      assert(summary.mismatches.length === 0,
        summary.mismatches.map(x => `R${x.round}: ${x.got} statt ${x.want}`).join(', '));
      return `${roundBlocks.length} Zeiten, erste ${summary.got[0]}, letzte ${summary.got[33]}`;
    });

    test('Fixture: jede Runde behält ihre Spiele, keins doppelt', () => {
      const seen = roundBlocks.flatMap(b => b.items.map(x => x.nr));
      eq(seen.length, 131, 'Spiele in Blöcken');
      eq(new Set(seen).size, 131, 'verschiedene Nummern');
      return 'jedes Spiel in genau einem Block';
    });

    test('Fixture: Spiele einer Runde stehen nach Platz sortiert', () => {
      for (const b of roundBlocks) {
        const courts = b.items.map(x => Number(x.court) || 0);
        const sorted = [...courts].sort((x, y) => x - y);
        assert(courts.join() === sorted.join(), `Runde ${b.round}: ${courts.join()}`);
      }
      return 'aufsteigend in allen 34 Runden';
    });

    test('Fixture: die sieben Pausen liegen auf denselben Uhrzeiten wie 2026', () => {
      eq(breakBlocks.length, 7, 'Pausen');
      for (let i = 0; i < BREAKS_2026.length; i++) {
        eq(summary.breaks[i], BREAKS_2026[i], `Pause ${i + 1}`);
      }
      return BREAKS_2026.join(' · ');
    });

    test('Fixture: gespieltes Turnier hat keine aktuelle Runde', () => {
      eq(sum.done, 131, 'gespielt');
      eq(sum.current, null, 'aktuelle Runde');
      assert(roundBlocks.every(b => b.state === 'done'), 'alle Blöcke „done“');
      return '131 von 131 gespielt, „Jetzt“ nirgends';
    });

    test('Fixture: Gruppentabellen und Endplatzierung kommen mit', () => {
      eq(Object.keys(data.groups).sort().join(''), 'ABCD', 'Gruppen');
      eq(Object.values(data.groups).reduce((n, g) => n + g.length, 0), 30, 'Zeilen');
      eq(data.ranks.length, 30, 'Plätze');
      eq(data.ranks[0].place, 1, 'erster Platz');
      return '4 Gruppen, 30 Teams, Plätze 1–30';
    });

    test('Fixture: Platz 1 ist der Sieger aus der Fixture-Datei', () => {
      const want = fixture.placements.find(p => p.place === 1);
      eq(data.ranks[0].team, want.team, 'Sieger');
      return `Platz 1: ${data.ranks[0].team}`;
    });

    // ---- B. the viewer's own decisions ---------------------------------

    test('Aktuelle Runde ist die erste unvollständige', () => {
      const d = V.parseWeb(doc(
        m(1, 1, 6, 3, 'done'),
        m(2, 2, 6, 4, 'done'),
        m(3, 3, null, null, 'playing'),
        m(4, 4, null, null, 'open')));
      const s = V.summary(d);
      eq(s.current.round, 3, 'aktuelle Runde');
      eq(V.blocks(d).map(b => b.state).join(','), 'done,done,now,next', 'Zustände');
      return 'Runde 3 läuft, 1–2 gespielt, 4 kommt';
    });

    test('Ein offenes Spiel in einer frühen Runde hält „Jetzt“ dort fest', () => {
      /*
       * §9.1's 2026 bug, stated as the behaviour it now has: completeness
       * decides, so a round with one unplayed match stays current no matter how
       * many later rounds are finished. That is correct — the round is not over
       * — and it is why §6.2 makes "delayed" a move to a later round rather
       * than a state, which takes the match out of this round entirely.
       */
      const d = V.parseWeb(doc(
        m(1, 1, 6, 3, 'done'),
        m(2, 1, null, null, 'open'),
        m(3, 2, 6, 1, 'done'),
        m(4, 3, 6, 2, 'done')));
      eq(V.summary(d).current.round, 1, 'aktuelle Runde');
      return 'Runde 1 bleibt aktuell, solange Spiel 2 offen ist';
    });

    test('Verschobenes Spiel gibt die Runde frei', () => {
      /* The same four matches, with the open one moved to round 3 (§6.2). */
      const d = V.parseWeb(doc(
        m(1, 1, 6, 3, 'done'),
        m(2, 3, null, null, 'open'),
        m(3, 2, 6, 1, 'done'),
        m(4, 3, 6, 2, 'done')));
      eq(V.summary(d).current.round, 3, 'aktuelle Runde');
      return 'Runde 1 ist fertig, „Jetzt“ steht auf Runde 3';
    });

    test('Leerer Status mit Ergebnis gilt als gespielt', () => {
      /* Historical data has no status column (§3.3). */
      const d = V.parseWeb(doc(m(1, 1, 6, 3, ''), m(2, 2, null, null, '')));
      eq(d.matches[0].status, 'done', 'Spiel 1');
      eq(d.matches[1].status, 'open', 'Spiel 2');
      eq(V.summary(d).current.round, 2, 'aktuelle Runde');
      return 'Ergebnis ohne Status → done, leer ohne Ergebnis → open';
    });

    test('„playing“ wird von „open“ unterschieden', () => {
      const d = V.parseWeb(doc(m(1, 1, null, null, 'playing'), m(2, 1, null, null, 'open')));
      assert(V.isPlaying(d.matches[0]), 'Spiel 1 läuft');
      assert(!V.isPlaying(d.matches[1]), 'Spiel 2 läuft nicht');
      eq(V.summary(d).playing, 1, 'laufende Spiele');
      return 'ein laufendes, ein offenes Spiel in derselben Runde';
    });

    test('Verspätung verschiebt die Startzeit und nennt den Verzug', () => {
      /*
       * Round 1 is stamped 12 minutes after the planned 10, so round 2 cannot
       * start at 09:10 any more (§6.1). The delta is what the header shows.
       */
      const d = V.parseWeb(doc(m(1, 1, 6, 3, 'done'), m(2, 2, null, null, 'open')));
      d.matches[0].doneAt = '09:12';
      const rounds = V.blocks(d).filter(b => b.kind === 'round');
      eq(rounds[0].time, '09:00', 'Runde 1');
      eq(rounds[1].time, '09:12', 'Runde 2');
      eq(rounds[1].delta, 2, 'Verzug');
      return 'Runde 2 startet 09:12 statt 09:10, +2 Min';
    });

    test('Pause zwischen zwei Runden bekommt ihre Uhrzeit', () => {
      const d = V.parseWeb(doc(
        m(1, 1, null, null, 'open'), 'P|1|5|Platzpflege', m(2, 2, null, null, 'open')));
      const b = V.blocks(d).find(x => x.kind === 'break');
      eq(b.from, '09:10', 'Pausenbeginn');
      eq(b.to, '09:15', 'Pausenende');
      eq(b.label, 'Platzpflege', 'Text');
      return 'Platzpflege 09:10–09:15 nach Runde 1';
    });

    test('Zwei Pausen nach derselben Runde stapeln sich', () => {
      const d = V.parseWeb(doc(
        m(1, 1, null, null, 'open'),
        'P|1|5|Platzpflege', 'P|1|10|Reserveblock',
        m(2, 2, null, null, 'open')));
      const [first, second] = V.blocks(d).filter(x => x.kind === 'break');
      eq(`${first.from}–${first.to}`, '09:10–09:15', 'erste Pause');
      eq(`${second.from}–${second.to}`, '09:15–09:25', 'zweite Pause');
      return 'sie folgen aufeinander statt sich zu überlappen';
    });

    test('Offener Slot zeigt den deutschen Text hinter der Referenz', () => {
      const d = V.parseWeb(doc(
        m(1, 1, 6, 3, 'done', { phase: 'VF', label: 'Viertelfinale 1' }),
        m(2, 2, null, null, 'open', {
          phase: 'HF', label: 'Halbfinale 1',
          aRef: 'W:1', aTeam: '', bRef: 'G:B:2', bTeam: '', aCode: '', bCode: '',
        })));
      const a = V.slot(d.matches, d.matches[1].aRef, d.matches[1].aTeam);
      const b = V.slot(d.matches, d.matches[1].bRef, d.matches[1].bTeam);
      eq(a.name, 'Sieger Viertelfinale 1', 'A-Slot');
      assert(a.open, 'A ist offen');
      eq(b.name, '2. Gruppe B', 'B-Slot');
      return '„Sieger Viertelfinale 1“ und „2. Gruppe B“';
    });

    test('Besetzter Slot zeigt den Namen, nicht die Referenz', () => {
      const d = V.parseWeb(doc(m(1, 1, 6, 3, 'done')));
      const a = V.slot(d.matches, d.matches[0].aRef, d.matches[0].aTeam);
      eq(a.name, 'Anna / Berta', 'A-Slot');
      assert(!a.open, 'A ist besetzt');
      return 'Name schlägt Referenz';
    });

    test('Suche findet Team, Kürzel und Bezeichnung', () => {
      const d = V.parseWeb(doc(m(1, 1, null, null, 'open')));
      const one = d.matches[0];
      assert(V.hit(d.matches, one, 'berta'), 'Teamname');
      assert(V.hit(d.matches, one, 'a1'), 'Kürzel');
      assert(V.hit(d.matches, one, 'gruppe a'), 'Bezeichnung');
      assert(!V.hit(d.matches, one, 'zeppelin'), 'Unsinn findet nichts');
      return 'Name, Kürzel und Bezeichnung durchsuchbar';
    });

    test('Fehlende C-Zeile: keine Zeiten, aber auch kein Absturz', () => {
      /* A v1 sheet has no `C` line (§8), so nothing can be clocked. */
      const d = V.parseWeb(lines(['META|Alt|4|1|', m(1, 1, null, null, 'open')]));
      const s = V.summary(d);
      eq(s.timed, false, 'ohne Zeitangaben');
      eq(V.blocks(d)[0].time, '', 'leere Uhrzeit');
      eq(s.current.round, 1, 'aktuelle Runde trotzdem');
      return 'Runden ohne Uhrzeit, „Jetzt“ funktioniert weiter';
    });

    test('Leeres Blatt liefert leere Listen', () => {
      const d = V.parseWeb('');
      eq(d.matches.length, 0, 'Spiele');
      eq(V.blocks(d).length, 0, 'Blöcke');
      eq(V.summary(d).current, null, 'aktuelle Runde');
      return 'nichts drin, nichts kaputt';
    });

    test('Kommas in Namen überleben den CSV-Export', () => {
      /* Sheets quotes any field with a comma; the row is still one WEB line. */
      const raw = '"' + m(1, 1, 6, 3, 'done', { aTeam: 'Meier, Sepp / Huber, Hans' }) + '"';
      const d = V.parseWeb(lines(['C|09:00|10|12|set', raw]));
      eq(d.matches.length, 1, 'Spiele');
      eq(d.matches[0].aTeam, 'Meier, Sepp / Huber, Hans', 'Name');
      return 'ein Feld mit zwei Kommas bleibt ein Feld';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ViewerTests;
