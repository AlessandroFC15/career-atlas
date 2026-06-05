# Career Atlas

Chrome (MV3) extension that maps who you overlapped with in your career and where
each of them went next, rooted in your own LinkedIn history. See `vision.md`,
`journey.md`, and `milestones/`.

## Status: M0 — Seed and show

Click the toolbar icon → a home tab opens → **Seed my graph** drives a visible
worker tab over your own profile, parses your experience, and shows your name and
a chronological list of every company you worked at (logo + tenure). No graph yet.
See `milestones/m0-plan.md` for the full design.

## Develop

```bash
npm install
npm run dev        # Vite + CRXJS dev server with HMR
npm run build      # type-check + production build into dist/
npm test           # parser unit tests (jsdom, against the saved fixture)
```

## Load the extension in Chrome

1. `npm run build`
2. Go to `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Pin the extension, click its icon, then **Seed my graph** (logged into LinkedIn).

For HMR during development, `npm run dev` and load the generated `dist/` (CRXJS
keeps it in sync); reload the extension from `chrome://extensions` after manifest
changes.

## Architecture (M0)

- `src/background.ts` — minimal service worker: toolbar click opens/focuses the home tab.
- `src/home/` — the React home page (UI + orchestration).
- `src/orchestrator.ts` — the seed sequence, run from the home page.
- `src/parser.ts` — self-contained experience parser injected via `executeScript`.
- `src/profileReader.ts` — self-contained `/in/me` header reader.
- `src/images.ts` — cross-origin image fetch → data URL caching.
- `test/` — parser unit tests + saved HTML fixture.

## Tests and the fixture

The parser is tested offline (jsdom) against `test/fixtures/experience.html`, a
**hand-authored** snapshot that mirrors LinkedIn's `details/experience` DOM
(visually-hidden span text, `pvs-entity` cards, grouped multi-role cards). Before
relying on the live path, replace it with a real saved snapshot of your own
`details/experience` page (m0-plan §12) and re-run `npm test`.
