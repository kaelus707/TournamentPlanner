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

The app itself is a single static `index.html` hosted anywhere (GitHub Pages).
One deployment serves every organizer; the `id` parameter selects the tournament.

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

No time column. Time is computed.

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
| 21 | 6/5/5/5 | 40 |
| 22 | 6/6/5/5 | 45 |
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

### 5.3 Group phase generation

Groups are disjoint, so matches from different groups can never conflict. This
makes packing simple:

1. Run the **circle method** within each group to produce its internal rounds.
   A group of size `m` yields `m-1` rounds (`m` rounds with a bye if `m` is odd).
2. Distribute group-rounds across global rounds, at most `courts` matches per
   global round.
3. Constraint: two rounds of the same group must be at least **two global rounds
   apart**. This gives every team its break automatically.

If step 3 cannot be satisfied, increase the number of global rounds. Do not
attempt clever optimisation — at this scale a greedy pass with a few randomised
restarts is sufficient and the result is easy to reason about.

### 5.4 Standings

Per group, per team: `Sp`, `S`, `U`, `N`, `Diff`, `Pkt`.

- Win 3, draw 1, loss 0
- `Diff` = goals for − goals against
- Order: **Punkte → Differenz → Siege → manual decider**

A walkover counts as a normal result with the configured score.

The manual decider is a column the organizer can fill when two teams are
identical on all three criteria. It is used only as the last tiebreak.

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

**Match count.** For 24 teams: 12 + 4 + 4 + 4 + 4 = 28 endrunde matches.
For 30 teams: 12 + 4×5 + 1 = 33, matching the 2026 event.

### 5.6 Ordering of the endrunde

Lower buckets play first, as in 2026: the last places are decided early so that
those teams can go home, and the final is the last match of the day on court 1.

Semi-finals, the third-place match and the final are scheduled alone on court 1.

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
An open-ended final has no computed end.

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
| `G:A:1` | 1st place, group A |
| `W:102` | winner of match 102 |
| `L:102` | loser of match 102 |
| `B:3:2` | 2nd of the rank-3 bucket |

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

Errors block the move. Warnings are shown and can be overridden.

This function is the safety net for every manual change, and should be written
and tested first, against the 2026 data as a known-good fixture.

---

## 8. `WEB` output format

Unchanged in spirit from the 2026 build; two changes to the `M` line.

```
META|<title>|<teams>|<matches>|<logo>
M|<nr>|<round>|<court>|<phase>|<label>|<aRef>|<aTeam>|<bRef>|<bTeam>|<sa>|<sb>|<aCode>|<bCode>|<status>
P|<afterRound>|<label>
G|<group>|<rank>|<code>|<team>|<sp>|<s>|<u>|<n>|<diff>|<pkt>
E|<place>|<team>|<group>|<origin>
```

Changes from v1: `zeit` is replaced by `round`; `status` is appended; `P` lines
carry a round index instead of a time string.

**Treat this format as a contract.** It is the seam between engine and viewer.
Keeping it stable is what allows the engine to be rewritten without touching
the UI — which is exactly the migration this project is performing.

---

## 9. Screens

### 9.1 Viewer (public, mobile-first)

Essentially the existing `index.html`. Tabs: Spiele, Gruppen, Platzierung.
Filter chips, search, live polling. Changes required:

- Read `round` and compute the time instead of reading `zeit`
- Render `status = playing` distinctly from `open`
- Current round = first incomplete round (fixes the 2026 bug where one unplayed
  match pinned "Jetzt" to an early time block)

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

Steps 1–5 produce a usable planning tool on their own. Steps 6–8 are the
tournament-day half. Step 9 is what removes the need to open the spreadsheet.

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

If any of these disagree, the new engine is wrong, not the fixture.
