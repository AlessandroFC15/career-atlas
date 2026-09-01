import type { PersonRecord } from './types';

/**
 * Self-contained people-search parser, injected into the worker tab via
 * `chrome.scripting.executeScript({ func })`. Same constraints as
 * `injectedScrapeExperience`: NO module-scope references (every helper is
 * nested), touches only the global `document`, and is importable by unit tests
 * to run against a fixture in jsdom. The type import above is erased at compile
 * time.
 *
 * --- Strategy (from inspecting the live 2026 people-search DOM) ---
 * Source is the first-degree people search:
 *   /search/results/people/?keywords=<company>&network=["F"]
 * Class names are obfuscated hashes (no stable hooks), and the page is littered
 * with /in/ links that are NOT results (mutual-connection facepiles, "people
 * also viewed" sidebars). The one deploy-stable signal that marks a REAL result
 * card is the connection-degree badge ("1st"/"2nd"/"3rd"), which the noise links
 * never carry. So we anchor on that:
 *   1. find every degree-badge span,
 *   2. climb to the enclosing card (nearest ancestor holding both a profile link
 *      AND the photo <img>),
 *   3. read the profile vanity (the person key), name, headline, location, photo,
 *   4. dedup by vanity (the name/badge render twice for screen readers).
 *
 * @returns the parsed first-page people (photos as URLs only; byte-fetching
 *          happens later in the home page, like company logos).
 */
export async function injectedScrapePeople(
  timeoutMs = 15000,
): Promise<PersonRecord[]> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // A degree badge reads like "• 1st" / "1st" / "2nd" (EN) or "• 1°" / "2°" /
  // "3°" (PT-BR, live-verified against a real PT-BR search page — LinkedIn
  // renders the DEGREE SIGN U+00B0 "°", not the ordinal indicator "º"; both
  // are accepted here in case of variation). Leading non-word chars (the
  // bullet glyph, whatever variant, plus spaces) are tolerated so the match
  // does not hinge on an exact bullet character.
  const DEGREE_RE = /^\W*(?:(?:1st|2nd|3rd)\b|1[°º]|2[°º]|3[°º])/i;
  // Action controls and meta lines that are not the headline/location. Only
  // "Mensagem" is live-verified (the first-degree search this parser targets
  // only ever renders a Message action); the rest are PT-BR translations of
  // the English set, included defensively.
  const ACTION_RE =
    /^(message|connect|follow|following|pending|view profile|mensagem|conectar-se|seguir|seguindo|pendente|ver perfil)$/i;
  // "Atual:"/"Anterior:" (PT-BR for "Current:"/"Past:") live-verified.
  const SUMMARY_SKIP_RE = /^(current|past|atual|anterior)\s*:/i;
  // "N conexões em comum" (PT-BR for "N mutual connections") live-verified;
  // matched loosely on the "conex...em comum" shape rather than an exact
  // singular/plural spelling.
  const MUTUAL_RE = /mutual connection|conex\w* em comum/i;

  function clean(el: Element | null | undefined): string {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** `/in/<vanity>` is the person key; strip a locale segment, query, hash. */
  function vanityFromHref(href: string | null | undefined): string | null {
    if (!href) return null;
    const m = href.match(/\/in\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function photoFrom(card: Element): string | undefined {
    const imgs = Array.from(card.querySelectorAll('img')) as HTMLImageElement[];
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (/^https?:\/\//.test(src) && !/ghost/i.test(src)) return src;
    }
    return undefined;
  }

  /** Climb to the result card: nearest ancestor with both a profile link and a
   *  photo img. That bounds the card to one person (the name/headline/location
   *  all sit inside it) and excludes badge-less noise links along the way. */
  function cardOf(el: Element): Element | null {
    let n: Element | null = el;
    for (let i = 0; i < 14 && n; i++) {
      n = n.parentElement;
      if (n && n.querySelector('a[href*="/in/"]') && n.querySelector('img')) {
        return n;
      }
    }
    return null;
  }

  function degreeBadges(): Element[] {
    return Array.from(document.querySelectorAll('span')).filter((s) =>
      DEGREE_RE.test(clean(s)),
    );
  }

  /** Ordered, non-empty leaf text lines within a card (DOM order = visual). */
  function leafLines(card: Element): string[] {
    const out: string[] = [];
    for (const el of Array.from(card.querySelectorAll('span, div, p'))) {
      if (el.children.length > 0) continue; // leaves only
      const t = clean(el);
      if (t) out.push(t);
    }
    // Collapse consecutive duplicates (the a11y name echo).
    return out.filter((t, i) => i === 0 || t !== out[i - 1]);
  }

  function parseCard(card: Element): PersonRecord | null {
    const link = card.querySelector('a[href*="/in/"]');
    const vanity = vanityFromHref(link?.getAttribute('href'));
    if (!vanity) return null;
    const name = clean(link);
    if (!name) return null;

    // Headline and location are the first two "summary" lines once the name,
    // the degree badge, action buttons, the "Current:/Past:" line and the
    // mutual-connections line are filtered out (all positional, no classes).
    const summary = leafLines(card).filter(
      (t) =>
        t !== name &&
        !DEGREE_RE.test(t) &&
        !ACTION_RE.test(t) &&
        !SUMMARY_SKIP_RE.test(t) &&
        !MUTUAL_RE.test(t),
    );

    return {
      vanity,
      profileUrl: `https://www.linkedin.com/in/${vanity}/`,
      name,
      headline: summary[0],
      location: summary[1],
      photoUrl: photoFrom(card),
    };
  }

  // Readiness: poll for result cards, then a bounded grace period for the lazily
  // loaded photo <img> srcs to populate (same shape as the experience parser).
  const deadline = Date.now() + timeoutMs;
  const PHOTO_GRACE_MS = 4000;
  let badges: Element[] = [];
  let foundAt: number | null = null;
  while (Date.now() < deadline) {
    badges = degreeBadges();
    if (badges.length) {
      if (foundAt === null) foundAt = Date.now();
      const cards = badges
        .map((b) => cardOf(b))
        .filter((c): c is Element => c !== null);
      const withPhoto = cards.filter((c) => photoFrom(c)).length;
      if (cards.length && withPhoto === cards.length) break;
      if (Date.now() - foundAt > PHOTO_GRACE_MS) break;
    }
    await sleep(300);
  }

  const records: PersonRecord[] = [];
  const seen = new Set<string>();
  for (const badge of badges) {
    const card = cardOf(badge);
    if (!card) continue;
    const rec = parseCard(card);
    if (!rec || seen.has(rec.vanity)) continue;
    seen.add(rec.vanity);
    records.push(rec);
  }
  return records;
}
