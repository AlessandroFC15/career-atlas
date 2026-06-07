# Potential Ideas

A running list of ideas worth considering but not yet committed to a milestone. Capture freely; promote to a plan when one earns its place.

## Galaxy / trajectory

- **Show colleague promotions in the galaxy.** When a colleague is expanded, surface where they were promoted (held 2+ roles at one company). The data already exists: `OnwardStint.roles` is filled in `deriveOnward` (`src/graph.ts`), and `roles.length > 1` means a promotion at that onward company. Today it only whispers as a hover label on the leaf orb. Open question is the *visual form*, not the data.
  - Constraint we like: not new orbs. Promotions are growth *within* a company, so they shouldn't add nodes to the trajectory.
  - Tried (and scrapped, didn't like it): a "level up" indicator drawn on the beam arriving at the leaf, in three candidate glyphs (chevrons climbing into the star, a `↑N` count chip, perpendicular tick marks). The beam carrying it felt like a metaphor stretch (a beam is a *move between* companies; a promotion happens *at* one), and the chevrons read as noise more than signal.
  - If revisited: consider expressing it on the leaf/star itself rather than the edge (e.g. a subtle multi-ring corona, or the join-year label growing into a small "joined as X → climbed N" on hover). Also a scope call left open: whether to also show promotions at the *shared* company (resonant "you watched them climb", but needs extra derivation and has no leaf to attach to).
  - Related tweak that stands on its own: the leaf hover could name the role they *joined as* (the entry position, i.e. the last element since LinkedIn lists roles latest-first) to pair with the join year, instead of the full `·`-joined role list.

## Sharing

- **Export a screenshot of your trajectory to share on social media.** Let the user export their career star-chart as an image (e.g. PNG) to post on LinkedIn / X / etc. Fits the "soulful, crafted" feel: a beautiful constellation of where you've been is inherently shareable, and doubles as organic distribution for the product. Worth designing the framing/branding of the exported image deliberately (title, name, subtle watermark) so a shared image looks intentional.
