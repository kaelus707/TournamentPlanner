/*
 * The sheet seam — SPEC.md §2, §3 and build step 9.
 *
 * Two halves, and the split matters:
 *
 *   Pure. parseConfig / parseTeams / parseMatches turn the tabular shape of
 *   §3.1–3.3 into the model of §4, and teamGrid / matchGrid turn it back. They
 *   are plain functions over arrays of strings, so they run in Node and are
 *   tested there.
 *
 *   Transport. load / writePlan / writeState / ping talk to the bound Apps
 *   Script of §2. They need a browser and are not tested.
 *
 * Nothing here computes anything about the tournament. The Apps Script is a
 * writer and this file is the shipping label: SPEC's first design principle is
 * that the sheet is storage, not the engine, and the moment either side starts
 * deriving something there are two engines to keep in step.
 *
 * Columns are matched by **name**, not by position. The organizer can open the
 * sheet and insert a column of their own at 11:00 (design principle 4) and the
 * app still finds `sa`.
 */
const TournamentSheet = (() => {
  'use strict';

  const TEAM_COLUMNS = ['id', 'p1', 'p2', 'group', 'decider'];

  const MATCH_COLUMNS = ['nr', 'round', 'court', 'phase', 'label',
    'aRef', 'bRef', 'aTeam', 'bTeam', 'sa', 'sb', 'status', 'wo', 'doneAt'];

  /* Config values §4 wants as numbers. Everything else stays the text it was. */
  const NUMERIC = ['courts', 'matchMin', 'semiMin', 'groups', 'seed'];

  // ----------------------------------------------------------------- helpers

  const text = v => String(v == null ? '' : v).trim();

  /** A cell as a number, or null for "nothing entered" — not 0. */
  const number = v => {
    const s = text(v);
    return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
  };

  /** The row index whose first cell is `first`, i.e. the header row. */
  function headerRow(grid, first) {
    for (let i = 0; i < (grid || []).length; i++) {
      if (text((grid[i] || [])[0]).toLowerCase() === first) return i;
    }
    return -1;
  }

  /** Column name -> index, from a header row. */
  function columnsOf(row) {
    const at = new Map();
    (row || []).forEach((name, i) => { if (text(name)) at.set(text(name), i); });
    return at;
  }

  const reader = (at, row) => name => (at.has(name) ? text(row[at.get(name)]) : '');

  // ------------------------------------------------------------------ Config

  /**
   * §3.1: key in column A, value in column B, `break` repeated once per pause.
   *
   * An unknown key is kept rather than dropped. The organizer may have put a
   * note of their own in there, and silently swallowing it would make the sheet
   * and the app disagree about what the sheet says.
   */
  function parseConfig(grid) {
    const config = { breaks: [] };
    for (const row of grid || []) {
      const key = text((row || [])[0]);
      if (!key) continue;
      const value = text((row || [])[1]);

      if (key === 'break') {
        // "afterRound | minutes | label" (§3.1). Breaks anchor to rounds, so a
        // break without a round is not a break, it is a typo.
        const parts = value.split('|').map(text);
        const afterRound = number(parts[0]);
        if (afterRound == null) continue;
        config.breaks.push({
          afterRound,
          min: number(parts[1]) || 0,
          label: parts[2] || 'Pause',
        });
        continue;
      }

      config[key] = NUMERIC.indexOf(key) >= 0 ? (number(value) || 0) : value;
    }
    return config;
  }

  // ------------------------------------------------------------------- Teams

  /** §3.2 -> §4 teams. Rows without an id are blank lines, not teams. */
  function parseTeams(grid) {
    const head = headerRow(grid, 'id');
    if (head < 0) throw new Error('Im Blatt „Teams“ fehlt die Kopfzeile mit „id“.');
    const at = columnsOf(grid[head]);

    const out = [];
    for (const row of grid.slice(head + 1)) {
      const get = reader(at, row || []);
      const id = get('id');
      if (!id) continue;
      const team = { id, p1: get('p1'), p2: get('p2'), group: get('group') };
      // §3.2: empty for almost every team, and §5.4 counts empty as 0. Carrying
      // the key only when it is set keeps the common row honest.
      const decider = number(get('decider'));
      if (decider != null) team.decider = decider;
      out.push(team);
    }
    return out;
  }

  function teamGrid(teams) {
    const rows = (teams || []).map(t => TEAM_COLUMNS.map(c => (t[c] == null ? '' : t[c])));
    return [TEAM_COLUMNS.slice()].concat(rows);
  }

  // --------------------------------------------------------------- Spielplan

  /**
   * §3.3 -> §4 matches.
   *
   * `sa` / `sb` come back as null when the cell is empty, which is what §5.4
   * means by "a match counts once both scores are present" — a blank cell is
   * not a nil-all draw.
   */
  function parseMatches(grid) {
    const head = headerRow(grid, 'nr');
    if (head < 0) throw new Error('Im Blatt „Spielplan“ fehlt die Kopfzeile mit „nr“.');
    const at = columnsOf(grid[head]);

    const out = [];
    for (const row of grid.slice(head + 1)) {
      const get = reader(at, row || []);
      const nr = number(get('nr'));
      if (nr == null) continue;

      const wo = get('wo').toLowerCase();
      const status = get('status').toLowerCase();

      out.push({
        nr,
        round: number(get('round')),
        court: number(get('court')),
        phase: get('phase'),
        label: get('label'),
        aRef: get('aRef'),
        bRef: get('bRef'),
        aTeam: get('aTeam') || null,
        bTeam: get('bTeam') || null,
        sa: number(get('sa')),
        sb: number(get('sb')),
        status: status === 'playing' || status === 'done' ? status : 'open',
        wo: wo === 'a' || wo === 'b' ? wo : null,
        doneAt: get('doneAt'),
      });
    }
    return out.sort((a, b) => a.nr - b.nr);
  }

  function matchGrid(matches) {
    const rows = [...(matches || [])]
      .sort((a, b) => (a.nr || 0) - (b.nr || 0))
      .map(m => MATCH_COLUMNS.map(c => (m[c] == null ? '' : m[c])));
    return [MATCH_COLUMNS.slice()].concat(rows);
  }

  /**
   * The same matches as patches keyed by `nr` — what an update sends.
   *
   * Every column travels rather than only the ones that changed, because
   * resolution runs over the whole schedule after every result (§6.3) and a
   * promote moves two matches at once (§6.2). Working out the difference would
   * be a second place to get "what changed" wrong, and 131 rows of fourteen
   * short fields is a fraction of one photo.
   */
  function matchPatches(matches) {
    return [...(matches || [])]
      .sort((a, b) => (a.nr || 0) - (b.nr || 0))
      .map(m => {
        const patch = {};
        for (const c of MATCH_COLUMNS) patch[c] = (m[c] == null ? '' : m[c]);
        return patch;
      });
  }

  const webGrid = lines => (lines || []).map(l => [l]);

  // --------------------------------------------------------------- transport

  /*
   * Apps Script serves no CORS preflight, so a POST that would trigger one
   * never leaves the browser. A text/plain body keeps the request "simple" and
   * the JSON arrives intact in e.postData.contents.
   *
   * The reply is a 302 to googleusercontent.com which fetch follows on its own.
   * By then doPost has already run: the redirect delivers its output, it does
   * not repeat the call.
   */
  async function post(endpoint, payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Die Tabelle antwortet mit HTTP ${res.status}.`);
    return unwrap(await res.text());
  }

  /**
   * The reply, or an error carrying what the script actually said.
   *
   * A Google login page instead of JSON is the failure this is really for: it
   * means the deployment is set to "Nur ich" rather than "Jeder", and a raw
   * parse error would send the organizer looking in the wrong place.
   */
  function unwrap(body) {
    let data;
    try {
      data = JSON.parse(body);
    } catch (err) {
      throw new Error(/^\s*</.test(body)
        ? 'Die Tabelle antwortet mit einer Anmeldeseite. Die Bereitstellung muss auf '
          + '„Zugriff: Jeder“ stehen.'
        : 'Die Antwort der Tabelle ist unlesbar.');
    }
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || 'Die Tabelle hat den Schreibvorgang abgelehnt.');
    }
    return data;
  }

  /** The three human-written tabs, as the model of §4. */
  async function load(endpoint) {
    const res = await fetch(endpoint, { cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new Error(`Die Tabelle antwortet mit HTTP ${res.status}.`);
    const data = unwrap(await res.text());
    return {
      config: parseConfig(data.config),
      teams: parseTeams(data.teams),
      matches: parseMatches(data.plan),
    };
  }

  /** Token check only — the setup screen asking "does this key work?". */
  const ping = (endpoint, token) => post(endpoint, { action: 'ping', token });

  /**
   * The whole plan written at once: the draw into `Teams`, the schedule into
   * `Spielplan`, the projection into `WEB`. Used when a tournament is generated
   * and the sheet has no schedule in it yet.
   *
   * `text` names the columns that must stay strings. Only `doneAt` does: Sheets
   * reads "09:14" as a time of day, and a round-trip through that is how a
   * stamp turns into 09:14:00 on somebody's phone.
   */
  const writePlan = (endpoint, token, teams, matches, web) => post(endpoint, {
    action: 'plan',
    token,
    teams: teamGrid(teams),
    plan: matchGrid(matches),
    web: webGrid(web),
    text: ['doneAt'],
  });

  /** A result or a move: the rows patched in place, and `WEB` rewritten (§3.4). */
  const writeState = (endpoint, token, matches, web) => post(endpoint, {
    action: 'save',
    token,
    rows: matchPatches(matches),
    web: webGrid(web),
  });

  // ---------------------------------------------------------------- endpoint

  /**
   * §2: the deployment URL lives in the `Config` tab, so the app finds it the
   * same way the viewer finds `WEB` — the published CSV of one tab.
   *
   * Whoever can read the spreadsheet can therefore also read `token`, which
   * sits two rows above it. That is the threat model §2 states out loud, and
   * the way around it is in sheet/ANLEITUNG.md: publish only `WEB` and hand the
   * endpoint to the app once instead.
   */
  function configUrl(sheetId) {
    return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId)
      + '/gviz/tq?tqx=out:csv&headers=0&sheet=Config';
  }

  /** Quote-aware CSV, the same shape Sheets exports. */
  function parseCsv(input) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (quoted) {
        if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    row.push(field);
    rows.push(row);
    return rows;
  }

  async function findEndpoint(sheetId) {
    const blind = 'Das Blatt „Config“ ist nicht öffentlich lesbar.';
    const res = await fetch(configUrl(sheetId), { cache: 'no-store' });
    if (!res.ok) throw new Error(blind);
    const body = await res.text();
    if (/^\s*</.test(body)) throw new Error(blind);
    const endpoint = parseConfig(parseCsv(body)).endpoint;
    if (!endpoint) throw new Error('In „Config“ steht kein Schlüssel „endpoint“.');
    return endpoint;
  }

  return {
    parseConfig, parseTeams, parseMatches,
    teamGrid, matchGrid, matchPatches, webGrid, parseCsv,
    load, ping, writePlan, writeState, findEndpoint, configUrl,
    TEAM_COLUMNS, MATCH_COLUMNS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TournamentSheet;
