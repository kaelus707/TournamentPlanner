# Tournament App — Specification

Version 0.1 · Successor to the Bonsai Cup 2026 build

---

## 1. What this is

A browser app for running a small doubles tournament: group phase, knockout, and
placement matches down to last place. Built for club tournaments of roughly 16–32
teams on 3–6 courts, run in synchronised rounds over a single day.

It replaces a hand-built Google Sheet whose formulas were sized for exactly 30
teams in groups of 8/8/7/7. The schedule generation moves into JavaScript so the
team count becomes a parameter instead of a rebuild.

### Design principles

1. **The sheet is storage, not the engine.** All formulas are deleted. The app
   computes standings, brackets, and times.
2. **Times are computed, never stored.** A match has a round and a court. Its
   time is derived from actual progress.
3. **Propose, don't impose.** The app never reorders matches on its own. It
   suggests; the admin confirms.
4. **The spreadsheet stays openable.** At 11:00 on tournament day, if the app
   misbehaves, the organizer can fix a cell by hand. Nothing in the design may
   break that.
5. **No accounts.** Public read via a link. Admin write via a secret token in
   the URL.

### Non-goals

- Player registration, user accounts, OAuth
- Polls, chat, notifications
- Payments, association integration, ranking systems (LK)
- Singles draws, seeded knockout draws, consolation formats other than the one
  described here

---

## 2. Multi-tenancy model

There is no server and no database. Tenancy is one spreadsheet per tournament.

```
Organizer copies the template sheet
        ↓
Deploys the bound Apps Script once (Deploy → New deployment → Web app)
        ↓
Opens  app-url/?id=<SHEET_ID>            → public viewer
       app-url/?id=<SHEET_ID>&k=<TOKEN>  → admin
```

The app itself is static files hosted anywhere (GitHub Pages): the two screens,
`index.html` (viewer) and `round.html` (admin), beside the modules they load —
`engine.js`, `viewer.js`, `sheet.js`. No build step; the files are served as
they are written. One deployment serves every organizer; the `id` parameter
selects the tournament.

**Why a bound script:** an Apps Script attached to a spreadsheet is copied along
with the spreadsheet. So the template carries its own write endpoint. The
organizer deploys it once and pastes the deployment URL into the `Config` tab.

**Token:** a random string the organizer sets in `Config`. The Apps Script
rejects any write whose token doesn't match. This is not real security — it
keeps honest people honest, which is the actual threat model for a club
tournament.

---

## 3. Spreadsheet template

Five tabs. Only `Config`, `Teams`, and `Spielplan` are written by humans or the
app; `WEB` is generated output; `Anleitung` is documentation.

The template is built by `sheet/Vorlage.gs`, a second Apps Script file pasted
beside `Code.gs`. It installs a **Turnier → Tabelle einrichten** menu item that
creates the five tabs, fills `Config` with the defaults below, writes the two
header rows and generates a token. It writes only into empty tabs, so re-running
it on a live tournament sheet is safe.

It is separate from `Code.gs` because `Code.gs` is the deployed endpoint and has
to be re-versioned on every edit; setup runs from the menu and is never deployed.
`Vorlage.gs` may be deleted from the script project once a sheet is set up.

### 3.1 `Config`

Key/value pairs, column A = key, column B = value.

| Key | Example | Notes |
|---|---|---|
| `title` | Bonsai Cup 2026 | Shown in header |
| `logo` | https://… | Optional image URL |
| `start` | 09:00 | Planned first round start |
| `courts` | 5 | |
| `matchMin` | 10 | Group / placement match duration |
| `semiMin` | 12 | Semi-final duration |
| `finalMode` | set | `set` = open-ended, or a number of minutes |
| `groups` | 4 | Fixed at 4 for v1 (see §5.1) |
| `walkover` | 2:0 | Score recorded for a no-show |
| `token` | k7f2p9x… | Admin secret |
| `endpoint` | https://script.google.com/… | Apps Script deployment URL |

Breaks are listed as repeated rows:

| Key | Value |
|---|---|
| `break` | `6 \| 5 \| Platzpflege` |
| `break` | `12 \| 10 \| Reserveblock` |

Format: `afterRound | minutes | label`. **Breaks anchor to round indices, not
clock times.** A break pinned to 11:00 drifts out of position the moment the
tournament runs late.

### 3.2 `Teams`

| Column | Type | Notes |
|---|---|---|
| `id` | text | `T01`, `T02`, … stable, never reused |
| `p1` | text | Player 1 name |
| `p2` | text | Player 2 name |
| `group` | `A`–`D` | Written by the draw, editable by hand |
| `decider` | int, optional | Manual tiebreak, see §5.4. Empty for almost every team |

Team display name is `p1 / p2`, derived, not stored.

`group` is **stored data, not a derivation.** Auto-draw fills the column; the
organizer can overwrite any cell.

### 3.3 `Spielplan`

The generated schedule. One row per match. Written once by the generator, then
only the result and status columns change.

| Column | Type | Written by |
|---|---|---|
| `nr` | int | generator |
| `round` | int | generator, updated on promote/delay |
| `court` | int | generator, updated on promote/delay |
| `phase` | text | generator — `Gruppe`, `VF`, `HF`, `Finale`, `Platz` |
| `label` | text | generator — e.g. `Gruppe A`, `Spiel um Platz 13` |
| `aRef` | text | generator — see §6.3 |
| `bRef` | text | generator |
| `aTeam` | text | resolver — team id or empty |
| `bTeam` | text | resolver |
| `sa` | int | admin |
| `sb` | int | admin |
| `status` | text | admin — `open` / `playing` / `done` |
| `wo` | text | admin — empty, `a`, or `b` (walkover winner) |
| `doneAt` | `HH:MM` | admin app — clock time the result was saved, empty until then |

No planned time column. Planned time is computed.

`doneAt` is the one exception, and it is not a plan — it is an observation. §6.1
needs the time a round actually finished in order to show drift at all; without
it `finishOf` can only ever return the computed end, and the schedule can never
notice that it is running late. The app writes it on save, and it stays
hand-editable like every other cell, because an organizer correcting a
mis-tapped result at 11:40 needs to be able to correct its time too.

A missing `doneAt` on a finished match is not an error. Historical data has
none, and §6.1 falls back to the computed end rather than reading an absent
stamp as a time.

### 3.4 `WEB`

Generated projection of the whole tournament state in the pipe-delimited line
format the viewer consumes. Rewritten on every result entry. See §6.

### 3.5 `Anleitung`

Static text for the organizer: how to deploy the script, where the token goes,
what not to touch.

---

## 4. Data model (in-app)

```js
config = {
  title, logo, start, courts, matchMin, semiMin, finalMode,
  groups, walkover, token, endpoint,
  breaks: [{ afterRound, min, label }]
}

team = { id, p1, p2, group }

match = {
  nr, round, court, phase, label,
  aRef, bRef,          // symbolic origin, always present
  aTeam, bTeam,        // resolved team ids, null until known
  sa, sb,              // numbers or null
  status,              // "open" | "playing" | "done"
  wo                   // null | "a" | "b"
}
```

Derived, never stored: match time, group standings, bracket progression, final
placement, current round.

---

## 5. Tournament format

### 5.1 Group allocation

Four groups, always. Sizes differ by at most one.

Fixing the group count at four is deliberate. The entire downstream structure
pairs teams **by group position**, never by points — 1st vs 2nd, 4th vs 4th,
7th vs 7th. That makes unequal group sizes harmless. Three or five groups would
force comparison of points across groups that played different numbers of
matches, which is not comparable.

For N teams: base size `floor(N/4)`, with `N mod 4` groups getting one extra.

| N | Sizes | Group matches |
|---|---|---|
| 21 | 6/5/5/5 | 45 |
| 22 | 6/6/5/5 | 50 |
| 23 | 6/6/6/5 | 55 |
| 24 | 6/6/6/6 | 60 |
| 30 | 8/8/7/7 | 98 |

Group matches = sum of `m(m-1)/2` over the four groups.

**Supported range:** 16–32 teams. Below 16, groups get too small for the
placement buckets; above 32 the day gets too long. The app should refuse
outside this range rather than generate something odd.

### 5.2 The allocation screen

Input: team count, courts, match duration, planned start.

Output, live: group sizes, group match count, endrunde match count, total
rounds, estimated finish time. The organizer is really making a **duration
decision**, so the finish time is the number that matters and should be the
most prominent thing on screen.

`allocation({ teams, courts, start, matchMin, semiMin, finalMode, breaks })`
returns all of it, plus the buckets of §5.5 with the places each decides. It
**refuses** outside 16–32 teams: `ok: false` and a problem list, and none of the
numbers. A plausible-looking plan for a tournament this format cannot run is
worse than no plan.

**The round counts are estimates.** No schedule exists yet, so they are what the
packing rules allow at best:

```
groupRounds = max( ceil(groupMatches / courts), 2·circleRounds − 1 )
endRounds   = max( ceil(sharedMatches / courts), bracketDepth ) + 4
```

The second term of `groupRounds` is §5.3's two-rounds-apart rule: a group whose
circle method yields R rounds occupies at least 2R−1 global rounds. With few
teams and many courts that spacing binds, not capacity — 16 teams on 6 courts
need 5 rounds, not the 4 that 24 matches would suggest.

The `+ 4` is §5.6: the two semi-finals, the third-place match and the final are
alone on court 1, so they cost a round each however many courts stand empty.
`sharedMatches` is everything else.

Both formulas reproduce 2026 exactly: `ceil(98/5) = 20` is the group phase, and
`ceil(29/3) + 4 = 14` is the endrunde, which ran on three courts.

**They are floors, not predictions.** The generator of step 4 matches them
whenever the field can keep the courts busy — every count from 16 to 32 teams on
3 or 4 courts, and 30 teams on 5 — but the break of §5.3 caps how much can be
packed: two consecutive rounds together hold at most half the field, so courts
beyond that sit idle. 24 teams on 6 courts needs 13 rounds against a floor of
10, and no seed does better, because a group of six cannot be split into two
alternating halves that still play each other.

So the preview should be read as "not before this". Once a schedule exists,
`groupPhase()` reports the real count and `timeline()` is the truth.

The finish time uses the same tail: rounds `R−3 … R` are Halbfinale, Halbfinale,
Spiel um Platz 3, Finale, so the durations are known without a schedule. An
open-ended final has no finish (§6.1), only a start time, and the screen shows
that instead of inventing an end.

### 5.3 Group phase generation

Groups are disjoint, so matches from different groups can never conflict. This
makes packing simple:

1. Run the **circle method** within each group to produce its internal rounds.
   A group of size `m` yields `m-1` rounds (`m` rounds with a bye if `m` is odd).
2. Distribute group-rounds across global rounds, at most `courts` matches per
   global round.
3. Constraint: **no team plays in two consecutive global rounds.** Every team
   gets its break.

If step 3 cannot be satisfied, increase the number of global rounds. Do not
attempt clever optimisation — at this scale a greedy pass with a few randomised
restarts is sufficient and the result is easy to reason about.

**A group-round is not atomic.** It cannot be: groups of 8/8/7/7 produce blocks
of 4, 4, 3 and 3 matches, and no two of those fit on five courts, so whole-block
packing would need 28 global rounds where 20 suffice. The 2026 schedule splits
them too — its first round is four Gruppe A matches and one of Gruppe B.

That is why step 3 is stated at the team and not at the group. An earlier
draft said "two rounds of the same group must be at least two global rounds
apart", which is the same rule *only* while blocks stay whole. Once a block is
split the group-level phrasing forbids schedules that are perfectly restful and
permits ones that are not, so the team-level rule is the one that survives.

The break is a hard constraint: a court is left empty rather than filled with a
team that played last round. The single exception is a global round that would
otherwise be empty, which would postpone the tournament rather than schedule it.

The draw and the packing are both **seeded**. Regenerating after correcting a
misspelled name must return the same tournament, not a new one.

### 5.4 Standings

Per group, per team: `Sp`, `S`, `U`, `N`, `Diff`, `Pkt`.

- Win 3, draw 1, loss 0
- `Diff` = goals for − goals against
- Order: **Punkte → Differenz → Siege → manual decider**

A walkover counts as a normal result with the configured score. It overrides
whatever is in `sa`/`sb`, so a match that was started and then abandoned still
records the walkover, not the partial score.

A match counts once both scores are present. `status` is **not** consulted: a
match carrying two scores has a result whether or not anyone remembered to mark
it done, and a table that ignores an entered score is worse than one that is a
minute early.

The manual decider is the `decider` column on `Teams` (§3.2). The organizer
fills it when two teams are identical on all three criteria; **higher wins**,
consistent with Punkte, Differenz and Siege. Empty counts as 0. It is used only
as the last tiebreak.

After the decider comes one more step the organizer never sees: team id,
ascending. Without it two teams the organizer has not separated would be ordered
by whatever sequence the input happened to arrive in, and the same tournament
would rank differently on a reload. A row that reaches this step is **flagged**
so the screen can ask for a decider rather than present an arbitrary order as
if it were settled. On the 2026 data no row reaches it — every tie there is
resolved by difference.

### 5.5 Endrunde — bucketed placement

After the group phase, teams are bucketed by their **group position**:

| Bucket | Members | Decides |
|---|---|---|
| Ranks 1 + 2 | 8 teams | places 1–8 |
| Rank 3 | up to 4 | places 9–12 |
| Rank 4 | up to 4 | places 13–16 |
| Rank 5 | up to 4 | places 17–20 |
| Rank 6 | up to 4 | places 21–24 |
| Rank 7 | up to 4 | places 25–28 |
| Rank 8 | up to 4 | places 29–32 |

Each bucket is resolved independently. Bucket sizes possible with four groups
are 1 to 8; sizes 2, 3, 4 and 8 occur in practice.

**Bucket brackets**

| Size | Structure | Matches |
|---|---|---|
| 2 | single match | 1 |
| 3 | round-robin, ordered by points → diff → head-to-head | 3 |
| 4 | two semis; winners' final; losers' final | 4 |
| 5 | 4-bracket, then 5th plays the bracket's 4th for the last two places | 5 |
| 8 | quarters; then 1–4 bracket and 5–8 bracket in parallel | 12 |

The size-8 bracket is exactly the structure used in 2026: four quarter-finals,
two semi-finals, final and third-place match on one side; a 5–8 round with a
5th-place and a 7th-place match on the other.

**Singleton case.** A bucket of exactly one team occurs when `N ≡ 1 (mod 4)`
(21, 25, 29 teams). Merge it upward so the preceding bucket has 5 members and
use the size-5 bracket.

**Bucket seeding.** A bucket's members are ordered by **rank, then by group
letter**, and `B:<id>:<n>` (§6.3) names the n-th of them. The id is the bucket's
first rank, so the top bucket is `B:1`, the rank-3 bucket is `B:3`.

For the rank-3 bucket that reads `B:3:1 … B:3:4` = 3rd of A, B, C, D. For a
merged bucket of ranks 5 and 6 it reads `B:5:1 … B:5:4` = 5th of A, B, C, D and
`B:5:5` = 6th of A — which is exactly the team the size-5 bracket wants in fifth
place, arrived at without comparing points across groups that played different
numbers of matches (§5.1).

The brackets seed 1 v 4 and 2 v 3, and 1-8, 4-5, 2-7, 3-6 for the eight. Because
the members are ordered by group within a rank, every one of those pairings is
between two different groups.

**Match count.** For 24 teams: 12 + 4 + 4 + 4 + 4 = 28 endrunde matches.
For 30 teams: 12 + 4×5 + 1 = 33, matching the 2026 event.

### 5.6 Ordering of the endrunde

Lower buckets play first, as in 2026: the last places are decided early so that
those teams can go home, and the final is the last match of the day on court 1.

Semi-finals, the third-place match and the final are scheduled alone on court 1.
They are taken only once no shared-court match is left, which is what keeps the
final the last match of the day.

**One deep match per round.** Run purely by bucket order, the eight-team bracket
starts last and its chain — quarter-final, 5–8 round, fifth-place match — then
runs on alone at the end with the courts beside it empty, costing a round. So
each round admits one match from the longest remaining chain and fills the rest
by place. That is the shape of the 2026 endrunde: a quarter-final on court 1,
placement matches on the courts beside it.

Two matches share a round only if their **slots** are disjoint, a slot being a
bucket seed, the winner of a match, or the loser of a match. Winner and loser of
the same match are different slots — which is why the 5–8 round and the
semi-finals may run side by side although both descend from the same four
quarter-finals, while a round robin of three, whose matches share seeds, comes
out strictly sequential.

---

## 6. Timing model

### 6.1 Rounds are the unit

All courts start together. A round is complete when every match assigned to it
has `status = done`.

```
plannedStart(r) = config.start + Σ (duration + breaks) for rounds < r

finishOf(r)     = complete(r) ? timeOfLastResultIn(r)
                              : liveStart(r) + duration(r)

liveStart(r)    = max(plannedStart(r), finishOf(r-1))
```

`duration(r)` is `matchMin`, or `semiMin` for a round containing a semi-final.
An open-ended final has no computed end — its duration is *absent*, not zero,
so nothing downstream can add it up as if the final took no time.

`timeOfLastResultIn(r)` is the latest `doneAt` in the round (§3.3). When the
round carries no stamp at all, `finishOf` falls back to `liveStart(r) +
duration(r)`. That is the normal path for historical data and for any round
entered without the app.

**A break after a late round is absorbed, not appended.** `liveStart` maxes
against the previous round's raw `finishOf`, so a round that overruns eats into
the Platzpflege instead of pushing it down the day. This is the formula above
read literally, and it is also what happens on a court: when the tournament is
late, the break is what gives.

The display shows `liveStart(r)` and, when it differs from planned, the delta
(`09:22 · +2 min`). The current round is the first round that is not complete.

### 6.2 Delay and promote

`delayed` is **not a stored state**. Marking a match delayed is a move:

1. The match is reassigned to a later round.
2. It leaves the current round, so round completion is unaffected.
3. The app proposes a replacement to pull forward into the freed court.

**Reassignment target for the delayed match:** the earliest future round in
which both teams are free and the move creates no conflict.

**Replacement candidate scoring.** Candidates are matches in later rounds whose
four players are not already playing in the current round. Score:

| Factor | Weight |
|---|---|
| Distance from current round | prefer nearest |
| Either team played in round r−1 | heavy penalty |
| Same group as the delayed match | small bonus |
| Same court number already assigned | small bonus |

Show the top three. The admin picks. **Nothing is applied automatically.**

If a delayed match ultimately cannot be played, the admin enters a walkover for
the team that was present, or 0:0 if neither was. Both are ordinary results.

### 6.3 Reference resolution

`aRef` / `bRef` carry the symbolic origin of a slot so the viewer can display a
match before its participants are known.

| Form | Meaning |
|---|---|
| `T:A1` | team `A1` itself |
| `G:A:1` | 1st place, group A |
| `W:102` | winner of match 102 |
| `L:102` | loser of match 102 |
| `B:3:2` | 2nd of the rank-3 bucket |

`T:` covers every group-phase slot. The draw fixes those participants before
the schedule is generated, so `aTeam` is filled from the start and never
changes. It exists so that **every ref parses through one grammar**: a ref
matching no form here is a validation error (§7) rather than an unrecognised
string that quietly resolves to nothing on tournament day.

Resolution runs after every result entry, top to bottom, filling `aTeam` /
`bTeam` where the source is decided. Unresolved refs render as their human label
("Verlierer Viertelfinale 2"), as in the current build.

---

## 7. Validation

`conflicts(matches, teams, config)` — a pure function returning a list of
problems. Runs after generation and before any move is applied.

| Check | Severity |
|---|---|
| Team appears twice in the same round | error |
| Court double-booked in the same round | error |
| More matches in a round than courts | error |
| Team plays in consecutive rounds | warning |
| A match's refs point to an undecided source in an earlier round | error |
| Group sizes differ by more than one | warning |
| Two teams share a surname within one group | warning |
| A `Gruppe` match pairs teams from two different groups | error |
| A ref matches no form in §6.3 | error |
| A `T:` ref names a team that is not in `Teams` | error |
| A `W:` / `L:` ref names a match that does not exist | warning |

Errors block the move. Warnings are shown and can be overridden.

The three ref checks exist because a ref that cannot be read has to be reported
somewhere. Without them a typo, a deleted team or a renumbered match passes
validation and only surfaces when the match is called onto court.

The cross-group check is an error rather than a warning because §5.4 counts a
group match in both teams' tables. One hand-edited `group` cell therefore
corrupts two group tables at once, with nothing on screen to say why. The
generator cannot produce this; a person editing the sheet can.

`B:` refs are ordering-checked against the **end of the group phase**, not
against individual matches. A bucket is filled by group position (§5.5), so
what a `B:` ref waits for is a finished group table — the same thing a `G:` ref
waits for, except that a bucket draws from every group that reaches its rank and
the match does not say which groups those are. Checking against the last group
round of any group is the strict reading, and the right one: an endrunde match
that starts before the slowest group has finished is wrong even if the bucket it
happens to draw from is already settled.

This replaces an earlier note that deferred the check to build step 6 on the
grounds that the match model carries no bucket id. It carries none, and needs
none — the group phase boundary is enough.

The consecutive-rounds warning applies across phase boundaries too. On the
2026 data that is two warnings in 131 matches — a team leaving the group phase
straight into the endrunde, and a semi-final loser walking onto court for the
third-place match. Both are worth seeing; neither blocks anything.

This function is the safety net for every manual change, and should be written
and tested first, against the 2026 data as a known-good fixture.

---

## 8. `WEB` output format

Unchanged in spirit from the 2026 build; two changes to the `M` line, one wider
`P` line and one new line.

```
META|<title>|<teams>|<matches>|<logo>
C|<start>|<matchMin>|<semiMin>|<finalMode>
M|<nr>|<round>|<court>|<phase>|<label>|<aRef>|<aTeam>|<bRef>|<bTeam>|<sa>|<sb>|<aCode>|<bCode>|<status>
P|<afterRound>|<min>|<label>
G|<group>|<rank>|<code>|<team>|<sp>|<s>|<u>|<n>|<diff>|<pkt>
E|<place>|<team>|<group>|<origin>
```

Changes from v1: `zeit` is replaced by `round`; `status` is appended; `P` lines
carry a round index and the break's length instead of a time string; and the
`C` line is new.

`C` exists because §9.1 asks the viewer to compute times from `round`, and the
inputs §6.1 needs to do that have nowhere else to come from. `Config` is not an
alternative: it holds the admin token, so the public viewer must never read it.
`C` therefore carries the four timing values and nothing else — never `token`,
never `endpoint`. `P` gained `min` for the same reason: `plannedStart` needs the
length of a break, not only its position.

`<aTeam>` / `<bTeam>` are display names and `<aCode>` / `<bCode>` the team ids,
as in the 2026 build. `<sa>` / `<sb>` are the scores a table would count, so a
walkover appears as the configured score (§5.4): the format has no walkover
field, and writing the abandoned partial score would contradict the `G` lines
computed from the same match.

**Treat this format as a contract.** It is the seam between engine and viewer.
Keeping it stable is what allows the engine to be rewritten without touching
the UI — which is exactly the migration this project is performing.

---

## 9. Screens

### 9.1 Viewer (public, mobile-first)

Essentially the existing `index.html`. Tabs: Spiele, Gruppen, Platzierung.
Filter chips, search, live polling. The three changes step 10 made:

- Reads `round` and computes the time from the `C` line, the round index and the
  `P` breaks, instead of reading `zeit`
- Renders `status = playing` distinctly from `open` — a running court carries its
  own badge, not only the accent of the round it sits in
- Current round = first incomplete round (fixes the 2026 bug where one unplayed
  match pinned "Jetzt" to an early time block)

The page draws; it derives nothing. `viewer.js` holds the data layer — reading
§8 and assembling the blocks — and calls `timeline()` for every time it shows,
so the public screen and the round screen cannot disagree about when a round
starts. Splitting it out is also what makes it testable from a terminal: logic
inside an inline `<script>` cannot be checked against the fixture, and §11 asks
for exactly that.

**The viewer shows planned times, not live ones.** `liveStart` needs `doneAt`
(§6.1) and the `M` line does not carry it, so in the viewer `liveStart` always
equals `plannedStart` and the drift is always zero. This is deliberate: the
stamp is an admin observation living in `Spielplan`, and the screen that shows
drift is the round screen (§9.2). The viewer computes drift the same way anyway,
so it needs no change on the day a stamp does reach it.

### 9.2 Round screen (admin, mobile)

The primary day-of screen. Header: round number, live start time, delta from
plan, results-entered count. Below: one row per court showing the match and
either its score, `läuft`, or an entry affordance.

Tapping a row opens: score entry, mark as playing, mark as delayed, walkover.
Marking delayed expands the row inline with the promote suggestions.

### 9.3 Setup (admin, desktop)

Sheet ID entry, team list import, group allocation with the duration preview,
manual draw adjustment, generate, validate, write to sheet.

---

## 10. Build order

| # | Step | Depends on |
|---|---|---|
| 1 | Data model, `WEB` format v2 | — |
| 2 | `conflicts()` + 2026 fixture tests | 1 |
| 3 | Group allocation + duration preview | 1 |
| 4 | Group phase generator (circle method + packing) | 2, 3 |
| 5 | Standings engine | 1 |
| 6 | Bucket placement generator | 4, 5 |
| 7 | Timing model + round completion | 1 |
| 8 | Round screen: delay, promote, result entry | 6, 7 |
| 9 | Apps Script write path | 8 |
| 10 | Viewer updates | 7 |
| 11 | Template builder (`sheet/Vorlage.gs`) | 9 |

All eleven are built. The engine is `engine.js`, the two screens are `index.html`
and `round.html`, the seams are `sheet.js` (§3) and `viewer.js` (§8), and every
derivation is checked against the 2026 fixture by `node test/run.js`.

Steps 1–5 produce a usable planning tool on their own. Steps 6–8 are the
tournament-day half. Step 9 is what removes the need to open the spreadsheet,
and step 11 the need to build it by hand.

**Expect steps 6 and 8 to take longer than they look.** The placement generator
hides its complexity in bucket edge cases; the promote scoring is easy to write
badly, producing swaps that are legal but socially absurd.

---

## 11. Test fixture

The 2026 tournament is a complete known-good dataset: 30 teams, 131 matches,
full results, final placement 1–30. Every engine component should be validated
against it.

- `conflicts()` must return no errors on the 2026 schedule
- The standings engine must reproduce all four group tables exactly, including
  the A2/A4 and B2/B7 ties resolved on difference
- The placement generator must reproduce the 33-match endrunde structure
- The resolver must reproduce final placement 1–30
- The viewer must land on the same 34 round start times the v1 file recorded, and
  recompute the seven breaks onto the same clock ranges it wrote out as text

If any of these disagree, the new engine is wrong, not the fixture.
