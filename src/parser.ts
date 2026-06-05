import type { DateParts, ExperienceEntry, Role } from './types';

/**
 * Self-contained experience parser, injected into the worker tab via
 * `chrome.scripting.executeScript({ func })`. Because Chrome serializes the
 * function with `Function.prototype.toString`, this function MUST NOT reference
 * any module-scope binding: every helper is nested inside it and it touches only
 * the global `document` / `getComputedStyle`. The type imports above are erased
 * at compile time.
 *
 * It is a normal function, so the unit tests import it and run it against a
 * captured fixture document in jsdom (see test/fixtures/experience.html).
 *
 * --- Strategy (rewritten after inspecting the live 2026 DOM) ---
 * LinkedIn's current `details/experience` page has NO stable class hooks
 * (`pvs-entity`, `t-bold`, etc. are gone; class names are obfuscated hashes) and
 * NO visually-hidden screen-reader text. The only deploy-stable signals are:
 *   1. font-weight: 600 marks heading lines (role titles + company names),
 *   2. a date-range text pattern marks tenure lines.
 * So we anchor on those two, not on classes:
 *   - The experience list is the lowest common ancestor of all date-range <p>s;
 *     each card is a child of it that contains a date-range <p>. (This finds
 *     entries even when the company is unlinked, which anchor-based detection
 *     would miss.)
 *   - 1 bold line in a card  => single role  (bold = title, next plain line =
 *     "Company · Type", the date line = tenure).
 *   - >=2 bold lines         => grouped card (bold[0] = company; each later bold
 *     line is a role title whose tenure is the NEXT date line after it — this
 *     skips stray "Full-time"/"Internship" employment-type lines).
 *
 * Bold is read via getComputedStyle (live: real CSS; offline: the fixture bakes
 * the computed font-weight inline so jsdom can read it).
 *
 * @returns the parsed experience entries (logos as URLs only; byte-fetching
 *          happens later in the home page).
 */
export async function injectedScrapeExperience(
  timeoutMs = 15000,
): Promise<ExperienceEntry[]> {
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const DATE_RE =
    /([A-Za-z]{3,}\.?\s+\d{4}|\d{4})\s*[-–—]\s*(present|[A-Za-z]{3,}\.?\s+\d{4}|\d{4})/i;

  function clean(el: Element | null | undefined): string {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isDateLine(text: string): boolean {
    return DATE_RE.test(text);
  }

  function isBold(el: Element): boolean {
    // Inline first (the offline fixture bakes font-weight inline); fall back to
    // computed style (the live page sets it via CSS classes).
    const inline = (el as HTMLElement).style?.fontWeight;
    let weight = inline || '';
    if (!weight && typeof getComputedStyle === 'function') {
      try {
        weight = getComputedStyle(el).fontWeight;
      } catch {
        weight = '';
      }
    }
    return weight === 'bold' || Number(weight) >= 600;
  }

  /** Strip a trailing "· Full-time" / "· 2 yrs" middot segment. */
  function beforeDot(s: string): string {
    return s.split('·')[0].replace(/\s+/g, ' ').trim();
  }

  function parseDate(token: string): DateParts | null {
    const t = token.trim();
    if (!t) return null;
    const m = t.match(/^([A-Za-z]{3,})?\.?\s*(\d{4})$/);
    if (!m) {
      const yearOnly = t.match(/(\d{4})/);
      return yearOnly ? { year: Number(yearOnly[1]) } : null;
    }
    const year = Number(m[2]);
    if (m[1]) {
      const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (month) return { year, month };
    }
    return { year };
  }

  /** "Aug 2025 - Present · 11 mos" -> {start, end}. */
  function parseRange(rawDateText: string): {
    start: DateParts | null;
    end: DateParts | null;
  } {
    const rangePart = rawDateText.split('·')[0];
    const halves = rangePart.split(/[-–—]/).map((s) => s.trim());
    const start = parseDate(halves[0] || '');
    const endToken = halves[1] || '';
    const end = /present/i.test(endToken) ? null : parseDate(endToken);
    return { start, end };
  }

  function dateLE(a: DateParts, b: DateParts): boolean {
    if (a.year !== b.year) return a.year < b.year;
    return (a.month ?? 0) <= (b.month ?? 0);
  }

  function earliest(dates: DateParts[]): DateParts {
    return dates.reduce((min, d) => (dateLE(d, min) ? d : min));
  }

  function latest(dates: DateParts[]): DateParts {
    return dates.reduce((max, d) => (dateLE(max, d) ? d : max));
  }

  function companyUrnFromUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const m = url.match(/\/company\/([^/?#]+)/);
    return m ? `urn:li:company:${decodeURIComponent(m[1])}` : undefined;
  }

  function companyLinkFrom(card: Element): string | undefined {
    const href = card
      .querySelector('a[href*="/company/"]')
      ?.getAttribute('href');
    return href ? href.split('?')[0].split('#')[0] : undefined;
  }

  function logoUrlFrom(card: Element): string | undefined {
    const imgs = Array.from(card.querySelectorAll('img')) as HTMLImageElement[];
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (/^https?:\/\//.test(src) && !/ghost/i.test(src)) return src;
    }
    return undefined;
  }

  function ancestors(el: Element): Element[] {
    const chain: Element[] = [];
    let n: Element | null = el;
    while (n) {
      chain.push(n);
      n = n.parentElement;
    }
    return chain;
  }

  /** Lowest common ancestor of a set of elements. */
  function lowestCommonAncestor(els: Element[]): Element | null {
    if (els.length === 0) return null;
    let chain = ancestors(els[0]);
    for (let i = 1; i < els.length; i++) {
      const set = new Set(ancestors(els[i]));
      chain = chain.filter((a) => set.has(a));
      if (chain.length === 0) return null;
    }
    return chain[0] ?? null;
  }

  /** Ordered, non-empty <p> lines within a card (DOM order = visual order). */
  function lineEls(card: Element): { el: Element; text: string }[] {
    return Array.from(card.querySelectorAll('p'))
      .map((el) => ({ el, text: clean(el) }))
      .filter((p) => p.text.length > 0);
  }

  function topLevelCards(): Element[] {
    const root = document.querySelector('main') || document.body;
    const datePs = Array.from(root.querySelectorAll('p')).filter((p) =>
      isDateLine(clean(p)),
    );
    if (datePs.length === 0) return [];
    const container = lowestCommonAncestor(datePs);
    if (!container) return [];
    return Array.from(container.children).filter((child) =>
      Array.from(child.querySelectorAll('p')).some((p) => isDateLine(clean(p))),
    );
  }

  function parseCard(card: Element): ExperienceEntry | null {
    const lines = lineEls(card);
    const boldLines = lines.filter((l) => isBold(l.el));
    const companyUrl = companyLinkFrom(card);
    const logoUrl = logoUrlFrom(card);

    let companyName = '';
    const roles: Role[] = [];

    const nextDateAfter = (startIdx: number): string => {
      for (let j = startIdx + 1; j < lines.length; j++) {
        if (isDateLine(lines[j].text)) return lines[j].text;
      }
      return '';
    };

    if (boldLines.length <= 1) {
      // Single-role card: bold = title, next plain line = "Company · Type".
      const title = boldLines[0]?.text || '';
      const titleIdx = boldLines[0] ? lines.indexOf(boldLines[0]) : -1;
      for (let i = titleIdx + 1; i < lines.length; i++) {
        if (!isBold(lines[i].el) && !isDateLine(lines[i].text)) {
          companyName = beforeDot(lines[i].text);
          break;
        }
      }
      const dateText = nextDateAfter(titleIdx);
      if (dateText) {
        const { start, end } = parseRange(dateText);
        roles.push({ title, start: start ?? { year: 0 }, end, rawDateText: dateText });
      }
    } else {
      // Grouped card: bold[0] = company, each later bold line = a role title.
      companyName = beforeDot(boldLines[0].text);
      for (let i = 1; i < boldLines.length; i++) {
        const title = boldLines[i].text;
        const dateText = nextDateAfter(lines.indexOf(boldLines[i]));
        if (!dateText) continue;
        const { start, end } = parseRange(dateText);
        roles.push({ title, start: start ?? { year: 0 }, end, rawDateText: dateText });
      }
    }

    if (!companyName || roles.length === 0) return null;

    const starts = roles.map((r) => r.start);
    const aggStart = earliest(starts);
    const anyPresent = roles.some((r) => r.end === null);
    const ends = roles.map((r) => r.end).filter((e): e is DateParts => !!e);
    const aggEnd = anyPresent ? null : ends.length ? latest(ends) : null;

    return {
      companyName,
      companyUrl,
      companyUrn: companyUrnFromUrl(companyUrl),
      logoUrl,
      start: aggStart,
      end: aggEnd,
      roles,
      rawDateText: roles.map((r) => r.rawDateText).join(' / '),
    };
  }

  // --- Readiness: poll for the experience list AND for the lazily-loaded logo
  // <img> src attributes (m0-plan §7). The text list hydrates a beat before the
  // logo images get their real src; parsing the instant the text appears would
  // capture empty src and lose every logo. So once the list is found, wait a
  // bounded grace period for the logos to populate, then proceed regardless (a
  // company may genuinely have no logo).
  const deadline = Date.now() + timeoutMs;
  const LOGO_GRACE_MS = 6000;
  let cards: Element[] = [];
  let listFoundAt: number | null = null;
  while (Date.now() < deadline) {
    cards = topLevelCards();
    if (cards.length) {
      if (listFoundAt === null) listFoundAt = Date.now();
      const withLogo = cards.filter((c) => logoUrlFrom(c)).length;
      if (withLogo === cards.length) break;
      if (Date.now() - listFoundAt > LOGO_GRACE_MS) break;
    }
    await sleep(300);
  }

  const entries: ExperienceEntry[] = [];
  for (const card of cards) {
    const entry = parseCard(card);
    if (entry) entries.push(entry);
  }
  return entries;
}
