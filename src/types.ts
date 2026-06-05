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
