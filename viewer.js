/*
 * The viewer's data layer — SPEC.md §8 and §9.1, build step 10.
 *
 * index.html is the public screen. This file is everything on that screen that
 * is not a DOM node: reading the `WEB` lines of §8, and turning them into the
 * blocks the page draws. The split is the same one sheet.js makes, and for the
 * same reason — logic that lives inside an inline <script> cannot be run from a
 * terminal, and §11 asks for every derivation to be checked against the 2026
 * fixture.
 *
 * Nothing here computes a time. §6.1 is the engine's, and calling
 * TournamentEngine.timeline() is the whole point: a second implementation of
 * the timing model in the viewer would be a second thing to keep in step, and
 * the one that is wrong on tournament day would be the one on the public
 * screen. This file only decides what to *show*.
 */
const TournamentViewer = (() => {
  'use strict';

  const E = (typeof TournamentEngine !== 'undefined')
    ? TournamentEngine
    : require('./engine.js');

  const text = v => String(v == null ? '' : v).trim();

  /** A score cell: the number entered, or null for "nothing entered" — not 0. */
  const score = v => (text(v) === '' ? null : Number(v));

  /** A count cell, for the G lines, where an empty cell really does mean 0. */
  const count = v => (Number(v) || 0);

  // ------------------------------------------------------------------- CSV

  /**
   * The sheet's gviz export is CSV with one `WEB` line per row, in column A.
   * Quote-aware because Sheets quotes any field holding a comma, and a team
   * name is free text.
   */
  function csvRows(t) {
    const rows = [];
    let field = '', row = [], quoted = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (quoted) {
        if (c === '"') {
          if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ----------------------------------------------------------------- status

  /**
   * §3.3 lists `status` as admin-written, and §3.3 also says every cell stays
   * hand-editable. So the column can be blank on a row that plainly has a
   * result — historical data has no status column at all.
   *
   * Both scores present is therefore read as `done`. This matters more than it
   * looks: timeline() decides round completeness on `status === 'done'` alone,
   * so a blank status would leave a finished round looking unfinished and pin
   * "Jetzt" to it — the exact 2026 bug §9.1 asks step 10 to fix. Normalising
   * here means the engine and the screen cannot disagree about what is played.
   */
  function normalStatus(raw, sa, sb) {
    const s = text(raw).toLowerCase();
    if (s === 'done' || s === 'playing') return s;
    return sa != null && sb != null ? 'done' : 'open';
  }

  const isDone = m => m.status === 'done';
  const isPlaying = m => m.status === 'playing';

  // ------------------------------------------------------------------ parse

  /**
   * §8 text -> the model §4 describes, plus the group tables and the final
   * placement the same lines carry.
   *
   * Field positions are the contract of §8 and are read positionally on
   * purpose: unlike the sheet's own tabs (§3, where sheet.js matches columns by
   * name because the organizer may insert one), `WEB` is generated output that
   * no one edits by hand.
   */
  function parseWeb(input) {
    const out = {
      title: '', logo: '',
      config: { start: '', matchMin: 0, semiMin: 0, finalMode: '', breaks: [] },
      matches: [], groups: {}, ranks: [],
    };

    for (const row of csvRows(String(input == null ? '' : input))) {
      const line = text(row[0]);
      if (!line) continue;
      const p = line.split('|');

      switch (p[0]) {
        case 'META':
          if (text(p[1])) out.title = text(p[1]);
          out.logo = text(p[4]);
          break;

        case 'C':
          out.config.start = text(p[1]);
          out.config.matchMin = count(p[2]);
          out.config.semiMin = count(p[3]);
          out.config.finalMode = text(p[4]);
          break;

        case 'M': {
          const sa = score(p[10]), sb = score(p[11]);
          out.matches.push({
            nr: count(p[1]),
            round: count(p[2]),
            court: text(p[3]),
            phase: text(p[4]),
            label: text(p[5]),
            aRef: text(p[6]), aTeam: text(p[7]),
            bRef: text(p[8]), bTeam: text(p[9]),
            sa, sb,
            aCode: text(p[12]), bCode: text(p[13]),
            status: normalStatus(p[14], sa, sb),
          });
          break;
        }

        case 'P':
          out.config.breaks.push({
            afterRound: count(p[1]),
            min: count(p[2]),
            label: text(p[3]),
          });
          break;

        case 'G':
          (out.groups[text(p[1])] ||= []).push({
            rank: count(p[2]) || 99,
            code: text(p[3]), team: text(p[4]),
            sp: count(p[5]), s: count(p[6]), u: count(p[7]), n: count(p[8]),
            diff: count(p[9]), pkt: count(p[10]),
          });
          break;

        case 'E':
          out.ranks.push({
            place: count(p[1]), team: text(p[2]),
            group: text(p[3]), origin: text(p[4]),
          });
          break;
      }
    }

    for (const k in out.groups) out.groups[k].sort((a, b) => a.rank - b.rank);
    out.ranks.sort((a, b) => a.place - b.place);
    out.matches.sort((a, b) => a.nr - b.nr);
    return out;
  }

  // ------------------------------------------------------------------ names

  /**
   * What to print in a slot: the resolved team, or the German label behind the
   * ref while the source is still undecided (§6.3). `open` marks the second
   * case so the page can style a placeholder differently from a name.
   */
  function slot(matches, ref, team) {
    const name = text(team);
    if (name) return { name, open: false };
    return { name: E.refLabel(ref, matches), open: true };
  }

  // ----------------------------------------------------------------- blocks

  const breaksAfter = (config, round) =>
    ((config && config.breaks) || []).filter(b => b.afterRound === round);

  /**
   * The page as an ordered list of round headers, their matches and the breaks
   * between them — one block per thing drawn, in the order it is drawn.
   *
   * Times come from timeline(): `time` is `liveStart` (§6.1) and `delta` the
   * drift against plan, 0 when there is none, which is what lets the page stay
   * quiet on a day that runs to plan.
   *
   * On today's contract `delta` is *always* 0 here, and that is not a bug: §8's
   * `M` line carries no `doneAt`, so `finishOf` can only ever return the
   * computed end and `liveStart` can only ever equal `plannedStart`. The public
   * screen therefore shows planned times. Drift is the round screen's job
   * (§9.2), which reads `Spielplan` and has the stamps.
   *
   * The mechanism is kept rather than dropped because it is the same timeline()
   * every other screen uses, and it starts working the day a stamp reaches the
   * viewer. viewer.test.js pins it by setting `doneAt` by hand.
   *
   * A break is placed after its round and clocked from that round's end, so two
   * breaks booked after the same round stack rather than overlap. When the end
   * cannot be computed — the open-ended final of §6.1 — the break keeps its
   * label and loses its times, rather than inventing them.
   */
  function blocks(data) {
    const matches = (data && data.matches) || [];
    const config = (data && data.config) || {};

    const rows = E.timeline(matches, config);
    const current = E.currentRound(rows);

    const byRound = new Map();
    for (const m of matches) {
      if (!byRound.has(m.round)) byRound.set(m.round, []);
      byRound.get(m.round).push(m);
    }
    for (const list of byRound.values()) {
      list.sort((a, b) => (Number(a.court) || 0) - (Number(b.court) || 0));
    }

    const out = [];
    for (const r of rows) {
      out.push({
        kind: 'round',
        round: r.round,
        time: E.hhmm(r.start),
        delta: r.delta,
        complete: r.complete,
        // §9.1: the current round is the first incomplete one. Everything
        // before it is played, everything after it is still to come.
        state: !current ? 'done'
             : r.round < current.round ? 'done'
             : r.round === current.round ? 'now'
             : 'next',
        items: byRound.get(r.round) || [],
      });

      let at = r.end;
      for (const b of breaksAfter(config, r.round)) {
        out.push({
          kind: 'break',
          min: b.min,
          label: b.label,
          from: at == null ? '' : E.hhmm(at),
          to: at == null ? '' : E.hhmm(at + b.min),
        });
        if (at != null) at += b.min;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- summary

  /**
   * The numbers the status card shows. `current` is the timeline row of the
   * round being played, or null once everything is done — the same row blocks()
   * marks `now`, so the card and the list cannot disagree.
   */
  function summary(data) {
    const matches = (data && data.matches) || [];
    const config = (data && data.config) || {};
    const rows = E.timeline(matches, config);

    return {
      total: matches.length,
      done: matches.filter(isDone).length,
      playing: matches.filter(isPlaying).length,
      rounds: rows.length,
      current: E.currentRound(rows),
      // Nothing to compute a clock from — a v1 sheet with no `C` line (§8).
      timed: E.toMinutes(config.start) != null,
    };
  }

  /** Whether a search term matches anything the page shows for a match. */
  function hit(matches, m, needle) {
    if (!needle) return true;
    const a = slot(matches, m.aRef, m.aTeam).name;
    const b = slot(matches, m.bRef, m.bTeam).name;
    return [a, b, m.aCode, m.bCode, m.label]
      .join(' ').toLowerCase().includes(needle);
  }

  return {
    csvRows, parseWeb, blocks, summary, slot, hit,
    isDone, isPlaying, normalStatus,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TournamentViewer;
