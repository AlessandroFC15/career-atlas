# Career Trajectory Explorer — Vision & Approach

Personal notes. Captures what we're building, the constraints that shape it, and the high-level decisions made so far. Deliberately stops short of implementation detail.

---

## 1. Concept & Vision

A visual tool for exploring where former colleagues have gone in their careers, sourced from LinkedIn.

The graph is **two levels deep, rooted in your own career**. It does not unfold outward indefinitely.
- **Level 0 (seed):** your own companies. These are the **only expandable nodes**, a small fixed set drawn from your own history.
- **Level 1:** the **first-degree connections** who surface for a company you expand. **You confirm who you actually worked with by clicking them** (decided in M3, supersedes the earlier auto-overlap framing): clicking a person both confirms the relationship and traces their onward path. People you don't click stay as unconfirmed candidates; a click whose profile doesn't even list the company is dismissed as a search false positive.
- **Level 2:** the **workplaces those colleagues moved to afterward**. These are **terminal leaves**, plotted for insight but never expandable.

The graph answers exactly one question: for each place I worked, who did I work with, and where did each of them go next? See `journey.md` for the full step-by-step behavior.

**Visual arrangement (decided in M1, supersedes earlier "rooted, you at the center" framing).** The seed renders as a horizontal **career chain**: your companies in chronological order, each linked to the next (`first → next → …`), not as a fan radiating from a central "you" node. You appear in a **header bar**, not as a graph node. A company you worked at in two separate stints appears as **two chain nodes** at its two points in time, rather than one deduped node (see the deduplication note in `journey.md`). The two-level rooted model above is unchanged; this only fixes how Level 0 is laid out.

The intended feel is still **exploration, not a one-shot dump**: the graph grows where the user deliberately clicks, one company at a time, rather than materializing all at once.

**Navigation (decided in M2, supersedes the "one graph, all levels visible" framing).** The two levels are not all shown on one canvas. The product has two views: an **atlas** (the career chain above, Level 0) and, per company, a **galaxy** you **drill into** by clicking a company star. Inside a galaxy you see only that one company as the major star, its people (Level 1) as a cluster below it, and, for the colleagues you click, where each went next (Level 2). A back affordance returns you to the atlas. You explore one company's subtree at a time. One consequence, accepted: cross-company convergence (a colleague from company A and one from company B both ending up at the same place) is not visible, since you never see two companies' people at once. The two-level rooted model is otherwise unchanged; this fixes how levels 1 and 2 are presented. See `m2-plan.md`.

**Onward layout & convergence (decided in M3).** A colleague you click is pulled into their own **swimlane** below the cluster; their onward workplaces sit on a **continuous real-time axis** (left = earlier), so each person's timeline is read honestly. When two colleagues landed at the same place, the stars stay at their true dates and share a **convergence accent** (glow + a faint connecting thread) rather than being merged into one node, which preserves both the convergence insight and each individual timeline. See `m3-plan.md`.

---

## 2. Guiding Constraint: Human-Shaped Traffic

LinkedIn's terms prohibit automated data collection, and they enforce it. This is the single constraint that shapes the whole design, so it's stated up front rather than treated as a footnote.

The distinction that matters is **not** "who writes the code" or "is the browser real." It's the **pattern of access**:
- **Human-shaped**: requests come from the user's own logged-in browser, at low volume, each one triggered by a deliberate user action. Indistinguishable from normal browsing. Low risk.
- **Machine-shaped**: many requests in a loop, evenly paced, no reading time, navigation firing on its own. Flagged as automation regardless of where it runs. High risk.

Two consequences we accepted:
- **Unbounded multi-hop crawling is off the table.** Full auto-expansion that hops from company to company is inherently high-volume, and no pacing trick makes hundreds of automated fetches look human. The recursion *is* the volume. Every page load stays tied to a deliberate user action: clicking your **own** company loads one people-search page (M2), and clicking a **person** loads one profile to trace where they went (M3, supersedes the earlier "auto-sweep every connection" framing). There is no bulk sweep: only the colleagues you click are fetched, one at a time. Because onward companies are non-expandable leaves (see §1), this never cascades into multi-hop crawling; total volume is bounded by your own career size and how many people you choose to trace. The guardrails (randomized human pacing, session fetch budget, halt-on-challenge) are detailed in `journey.md`.
- **Scope is personal use, not a multi-user product.** A product where many people sign in and the system pulls their connections re-introduces scale, third-party (non-consenting) data processing, and GDPR exposure. The current design targets a single user exploring their own network.

These are decisions, not open questions. If the goal ever shifts to a shippable product, this section has to be revisited first, because it changes everything downstream.

---

## 3. Data Access Analysis

The graph needs three distinct pulls. They have very different availability.

**Pull #1 — your own work history.**
Seeds the graph, and read the same human-shaped way as everything else: from your own logged-in profile page, not an export. The entry point is one of two:
- **Preferred:** the browser extension pulls your work history directly from your own logged-in session, with no manual input. Because it's your own already-loaded profile, this is the cleanest possible seed.
- **Fallback:** you paste your logged-in profile URL, and the same page-parse runs against it.

There is no data export or manual file-upload step. This pull uses the identical parsing path as #2 and #3, just pointed at your own profile.

**Pull #2 — first-degree connections who worked at a given company.**
No official API or export provides this. It is only available by reading a logged-in LinkedIn page. **Mechanism (decided in M2, supersedes the "company People view" framing):** a single **first-degree people search** keyed on the company name (`/search/results/people/?keywords=<company>&network=["F"]`), rather than the company People tab (which would need a separate current-company and past-company fetch). One query, leaning on LinkedIn's relevance ranking. Confirmed against a live page: results filter cleanly to first-degree and parse into structured records (name, headline, location, profile link, photo). The keyword can over-match (people who never actually worked there), which is **fine because you only click the people you recognize**, and a click whose profile doesn't list the company is dismissed (Pull #3).

**Pull #3 — a person's full dated work history.**
Also has no API. Only available on the individual's profile page, and read **only for the colleagues you click** (M3). Feasibility confirmed: the experience section parses cleanly (the seed parser is reused), including the start/end dates. The dates are used to **anchor** on the shared company (find their stint there) and to plot the stints they took **after they left** it on the galaxy time axis. A profile with no stint at the company is a search false positive and is dismissed.

**Approaches considered and rejected:**
- **Self-hosted backend crawler** (authenticated with a session cookie): fully automatic, but machine-shaped and puts the account at real risk. Rejected on the human-shaped constraint.
- **Third-party scraping APIs**: keep the account out of the firing line but cost money per profile, sit in the same legal grey area, and are impermanent (vendors get shut down). Not aligned with a low-volume personal tool.
- **Claude as the runtime scraper** (driving the browser, or a file-watching bridge that wakes Claude on each click): rejected. The extraction is deterministic page-parsing, which an LLM does no better, only slower, costlier, and with a hard dependency on a live Claude session. The thing that made early manual testing feel safe was low volume and user-triggered single page loads, not the involvement of Claude.

---

## 4. Architecture: High-Level Decisions

These are the load-bearing choices. Implementation detail is intentionally out of scope here.

**Runtime: a browser extension, not a backend and not a Claude skill.**
The extension runs inside the user's own logged-in browser. Its traffic *is* the user's real session, which is exactly the human-shaped property we need. No server ever touches LinkedIn. A Claude-based runtime was considered and rejected (see Pull rejections above); a backend crawler was rejected on the traffic constraint.

**Interaction model: click-to-expand, one page per click.**
Each expansion of the graph corresponds to exactly one user-triggered page load:
- Click a company node, load that one People page, plot the connections.
- Click a person node, load that one profile, plot their onward workplaces.

This is the mechanism that keeps traffic human-shaped *by construction*, and it also dissolves the combinatorial-explosion problem: expansion only ever happens where the user deliberately clicks, never in a burst. Granularity is the safety mechanism, not an afterthought.

**Persistence.**
The graph (nodes, edges, captured history) is stored locally so it survives across sessions and so re-clicking something already explored does not trigger a re-fetch.

**Where Claude fits: reasoning, not scraping.**
The page extraction is plain, deterministic parsing and needs no AI. Claude's potential role is the *fuzzy* work, called as an ordinary API request only when needed:
- entity resolution (is this the same person across two pages?),
- company-name normalization (collapsing variant spellings into one node),
- judgment calls on ambiguous company-name matches (anchoring a colleague's stint to the shared company when URN/name are fuzzy).
This keeps a clean split: the browser does deterministic capture; Claude is an optional helper for the judgment layer.

---

## Open Questions (deferred, not decided)

- Exact UI surface for the graph relative to the LinkedIn page.
- Whether the Claude reasoning layer is needed at all for a first version, or only later.

*Resolved:* how far onward-workplace expansion should go is now decided: zero hops. Onward workplaces are terminal leaves and are never expanded (see §1 and `journey.md`).
