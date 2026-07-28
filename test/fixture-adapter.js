/*
 * Fixture adapter — test support only, not part of the app.
 *
 * The 2026 files in test/fixtures are a dump of the *old* WEB format (v1).
 * They differ from the model in SPEC.md §4 in two ways that matter:
 *
 *   1. A match carries a clock time (`zeit`), not a round index. Rounds are
 *      reconstructed by grouping consecutive M lines that share a zeit. All
 *      courts start together (SPEC §6.1), so one shared start time is one
 *      round. Verified against the fixture: 131 matches, 34 distinct zeit
 *      values, 34 contiguous blocks, no zeit reused after a gap.
 *
 *   2. Refs are German display labels ("Sieger Viertelfinale 1"), not the
 *      symbolic forms of §6.3. They are translated back to G:/W:/L:/T: form.
 *      Two matches can share a label (both halves of a placement round), so a
 *      "Sieger <label>" with two candidates resolves positionally: the A slot
 *      takes the lower match number, the B slot the higher. Verified: all 262
 *      refs re-resolve to exactly the team codes the fixture itself records.
 *
 * Everything here is about reading the old files. Nothing here belongs in the
 * engine.
 */
const FixtureAdapter = (() => {
  'use strict';

  const stripBom = t => t.replace(/^\uFEFF/, '');

  /** Quote-aware split of one CSV line — Sheets exports quote any field with a comma. */
  function splitCsvLine(line) {
    const out = [];
    let field = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { out.push(field); field = ''; }
      else field += c;
    }
    out.push(field);
    return out;
  }

  /** bc2026-teams.csv -> [{ id, p1, p2, group }] */
  function parseTeams(text) {
    const rows = stripBom(text).split(/\r?\n/).map(splitCsvLine);
    const header = rows.findIndex(r => (r[0] || '').trim() === 'Code');
    if (header < 0) throw new Error('Teams-Fixture: Kopfzeile mit "Code" nicht gefunden.');

    const teams = [];
    for (const r of rows.slice(header + 1)) {
      const id = (r[0] || '').trim();
      if (!id) continue;
      teams.push({
        id,
        group: (r[1] || '').trim(),
        p1: (r[2] || '').trim(),
        p2: (r[3] || '').trim(),
      });
    }
    return teams;
  }

  // --------------------------------------------------------- WEB v1 -> v2

  const PHASE = {
    'Gruppenphase': 'Gruppe',
    'Viertelfinale': 'VF',
    'Halbfinale': 'HF',
    'Finale': 'Finale',
    'Platzierungsspiel': 'Platz',
  };

  /** Consecutive matches sharing a zeit form one round. Returns nr -> round. */
  function roundsByStartTime(raw) {
    const roundOf = new Map();
    let round = 0, previous = null;
    for (const m of raw) {
      if (m.zeit !== previous) { round++; previous = m.zeit; }
      roundOf.set(m.nr, round);
    }
    return roundOf;
  }

  /**
   * A v1 ref label -> a §6.3 ref.
   * `side` is 0 for the A slot and 1 for the B slot, used only to split a
   * label that two matches share. Anything unrecognised is returned unchanged
   * so conflicts() reports it rather than the adapter hiding it.
   */
  function toRef(raw, side, byLabel) {
    const text = (raw || '').trim();
    if (!text) return '';
    if (/^[A-Z]\d+$/.test(text)) return `T:${text}`;

    let m;
    if ((m = /^(\d+)\.\s*Gr\.\s*([A-Z])$/.exec(text))) return `G:${m[2]}:${m[1]}`;

    if ((m = /^(Sieger|Verlierer)\s+(.+)$/.exec(text))) {
      const candidates = byLabel.get(m[2]) || [];
      if (candidates.length === 0 || candidates.length > 2) return text;
      const src = candidates.length === 1 ? candidates[0] : candidates[side];
      if (src == null) return text;
      return `${m[1] === 'Sieger' ? 'W' : 'L'}:${src}`;
    }
    return text;
  }

  /** bc2026-web.csv -> { meta, matches, standings, placements, breaks, rounds } */
  function parseWeb(text) {
    const lines = stripBom(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let meta = null;
    const raw = [], standings = [], placements = [], breaks = [];

    for (const line of lines) {
      const f = line.split('|');
      switch (f[0]) {
        case 'META':
          meta = { title: f[1], teams: +f[2], matches: +f[3] };
          break;
        case 'M':
          raw.push({
            nr: +f[1], zeit: f[2], court: +f[3], phase: f[4], label: f[5],
            aRef: f[6], bRef: f[8],
            aTeam: f[12] || null, bTeam: f[13] || null,
            sa: f[10] === '' ? null : +f[10],
            sb: f[11] === '' ? null : +f[11],
          });
          break;
        case 'G':
          standings.push({
            group: f[1], rank: +f[2], team: f[3],
            sp: +f[5], s: +f[6], u: +f[7], n: +f[8], diff: +f[9], pkt: +f[10],
          });
          break;
        case 'E':
          placements.push({ place: +f[1], team: f[2], group: f[3], origin: f[4] });
          break;
        case 'P':
          breaks.push(f.slice(1).join('|'));
          break;
      }
    }

    raw.sort((a, b) => a.nr - b.nr);
    const roundOf = roundsByStartTime(raw);

    const byLabel = new Map();
    for (const m of raw) {
      if (!byLabel.has(m.label)) byLabel.set(m.label, []);
      byLabel.get(m.label).push(m.nr);
    }

    const matches = raw.map(m => ({
      nr: m.nr,
      round: roundOf.get(m.nr),
      court: m.court,
      phase: PHASE[m.phase] || m.phase,
      label: m.label,
      aRef: toRef(m.aRef, 0, byLabel),
      bRef: toRef(m.bRef, 1, byLabel),
      aTeam: m.aTeam,
      bTeam: m.bTeam,
      sa: m.sa,
      sb: m.sb,
      status: m.sa != null && m.sb != null ? 'done' : 'open',
      wo: null,
    }));

    return {
      meta, matches, standings, placements, breaks,
      rounds: matches.length ? Math.max(...roundOf.values()) : 0,
    };
  }

  return { parseTeams, parseWeb, toRef };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FixtureAdapter;
