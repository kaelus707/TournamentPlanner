/*
 * Tournament engine — validation and standings.
 *
 * conflicts(matches, teams, config) is the safety net described in SPEC.md §7.
 * standings(matches, teams, config) is the group table engine of SPEC.md §5.4.
 *
 * Both are pure: they read their three inputs, mutate nothing, and return a
 * plain array. Neither decides anything — the caller shows the result, blocks
 * on errors and may override warnings.
 *
 * Loads as a plain <script> in the browser; also requireable from Node so the
 * same code can be exercised from a terminal. No build step either way.
 */
const TournamentEngine = (() => {
  'use strict';

  // ---------------------------------------------------------------- issues

  const issue = (severity, code, message, extra) =>
    Object.assign({ severity, code, message, round: null, matches: [], teams: [] }, extra);

  const errors   = list => list.filter(i => i.severity === 'error');
  const warnings = list => list.filter(i => i.severity === 'warning');

  // --------------------------------------------------------------- helpers

  function indexTeams(teams) {
    const byId = new Map();
    for (const t of teams || []) byId.set(t.id, t);
    return byId;
  }

  const label = (teams, id) => {
    const t = teams.get(id);
    return t ? `${t.p1} / ${t.p2}` : id;
  };

  /** Matches keyed by round, rounds ascending. Matches without a round are skipped. */
  function groupByRound(matches) {
    const rounds = new Map();
    for (const m of matches) {
      if (m.round == null) continue;
      if (!rounds.has(m.round)) rounds.set(m.round, []);
      rounds.get(m.round).push(m);
    }
    return new Map([...rounds].sort((a, b) => a[0] - b[0]));
  }

  /** Which group a group-phase match belongs to, via its teams. */
  function groupOfMatch(m, teams) {
    for (const id of [m.aTeam, m.bTeam]) {
      const t = id && teams.get(id);
      if (t && t.group) return t.group;
    }
    return null;
  }

  /** group letter -> last round in which that group still plays. */
  function groupPhaseEnd(matches, teams) {
    const last = new Map();
    for (const m of matches) {
      if (m.phase !== 'Gruppe' || m.round == null) continue;
      const g = groupOfMatch(m, teams);
      if (!g) continue;
      if (!last.has(g) || m.round > last.get(g)) last.set(g, m.round);
    }
    return last;
  }

  const surnameOf = name => String(name || '').trim().split(/\s+/)[0] || '';

  // ------------------------------------------------------------------ refs

  const isInt = s => /^\d+$/.test(s);

  /*
   * Ref forms are SPEC.md §6.3: G:<group>:<rank>, W:<nr>, L:<nr>, B:<bucket>:<rank>.
   *
   * T:<teamId> is added here for a slot whose team is known the moment the
   * schedule is generated — every group-phase slot. §6.3 lists only the four
   * derived forms and does not name this case, so the engine defines it.
   */
  function parseRef(ref) {
    if (typeof ref !== 'string' || ref === '') return { kind: 'none' };
    const p = ref.split(':');
    if (p[0] === 'T' && p.length === 2 && p[1]) return { kind: 'T', team: p[1] };
    if (p[0] === 'G' && p.length === 3 && p[1] && isInt(p[2])) return { kind: 'G', group: p[1], rank: +p[2] };
    if (p[0] === 'W' && p.length === 2 && isInt(p[1])) return { kind: 'W', src: +p[1] };
    if (p[0] === 'L' && p.length === 2 && isInt(p[1])) return { kind: 'L', src: +p[1] };
    if (p[0] === 'B' && p.length === 3 && isInt(p[1]) && isInt(p[2])) return { kind: 'B', bucket: +p[1], rank: +p[2] };
    return { kind: 'bad' };
  }

  // ---------------------------------------------------------------- checks

  /** §7: team appears twice in the same round — error. */
  function checkTeamTwiceInRound(out, rounds, teams) {
    for (const [round, ms] of rounds) {
      const where = new Map();
      for (const m of ms) {
        for (const id of [m.aTeam, m.bTeam]) {
          if (!id) continue;
          if (!where.has(id)) where.set(id, []);
          where.get(id).push(m.nr);
        }
      }
      for (const [id, nrs] of where) {
        if (nrs.length < 2) continue;
        out.push(issue('error', 'team-twice-in-round',
          `Runde ${round}: ${label(teams, id)} steht in ${nrs.length} Spielen gleichzeitig (${nrs.join(', ')}).`,
          { round, matches: nrs, teams: [id] }));
      }
    }
  }

  /** §7: court double-booked in the same round — error. */
  function checkCourtDoubleBooked(out, rounds) {
    for (const [round, ms] of rounds) {
      const where = new Map();
      for (const m of ms) {
        if (m.court == null) continue;
        if (!where.has(m.court)) where.set(m.court, []);
        where.get(m.court).push(m.nr);
      }
      for (const [court, nrs] of where) {
        if (nrs.length < 2) continue;
        out.push(issue('error', 'court-double-booked',
          `Runde ${round}: Platz ${court} ist doppelt belegt (Spiele ${nrs.join(', ')}).`,
          { round, matches: nrs }));
      }
    }
  }

  /** §7: more matches in a round than courts — error. */
  function checkRoundCapacity(out, rounds, config) {
    const courts = config && config.courts;
    if (!courts) return;
    for (const [round, ms] of rounds) {
      if (ms.length <= courts) continue;
      out.push(issue('error', 'round-over-capacity',
        `Runde ${round}: ${ms.length} Spiele bei nur ${courts} Plätzen.`,
        { round, matches: ms.map(m => m.nr) }));
    }
  }

  /** §7: team plays in consecutive rounds — warning. */
  function checkConsecutiveRounds(out, matches, teams) {
    const played = new Map();
    for (const m of matches) {
      if (m.round == null) continue;
      for (const id of [m.aTeam, m.bTeam]) {
        if (!id) continue;
        if (!played.has(id)) played.set(id, new Map());
        if (!played.get(id).has(m.round)) played.get(id).set(m.round, m.nr);
      }
    }
    for (const [id, rounds] of played) {
      const list = [...rounds.keys()].sort((a, b) => a - b);
      for (let i = 1; i < list.length; i++) {
        if (list[i] !== list[i - 1] + 1) continue;
        out.push(issue('warning', 'consecutive-rounds',
          `${label(teams, id)} spielt in Runde ${list[i - 1]} und ${list[i]} ohne Pause.`,
          { round: list[i], matches: [rounds.get(list[i - 1]), rounds.get(list[i])], teams: [id] }));
      }
    }
  }

  /** §7: a match's refs point to a source that is not decided earlier — error. */
  function checkRefsDecided(out, matches, teams, byNr, lastGroupRound) {
    for (const m of matches) {
      for (const raw of [m.aRef, m.bRef]) {
        const ref = parseRef(raw);

        if (ref.kind === 'none') continue;

        if (ref.kind === 'bad') {
          out.push(issue('error', 'ref-malformed',
            `Spiel ${m.nr}: unbekannte Referenz „${raw}".`,
            { round: m.round, matches: [m.nr] }));
          continue;
        }

        if (ref.kind === 'T') {
          if (!teams.has(ref.team)) {
            out.push(issue('error', 'unknown-team',
              `Spiel ${m.nr}: Team „${ref.team}" steht nicht in der Teamliste.`,
              { round: m.round, matches: [m.nr], teams: [ref.team] }));
          }
          continue;
        }

        if (ref.kind === 'W' || ref.kind === 'L') {
          const src = byNr.get(ref.src);
          if (!src) {
            out.push(issue('warning', 'ref-source-unknown',
              `Spiel ${m.nr}: Referenz „${raw}" zeigt auf ein Spiel, das es nicht gibt.`,
              { round: m.round, matches: [m.nr] }));
            continue;
          }
          if (m.round == null || src.round == null) continue;
          if (src.round >= m.round) {
            out.push(issue('error', 'ref-not-decided',
              `Spiel ${m.nr} (Runde ${m.round}) hängt von Spiel ${src.nr} ab, das nicht früher stattfindet (Runde ${src.round}).`,
              { round: m.round, matches: [m.nr, src.nr] }));
          }
          continue;
        }

        if (ref.kind === 'G') {
          const last = lastGroupRound.get(ref.group);
          if (last == null) {
            out.push(issue('warning', 'ref-source-unknown',
              `Spiel ${m.nr}: Referenz „${raw}" verweist auf Gruppe ${ref.group}, zu der es keine Gruppenspiele gibt.`,
              { round: m.round, matches: [m.nr] }));
            continue;
          }
          if (m.round != null && last >= m.round) {
            out.push(issue('error', 'ref-not-decided',
              `Spiel ${m.nr} (Runde ${m.round}) braucht die Endtabelle von Gruppe ${ref.group}, die erst nach Runde ${last} feststeht.`,
              { round: m.round, matches: [m.nr] }));
          }
          continue;
        }

        // ref.kind === 'B': a bucket ref cannot be ordered-checked yet. The
        // match model carries no bucket id, so there is no way to find the
        // matches that decide bucket N. Revisit in build step 6, which is what
        // introduces B: refs in the first place. The 2026 fixture uses none.
      }
    }
  }

  /** §7: group sizes differ by more than one — warning. */
  function checkGroupSizes(out, teams) {
    const sizes = new Map();
    for (const t of teams.values()) {
      if (!t.group) continue;
      sizes.set(t.group, (sizes.get(t.group) || 0) + 1);
    }
    if (sizes.size < 2) return;
    const counts = [...sizes.values()];
    const spread = Math.max(...counts) - Math.min(...counts);
    if (spread <= 1) return;
    const shown = [...sizes].sort().map(([g, n]) => `${g}:${n}`).join(', ');
    out.push(issue('warning', 'group-size-spread',
      `Gruppengrößen unterscheiden sich um ${spread} (${shown}).`, {}));
  }

  /** §7: two teams share a surname within one group — warning. */
  function checkDuplicateSurnames(out, teams) {
    const perGroup = new Map();
    for (const t of teams.values()) {
      if (!t.group) continue;
      if (!perGroup.has(t.group)) perGroup.set(t.group, new Map());
      const names = perGroup.get(t.group);
      for (const player of [t.p1, t.p2]) {
        const s = surnameOf(player);
        if (!s) continue;
        if (!names.has(s)) names.set(s, new Set());
        names.get(s).add(t.id);
      }
    }
    for (const [group, names] of [...perGroup].sort()) {
      for (const [surname, ids] of [...names].sort()) {
        if (ids.size < 2) continue;
        out.push(issue('warning', 'duplicate-surname',
          `Gruppe ${group}: „${surname}" kommt in mehreren Teams vor (${[...ids].join(', ')}).`,
          { teams: [...ids] }));
      }
    }
  }

  // ------------------------------------------------------------- standings

  const WIN = 3, DRAW = 1;

  /** config.walkover ("2:0") -> [winnerScore, loserScore]. Defaults to 2:0. */
  function walkoverScore(config) {
    const m = /^(\d+)\s*:\s*(\d+)$/.exec(String((config && config.walkover) || '').trim());
    return m ? [+m[1], +m[2]] : [2, 0];
  }

  /**
   * The scores a match contributes, or null if it contributes nothing yet.
   *
   * A walkover overrides sa/sb: §5.4 says it counts as a normal result with the
   * configured score, so that is what the table sees. Otherwise both scores
   * must be present. `status` is deliberately not consulted — a match carrying
   * two scores has a result whether or not someone remembered to tap "fertig",
   * and a table that ignores an entered score is worse than one that is a
   * minute early.
   */
  function resultOf(m, wo) {
    if (m.wo === 'a') return [wo[0], wo[1]];
    if (m.wo === 'b') return [wo[1], wo[0]];
    if (m.sa == null || m.sb == null) return null;
    return [m.sa, m.sb];
  }

  const emptyRow = t => ({
    id: t.id, group: t.group, rank: 0,
    sp: 0, s: 0, u: 0, n: 0,
    gf: 0, ga: 0, diff: 0, pkt: 0,
    decider: Number(t.decider) || 0,
    tied: false,
  });

  /** Add one played match to one team's row, from that team's point of view. */
  function tally(row, own, other) {
    row.sp++;
    row.gf += own;
    row.ga += other;
    if (own > other) { row.s++; row.pkt += WIN; }
    else if (own === other) { row.u++; row.pkt += DRAW; }
    else { row.n++; }
    row.diff = row.gf - row.ga;
  }

  /*
   * §5.4: Punkte → Differenz → Siege → manueller Entscheid.
   *
   * The id compare is a fifth step the spec does not name. Without it two rows
   * the organizer has not separated would land in whatever order the input
   * happened to arrive in, and the same tournament would rank differently on a
   * reload. Ties that reach it are reported as `tied` rather than hidden.
   */
  function compareRows(a, b) {
    return b.pkt - a.pkt
        || b.diff - a.diff
        || b.s - a.s
        || b.decider - a.decider
        || String(a.id).localeCompare(String(b.id));
  }

  /**
   * True when nothing the engine knows separates these two rows. Requires both
   * to have played: before the first result every table is all-zero, and
   * flagging that as an unresolved tie would be noise, not information.
   */
  const unresolvedTie = (a, b) =>
    a.sp > 0 && b.sp > 0 &&
    a.pkt === b.pkt && a.diff === b.diff && a.s === b.s && a.decider === b.decider;

  /**
   * Group tables, flat, sorted by group then rank — one entry per `G` line of
   * the WEB format (§8).
   *
   * Membership comes from `teams`, not from the matches: `group` is stored data
   * (§3.2), so a team that has not played yet still appears with a zero row.
   */
  function standings(matches, teams, config) {
    const wo = walkoverScore(config);

    const rows = new Map();
    for (const t of teams || []) {
      if (!t.group) continue;
      rows.set(t.id, emptyRow(t));
    }

    for (const m of matches || []) {
      if (m.phase !== 'Gruppe') continue;
      const result = resultOf(m, wo);
      if (!result) continue;
      const a = rows.get(m.aTeam);
      const b = rows.get(m.bTeam);
      // An unknown or ungrouped team is a data problem, and conflicts() is
      // where data problems are reported. Here it simply does not count.
      if (!a || !b) continue;
      tally(a, result[0], result[1]);
      tally(b, result[1], result[0]);
    }

    const out = [];
    const groups = [...new Set([...rows.values()].map(r => r.group))].sort();
    for (const g of groups) {
      const table = [...rows.values()].filter(r => r.group === g).sort(compareRows);
      table.forEach((r, i) => {
        r.rank = i + 1;
        r.tied = (i > 0 && unresolvedTie(table[i - 1], r)) ||
                 (i < table.length - 1 && unresolvedTie(table[i + 1], r));
      });
      out.push(...table);
    }
    return out;
  }

  // ------------------------------------------------------------------ main

  function conflicts(matches, teams, config) {
    const out = [];
    const ms = [...(matches || [])].sort((a, b) => (a.nr || 0) - (b.nr || 0));
    const teamIdx = indexTeams(teams);
    const rounds = groupByRound(ms);
    const byNr = new Map(ms.map(m => [m.nr, m]));
    const lastGroupRound = groupPhaseEnd(ms, teamIdx);

    checkTeamTwiceInRound(out, rounds, teamIdx);
    checkCourtDoubleBooked(out, rounds);
    checkRoundCapacity(out, rounds, config);
    checkRefsDecided(out, ms, teamIdx, byNr, lastGroupRound);
    checkConsecutiveRounds(out, ms, teamIdx);
    checkGroupSizes(out, teamIdx);
    checkDuplicateSurnames(out, teamIdx);

    return out;
  }

  return { conflicts, standings, parseRef, errors, warnings, surnameOf, walkoverScore };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TournamentEngine;
