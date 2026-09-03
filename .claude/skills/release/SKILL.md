---
name: release
description: Build a Chrome Web Store-ready zip for a new version, with analytics correctly tagged as production. Use when the user wants to release, ship a new version, cut a release, or package the extension for the Web Store.
---

# Release

Produces `career-atlas-X.Y.Z.zip` for upload to the Chrome Web Store, with the
version bumped and `VITE_ANALYTICS_ENV` correctly set to `production` for
that build only. This is the step that was previously manual and silently
shipped `environment: development` on every published event (see `.env` vs
`.env.example` in `src/analytics.ts`) — this skill exists specifically to
make that mistake structurally hard to repeat.

## Steps

1. **Clean tree check.** Run `git status`. If there are uncommitted changes,
   stop and ask the user whether to commit/stash first — a release build
   should come from a known, committed state.

2. **Run the test suite and typecheck.** `npm test` and `npm run typecheck`
   (or just `npm run build`, which runs `tsc --noEmit`). Stop and report if
   either fails; do not package a release on top of failing checks.

3. **Decide the version bump.** Read the current version from `package.json`
   and `manifest.config.ts` (they must match). Ask the user for the new
   version if they haven't already given one (or infer patch/minor/major from
   what changed since the last release, and confirm). Update the version in
   **both** `package.json` and `manifest.config.ts` — they are two separate
   hardcoded strings, not derived from each other.

4. **Build with production analytics env, via a shell override, not by
   editing `.env`.** Run:

   ```
   VITE_ANALYTICS_ENV=production npm run zip
   ```

   A shell-exported value takes precedence over the same key in `.env`
   (standard dotenv behavior: it does not overwrite an already-set process
   env var), so this produces a build tagged `environment: production`
   without ever touching the `.env` file on disk. This is deliberately safer
   than flipping `.env` and flipping it back: there's no window where `.env`
   sits at the wrong value, and nothing to forget to restore if the build
   fails partway through.

5. **Verify the artifact.** Confirm `career-atlas-X.Y.Z.zip` was written
   (the `zip` script derives the filename from `package.json`'s version, so
   it should already match) and briefly sanity-check `dist/manifest.json`
   inside it shows the new version
   (`unzip -p career-atlas-X.Y.Z.zip manifest.json | grep version`).

6. **Commit the version bump and tag it.** Stage exactly `package.json` and
   `manifest.config.ts`, commit with a message like `Bump version to
   X.Y.Z`, and push to `main` (this repo commits directly to `main`). Then
   tag that commit and push the tag:

   ```
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The tag is the durable pointer to exactly what shipped — since the zip
   itself isn't committed (see below), `git checkout vX.Y.Z && npm run zip`
   is how to reproduce a past release's artifact byte-for-byte later.

7. **Stop here.** Uploading to the Chrome Web Store Developer Dashboard is a
   manual, external action this skill does not and cannot perform. Tell the
   user the zip is ready at `career-atlas-X.Y.Z.zip` and that they need to
   upload it themselves.

## Why the zip isn't committed to the repo

`career-atlas-*.zip` is gitignored. It's a regenerable binary build
artifact, not source — committing one on every release would bloat the
repo's history with a binary diff each time for something fully
reproducible from a tagged commit. The `vX.Y.Z` tag from step 6 is the
answer to "where do I find release N" instead. If a specific released zip
needs to be kept somewhere permanent (e.g. for audit purposes), attach it to
a GitHub Release on that tag — don't add it to the repo tree.

## Why a shell override instead of editing `.env`

`.env` is the single file Vite reads for every build — dev, test, and the
one that gets zipped — so there's no separate "production env file" to point
`npm run zip` at without restructuring the build. Rather than temporarily
editing `.env` and restoring it (which leaves a window where the file is
wrong, and something to forget if the build fails), a shell-level
`VITE_ANALYTICS_ENV=production` in front of the command wins over `.env` for
that one process only, so the developer's on-disk default (`development`)
is never touched. If this still proves error-prone in practice, consider a
`.env.production` file Vite loads automatically in production mode as a
sturdier follow-up.
