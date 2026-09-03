---
name: work-on
description: Start work on a GitHub issue (or a free-text ask) in its own git worktree, moving the issue to In Progress on the launch project. Use when the user wants to start, pick up, or work on an issue, or spin up a parallel lane.
---

# Work on

Open a lane: one worktree, one branch, one piece of work. `/land` closes it.

## Resolve the ask

- **`/work-on <number>`**: `gh issue view <n> --json number,title,body`. The issue body
  is the brief. Read it before touching anything.
- **`/work-on "<free text>"`**: no issue, no project move. Skip straight to the worktree.

Slug: the issue number plus three or four kebab words from the title
(`6-more-orb-fake-load`). Free-text asks slug from the text.

## Move it to In Progress

Issue-backed lanes only. `item-add` is idempotent and returns the item id either way,
so always add before editing:

```
gh project item-add 1 --owner AlessandroFC15 \
  --url https://github.com/AlessandroFC15/career-atlas/issues/<n> --format json
gh project item-edit --project-id PVT_kwHOAIbwvM4BhTT_ --id <item id> \
  --field-id PVTSSF_lAHOAIbwvM4BhTT_zhgPhzQ --single-select-option-id 47fc9ee4
```

Status option ids: Todo `f75ad846`, In Progress `47fc9ee4`, Done `98236657`.
Never set Done here. `/land` closes the issue and the project moves it on its own.

## Open the lane

```
git worktree add ../career-atlas-<slug> -b lane/<slug> main
ln -s ../career-atlas/node_modules ../career-atlas-<slug>/node_modules
```

Branch from local `main`, not `origin/main`: main is sometimes ahead of the remote.
The symlink is safe because every lane shares one lockfile. If the work will touch
`package.json`, run a real `npm install` in the lane instead.

Then `EnterWorktree` with `path: ../career-atlas-<slug>` to move this session in.

## Do the work

Normal work, committing on the lane branch as you go. Verify with
`npm test && npm run build` (`build` runs `tsc --noEmit` first, so that is both checks).

Two facts about this repo, worth saying once to the user and then leaving alone:
`vite.config.ts` pins port 5173 with `strictPort`, so only one lane at a time can run
`npm run dev`; and a lane's unpacked build is a separate extension with its own storage,
so it needs its own seed. `manifest.config.ts` names it after the worktree directory
(`Career Atlas [<slug>]`), so it is tellable apart from the primary in Chrome.

## Running it detached

When the user asks for the lane to run in the background, hand it to an `Agent` with
`isolation: "worktree"` instead of the steps above, passing the issue body as the brief.
Do the project move first either way. Detached lanes suit work that verifies itself
(pure logic, parsers, tests) and not work that needs the user's eye.

## Finish

Print the worktree path, the branch, and that `/land` closes it.
