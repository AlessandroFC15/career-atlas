import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initDevLocale } from '../i18n';

// chrome.i18n resolves messages from the browser's UI language, so the
// document's declared language should follow it too (issue #7).
document.documentElement.lang = chrome.i18n.getUILanguage();

// initDevLocale is a no-op outside dev builds, so this await costs nothing
// in a built extension.
initDevLocale().then(() => {
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root');
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (import.meta.env.DEV) {
    import('./devLocaleToggle').then(({ mountDevLocaleToggle }) => mountDevLocaleToggle());
  }
});
