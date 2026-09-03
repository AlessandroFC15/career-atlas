---
name: land
description: Finish a lane opened by /work-on. Rebases it onto main, verifies, fast-forwards main, pushes, and removes the worktree. Use when the user wants to land, finish, or merge a lane.
---

# Land

Close a lane `/work-on` opened. `/land` on its own lands the lane you are in;
`/land <slug>` lands one by name from the primary worktree.

Nothing red ever reaches `main`, and nothing is pushed before it is green.

## The sequence

1. **Commit what is left** in the lane, staging by explicit path. Never `git add -A`.
2. **Rebase onto main, in the lane's worktree**: `git rebase main`. Conflicts get
   resolved here, where the lane's context is. If a conflict lands in `styles.css`,
   `App.tsx`, `orchestrator.ts`, or `flow/build.ts`, stop and ask the user rather than
   picking a resolution.
3. **Verify, in the lane**: `npm test && npm run build`. After the rebase the lane tip's
   tree is exactly what `main` becomes, so this one run covers the merge too.
4. **Squash** the lane into one commit unless the user says otherwise (a lane that is
   already one commit just needs an amend, not a squash). The repo's history
   is curated one-liners (`M3: trace where a colleague went`); a trail of `fix test` does
   not belong on it. Write the message in that style, no em dashes, and end an
   issue-backed lane with `Closes #<n>` so GitHub closes the issue and the launch project
   moves the row to Done on its own.
5. **Merge and push**, from the primary worktree: `git merge --ff-only lane/<slug>` then
   `git push origin main`. The `--ff-only` is the assertion that step 2 really happened;
   if it refuses, do not merge, go back and rebase.
6. **Clean up**: `git worktree remove ../career-atlas-<slug>`, `git branch -d lane/<slug>`,
   and rebuild `dist/` in the primary, since that is the build Chrome has loaded.
7. **Report**: what landed, the issue it closed, and whether the user should reload the
   extension.

## When it fails

Stop and leave the worktree intact. Never carry a red lane onto `main` to fix it there.
If something slips through and `main` is broken before the push, reset `main` back to the
previous SHA and keep the lane branch alive.

## Abandoning

`/land --abandon <slug>` throws the lane away: print the branch SHA first so it stays
recoverable, then remove the worktree and delete the branch with `-D`. Move the issue
back to Todo (`f75ad846`) on the launch project, ids in the `work-on` skill.
