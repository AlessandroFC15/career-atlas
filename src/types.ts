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

export interface CareerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  derivedFrom: number; // seed.seededAt this graph was built from (staleness check)
}
