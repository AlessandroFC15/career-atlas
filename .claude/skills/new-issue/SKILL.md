---
name: new-issue
description: Research and file a new GitHub issue on this repo. Use when the user wants to file, open, or log an issue, turn a finding from the session into an issue, or promote an idea from docs/potential-ideas.md.
---

# New issue

Turn a rough ask into an issue someone can act on, then open it with `gh`.

## The two rules

Everything else here is judgment. These two are not:

1. **Actionable cold.** A reader who was not in this conversation must be able to
   pick it up without asking a follow-up question. If they would have to ask
   "where?" or "what does it do today?", the issue is not finished.
2. **Anchored, when code exists.** Go read the actual code before drafting a word,
   and cite what you found as file + symbol, with the line as a convenience:
   `src/orchestrator.ts:74` — `isLoggedOutUrl()`. The symbol is what survives when
   the line number rots. A pure product idea with nothing built yet is allowed to
   have no anchors; a bug or a refactor is not.

Read issue #1 (`gh issue view 1`) for tone and depth. It is a reference, **not a
template**: do not copy its headings.

## Where the ask comes from

- **A one-liner from the user.** Cold start. Research it before writing.
- **Something found during this session.** The context is already loaded; use it,
  and still verify the anchors are current.
- **An entry in `docs/potential-ideas.md`.** Fold in what the doc already says
  rather than restating it worse. Leave the doc alone (editing it is not this
  skill's job); mention that the entry now has an issue.

## Writing it

- **Size it to the thing.** A typo fix is two sentences. A design-loaded change
  earns issue #1's length. Never pad a small issue into the shape of a big one.
- **Shape is free.** No mandated sections. Cover what the issue needs: what happens
  now, why it is worth doing, where the code lives, the rough shape of a fix, how
  you would know it is done. Drop whatever does not apply.
- **Leave open questions open.** When you hit a design fork, do not interrogate the
  user at filing time. Write the fork into the body, state a lean, and let whoever
  picks it up decide.
- **House style.** No em dashes. Use the settled vocabulary from `CLAUDE.md` (atlas,
  galaxy, cluster, swimlane, leaf; you *expand* a company, you *trace* a person).
  Issues are read outside the session, so the vocabulary matters more here, not less.

## Filing it

1. Write the body to a scratch file so the markdown survives intact.
2. `gh issue create --title "..." --body-file <path> --label <label>`
3. `gh project item-add 1 --owner AlessandroFC15 --url <issue url>` so it shows up in
   the launch project's Todo column.

**Label:** exactly one of the repo's existing labels, usually `bug` or
`enhancement` (`gh label list`). Never create a new label. If none fits, propose
one to the user instead of inventing it.

No draft-approval step: file it directly. If it comes out wrong, fix it with
`gh issue edit`.

Then print the issue number and URL in one line and get back to whatever we were
doing. Filing is a side errand, not a destination.
