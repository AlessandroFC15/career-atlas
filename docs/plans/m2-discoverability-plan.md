# M2 — Star Discoverability: Detailed Plan

How we make it clear that a company star is clickable (drill into its galaxy)
without breaking the cosmic minimalism. This is a sub-plan of `m2-plan.md` (the
fly-into-star drill-in); it covers **only the affordance**, not the fetch,
parser, galaxy layout, or transition. Those live in `m2-plan.md` §5–§9.

## 0. The problem

After a fresh seed, the atlas renders the company chain as glassy stars with
**zero affordance** (M1 was deliberate about this — `CompanyNode`'s comment:
"Dormant, no click handler in M1; M2 wires expansion onto this same node, so no
fake affordance here"). Users don't know a star is a door. M2 makes the click
live (`m2-plan.md` §9: "company stars now carry a click handler; the dormant
Level-0 styling becomes live"). This plan is that styling.

## 1. Decisions (settled in brainstorm)

- **Zero words.** No "Click to explore" labels, no per-star tooltips, no ambient
  caption. The signal is pure motion / hover / metaphor. This is the highest-risk
  choice for raw comprehension and the most on-brand for the visual direction;
  accepted deliberately.
- **Three layers, on three timescales:**
  1. **Hover baseline** — immediate per-star feedback, rehearses the fly-in.
  2. **Post-seed ripple** — a one-time wordless "these are alive" wave, first run.
  3. **Orbiting ring on hover** — the signature, metaphor-native signal: a star
     visibly contains a *system* you can enter.
- **Out of scope** (considered, dropped): idle nudge timer, neighbor-dimming on
  hover (the fly-in already cross-fades neighbors; doing it on hover too risks
  feeling busy — revisit only if hover alone tests weak), any microcopy.

## 2. Definition of done

On a seeded atlas, with no text anywhere in the chain:

1. **Cursor** over any company star is a pointer (the one universal "clickable").
2. **Hovering** a star: it lifts and scales up slightly, its corona blooms
   brighter in its own `--star-color`, and a **faint ring** (the "this is a
   system" preview) fades in around the orb. Leaving reverses it smoothly.
3. **Immediately after the seed ignition finishes**, a single gentle pulse
   travels down the chain, left to right (the stars "breathe once"), then the
   atlas settles into its normal ambient float. It fires **once per fresh seed**,
   never on load-from-storage, never again.
4. All three respect `prefers-reduced-motion`: the hover lift/ring collapse to a
   static brightness change; the ripple does not play.
5. None of it shifts React Flow's `fitView` framing or knocks the edge beams off
   the orb centers (the bug fixed in `143ece1` must stay fixed — see §6).

The render is eyeballed (consistent with M1's "React Flow rendering is eyeballed,
not unit-tested"). No new pure logic, so no new unit tests (see §7).

## 3. Layer 1 — hover baseline

**Where:** CSS only, on the existing `.career-node` / `.career-star` /
`.career-node__pop` structure (`styles.css` ~233–290). Plus one prop wiring in
`CareerGraph.tsx`.

- **Cursor.** Set `cursor: pointer` on `.career-node` (or via React Flow node
  config). Cheapest, most reliable signal; do it regardless of everything else.
- **Lift + corona bloom.** On `.career-node:hover .career-star`:
  - a small `transform: scale(~1.06) translateY(-2px)` (the star rises toward
    you — same gesture as the fly-in pulling you in),
  - intensify the existing corona `box-shadow` (raise the `color-mix` percentages
    / blur radius of the near + far corona layers).
  - **Transition, not keyframes**, ~150–200ms ease-out, so it tracks the pointer.
- **Interaction with the ambient `starfloat`.** `.career-star` already runs an
  infinite `starfloat` translateY animation. A hover `transform` on the same
  element will fight it (animation wins / snaps). Resolve by **moving the hover
  scale/lift onto a wrapper** (e.g. apply lift to `.career-node__pop` or a new
  inner element, keep `starfloat` on `.career-star`), so the two transforms live
  on different elements and compose. Confirm against the §6 handle constraint:
  the lift must stay **inside** `.career-node__pop`, never on the node root that
  carries the React Flow handles.

## 4. Layer 2 — post-seed ripple

**Where:** extends the existing pure-CSS intro system (`styles.css` ~291–331),
gated by the same `.career-graph[data-intro]` attribute that `CareerGraph`
already sets only on the `handleSeed` (fresh-seed) path. **No JS timers.**

- The intro already staggers each star's ignition by `calc(var(--i) * --stagger)`
  and starts the ambient float at `calc(var(--i) * --stagger + var(--pop))`
  (after that star settles). The ripple is **one more keyframed pulse** slotted at
  that same per-star settle moment, so it reads as a wave that follows ignition
  down the chain.
- **Mechanism:** a short keyframe (e.g. a ~1.04 scale-and-glow swell and back,
  ~600ms) on a hover-neutral element (same wrapper chosen in §3 to avoid the
  `starfloat` conflict), with `animation-delay` keyed on `--i` so star 0 pulses
  first, then 1, then 2 — the "breathe once" wave. It runs **once** (no
  `infinite`), under `[data-intro]` only, so load-from-storage never plays it and
  it never repeats.
- **Sequencing:** the pulse should begin **as/just after** each star finishes
  igniting, i.e. delay ≈ `calc(var(--i) * --stagger + --pop)` (the same anchor
  the ambient float uses today). Tune so the ripple doesn't collide visually with
  the overshoot tail of `star-ignite`.
- Keep `--stagger` / `--pop` as the single source of truth (the comment at
  ~295 already warns to keep them in sync with the m1 spec); the ripple reuses
  them rather than introducing new magic numbers.

## 5. Layer 3 — orbiting ring on hover

The signature touch: on hover, a faint ring (and optionally one or two small
orbiting dots) appears around the orb, previewing that the star **contains a
system** — the galaxy of people you're about to fly into. The affordance *is* the
concept.

- **Where:** a new decorative child inside `.career-star` (an `::before`/`::after`
  pseudo-element is cleanest — no new DOM, no React change). The existing
  `.career-star` is already `position: relative`, so an absolutely-positioned ring
  anchors to it for free.
- **Look:** a thin, low-opacity circular border slightly larger than the orb
  (a hair outside the bright rim), tinted with `--star-color` so it inherits the
  company hue, same language as the corona. Default state: invisible /
  `scale(0.9)` + `opacity: 0`. Hover: `opacity` up + `scale(1)` via transition.
- **Optional orbiting dots (stretch within this layer):** 1–2 tiny dots on the
  ring, slowly rotating, to literally say "things orbit here." Adds the most
  "soul" but also the most motion; build the plain ring first, add dots only if it
  reads flat. If included, the rotation is a slow `@keyframes spin` on a ring
  wrapper, paused under reduced-motion.
- **Restraint check:** one ring, one hue, fades in/out with the same timing as the
  lift so hover feels like a single gesture, not three stacked effects.

## 6. Constraints to honor (don't regress these)

- **Beam centering (`143ece1`).** Edge beams attach to React Flow `Handle`s that
  sit on `.career-node`, deliberately **outside** `.career-node__pop` so the intro
  scale never moves them. Every transform added here (hover lift, ripple) must
  stay on `.career-node__pop` or a child, **never** on `.career-node` itself, or
  the beams will shift off the orb again. This is the single biggest footgun.
- **`fitView` stability.** Node bounding-box dimensions (`NODE_WIDTH/HEIGHT`,
  `ORB`) feed `fitView` measurement. Hover scale is a visual `transform` (doesn't
  change layout box), so it's safe — but do **not** change the node's actual
  width/height or margins on hover.
- **`starfloat` composition (§3).** Two transforms on one element conflict; keep
  ambient float and hover/ripple on separate elements.
- **`prefers-reduced-motion`.** The file already has reduced-motion blocks for
  `starfloat`, the intro, and the cosmos. Add matching guards: hover degrades to a
  static brightness bump (no scale, no animated ring fade), ripple is disabled.

## 7. Testing

- **No new unit tests.** This is pure presentation; per CLAUDE.md, React Flow
  rendering is eyeballed. The existing `deriveGraph` / `layout` tests are
  untouched.
- **Manual checklist (fresh seed):** pointer cursor on hover; lift + corona +
  ring fade in and reverse cleanly; the one-time ripple plays once, left→right,
  right after ignition; reload-from-storage shows **no** ripple; beams stay
  centered on orbs through hover and ripple; `fitView` framing unchanged; toggle
  OS reduced-motion and confirm the static fallbacks.

## 8. Build order

1. Layer 1 (cursor + lift + corona), resolving the `starfloat` wrapper split
   first — that wrapper decision unblocks layers 2 and 3.
2. Layer 3 (hover ring) on the same wrapper.
3. Layer 2 (post-seed ripple) last, since it's the fiddliest timing and depends on
   the same conflict-free wrapper.
4. Reduced-motion guards alongside each layer, not bolted on at the end.

This sequencing means the click handler from `m2-plan.md` §9 can land first and be
testable with just the cursor change, then the polish layers stack on top without
touching the drill-in logic.

## 9. Open taste calls

- **Ring vs. ring-with-orbiting-dots** — ship the plain ring, judge by eye whether
  it needs dots (§5).
- **Ripple intensity** — a single subtle swell vs. a slightly more legible pulse;
  tune live against the "breathe once" feeling, erring quiet.
- **Whether hover should also dim neighbors** — dropped for now (the fly-in
  already does it); reconsider only if hover-alone tests weak (§1).
