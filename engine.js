/*
 * Tournament engine.
 *
 * conflicts(matches, teams, config)  the safety net of SPEC.md §7
 * standings(matches, teams, config)  the group tables of §5.4
 * timeline(matches, config)          the timing model of §6.1
 * allocation({ teams, courts, … })   the duration preview of §5.2
 *
 * All four are pure: they read their inputs, mutate nothing, and return plain
 * data. None of them decides anything — the caller shows the result, blocks on
 * errors and may override warnings.
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

  /**
   * §7: a group-phase match between two different groups — error.
   *
   * The generator cannot produce this; a hand-edited `group` cell can. It is an
   * error rather than a warning because standings() would silently count the
   * match in both tables, so two group tables would be wrong at once with
   * nothing on screen to say why.
   */
  function checkCrossGroupMatch(out, matches, teams) {
    for (const m of matches) {
      if (m.phase !== 'Gruppe') continue;
      const a = m.aTeam && teams.get(m.aTeam);
      const b = m.bTeam && teams.get(m.bTeam);
      if (!a || !b || !a.group || !b.group || a.group === b.group) continue;
      out.push(issue('error', 'cross-group-match',
        `Spiel ${m.nr}: Gruppenspiel zwischen Gruppe ${a.group} (${label(teams, m.aTeam)}) ` +
        `und Gruppe ${b.group} (${label(teams, m.bTeam)}).`,
        { round: m.round, matches: [m.nr], teams: [m.aTeam, m.bTeam] }));
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

  // ---------------------------------------------------------------- timing

  /** "09:00" -> 540 minutes since midnight. Null when it cannot be read. */
  function toMinutes(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text == null ? '' : text).trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }

  /**
   * 545 -> "09:05". Hours are deliberately not wrapped at 24: a tournament
   * that computes past midnight has a configuration problem, and "25:10" says
   * so where "01:10" would quietly hide it.
   */
  function hhmm(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60);
    const m = Math.round(min - h * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** config.finalMode: "set" (open-ended) or a number of minutes. */
  function finalMinutes(config) {
    const raw = config && config.finalMode;
    const text = String(raw == null ? '' : raw).trim();
    const n = Number(text);
    return text !== '' && Number.isFinite(n) ? n : null;
  }

  /**
   * §6.1: matchMin, or semiMin for a round containing a semi-final.
   *
   * A round containing an open-ended final has no duration at all — null, not
   * zero, so "unknown" cannot be mistaken for "instant" by anything adding it
   * up downstream.
   */
  function durationOf(ms, config) {
    const matchMin = Number(config && config.matchMin) || 0;
    if (ms.some(m => m.phase === 'Finale')) return finalMinutes(config);
    if (ms.some(m => m.phase === 'HF')) return Number(config && config.semiMin) || matchMin;
    return matchMin;
  }

  /** Total break minutes booked after this round (§3.1 — breaks anchor to rounds). */
  function breakAfter(config, round) {
    let total = 0;
    for (const b of (config && config.breaks) || []) {
      if (Number(b.afterRound) === round) total += Number(b.min) || 0;
    }
    return total;
  }

  /** §6.1: a round is complete when every match in it has status "done". */
  const isComplete = ms => ms.length > 0 && ms.every(m => m.status === 'done');

  /**
   * Clock time of the last result entered in this round, or null when the round
   * carries no `doneAt` stamp at all.
   *
   * Null is the normal case for historical data written before the column
   * existed — the 2026 fixture is entirely stamp-free. The caller falls back to
   * the computed end rather than treating a missing stamp as midnight.
   */
  function lastResultIn(ms) {
    let last = null;
    for (const m of ms) {
      const t = toMinutes(m.doneAt);
      if (t != null && (last == null || t > last)) last = t;
    }
    return last;
  }

  /**
   * One row per round, ascending — the whole timing model of §6.1 in one pass.
   *
   *   planned = config.start + Σ (duration + breaks) over earlier rounds
   *   start   = max(planned, end of the previous round)
   *   end     = last result stamp if complete, else start + duration
   *
   * The break after a late round is absorbed, not appended: `start` maxes
   * against the previous round's raw end, so a round that overruns eats into
   * the Platzpflege instead of pushing it. That is §6.1 read literally, and it
   * is also what actually happens on a court.
   */
  function timeline(matches, config) {
    const ms = [...(matches || [])].sort((a, b) => (a.nr || 0) - (b.nr || 0));
    const rounds = groupByRound(ms);

    const out = [];
    let planned = toMinutes(config && config.start);
    let previousEnd = null;

    for (const [round, inRound] of rounds) {
      const duration = durationOf(inRound, config);
      const complete = isComplete(inRound);

      const start = planned == null ? previousEnd
                  : previousEnd == null ? planned
                  : Math.max(planned, previousEnd);

      const stamped = complete ? lastResultIn(inRound) : null;
      const end = stamped != null ? stamped
                : (duration == null || start == null) ? null
                : start + duration;

      out.push({
        round,
        nrs: inRound.map(m => m.nr),
        duration,
        planned,
        start,
        end,
        delta: (start == null || planned == null) ? 0 : start - planned,
        complete,
        // An open round is one whose end cannot be computed: the open-ended
        // final, until someone stamps a result on it.
        open: end == null,
      });

      if (planned != null) planned += (duration || 0) + breakAfter(config, round);
      previousEnd = end;
    }

    return out;
  }

  /**
   * §9.1: the current round is the first incomplete one. Returns the row, or
   * null once everything is played. This is the fix for the 2026 bug where a
   * single unplayed match pinned "Jetzt" to an early time block — completeness
   * decides, not the clock.
   */
  const currentRound = rows => (rows || []).find(r => !r.complete) || null;

  // ------------------------------------------------------------ allocation

  const MIN_TEAMS = 16, MAX_TEAMS = 32;
  const GROUP_LETTERS = ['A', 'B', 'C', 'D'];

  /*
   * §5.5 bracket table. Only these five sizes can occur: the top bucket is
   * always eight, a rank bucket is at most four because there are four groups,
   * and the singleton merge produces five.
   *
   * `solo` counts the matches §5.6 puts alone on court 1 — the two semi-finals,
   * the third-place match and the final. `depth` is the number of sequential
   * stages the *rest* of the bracket needs, which is the floor on how far it
   * can be compressed no matter how many courts are free.
   */
  const BRACKETS = {
    2: { matches: 1,  depth: 1, solo: 0 },  // one match
    3: { matches: 3,  depth: 3, solo: 0 },  // round robin, three teams, one match at a time
    4: { matches: 4,  depth: 2, solo: 0 },  // two semis, then winners' and losers' final
    5: { matches: 5,  depth: 3, solo: 0 },  // the 4-bracket, then 5th against its 4th
    8: { matches: 12, depth: 3, solo: 4 },  // VF, 5–8-Runde, Spiele um 5 und 7 — plus the four solo rounds
  };

  /**
   * §5.1: four groups, sizes differing by at most one. Base size is floor(N/4)
   * and the first N mod 4 groups get one extra, so 30 becomes 8/8/7/7.
   */
  function groupSizes(n) {
    const base = Math.floor(n / GROUP_LETTERS.length);
    const extra = n % GROUP_LETTERS.length;
    return GROUP_LETTERS.map((group, i) => ({ group, size: base + (i < extra ? 1 : 0) }));
  }

  const roundRobinMatches = m => (m * (m - 1)) / 2;

  /**
   * Group-rounds the circle method yields for a group of m (§5.3): m-1, or m
   * when m is odd, because then one team sits out each round.
   */
  const circleRounds = m => (m < 2 ? 0 : m % 2 === 0 ? m - 1 : m);

  /**
   * §5.5: teams bucketed by group position. Ranks 1 and 2 form a single bucket
   * of eight; every lower rank forms a bucket from the groups that reach it.
   *
   * A trailing bucket of one (N ≡ 1 mod 4) is merged into the bucket above it.
   * That merge is what produces the size-5 bracket §5.5 describes — it is not
   * an edge case bolted on afterwards, it is the only way a five can arise.
   *
   * Accepts either the objects groupSizes() returns or plain numbers.
   */
  function buckets(sizes) {
    const counts = (sizes || []).map(g => Number(typeof g === 'number' ? g : g && g.size) || 0);
    const membersAt = rank => counts.filter(s => s >= rank).length;
    const deepest = counts.length ? Math.max(...counts) : 0;

    const out = [];
    const top = membersAt(1) + membersAt(2);
    if (top > 0) out.push({ ranks: [1, 2], size: top });
    for (let rank = 3; rank <= deepest; rank++) {
      const size = membersAt(rank);
      if (size > 0) out.push({ ranks: [rank], size });
    }

    const last = out[out.length - 1];
    if (out.length > 1 && last.size === 1) {
      out.pop();
      const previous = out[out.length - 1];
      previous.size += 1;
      previous.ranks = previous.ranks.concat(last.ranks);
    }

    let place = 1;
    for (const b of out) {
      b.firstPlace = place;
      b.lastPlace = place + b.size - 1;
      b.matches = BRACKETS[b.size] ? BRACKETS[b.size].matches : null;
      place = b.lastPlace + 1;
    }
    return out;
  }

  /**
   * §5.3: group matches packed onto the courts, with two rounds of the same
   * group kept two global rounds apart.
   *
   * Capacity is usually what binds, but not always: a group whose circle method
   * yields R rounds occupies at least 2R-1 global rounds, and with many courts
   * and small groups that spacing is the larger number.
   */
  function groupPhaseRounds(groups, courts) {
    const matches = groups.reduce((sum, g) => sum + roundRobinMatches(g.size), 0);
    const capacity = courts > 0 ? Math.ceil(matches / courts) : 0;
    const spacing = Math.max(0, ...groups.map(g => 2 * circleRounds(g.size) - 1));
    return { matches, rounds: Math.max(capacity, spacing) };
  }

  /**
   * §5.6: the endrunde packed the same way, with one exception. The two
   * semi-finals, the third-place match and the final are alone on court 1, so
   * they cost one round each however many courts stand empty. Everything else
   * shares the courts, floored by the deepest bracket.
   */
  function endPhaseRounds(list, courts) {
    let shared = 0, solo = 0, depth = 0;
    for (const b of list) {
      const bracket = BRACKETS[b.size];
      if (!bracket) continue;
      shared += bracket.matches - bracket.solo;
      solo += bracket.solo;
      depth = Math.max(depth, bracket.depth);
    }
    const capacity = courts > 0 ? Math.ceil(shared / courts) : 0;
    return { matches: shared + solo, rounds: Math.max(capacity, depth) + solo };
  }

  /**
   * The planned clock of a day of `rounds` rounds — §6.1 before any result
   * exists, so `liveStart` is always `plannedStart` and nothing has drifted.
   *
   * The durations are known without a schedule because §5.6 fixes the tail: the
   * last four rounds are Halbfinale, Halbfinale, Spiel um Platz 3, Finale. Only
   * the two semi-finals run at semiMin; the third-place match is an ordinary
   * round again.
   *
   * `finish` is null for an open-ended final — §6.1 gives that round no
   * duration, and inventing one here would be the same mistake in a new place.
   * `finalStart` is the number that still holds in that case.
   */
  function plannedFinish(rounds, config) {
    if (!(rounds > 0)) return { finalStart: null, finish: null };
    const start = toMinutes(config && config.start);
    if (start == null) return { finalStart: null, finish: null };

    const matchMin = Number(config && config.matchMin) || 0;
    const semiMin = Number(config && config.semiMin) || matchMin;

    let pause = 0;
    for (const b of (config && config.breaks) || []) {
      if (Number(b.afterRound) < rounds) pause += Number(b.min) || 0;
    }

    // Everything before the final, i.e. rounds 1 … rounds-1: that is rounds-3
    // rounds at matchMin (the ordinary ones plus the third-place match) and two
    // at semiMin.
    const finalStart = start
      + Math.max(0, rounds - 3) * matchMin
      + Math.min(2, rounds - 1) * semiMin
      + pause;

    const minutes = finalMinutes(config);
    return { finalStart, finish: minutes == null ? null : finalStart + minutes };
  }

  /**
   * §5.2: the allocation screen in one call. Everything the organizer sees
   * while turning the team count and the court count over — and the finish
   * time, which is the number the decision actually turns on.
   *
   * Outside 16–32 teams it refuses (§5.1) rather than hand back a plausible
   * plan for a tournament this format cannot run.
   *
   * The two round counts are estimates: they are the best the packing rules of
   * §5.3 and §5.6 allow. The generators of build steps 4 and 6 may need a round
   * more, and once a schedule exists timeline() is the truth.
   */
  function allocation(input) {
    const cfg = input || {};
    const n = Number(cfg.teams);
    const courts = Number(cfg.courts);
    const problems = [];

    if (!Number.isInteger(n) || n < MIN_TEAMS || n > MAX_TEAMS) {
      problems.push(issue('error', 'team-count-out-of-range',
        `${cfg.teams} Teams: das Format ist für ${MIN_TEAMS} bis ${MAX_TEAMS} Teams gedacht.`, {}));
    }
    if (!Number.isInteger(courts) || courts < 1) {
      problems.push(issue('error', 'no-courts',
        `${cfg.courts} Plätze: ohne mindestens einen Platz lässt sich nichts planen.`, {}));
    }
    if (problems.length) return { ok: false, problems, teams: cfg.teams, courts: cfg.courts };

    const groups = groupSizes(n);
    const list = buckets(groups);
    for (const b of list.filter(x => !BRACKETS[x.size])) {
      problems.push(issue('error', 'no-bracket',
        `Für einen Topf von ${b.size} Teams (Plätze ${b.firstPlace}–${b.lastPlace}) gibt es keinen Spielplan.`, {}));
    }

    const group = groupPhaseRounds(groups, courts);
    const end = endPhaseRounds(list, courts);
    const rounds = group.rounds + end.rounds;
    const clock = plannedFinish(rounds, cfg);

    return {
      ok: problems.length === 0,
      problems,
      teams: n,
      courts,
      groups,
      buckets: list,
      groupMatches: group.matches,
      groupRounds: group.rounds,
      endMatches: end.matches,
      endRounds: end.rounds,
      matches: group.matches + end.matches,
      rounds,
      start: toMinutes(cfg.start),
      finalStart: clock.finalStart,
      finish: clock.finish,
    };
  }

  // ------------------------------------------------------- group generator

  /*
   * How many greedy attempts the packer makes. §5.3 asks for "a greedy pass
   * with a few randomised restarts" and explicitly warns off cleverness; the
   * restarts are what turn a merely legal packing into a tight one, and twelve
   * of them cost a few milliseconds on the largest tournament this format runs.
   */
  const RESTARTS = 12;

  /**
   * Deterministic PRNG (xorshift32).
   *
   * The generator makes random choices, and the same seed has to give the same
   * schedule every time. An organizer who regenerates after fixing a misspelled
   * name must get their plan back, not a different tournament.
   */
  function randomFrom(seed) {
    let s = (Number(seed) >>> 0) || 0x9e3779b9;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  function shuffled(list, random) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  /**
   * §3.2: fills the `group` column.
   *
   * The sizes are §5.1's; which team lands in which group is the draw itself.
   * It is seeded for the same reason the packer is — a redraw after a
   * correction should return the same groups, not a new tournament — and the
   * organizer can overwrite any cell afterwards, because `group` is stored
   * data and not a derivation.
   */
  function draw(teams, config) {
    const list = teams || [];
    const order = shuffled(list.map(t => t.id), randomFrom(config && config.seed));
    const group = new Map();
    let at = 0;
    for (const g of groupSizes(order.length)) {
      for (let i = 0; i < g.size; i++) group.set(order[at++], g.group);
    }
    return list.map(t => Object.assign({}, t, { group: group.get(t.id) }));
  }

  /**
   * §5.3 step 1: the circle method. One team is held in place while the rest
   * rotate around it, so every pair meets exactly once — m-1 rounds for even m,
   * and m rounds with one team resting each time for odd m.
   *
   * Which side takes the A slot alternates by round, so that no team ends up
   * the left-hand name on every line of its schedule.
   */
  function circleMethod(ids) {
    const order = ids.slice();
    if (order.length % 2 === 1) order.push(null);
    const n = order.length;
    if (n < 2) return [];

    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = order[i], b = order[n - 1 - i];
        if (a != null && b != null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      order.splice(1, 0, order.pop());   // hold order[0], rotate everything else
    }
    return rounds;
  }

  /** Lexicographic "is x the better candidate", on the score tuples below. */
  function better(x, y) {
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return x[i] > y[i];
    }
    return false;
  }

  /**
   * The next match to put on a free court, or null when none fits.
   *
   * With `rested` set, a pair that played in the previous round is not a
   * candidate at all — that is the break of §5.3, and the caller drops the flag
   * only when holding it would leave a round completely empty.
   *
   * Scored, in order: the group with the most matches still to place, so none
   * is left with a tail nobody can pack; then the pair that has waited longest;
   * then the seeded coin.
   */
  function nextMatch(queues, busy, lastRound, round, random, rested) {
    let pick = null, best = null;

    for (const q of queues) {
      const block = q.rounds[q.front];
      if (!block) continue;
      for (let i = 0; i < block.length; i++) {
        const a = block[i][0], b = block[i][1];
        if (busy.has(a) || busy.has(b)) continue;

        const restA = round - (lastRound.has(a) ? lastRound.get(a) : -1);
        const restB = round - (lastRound.has(b) ? lastRound.get(b) : -1);
        const rest = Math.min(restA, restB);
        if (rested && rest < 2) continue;

        const score = [q.left, rest, random()];
        if (!best || better(score, best)) { best = score; pick = { queue: q, index: i }; }
      }
    }
    return pick;
  }

  /**
   * §5.3 steps 2 and 3: the group-rounds spread over global rounds, at most
   * `courts` matches per global round.
   *
   * **A group-round is not atomic here, and cannot be.** Four groups of 8/8/7/7
   * produce blocks of 4, 4, 3 and 3 matches, and no two of those fit on five
   * courts — whole-block packing would need 28 global rounds where 20 suffice.
   * The 2026 schedule splits them too: its first round is four Gruppe-A matches
   * and one of Gruppe B.
   *
   * So the two-rounds-apart rule is enforced where §5.3 says it is aimed —
   * "this gives every team its break" — at the team. A pair that played in the
   * previous round is taken only when nothing else can fill the court, because
   * leaving the court empty costs a whole round for everybody.
   *
   * A group offers one group-round at a time and moves to the next only between
   * global rounds, which is what keeps the four groups interleaved instead of
   * one group swallowing every court.
   */
  function pack(groups, courts, random) {
    const queues = groups.map(g => {
      const rounds = circleMethod(shuffled(g.ids, random)).map(r => r.slice());
      return {
        group: g.group,
        rounds,
        front: 0,
        left: rounds.reduce((n, r) => n + r.length, 0),
      };
    });

    const plan = [];
    const lastRound = new Map();

    while (queues.some(q => q.left > 0)) {
      const round = plan.length + 1;
      for (const q of queues) {
        while (q.rounds[q.front] && q.rounds[q.front].length === 0) q.front++;
      }

      const busy = new Set();
      const chosen = [];

      // Courts may be left empty to protect a break. They may not be left empty
      // to the point where the round holds nothing at all — that would not
      // schedule the tournament, it would only postpone it forever. So a round
      // that comes up empty is filled again with the break rule dropped.
      for (const rested of [true, false]) {
        while (chosen.length < courts) {
          const pick = nextMatch(queues, busy, lastRound, round, random, rested);
          if (!pick) break;
          const pair = pick.queue.rounds[pick.queue.front].splice(pick.index, 1)[0];
          pick.queue.left--;
          busy.add(pair[0]);
          busy.add(pair[1]);
          chosen.push({ group: pick.queue.group, a: pair[0], b: pair[1] });
        }
        if (chosen.length) break;
      }

      // Cannot happen: a group with matches left always has a non-empty front
      // block, and at the top of a round no team is busy yet. Bailing out beats
      // spinning forever if that reasoning is ever wrong.
      if (!chosen.length) break;

      for (const m of chosen) { lastRound.set(m.a, round); lastRound.set(m.b, round); }
      plan.push(chosen);
    }

    return plan;
  }

  /** How many times a team plays two global rounds in a row (§7, a warning). */
  function missedBreaks(plan) {
    const last = new Map();
    let count = 0;
    plan.forEach((matches, i) => {
      const round = i + 1;
      for (const m of matches) {
        for (const id of [m.a, m.b]) {
          if (last.get(id) === round - 1) count++;
          last.set(id, round);
        }
      }
    });
    return count;
  }

  /** The packed plan as §4 match objects, numbered top to bottom. */
  function toMatches(plan) {
    const out = [];
    let nr = 0;
    plan.forEach((matches, i) => {
      matches.forEach((m, court) => {
        out.push({
          nr: ++nr,
          round: i + 1,
          court: court + 1,
          phase: 'Gruppe',
          label: `Gruppe ${m.group}`,
          aRef: `T:${m.a}`,
          bRef: `T:${m.b}`,
          aTeam: m.a,
          bTeam: m.b,
          sa: null,
          sb: null,
          status: 'open',
          wo: null,
          doneAt: '',
        });
      });
    });
    return out;
  }

  /**
   * §10 step 4: the whole group phase, from grouped teams to numbered matches.
   *
   * Teams without a group are skipped — `group` is stored data (§3.2) and
   * draw() is what fills it. Nothing here validates the result; conflicts() is
   * where that happens, and the caller is expected to run it.
   *
   * Randomised restarts pick the tightest plan: fewest rounds first, then
   * fewest teams made to play twice in a row.
   */
  function groupPhase(teams, config) {
    const courts = Math.max(1, Number(config && config.courts) || 0);
    const seed = Number(config && config.seed) || 1;

    const byGroup = new Map();
    for (const t of teams || []) {
      if (!t || !t.group) continue;
      if (!byGroup.has(t.group)) byGroup.set(t.group, []);
      byGroup.get(t.group).push(t.id);
    }
    const groups = [...byGroup.keys()].sort().map(group => ({ group, ids: byGroup.get(group) }));
    if (!groups.length) return { matches: [], rounds: 0, seed: null, missedBreaks: 0 };

    let winner = null;
    for (let i = 0; i < RESTARTS; i++) {
      const plan = pack(groups, courts, randomFrom(seed + i));
      const tried = { plan, seed: seed + i, rounds: plan.length, missedBreaks: missedBreaks(plan) };
      const wins = !winner
        || tried.rounds < winner.rounds
        || (tried.rounds === winner.rounds && tried.missedBreaks < winner.missedBreaks);
      if (wins) winner = tried;
    }

    return {
      matches: toMatches(winner.plan),
      rounds: winner.rounds,
      seed: winner.seed,
      missedBreaks: winner.missedBreaks,
    };
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
    checkCrossGroupMatch(out, ms, teamIdx);
    checkConsecutiveRounds(out, ms, teamIdx);
    checkGroupSizes(out, teamIdx);
    checkDuplicateSurnames(out, teamIdx);

    return out;
  }

  return {
    conflicts, standings, timeline, currentRound,
    allocation, groupSizes, buckets, plannedFinish,
    draw, groupPhase, circleMethod,
    parseRef, errors, warnings, surnameOf, walkoverScore,
    toMinutes, hhmm,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TournamentEngine;
