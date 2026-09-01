import { DEV_LOCALES, getDevLocale, setDevLocale } from '../i18n';

/** Dev-only: a small floating button that cycles the locale override (issue
 *  #7 testing) so you can preview pt-BR, or force English, without changing
 *  Chrome's actual UI language. Only mounted when `import.meta.env.DEV` at
 *  the call site, so it never ships in a built extension. */
export function mountDevLocaleToggle(): void {
  const btn = document.createElement('button');
  btn.style.cssText =
    'position:fixed;bottom:8px;right:8px;z-index:9999;font:11px monospace;' +
    'padding:4px 8px;background:#111;color:#7c8cff;border:1px solid #7c8cff;' +
    'border-radius:4px;cursor:pointer;opacity:0.55;';
  btn.onmouseenter = () => (btn.style.opacity = '1');
  btn.onmouseleave = () => (btn.style.opacity = '0.55');
  btn.textContent = `lang: ${getDevLocale() ?? 'auto'}`;
  btn.onclick = () => {
    const i = DEV_LOCALES.indexOf(getDevLocale());
    setDevLocale(DEV_LOCALES[(i + 1) % DEV_LOCALES.length]);
  };
  document.body.appendChild(btn);
}
