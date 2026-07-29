/*
 * Terminal entry point for every suite: `node test/run.js`.
 *
 * The suites themselves only export run(webText, teamsText) so the browser
 * pages can drive them too. This file is the Node half: it reads the fixture
 * off disk, runs each suite and exits non-zero if anything failed, which is
 * the part a terminal needs and a browser page does not.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const SUITES = [
  { name: 'conflicts()', suite: require('./conflicts.test.js') },
  { name: 'standings()', suite: require('./standings.test.js') },
  { name: 'timeline()',  suite: require('./timing.test.js') },
  { name: 'allocation()', suite: require('./allocation.test.js') },
  { name: 'groupPhase()', suite: require('./groupphase.test.js') },
];

const web = fixture('bc2026-web.csv');
const teams = fixture('bc2026-teams.csv');

let failed = 0;
let total = 0;

for (const { name, suite } of SUITES) {
  const { results } = suite.run(web, teams);
  const bad = results.filter(r => !r.pass);
  total += results.length;
  failed += bad.length;

  console.log(`\n${name} — ${results.length - bad.length}/${results.length}`);
  for (const r of bad) console.log(`  FEHL  ${r.name}\n        ${r.detail}`);
}

console.log(failed
  ? `\n${failed} von ${total} Tests fehlgeschlagen.`
  : `\nAlle ${total} Tests bestanden.`);

process.exit(failed ? 1 : 0);
