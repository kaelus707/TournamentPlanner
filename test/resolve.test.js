/*
 * Tests for resolve() / placement() / delayPlan() — SPEC.md §6.2, §6.3 and §8,
 * validated against the 2026 fixture (§11).
 *
 * Two halves, as in the other suites:
 *
 *   A. The fixture. It is a complete oracle for the resolver: every one of the
 *      131 matches records the teams that actually walked onto court, so the
 *      test blanks every derived slot, resolves from the refs alone, and
 *      demands all 262 come back the same. Its 30 E lines do the same for
 *      placement().
 *
 *   B. Hand-built data for everything the fixture cannot show: B: refs (the
 *      2026 sheet had none, it wrote group positions instead), a bucket of
 *      three, a deleted result, and the delay/promote proposals of §6.2.
 */
const ResolveTests = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined') ? TournamentEngine : require('../engine.js');
  const A = (typeof FixtureAdapter !== 'undefined') ? FixtureAdapter : require('./fixture-adapter.js');

  // ------------------------------------------------------------- assertions

  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (got, want, what) => assert(got === want, `${what}: erwartet ${want}, bekommen ${got}`);

  const CFG = { start: '09:00', courts: 5, matchMin: 10, semiMin: 12, finalMode: 'set', walkover: '2:0' };

  /**
   * Every slot the resolver is supposed to derive, emptied. T: slots keep their
   * team — §6.3 says the draw fixes those before the schedule exists and they
   * never change, so blanking them would test a case that cannot occur.
   */
  const blanked = matches => matches.map(m => {
    const derived = ref => E.parseRef(ref).kind !== 'T';
    return Object.assign({}, m, {
      aTeam: derived(m.aRef) ? null : m.aTeam,
      bTeam: derived(m.bRef) ? null : m.bTeam,
    });
  });

  // ------------------------------------------------------- builders for §B

  const team = (id, group) => ({ id, group, p1: id, p2: 'Partner' });

  const match = (nr, round, extra) => Object.assign({
    nr, round, court: 1, phase: 'Gruppe', label: 'Gruppe A',
    aRef: '', bRef: '', aTeam: null, bTeam: null,
    sa: null, sb: null, status: 'open', wo: null, doneAt: '',
  }, extra);

  /**
   * A finished group phase, four groups of `size`. Every team beats every team
   * below it in its group, so the table order is the team order and the bucket
   * seats can be written down by hand.
   */
  function playedGroups(size) {
    const groups = ['A', 'B', 'C', 'D'];
    const teams = [];
    for (const g of groups) for (let i = 1; i <= size; i++) teams.push(team(`${g}${i}`, g));

    const matches = [];
    let nr = 0, round = 0;
    for (const g of groups) {
      for (let i = 1; i <= size; i++) {
        for (let j = i + 1; j <= size; j++) {
          matches.push(match(++nr, ++round, {
            label: `Gruppe ${g}`,
            aRef: `T:${g}${i}`, bRef: `T:${g}${j}`,
            aTeam: `${g}${i}`, bTeam: `${g}${j}`,
            sa: 6, sb: 0, status: 'done',
          }));
        }
      }
    }
    return { teams, matches, lastRound: round, lastNr: nr };
  }

  /** The 19-team shape of §5.5's size-3 bucket: groups of 5/5/5/4. */
  function teams19() {
    const out = [];
    [['A', 5], ['B', 5], ['C', 5], ['D', 4]].forEach(([g, n]) => {
      for (let i = 1; i <= n; i++) out.push(team(`${g}${i}`, g));
    });
    return out;
  }

  const rrMatch = (nr, round, aRef, bRef, aTeam, bTeam, extra) => match(nr, round, Object.assign({
    phase: 'Platz', label: 'Platzierungsrunde Platz 17–19',
    aRef, bRef, aTeam, bTeam,
  }, extra));

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
    const resolved = E.resolve(blanked(web.matches), teams, CFG);

    const byNr = new Map(web.matches.map(m => [m.nr, m]));
    summary.wrong = [];
    for (const m of resolved) {
      const want = byNr.get(m.nr);
      for (const side of ['aTeam', 'bTeam']) {
        if ((m[side] || null) !== (want[side] || null)) {
          summary.wrong.push({ nr: m.nr, side, got: m[side], want: want[side] });
        }
      }
    }
    summary.slots = resolved.length * 2;
    summary.rows = resolved;

    test('Fixture: alle 262 Slots werden aus den Referenzen allein wiederhergestellt', () => {
      eq(summary.wrong.length, 0,
        'falsche Slots' + (summary.wrong.length
          ? ' — ' + summary.wrong.slice(0, 5).map(x => `Spiel ${x.nr} ${x.side}: ${x.got} statt ${x.want}`).join(', ')
          : ''));
      return `131 Spiele, ${summary.slots} Slots, keine Abweichung`;
    });

    test('Fixture: kein Slot bleibt offen, das Turnier ist zu Ende gespielt', () => {
      const open = resolved.filter(m => !m.aTeam || !m.bTeam);
      eq(open.length, 0, 'offene Slots' + (open.length ? ' — Spiele ' + open.map(m => m.nr).join(', ') : ''));
      return 'G:, W: und L: lösen sich vollständig auf';
    });

    const places = E.placement(web.matches, teams, CFG);
    const nameOf = new Map(teams.map(t => [t.id, `${t.p1} / ${t.p2}`]));
    summary.places = places;
    summary.nameOf = nameOf;
    summary.placeWrong = [];
    for (const want of web.placements) {
      const got = places.find(p => p.place === want.place);
      const name = got && got.team ? nameOf.get(got.team) : '';
      if (name !== want.team || (got && got.group) !== want.group || (got && got.origin) !== want.origin) {
        summary.placeWrong.push({ place: want.place, got: name, want: want.team });
      }
    }

    test('Fixture: die Platzierung 1–30 stimmt Zeile für Zeile', () => {
      eq(places.length, 30, 'Plätze');
      eq(summary.placeWrong.length, 0,
        'falsche Plätze' + (summary.placeWrong.length
          ? ' — ' + summary.placeWrong.slice(0, 5).map(x => `Platz ${x.place}: ${x.got} statt ${x.want}`).join(', ')
          : ''));
      return 'Team, Gruppe und Herkunft wie im Blatt von 2026';
    });

    test('Fixture: Platz 1 und 2 kommen aus dem Finale', () => {
      eq(places[0].origin, 'Sieger Finale', 'Herkunft Platz 1');
      eq(places[1].origin, 'Verlierer Finale', 'Herkunft Platz 2');
      eq(nameOf.get(places[0].team), 'Deyl Ali / Kern Hans', 'Sieger');
      return 'Deyl Ali / Kern Hans';
    });

    test('Fixture: resolve() ändert die Eingabe nicht', () => {
      const input = blanked(web.matches);
      const before = input.filter(m => m.aTeam).length;
      E.resolve(input, teams, CFG);
      eq(input.filter(m => m.aTeam).length, before, 'gefüllte Slots in der Eingabe');
      return 'rein, wie der Rest der Engine';
    });

    test('Fixture: der aufgelöste Spielplan bleibt konfliktfrei', () => {
      eq(E.errors(E.conflicts(resolved, teams, CFG)).length, 0, 'Fehler');
      return 'conflicts() sieht keinen Unterschied zum Original';
    });

    // ---- B. hand-built ------------------------------------------------

    test('Ein G:-Ref wartet auf die fertige Gruppentabelle', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const open = [
        match(1, 1, { aRef: 'T:A1', bRef: 'T:A2', aTeam: 'A1', bTeam: 'A2' }),
        match(2, 2, { phase: 'Platz', label: 'Spiel um Platz 1', aRef: 'G:A:1', bRef: 'G:A:2' }),
      ];
      eq(E.resolve(open, t, CFG)[1].aTeam, null, 'vor dem Ergebnis');

      open[0] = Object.assign({}, open[0], { sa: 6, sb: 2, status: 'done' });
      eq(E.resolve(open, t, CFG)[1].aTeam, 'A1', 'nach dem Ergebnis');
      return 'null, solange ein Gruppenspiel offen ist';
    });

    test('Ein B:-Ref trifft den Topfplatz aus §5.5', () => {
      const g = playedGroups(6);
      // Topf 3 sind die Dritten von A, B, C, D. In jeder Gruppe gewinnt die
      // kleinere Nummer, also ist der Dritte von B das Team B3.
      const end = [match(g.lastNr + 1, g.lastRound + 1, {
        phase: 'Platz', label: 'Spiel um Platz 9', aRef: 'B:3:2', bRef: 'B:3:3',
      })];
      const out = E.resolve(g.matches.concat(end), g.teams, CFG);
      const last = out[out.length - 1];
      eq(last.aTeam, 'B3', 'B:3:2');
      eq(last.bTeam, 'C3', 'B:3:3');
      return 'nach Rang, dann nach Gruppenbuchstabe';
    });

    test('Ein B:-Ref wartet auf alle vier Gruppen, nicht nur auf die eigene', () => {
      const g = playedGroups(4);
      // Ein einziges Spiel der Gruppe D wieder öffnen.
      const ms = g.matches.map(m => m.nr === g.lastNr
        ? Object.assign({}, m, { sa: null, sb: null, status: 'open' })
        : m);
      const end = [match(g.lastNr + 1, g.lastRound + 1, {
        phase: 'Platz', label: 'Spiel um Platz 9', aRef: 'B:3:1', bRef: 'B:3:2',
      })];
      const out = E.resolve(ms.concat(end), g.teams, CFG);
      eq(out[out.length - 1].aTeam, null, 'Topfplatz aus Gruppe A');
      return 'ein offenes Spiel in D hält Topf 3 komplett zurück';
    });

    test('Ein gelöschtes Ergebnis räumt den Folgeplatz wieder frei', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const played = [
        match(1, 1, { phase: 'VF', label: 'Viertelfinale 1', aRef: 'T:A1', bRef: 'T:A2',
          aTeam: 'A1', bTeam: 'A2', sa: 6, sb: 2, status: 'done' }),
        match(2, 2, { phase: 'HF', label: 'Halbfinale 1', aRef: 'W:1', bRef: 'L:1' }),
      ];
      eq(E.resolve(played, t, CFG)[1].aTeam, 'A1', 'mit Ergebnis');

      const cleared = E.enterResult(played, 1, { sa: null, sb: null, status: 'open' }, t, CFG);
      eq(cleared[1].aTeam, null, 'nach dem Löschen');
      return 'kein alter Name bleibt auf dem nächsten Platz stehen';
    });

    test('Ein Unentschieden im K.-o.-Spiel entscheidet nichts', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const drawn = [
        match(1, 1, { phase: 'VF', label: 'Viertelfinale 1', aRef: 'T:A1', bRef: 'T:A2',
          aTeam: 'A1', bTeam: 'A2', sa: 4, sb: 4, status: 'done' }),
        match(2, 2, { phase: 'HF', label: 'Halbfinale 1', aRef: 'W:1', bRef: 'L:1' }),
      ];
      eq(E.resolve(drawn, t, CFG)[1].aTeam, null, 'Sieger');
      return 'lieber offen als geraten';
    });

    test('Ein Walkover schlägt den eingetragenen Spielstand', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const abandoned = [
        match(1, 1, { phase: 'VF', label: 'Viertelfinale 1', aRef: 'T:A1', bRef: 'T:A2',
          aTeam: 'A1', bTeam: 'A2', sa: 1, sb: 5, status: 'done', wo: 'a' }),
        match(2, 2, { phase: 'HF', label: 'Halbfinale 1', aRef: 'W:1', bRef: 'L:1' }),
      ];
      eq(E.resolve(abandoned, t, CFG)[1].aTeam, 'A1', 'Sieger');
      return '§5.4: der Walkover ist das Ergebnis, nicht der Teilstand';
    });

    test('enterResult stempelt nur fertige Spiele', () => {
      const t = [team('A1', 'A'), team('A2', 'A')];
      const one = [match(1, 1, { aRef: 'T:A1', bRef: 'T:A2', aTeam: 'A1', bTeam: 'A2' })];

      const running = E.enterResult(one, 1, { status: 'playing', doneAt: '09:14' }, t, CFG);
      eq(running[0].status, 'playing', 'Status');
      eq(running[0].doneAt, '', 'Stempel');

      const finished = E.enterResult(one, 1, { sa: 6, sb: 3, doneAt: '09:14' }, t, CFG);
      eq(finished[0].status, 'done', 'Status ohne Angabe');
      eq(finished[0].doneAt, '09:14', 'Stempel');
      return '„läuft" ist keine Beobachtung einer Endzeit';
    });

    test('Ein Topf von drei spielt jeder gegen jeden aus', () => {
      const t = teams19();
      const rr = [
        rrMatch(1, 1, 'B:5:1', 'B:5:2', 'A5', 'B5', { sa: 6, sb: 1, status: 'done' }),
        rrMatch(2, 2, 'B:5:3', 'B:5:1', 'C5', 'A5', { sa: 6, sb: 0, status: 'done' }),
        rrMatch(3, 3, 'B:5:2', 'B:5:3', 'B5', 'C5', { sa: 6, sb: 5, status: 'done' }),
      ];
      const p = E.placement(rr, t, CFG).filter(x => x.place >= 17 && x.place <= 19);
      // Alle drei haben 3 Punkte; C5 +1, A5 +1, B5 -2. C5 und A5 trennt der
      // direkte Vergleich, den C5 gewonnen hat.
      eq(p.map(x => x.team).join(','), 'C5,A5,B5', 'Reihenfolge');
      eq(p[0].origin, '1. Platzierungsrunde Platz 17–19', 'Herkunft');
      return 'Punkte, Differenz, direkter Vergleich';
    });

    test('Ein unfertiger Topf von drei bleibt offen statt zu raten', () => {
      const t = teams19();
      const rr = [
        rrMatch(1, 1, 'B:5:1', 'B:5:2', 'A5', 'B5', { sa: 6, sb: 1, status: 'done' }),
        rrMatch(2, 2, 'B:5:3', 'B:5:1', 'C5', 'A5'),
        rrMatch(3, 3, 'B:5:2', 'B:5:3', 'B5', 'C5'),
      ];
      const p = E.placement(rr, t, CFG).filter(x => x.place >= 17 && x.place <= 19);
      eq(p.length, 3, 'gezeigte Plätze');
      eq(p.filter(x => x.team).length, 0, 'vergebene Plätze');
      return 'die Plätze stehen da, die Namen noch nicht';
    });

    // ---- §6.2: Verschieben und Vorziehen ------------------------------

    /*
     * Zwei Plätze, Runde 1 voll. Spiel 1 wird verschoben; Kandidaten sind die
     * Spiele aus Runde 2 und 3, deren Teams in Runde 1 nicht schon spielen.
     */
    const moveTeams = [];
    for (let i = 1; i <= 8; i++) moveTeams.push(team(`A${i}`, 'A'));
    for (let i = 1; i <= 8; i++) moveTeams.push(team(`B${i}`, 'B'));

    const pair = (nr, round, court, a, b) => match(nr, round, {
      court, label: a[0] === 'A' ? 'Gruppe A' : 'Gruppe B',
      aRef: `T:${a}`, bRef: `T:${b}`, aTeam: a, bTeam: b,
    });

    const board = [
      pair(1, 1, 1, 'A1', 'A2'),
      pair(2, 1, 2, 'A3', 'A4'),
      pair(3, 2, 1, 'A5', 'A6'),     // ausgeruht, gleiche Gruppe, gleicher Platz
      pair(4, 2, 2, 'B1', 'B2'),     // ausgeruht, andere Gruppe
      pair(5, 3, 1, 'A1', 'A3'),     // spielt in Runde 1 schon → kein Kandidat
      pair(6, 3, 2, 'B3', 'B4'),     // weiter weg
    ];
    const MOVE_CFG = Object.assign({}, CFG, { courts: 2 });
    const plan = E.delayPlan(board, moveTeams, MOVE_CFG, 1);
    summary.plan = plan;

    test('Der Vorschlag zieht kein Spiel vor, dessen Teams schon am Platz stehen', () => {
      eq(plan.candidates.some(c => c.nr === 5), false, 'Spiel 5 vorgeschlagen');
      return 'A1 und A3 spielen in Runde 1 bereits';
    });

    test('Der beste Vorschlag ist nah, ausgeruht und aus derselben Gruppe', () => {
      eq(plan.top[0].nr, 3, 'bester Vorschlag');
      eq(plan.top[0].reasons.join(' · '),
        'aus der nächsten Runde · gleiche Gruppe (A) · schon auf Platz 1', 'Begründung');
      return 'Spiel 3 — und die Begründung steht daneben';
    });

    test('Wer in der Runde davor gespielt hat, fällt hinter alles andere zurück', () => {
      /*
       * Spiel 3 aus Runde 2 wird verschoben. Spiel 5 wäre auf dem Papier der
       * perfekte Ersatz — nächste Runde, gleiche Gruppe, gleicher Platz — aber
       * A7 und A8 kommen gerade aus Runde 1. Genau der Vorschlag, den §10 als
       * „legal, aber gesellschaftlich absurd" beschreibt.
       */
      const tired = [
        pair(1, 1, 1, 'A7', 'A8'),
        pair(2, 1, 2, 'A3', 'A4'),
        pair(3, 2, 1, 'A5', 'A6'),
        pair(4, 2, 2, 'B1', 'B2'),
        pair(5, 3, 1, 'A7', 'A8'),
        pair(6, 3, 2, 'B3', 'B4'),
      ];
      const p = E.delayPlan(tired, moveTeams, MOVE_CFG, 3);
      const five = p.candidates.find(c => c.nr === 5);
      assert(five, 'Spiel 5 fehlt in den Kandidaten');
      eq(five.rested, false, 'ausgeruht');
      eq(five.reasons.indexOf('ein Team hat gerade gespielt') >= 0, true, 'Begründung');
      eq(p.top[0].nr, 6, 'bester Vorschlag');
      eq(p.candidates[p.candidates.length - 1].nr, 5, 'letzter Platz der Rangfolge');
      return 'drei Boni schlagen die Strafe nicht';
    });

    test('Höchstens drei Vorschläge, aber alle bleiben abrufbar', () => {
      assert(plan.top.length <= 3, `${plan.top.length} statt höchstens 3 Vorschläge`);
      assert(plan.candidates.length >= plan.top.length, 'candidates ist kürzer als top');
      return `${plan.top.length} von ${plan.candidates.length}`;
    });

    test('Das verschobene Spiel landet in der frühesten freien Runde', () => {
      // Runde 2 ist mit zwei Spielen bei zwei Plätzen voll, in Runde 3 spielt A1.
      eq(plan.target, 4, 'Zielrunde');
      return 'Runde 2 ist voll, in Runde 3 steht A1 schon auf dem Platz';
    });

    test('Jeder Vorschlag nimmt die Runde mit, die er selbst frei macht', () => {
      for (const c of plan.candidates) eq(c.target, c.round, `Zielrunde für Spiel ${c.nr}`);
      return 'auf einem vollen Spielplan ist Verschieben ein Tausch';
    });

    test('Ein Vorschlag, dessen Tausch nicht aufgeht, wird gar nicht angeboten', () => {
      // Spiel 6 steht in Runde 3, in der A1 schon spielt — Spiel 1 kann dort
      // nicht hin, also ist Spiel 6 kein Tauschpartner.
      eq(plan.candidates.some(c => c.nr === 6), false, 'Spiel 6 vorgeschlagen');
      return 'lieber ein Vorschlag weniger als einer, der nicht geht';
    });

    /*
     * §7: die Endrunde liest die Gruppentabellen. Ein Gruppenspiel dahinter zu
     * schieben bricht nicht eine Regel, sondern jedes Endrundenspiel auf
     * einmal — der Grund, warum delayLimit() mehr kennt als W: und L:.
     */
    const groupBound = () => {
      const t = ['A1', 'A2', 'A3', 'A4'].map(id => team(id, 'A'));
      const ms = [
        match(1, 1, { aRef: 'T:A1', bRef: 'T:A2', aTeam: 'A1', bTeam: 'A2' }),
        match(2, 2, { aRef: 'T:A3', bRef: 'T:A4', aTeam: 'A3', bTeam: 'A4' }),
      ];
      const endrunde = match(3, 3, {
        phase: 'Platz', label: 'Spiel um Platz 1', aRef: 'G:A:1', bRef: 'G:A:2',
      });
      return { t, ms, endrunde, cfg: Object.assign({}, CFG, { courts: 1 }) };
    };

    test('Ohne Endrunde darf ein Gruppenspiel bis ans Ende wandern', () => {
      const b = groupBound();
      eq(E.delayPlan(b.ms, b.t, b.cfg, 1).target, 3, 'Zielrunde');
      return 'Runde 2 ist bei einem Platz belegt, Runde 3 ist frei';
    });

    test('Mit Endrunde bleibt dasselbe Gruppenspiel in der Gruppenphase', () => {
      const b = groupBound();
      const p = E.delayPlan(b.ms.concat([b.endrunde]), b.t, b.cfg, 1);
      eq(p.target, null, 'Zielrunde ohne Tausch');
      // Runde 3 liest die Gruppentabelle, also darf kein Vorschlag dorthin führen.
      eq(p.candidates.every(c => c.target <= 2), true, 'Vorschläge bis Runde 2');
      eq(p.top.map(c => `${c.nr}->R${c.target}`).join(','), '2->R2', 'Vorschlag');
      return 'nur noch der Tausch mit Runde 2 — Runde 3 gehört der Endrunde';
    });

    test('Der Tausch mit der Endrunde davor bleibt konfliktfrei', () => {
      const b = groupBound();
      const all = b.ms.concat([b.endrunde]);
      const moved = E.applyMove(all, b.cfg, { nr: 1, toRound: 2, promote: 2 });
      eq(E.errors(E.conflicts(moved, b.t, b.cfg)).length, 0, 'Fehler');
      eq(moved.find(m => m.nr === 1).round, 2, 'Runde von Spiel 1');
      eq(moved.find(m => m.nr === 2).round, 1, 'Runde von Spiel 2');
      return 'die beiden tauschen Runde und Platz, §7 hat nichts einzuwenden';
    });

    test('Ein verschobenes Spiel bleibt vor dem, was auf sein Ergebnis wartet', () => {
      const t = [team('A1', 'A'), team('A2', 'A'), team('A3', 'A')];
      const bracket = [
        match(1, 1, { phase: 'VF', label: 'Viertelfinale 1', aRef: 'T:A1', bRef: 'T:A2',
          aTeam: 'A1', bTeam: 'A2' }),
        match(2, 2, { phase: 'HF', label: 'Halbfinale 1', aRef: 'W:1', bRef: 'T:A3',
          aTeam: null, bTeam: 'A3' }),
      ];
      eq(E.delayPlan(bracket, t, Object.assign({}, CFG, { courts: 1 }), 1).target, null, 'Zielrunde');
      return 'lieber kein Vorschlag als einer, den §7 sofort zurückweist';
    });

    test('Der angewandte Zug tauscht Runde und Platz und sonst nichts', () => {
      const moved = E.applyMove(board, MOVE_CFG, { nr: 1, toRound: 4, promote: 3 });
      const one = moved.find(m => m.nr === 1);
      const three = moved.find(m => m.nr === 3);
      eq(one.round, 4, 'Runde des verschobenen Spiels');
      eq(three.round, 1, 'Runde des vorgezogenen Spiels');
      eq(three.court, 1, 'Platz des vorgezogenen Spiels');
      eq(one.aTeam, 'A1', 'Teams unverändert');
      eq(board.find(m => m.nr === 1).round, 1, 'Eingabe unverändert');
      return 'Spiel 1 nach Runde 4, Spiel 3 auf den frei gewordenen Platz 1';
    });

    test('Der angewandte Zug ist konfliktfrei', () => {
      const moved = E.applyMove(board, MOVE_CFG, { nr: 1, toRound: 4, promote: 3 });
      eq(E.errors(E.conflicts(moved, moveTeams, MOVE_CFG)).length, 0, 'Fehler');
      return 'conflicts() bleibt das Netz, aber es fängt hier nichts';
    });

    return { results, summary };
  }

  return { run };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ResolveTests;
