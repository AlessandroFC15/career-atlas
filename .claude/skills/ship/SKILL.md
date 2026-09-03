---
name: ship
description: Commit the files changed in this Claude session and push them to the main branch. Use when the user wants to ship, commit and push, or publish their work.
---

# Ship

Commit the changes **made during this session** and push them to `main`. Do not
sweep up unrelated working-tree changes the user made by hand or in another
session.

1. Run `git status` and `git diff` (and `git diff --staged`) to see the full
   working tree.
2. Identify which files *this session* actually changed. These are the files you
   created or edited via your own tool calls in this conversation. Any other
   modified or untracked files (pre-existing edits, unrelated work) are NOT
   yours to ship.
3. If the working tree contains changes beyond the ones from this session, list
   the session-related files you intend to commit and the ones you are leaving
   alone, and confirm with the user before staging.
4. Stage only the session's files explicitly by path: `git add <file> [<file>...]`.
   Never use `git add -A` / `git add .` (that would sweep up unrelated changes).
5. If the session's changes are logically distinct (e.g. a code fix plus an
   unrelated doc update), make separate commits so history stays clean.
6. Write a concise commit message summarizing the changes. Follow the repo's
   existing commit style (see `git log`). No em dashes.
7. Push to main: `git push origin main`.
8. Report the result (commit hash(es) + push confirmation), and note any files
   you deliberately left uncommitted.

Notes:
- This project's convention is to commit directly to `main` (no feature branch).
- If this session produced no changes to commit, say so and stop, even if the
  working tree has other uncommitted changes.