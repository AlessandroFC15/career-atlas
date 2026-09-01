import type { ProfileHeader } from './types';

/**
 * Self-contained reader injected into the worker tab on /in/me. Same constraint
 * as the parser: no module-scope references, only globals.
 *
 * --- Revised after inspecting the live 2026 DOM ---
 * The top card has NO <h1> (LinkedIn moved the name into an <h2>, alongside
 * section <h2>s like "Experience"/"Analytics"), and class names are obfuscated.
 * So the name comes primarily from document.title ("<Name> | LinkedIn"), with a
 * heading fallback that skips known section labels. The avatar is a licdn
 * `dms/image` URL; own-profile photos carry an `alt` that includes the name.
 * The canonical profileUrl is taken by the orchestrator from the resolved tab
 * URL, not from here.
 */
export async function injectedReadProfileHeader(
  timeoutMs = 15000,
): Promise<ProfileHeader | null> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // English labels, plus their Brazilian-Portuguese translations (issue #13).
  // "experiência", "atividades", "idioma do perfil", "perfil público e url"
  // and "formação acadêmica" are live-verified against a real PT-BR profile;
  // the rest are best-effort translations of the English set.
  const SECTION_LABELS = new Set([
    'about', 'experience', 'education', 'skills', 'activity', 'analytics',
    'suggested for you', 'profile language', 'public profile & url', 'featured',
    'licenses & certifications', 'interests', 'recommendations', 'languages',
    'people you may know', 'more profiles for you', 'highlights', 'projects',
    'honors & awards', 'volunteering', 'courses', 'test scores',
    'sobre', 'experiência', 'formação acadêmica', 'competências', 'atividades',
    'análises', 'sugestões para você', 'idioma do perfil',
    'perfil público e url', 'destaques', 'licenças e certificações',
    'interesses', 'recomendações', 'idiomas', 'pessoas que você talvez conheça',
    'mais perfis para você', 'projetos', 'prêmios e reconhecimentos',
    'voluntariado', 'cursos', 'notas de teste',
  ]);

  function readName(): string {
    // 1) document.title: "<Name> | LinkedIn" (sometimes "(3) <Name> | LinkedIn").
    const fromTitle = (document.title || '')
      .replace(/^\(\d+\)\s*/, '')
      .split('|')[0]
      .trim();
    if (fromTitle && !/^linkedin$/i.test(fromTitle)) return fromTitle;

    // 2) Fallback: first heading in main that isn't a known section label.
    const heads = Array.from(document.querySelectorAll('main h1, main h2'));
    for (const h of heads) {
      const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !SECTION_LABELS.has(t.toLowerCase())) return t;
    }
    return '';
  }

  function readAvatar(name: string): string | undefined {
    const imgs = Array.from(
      document.querySelectorAll('main img'),
    ) as HTMLImageElement[];
    const isReal = (s: string) => /^https?:\/\//.test(s) && !/ghost/i.test(s);

    // Prefer an own-profile photo: a dms/image whose alt mentions the name.
    if (name) {
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        if (isReal(src) && /dms\/image/i.test(src) && alt.includes(name)) {
          return src;
        }
      }
    }
    // Fallback: first real licdn dms/image on the page (top card sits first).
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (isReal(src) && /dms\/image/i.test(src)) return src;
    }
    return undefined;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const name = readName();
    if (name) return { name, avatarUrl: readAvatar(name) };
    await sleep(300);
  }
  return null;
}
