// Data model for M0 (see m0-plan.md §5).

/** A parsed date. `month` is optional because some LinkedIn entries are year-only. */
export interface DateParts {
  year: number;
  month?: number; // 1-12
}

/** One role within an experience stint (promotions collapse into nested roles). */
export interface Role {
  title: string;
  start: DateParts;
  end: DateParts | null; // null = "Present"
  rawDateText: string; // original string, for display/debugging
}

/** One LinkedIn experience card = one entry. */
export interface ExperienceEntry {
  companyName: string;
  companyUrl?: string; // canonical /company/<id>/ when the entry is linked
  companyUrn?: string; // derived from companyUrl when present
  logoUrl?: string; // original media.licdn.com URL (debug/refresh)
  logoDataUrl?: string; // cached base64, what the UI renders
  start: DateParts; // aggregate of nested roles: earliest start
  end: DateParts | null; // aggregate: latest end (or null if any role is Present)
  roles: Role[]; // one or more nested roles
  rawDateText: string;
}

/** The persisted seed. Stored under the single `chrome.storage.local` key `seed`. */
export interface Seed {
  name: string;
  profileUrl: string; // resolved canonical /in/<vanity>/
  avatarUrl?: string; // original URL
  avatarDataUrl?: string; // cached base64, what the UI renders
  seededAt: number; // epoch ms
  experiences: ExperienceEntry[];
}

/** What the on-page profile reader returns from /in/me. */
export interface ProfileHeader {
  name: string;
  avatarUrl?: string;
}

// --- M1: the materialized career graph (m1-plan §4). Derived from the Seed but
// stored separately under `graph`; the mutable working model M2-M4 extend. ---

/** One node in the working graph. M1 only emits company nodes (Level 0). */
export interface GraphNode {
  id: string; // stable per stint: `c${index}` (NOT the URN — boomerangs collide)
  kind: 'company'; // M2 adds 'person'; M4 adds 'onward'
  level: 0; // Level 0 = your own companies (the expandable tier, later)
  order: number; // chain position, 0-based, by ascending start date
  name: string;
  companyUrl?: string;
  companyUrn?: string;
  logoDataUrl?: string;
  start: DateParts; // aggregate tenure (from the ExperienceEntry)
  end: DateParts | null; // null = Present
  rawDateText: string;
  roleCount: number; // >1 ⇒ multi-role stint (face shows tenure; roles deferred)
}

export interface GraphEdge {
  id: string; // `e${i}`
  source: string; // company id at order i
  target: string; // company id at order i+1
  kind: 'next'; // career-progression edge
}

// --- M2: company expansion into people (m2-plan §4). Companies stay in
// nodes[]/edges[] (the atlas); a company's first page of people lives in a
// separate `expansions` map so the drill-in galaxy renders one subtree at a
// time and re-entering never re-fetches. ---

/** What `injectedScrapePeople` returns per first-degree search result (URLs
 *  only; photo bytes are fetched later in the home page, like company logos). */
export interface PersonRecord {
  vanity: string; // the /in/<vanity> key (person identity)
  profileUrl: string; // canonical https://www.linkedin.com/in/<vanity>/
  name: string;
  headline?: string;
  location?: string;
  photoUrl?: string; // original media.licdn.com URL
}

/**
 * One employer a colleague joined after leaving the shared company (a Level 2
 * leaf, M3 §4). Plotted at its start date on the galaxy time axis. Never
 * expandable.
 */
export interface OnwardStint {
  companyName: string;
  companyUrl?: string;
  companyUrn?: string; // dedup/convergence key when present (else normalized name)
  logoUrl?: string; // original media.licdn.com URL
  logoDataUrl?: string; // cached base64, what the UI renders
  start: DateParts; // join date: the x position on the time axis
  end: DateParts | null; // null = Present (still there)
  roles?: string[]; // the colleague's role title(s) there (shown on hover)
}

/** One first-degree connection surfaced under a company (a raw Level 1 node).
 *  M3 traces a clicked person: `status` flips in place and `onward` is filled. */
export interface PersonNode {
  id: string; // `${companyId}:${vanity}`, scoped per company (boomerang-safe)
  kind: 'person';
  level: 1;
  parentId: string; // the company GraphNode id this person hangs off
  vanity: string;
  profileUrl: string;
  name: string;
  headline?: string;
  location?: string;
  photoUrl?: string;
  photoDataUrl?: string; // cached base64, what the UI renders
  // 'raw': surfaced by M2, not yet traced (a candidate; also the resting state
  //   after a retryable error). 'traced': anchored on the shared company;
  //   `onward` present (possibly empty = terminal). 'dismissed': traced
  //   but their profile does not list this company (a keyword false positive),
  //   recoverable by re-clicking. (M3 §4)
  status: 'raw' | 'traced' | 'dismissed';
  onward?: OnwardStint[]; // set when status === 'traced' (empty = terminal)
  tracedAt?: number; // epoch ms when traced: lanes stack in this (click) order
  order: number; // column position within the galaxy
}

/** A company's captured first page of people (one search load). */
export interface CompanyExpansion {
  people: PersonNode[];
  keyword: string; // the search keyword used (the company name)
  fetchedAt: number; // epoch ms
}

export interface CareerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  derivedFrom: number; // seed.seededAt this graph was built from (staleness check)
  expansions?: Record<string, CompanyExpansion>; // keyed by company node id (M2)
}
