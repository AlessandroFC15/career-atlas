# Seed Reveal — Loading as the Birth of the Chart: Detailed Plan

A focused craft item, not a numbered milestone. It replaces the bare ring spinner shown during the initial seed (`runSeed`) with a cosmic loading sequence: the deep-space canvas is present from the first frame, a "you" star ignites, a true scatter of company stars blooms and sharpens as their logos cache, and on completion the scatter cross-dissolves into M1's existing staggered-ignition intro. Builds on M0 (`m0-plan.md`, the `runSeed` orchestration) and M1 (`m1-plan.md`, the `CareerGraph` render and its intro animation).

The four shaping decisions below were resolved in a design interview; the choices and rationale are in the Decision Log at the end.

> **The problem.** Seeding takes roughly **10 to 40 seconds** (worker tab loads, two LinkedIn page loads, DOM polling with a logo grace period, then parallel image fetches). For that whole window today the user sees one borrowed CSS ring spinner and a swapping line of text. It is the one moment in the product that does not earn its cosmic identity, and with no sense of progress, a 30-second run reads as broken. This is the weak point we are fixing.

---

## 1. Definition of done

When the user clicks **"Seed my graph"** on a fresh (or re-seeded) profile:

1. **No spinner appears anywhere in the seed path.** The deep-space canvas (same `--bg`, same far-field starfield) is present from the first frame; the loading sequence lives inside that void.
2. A single line of **phase text** crossfades at the bottom through the seed's real phases. **No numbers, no counts** in the copy.
3. The void responds to real progress:
   - A single **"you" star** ignites at center when the profile header is read; it takes the avatar photo once that image caches.
   - A **scatter of dim company stars** blooms once parsing returns the real company list, **one star per company actually found**.
   - Each company star **sharpens / warms** as its own logo actually finishes caching.
4. On completion, the loading scatter **cross-dissolves** into the `CareerGraph` mount as M1's staggered ignition fires, so the transition reads as one continuous birth rather than a screen swap.
5. The **initial load-from-storage flash** (reopening an already-seeded tab) no longer shows the ring spinner either; it shows a single quiet breathing star, consistent with the rest.
6. Error and empty paths are **unchanged in behavior** (same `SeedError` variants, same worker-tab-stays-open), they just hand off from the loading canvas instead of the spinner.

Out of scope: any change to parsing, the data model's persisted shapes (`seed`, `graph`), `deriveGraph`/`layout`, or M2's galaxy work. The pure logic and its unit tests are untouched.

---

## 2. Design principle

The loading screen is **not a "please wait."** It is the prelude to the payoff, the same world the graph lives in, so it should feel like the chart *coming into being*, not a placeholder bolted on in front of it. Two rules follow:

- **Honest, never decorative.** Every star on screen maps to something real (you, or a company we actually found). We never animate fake choreography to fill time. This is the project's "nothing decorative that doesn't earn its place" ethos applied to the one screen that most tempts a cheat.
- **Restraint.** One line of text, soft glow, slow motion. The drama is the stars arriving, not effects.

---

## 3. The storyboard

The seed already moves through five genuinely sequential, meaningful phases. We map each to a beat in the void. The company count is known only when parsing returns (end of "read experience"); logos resolve over time during caching, which is the one truly streaming signal.

| Seed phase | What the void shows | Phase text (no numbers) |
|---|---|---|
| Open profile | Empty void, far-field stars drifting. A faint indigo "pull" at center, like something is about to form. | Opening your LinkedIn profile… |
| Read name / photo | **One bright star ignites at center** — that is *you*, the anchor of the chart. | Reading your name and photo… |
| Open experience list | The "you" star breathes and holds. | Opening your full experience list… |
| Read experience | **A scatter of dim stars blooms** around you, one per company actually parsed. Not lit, not connected. | Reading your experience… |
| Cache photos / logos | The "you" star takes its avatar photo; each company star **sharpens** as its logo really caches. | Caching photos and logos… |
| Done → handoff | The scatter **cross-dissolves** into `CareerGraph` as the staggered ignition fires and beams connect the chain. | (graph) |

By the time loading ends, the chart is already half-born. There is nothing to "load into": the load *was* the birth.

---

## 4. Architecture and where things live

```
HOME TAB (React, App.tsx)  ── view state machine
  view 'loading'  → quiet breathing star (was: ring spinner)     [reopen-from-storage flash]
  view 'seeding'  → <LoadingChart progress={…}>                  [NEW; was: <SeedingState> spinner + msg]
  view 'seeded'   → <CareerGraph animateIntro>                   [M1, unchanged]
       │
       └─ handoff window: LoadingChart and CareerGraph both mount briefly;
          LoadingChart fades out (CSS) as CareerGraph's ignition fires, then unmounts.

orchestrator.ts  runSeed({ onProgress })
   onProgress now emits a structured SeedProgress event (not a bare string) at each phase,
   plus a per-logo tick as each image settles during caching.
```

- The **orchestrator stays the single source of truth for progress.** It just reports richer events. It does not know about stars.
- The **view layer owns all choreography and copy.** Phase→text and progress→stars both live in `App.tsx` / `LoadingChart`, so wording and motion are tunable without touching orchestration.
- **One canvas illusion via cross-dissolve, not a shared node layer.** `LoadingChart` and `CareerGraph` are separate components; we do not try to persist literal star objects across React Flow's mount. Matching dark, matching glow, and matched timing make the dissolve read as continuous (~90% of the magic for a fraction of the risk). See §8.

---

## 5. Progress event model

Replace the current `onProgress(message: string)` with a small discriminated union so the view can choreograph against real state:

```ts
type SeedProgress =
  | { phase: 'opening-profile' }
  | { phase: 'reading-header' }
  | { phase: 'opening-experience' }
  | { phase: 'reading-experience'; companyCount: number } // count emitted once parsed
  | { phase: 'caching'; companyCount: number }
  | { phase: 'logo-cached' };                              // one tick per settled image
```

- The **phase strings are stable identifiers**, not display copy. The human text lives in a single `PHASE_TEXT` map in the view (§7), so we never recompile orchestration to reword a line.
- `companyCount` rides along from the moment it is real (parse return) so the view knows how many dim stars to bloom. It is **never rendered as a number**; it only drives geometry.
- `logo-cached` fires once per image as it **settles** (resolved *or* failed), so the tick count matches the work even when a company has no logo (that star still sharpens, into an initials tile). The avatar settling fires one too, which the view routes to the "you" star.

`App.tsx` holds a derived seeding state, e.g. `{ phase, companyCount, cachedCount }`, incrementing `cachedCount` on each `logo-cached`.

---

## 6. Orchestrator changes

Contained edits in `orchestrator.ts`, no behavior change to parsing or persistence:

- **Swap the five `progress("…string…")` calls** for the corresponding `onProgress({ phase: … })` events, attaching `companyCount` (from the parsed `ExperienceEntry[]` length) on the `reading-experience` and `caching` events.
- **Per-logo ticks.** `cacheImages()` currently fetches avatar + every logo in one `Promise.all`. Wrap each fetch so it emits `onProgress({ phase: 'logo-cached' })` as it settles (e.g. `.finally(tick)` per item, or `Promise.allSettled` with a tick in each handler). This is the only structural change in the orchestrator, and it is local to `cacheImages`.
- **Signature stays callback-shaped**; only the callback's argument type changes. `runSeed` still resolves with the same `seed`.

---

## 7. The LoadingChart component (new)

`src/home/LoadingChart.tsx`, driven by the derived seeding state.

- Renders **inside the existing cosmic backdrop** (reuse `Cosmos` / the same CSS vars and star/glow rules so it is visually identical to the graph layer). No React Flow here; plain absolutely-positioned divs are enough for a static scatter.
- **The "you" star:** a single glowing point at center. Dim during "opening-profile", ignites on "reading-header", takes the avatar photo (reuse `Avatar` with its initials fallback) once `cachedCount` indicates the avatar settled.
- **Company stars:** when `companyCount` becomes known, render that many dim star points in a **deterministic scatter** around center (positions seeded by index, e.g. a golden-angle spiral, so nothing jitters on re-render; no `Math.random`). As `cachedCount` climbs, the first *k* stars switch from dim to sharpened. (Mapping by order is fine; the user cannot tell which physical logo finished, only that the field is warming up.)
- **Phase text:** one line near the bottom, crossfading on phase change, from a `PHASE_TEXT: Record<SeedProgress['phase'], string>` map. Copy is the §3 column, tunable in one place.
- **Motion vocabulary (new CSS keyframes in `styles.css`):** `orb-ignite` (scale + glow in, with the same soft overshoot family as M1's intro), `orb-breathe` (slow glow pulse for the holding "you" star), `scatter-bloom` (dim points fading/scaling in), `star-sharpen` (dim→warm). All slow and soft; reuse `--accent`, `--glow`.

---

## 8. The cross-dissolve handoff

The make-or-break moment, kept deliberately simple.

- On `runSeed` success, `App` transitions to `seeded` **with a brief handoff window** where **both** `LoadingChart` and `CareerGraph` are mounted: `CareerGraph` underneath (running M1's staggered ignition, which already exists), `LoadingChart` on top fading its opacity to 0 over a fixed duration.
- After the fade duration (a `setTimeout`/transition-end), `LoadingChart` unmounts. The eye reads one continuous motion: dim scatter dissolving exactly as the real chain ignites into beams.
- **No pixel-perfect position matching** between the loading scatter and the graph layout. Identical dark, identical glow, and timing the fade to start as the ignition fires carry the continuity. (M1's intro is a 450ms-per-node stagger over a ~1650ms pop; the dissolve is tuned against that, not against star coordinates.)
- **Re-seed** uses the same path: it already re-keys `CareerGraph` by seed timestamp and re-fires the intro, so the dissolve works identically.

---

## 9. The reopen-from-storage flash

The `loading` view (reading an existing `seed`/`graph` on mount) currently also shows the ring spinner. Replace it with a **single quiet breathing star** (the idle "you" star, no scatter), so the ring spinner is gone from the codebase's user-facing paths entirely and the brief flash matches the world. This is a few lines, done alongside the main work for consistency.

---

## 10. Testing

- **Pure logic is unaffected**, so existing parser / `deriveGraph` / `layout` unit tests must still pass untouched (the regression signal that we kept this to the view + progress plumbing).
- **New small pure unit:** the deterministic scatter helper (`(count, index) → {x, y}`) is side-effect-free and worth a test: stable output for the same input, and `count` points all within the intended field. Keeps the one piece of geometry honest.
- **Eyeballed (consistent with M1's "React Flow render is eyeballed"):** a full live seed to watch the five beats land, the per-logo sharpening actually track real fetches, and the dissolve read as continuous into the chain. Also eyeball a re-seed and a reopen-flash.
- **Manual error check:** trigger a logged-out / empty run and confirm the loading canvas hands off to the existing error/empty states with the worker tab still surfaced (behavior unchanged).

---

## 11. Risks and things to verify

- **Dissolve timing is the only real risk.** If the fade and the ignition feel like two events instead of one, tune the fade start/duration against M1's stagger; the fallback is a plain quick cross-fade (still strictly better than today's spinner). Recorded as a tuning task, not a scope cut.
- **Logo ticks vs. star count.** Ticks must settle-not-succeed so a logo-less company still sharpens its star; verify a profile with a missing/free-text company logo warms fully.
- **Very fast or very slow seeds.** A sub-second seed should not flash the scatter jarringly (consider a minimum beat duration so phases are legible); a 40-second seed should keep the "you" star breathing so it never looks frozen. Verify both ends.
- **Count arrives late.** Stars only bloom after parse returns, so phases 1–3 are just the "you" star. That is honest (we genuinely do not know the companies yet) and acceptable; verify it does not feel empty for the first few seconds (the breathing anchor + drifting far-field should carry it).

---

## 12. Tensions and deferrals

- **Cross-dissolve over shared layer.** We chose the dissolve for simplicity and to avoid fighting React Flow's mount. A literal persistent star layer (true position continuity) is carried as possible future polish, not scope.
- **Phases-only, no counts.** Live counts ("7 companies", "4 of 7 logos") were explicitly declined for restraint. The `companyCount` is in the event model only to drive geometry; if we ever want a count, the data is already there.
- **Order-mapped sharpening.** Sharpened stars track `cachedCount` by order, not by which specific logo finished. Invisible to the user and not worth the wiring to make exact.
- **Minimum-beat pacing.** If short seeds flash, a small floor per phase may be added; left out of the first cut to avoid making a fast path feel artificially slow.

---

## 13. Decision log

| Topic | Decision |
|-------|----------|
| Ambition | **Full reveal** — loading *is* the birth of the chart, no spinner anywhere in the seed path |
| Copy | **Phases only**, no numbers/counts in the text |
| Star truth | **Driven by real signal** — one star per company actually found, each sharpens as its logo really caches (no fake choreography) |
| Handoff | **Timed cross-dissolve** — loading scatter fades as M1's staggered ignition fires; not a shared persistent star layer |
| Progress API | `onProgress(string)` → **structured `SeedProgress` union** + a per-logo settle tick |
| Copy ownership | Phase→text map lives in the **view**, not the orchestrator (stable phase ids on the wire) |
| Orchestrator change | Only structural edit is **per-logo ticks in `cacheImages`**; parsing/persistence untouched |
| Scatter | **Deterministic** (index-seeded, no `Math.random`), unit-tested as a pure helper |
| Reopen flash | Ring spinner replaced by a **single breathing star** for consistency |
| Pure logic / tests | **Untouched**; existing unit tests must still pass as the regression guard |
| Error / empty paths | **Behavior unchanged**; they hand off from the loading canvas instead of the spinner |
