# Tournament Planner — Tournament App

A browser app for running a club doubles tournament. Read SPEC.md for the full
specification. SPEC.md is the source of truth — if something here contradicts
it, SPEC.md wins.

## Context

- Used by one person, twice a year. Simplicity beats generality.
- `Index.html` is the working 2026 viewer. It ran a real 30-team tournament
  successfully. Treat it as a reference, not as legacy code to be replaced
  wholesale.

## Hard rules

- No build step. No bundler, no npm dependencies, no framework.
  Plain HTML, CSS and vanilla JS that runs by opening a file in a browser.
- The `WEB` pipe-delimited format (SPEC.md §8) is a contract between engine and
  viewer. Do not change it without saying so explicitly and updating SPEC.md.
- All user-facing strings are German. Code, comments and commit messages are
  English.
- Every engine change must be validated against the 2026 fixture in
  `test/fixtures/`. See SPEC.md §11.
- Mobile first. The tournament-day screens are used one-handed, outdoors.

## Working style

- One build step (SPEC.md §10) per session.
- Explain your approach before writing code for anything non-trivial.
- Prefer small, readable functions over clever ones. I need to still understand
  this code in a year.
- After a step works, stop and tell me. I will commit.