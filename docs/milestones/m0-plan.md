# M0 — Seed and Show: Detailed Plan

Detailed implementation plan for Milestone 0 (see `milestones.md`). Every decision below was resolved in a design interview; the choices and their rationale are recorded in the Decision Log at the end.

---

## 1. Definition of done

Logged into LinkedIn in Chrome, the user:

1. Clicks the extension icon, the home tab (a full extension page) opens.
2. Sees an empty state with a single **"Seed my graph"** button.
3. Clicks it. A visible worker tab opens to their own profile, navigates to the full experience list, a spinner shows on the home tab, and the worker tab closes itself when done.
4. The home tab then shows: their **profile photo and name**, and a **chronological list of every company** they worked at, each row showing the **company logo** and the **tenure dates**. The list is complete (untruncated).

Plus: a logged-out browser produces a friendly "log in then retry" state, and the parser has unit tests passing against a saved HTML fixture.

The graph itself is **not** in M0. This is a list.

---

## 2. Tech foundation (locked)

- **Language/build:** TypeScript + Vite with the CRXJS plugin (MV3-aware, HMR).
- **UI:** React (chosen with M1's graph libraries in mind).
- **Target:** Chrome only, Manifest V3.
- **Home surface:** a full `chrome-extension://` page opened as a real browser tab.

---

## 3. Architecture and component topology

```
toolbar icon click
      │  (background service worker: only job is to open/focus the home tab)
      ▼
HOME TAB  (React app, full extension page)  ◀── single source of UI + orchestration
      │  user clicks "Seed my graph"
      │  orchestration runs HERE (home page has full chrome.tabs / scripting access)
      ▼
WORKER TAB  (a real linkedin.com tab, visible)
      │  1. navigate to /in/me  → capture canonical URL + name + avatar URL
      │  2. navigate to <canonical>/details/experience/
      │  3. programmatic injection of the parser (executeScript func)
      │     parser polls for the experience list, then returns structured data
      ▼
executeScript RETURN VALUE  ──▶ home page fetches+caches images ──▶ chrome.storage.local ──▶ render
```

- **Orchestrator: the home tab page**, not the background service worker. The home page is open the whole time (it is the UI), avoids MV3's ephemeral-service-worker problem, and means work only happens while the user is actively watching. Closing the home tab cancels, by design.
- **Background service worker: minimal.** Its only responsibility is `chrome.action.onClicked` → open the home tab, or focus it if an instance already exists (single-instance, tracked by tab id). No `default_popup`.
- **Parser delivery: programmatic injection** via `chrome.scripting.executeScript`, run only after navigation completes. We do not use a declared content script (that would auto-run on every LinkedIn page the user browses).
- **Transport: the `executeScript` return value.** The injected parser function returns the structured object and `executeScript` resolves with it directly in the home page. No `runtime.sendMessage`, no listeners.

---

## 4. Manifest and permissions

- `permissions`: `["storage", "scripting", "tabs"]`
- `host_permissions`: `["https://www.linkedin.com/*", "https://*.licdn.com/*"]`
  - `linkedin.com` for navigation + injection.
  - `*.licdn.com` so the extension can **fetch image bytes cross-origin** (host permission bypasses CORS for the extension's own fetches; see §8).
- `action`: title only, no popup; `onClicked` handled in the background worker.
- `background`: a service worker module whose sole logic is opening/focusing the home tab.

---

## 5. Data model

```ts
type DateParts = { year: number; month?: number }; // month optional (some entries are year-only)

interface Role {
  title: string;
  start: DateParts;
  end: DateParts | null;       // null = "Present"
  rawDateText: string;         // original string, for display/debugging
}

interface ExperienceEntry {    // one LinkedIn experience card = one entry
  companyName: string;
  companyUrl?: string;         // canonical /company/<id>/ when the entry is linked
  companyUrn?: string;         // derived from companyUrl when present
  logoUrl?: string;            // original media.licdn.com URL (debug/refresh)
  logoDataUrl?: string;        // cached base64, what the UI renders
  start: DateParts;            // aggregate of nested roles: earliest start
  end: DateParts | null;       // aggregate: latest end (or null if any role is Present)
  roles: Role[];               // one or more nested roles (promotions within the stint)
  rawDateText: string;
}

interface Seed {
  name: string;
  profileUrl: string;          // resolved canonical /in/<vanity>/
  avatarUrl?: string;          // original URL
  avatarDataUrl?: string;      // cached base64, what the UI renders
  seededAt: number;            // epoch ms (Date.now() is fine in extension runtime)
  experiences: ExperienceEntry[];
}
```

Stored under a single `chrome.storage.local` key: `seed`. Re-seeding overwrites it (idempotent).

**Nesting vs. separate stints:**
- Multiple **roles inside one continuous stint** (promotions) collapse into one `ExperienceEntry` with aggregate `start`/`end` and the roles preserved in `roles[]`.
- A company worked at across **two non-contiguous stints** is **two separate `ExperienceEntry` records** (mirrors LinkedIn's two cards 1:1). They will share a `companyUrn`. See §13 for the downstream reconciliation this requires.

---

## 6. Orchestration sequence (happy path)

Run from the home page when "Seed my graph" is clicked. UI state → `seeding` (spinner).

1. `chrome.tabs.create({ url: "https://www.linkedin.com/in/me/", active: true })` → worker tab (visible per `journey.md`).
2. Await `tabs.onUpdated` `status === "complete"` for the worker tab. Read the resolved `tab.url`.
   - If it is a login/authwall URL → **error path A** (logged out).
3. Inject a small reader on `/in/me`: poll for the top-card `h1`, return `{ name, avatarUrl }`. Canonical `profileUrl` comes from the resolved `tab.url`.
4. Navigate the worker tab to `<canonical>/details/experience/`. Await `complete`.
5. Inject the **parser** (`executeScript` `func`): it polls for the experience list (bounded timeout), then parses and returns `ExperienceEntry[]` (with `logoUrl`s, real `src` not lazy placeholders).
   - List never appears within timeout → **error path B**.
   - List appears but yields zero entries → **error path C**.
6. Home page **fetches and caches images** (§8): avatar + each company logo → data URLs.
7. Assemble `Seed`, write to `storage.local`, set state → `seeded`, render.
8. **Close the worker tab** (success only).

---

## 7. Parser design

> **Revised during implementation (2026-06-05).** Inspecting the *live* 2026
> `details/experience` DOM via Claude-in-Chrome invalidated the original
> extraction technique below. The current page has **no `pvs-entity`/`t-bold`/
> `pvs-list` classes** (class names are now obfuscated, per-deploy hashes) and
> **no visually-hidden screen-reader span copies**. Cards are `<div>`-based
> (grouped multi-role companies nest their roles in a `<ul>/<li>`), and the only
> deploy-stable signals are **font-weight 600 on heading lines** and a
> **date-range text pattern**. The strikethrough text is the original plan; the
> bullets after it are what was actually built and tested. See the Decision Log
> and §13.

- ~~**Technique:** DOM scraping of rendered text. Anchor on the experience section/list, read the visually-hidden `<span>` text (the clean screen-reader copies) for company name, titles, and date ranges.~~
- **Technique (implemented):** class-free DOM scraping anchored on two stable signals:
  - **List/card discovery:** the experience list is the lowest common ancestor of all date-range `<p>` elements; each card is a child of it that contains a date-range `<p>`. (LCA-of-dates, not anchor-of-company, so unlinked companies are still found.)
  - **Within a card:** count bold (`font-weight ≥ 600`) `<p>` lines. **1 bold ⇒ single role** (bold = title; the next plain line is `Company · Type`; the date line is the tenure). **≥2 bold ⇒ grouped** (`bold[0]` = company; each later bold line is a role title whose tenure is the *next* date line after it, which skips stray `Full-time`/`Internship` employment-type lines).
  - `companyUrl`/`companyUrn` from the entry's `a[href*="/company/"]` (now clean numeric ids, e.g. `/company/3051496/`); `logoUrl` from the card `<img>`.
- **Bold detection:** read `getComputedStyle(el).fontWeight` (live: real CSS; offline: the fixture bakes each `<p>`'s computed weight inline so jsdom can read it).
- **Self-contained constraint:** because we inject via `executeScript`'s `func` (to get a return value), the parser must be a single self-contained function with any helpers nested inside it. It cannot import at runtime. It is still a normal TS function, so it is unit-testable directly (§12).
- **Readiness:** poll for the experience list (LCA discovery) up to a bounded timeout before parsing. Robust to LinkedIn's lazy loading.
- **Dates:** parse to `{ year, month? }`, `"Present"` → `null` end, keep the raw string.

---

## 8. Image capture

- The parser returns **image URLs only**. Byte-fetching happens in the **home page** (extension context), which, thanks to `*.licdn.com` host permission, can fetch cross-origin and read the response body (page-context `fetch` would be blocked by CORS; a canvas read would taint).
- For each URL: `fetch` → `blob` → `FileReader.readAsDataURL` → store as `avatarDataUrl` / `logoDataUrl`.
- **Cache as data URLs**, not raw URLs: durable across reopens, no signed-URL expiry, no img-src CSP/host gymnastics at render time.
- **Fallbacks (initials placeholder):** missing profile photo → initials circle; missing/free-text company logo → company-initial letter tile. Always renders cleanly.

---

## 9. Persistence

- `chrome.storage.local` is the single source of truth in M0. Flow is parse → cache images → write → render-from-store.
- On home-page mount, read `seed`; if present, render it. (The polished "restore on reopen" UX is formally M1, but persisting now means M0 inherits a basic read-on-mount for free and avoids a throwaway in-memory path.)

---

## 10. UI states (React)

- **Empty:** profile photo absent, "Seed my graph" CTA.
- **Seeding:** single indeterminate spinner (chosen over staged messages for simplicity).
- **Seeded:** header with avatar + name; **chronological** (oldest first) list of company rows, each = logo + company name + tenure (e.g. "Acme · Jan 2020 – Present"). Re-seed allowed (overwrites).
- **Error:** variant-specific message + retry (see §11).

---

## 11. Error handling

| Path | Trigger | Behavior |
|------|---------|----------|
| A. Logged out | `/in/me` resolves to login/authwall | Keep + focus the worker tab, show "Log in to LinkedIn, then click Seed again". |
| B. Parse-not-ready | Experience list never appears within timeout | Keep worker tab for inspection, show parse-failed + retry. |
| C. Empty | Parser returns zero entries | Show "No experience found"; keep worker tab. |
| D. Generic | Navigation/tab error, or user closed the worker tab mid-run | Show generic failure + retry. |

Worker tab is auto-closed **only** on success; on every error it stays open and is surfaced so the user can see the real page state.

---

## 12. Testing

- **Fixture-first:** save a static HTML snapshot of your own `details/experience` page; build and unit-test the parser against it offline (jsdom), no LinkedIn hits. Fast, reproducible, catches regressions when LinkedIn reshuffles markup.
  - **Done (2026-06-05):** `test/fixtures/experience.html` is a real, sanitized capture of the author's own page (classes + tracking query strings stripped; each `<p>`'s computed font-weight baked inline so the bold signal survives in jsdom). 8 parser tests pass against it, covering single roles, grouped roles, "Present" ends, year math, an unlinked company, and the employment-type-line quirk.
- Then validate end-to-end live on your real profile.
  - **Done (2026-06-05):** live seed validated end-to-end on the author's logged-in profile (name, avatar, all six companies with logos and tenure). Two live-only fixes were needed and are folded into §6/§7: (1) the parser must wait a grace period for the lazily-loaded logo `<img>` `src`s to populate before reading, otherwise it parses the instant the *text* hydrates and loses every logo; (2) the `/in/me` header reader uses `document.title` for the name because the live top card has no `<h1>` (the name is in an `<h2>`).

---

## 13. Noted tensions and deferrals

- **Two-stint companies → two list rows** (your choice) keeps M0 a 1:1 mirror of LinkedIn, but they share one `companyUrn`. When M4 dedups company nodes by URN, this needs reconciling (one node holding two intervals, vs. two nodes). Flagged now so it does not surface silently later. **Resolved in M1 (`m1-plan.md` §4):** the seed renders as a chronological chain, so two stints become **two chain nodes** at two points in time, never deduped. M4's dedup is reframed as a Level-2 (onward-company) concern only.
- **Restore-on-reopen UX** is M1; M0 persists and does a basic read-on-mount only.
- **Parser brittleness vs. obfuscated DOM** (surfaced 2026-06-05): the live parser leans on `font-weight: 600` to find heading lines because LinkedIn's class names are now per-deploy hashes. This is more robust than class selectors but still breaks if LinkedIn restyles headings to a different weight. Mitigation deferred: a text-pattern fallback (e.g. infer titles by position relative to date lines) if the bold signal ever proves unreliable. The fixture-based test will catch a regression fast.
- **Stop / pacing / challenge handling** are M5; M0's two own-profile loads are low-volume and need none of it.

---

## 14. Decision log

| Topic | Decision |
|-------|----------|
| Build/lang | TypeScript + Vite (CRXJS) |
| UI framework | React |
| Browser | Chrome only, MV3 |
| Home surface | Full extension page in a tab |
| Icon click | Open/focus the home tab (no popup) |
| Orchestrator | The home tab page |
| Parser delivery | Programmatic injection (`executeScript`) |
| Own-profile resolution | Navigate worker tab to `/in/me` |
| Completeness | Two-step: `/in/me` then `/details/experience/` |
| Extraction | ~~Visually-hidden span text~~ → **class-free scraping anchored on font-weight (bold headings) + date-range pattern** (revised 2026-06-05; live DOM dropped stable classes and screen-reader spans; see §7) |
| Multi-role (nested) | One company, aggregate tenure, roles preserved |
| Dates | Normalized `{year, month?}` + raw string |
| Transport | `executeScript` return value |
| Persistence | `chrome.storage.local` now (single source of truth) |
| Company link/URN | Capture when present |
| Re-seed | Overwrite (idempotent) |
| Worker tab end | Close on success, keep on error |
| Readiness | Poll for the section, then parse |
| Logged out | Detect and prompt to log in |
| Progress UI | Single spinner |
| Boomerang company | Two separate entries |
| Sort order | Chronological (oldest first) |
| Parser testing | Fixture-first, then live |
| Profile photo | Captured on `/in/me`, cached as data URL, initials fallback |
| Company logos | Captured per entry, cached as data URL, initial-tile fallback |
| Image storage | Cache as data URLs (durable) |
| Image fetch | From the home page, via `*.licdn.com` host permission |
