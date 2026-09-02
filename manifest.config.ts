import { basename } from 'node:path';
import { defineManifest } from '@crxjs/vite-plugin';

// A lane (a /work-on worktree, `../career-atlas-<slug>`) builds its own unpacked
// extension, and Chrome lists them all together. Suffix the name with the lane
// slug so the cards are tellable apart; the primary worktree stays unsuffixed.
const dir = basename(process.cwd());
const lane = dir.startsWith('career-atlas-') ? dir.slice('career-atlas-'.length) : '';

// M0 manifest. Permissions and host_permissions per m0-plan §4.
export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: lane ? `Career Atlas [${lane}]` : 'Career Atlas',
  version: '0.1.0',
  description: 'Map who you overlapped with and where they went next, rooted in your own career.',
  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  // No default_popup: the toolbar click opens/focuses the home tab (handled in the background worker).
  action: {
    default_title: 'Open Career Atlas',
    default_icon: {
      16: 'public/icons/icon16.png',
      32: 'public/icons/icon32.png',
      48: 'public/icons/icon48.png',
      128: 'public/icons/icon128.png',
    },
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  permissions: ['storage', 'scripting', 'tabs', 'alarms'],
  host_permissions: ['https://www.linkedin.com/*', 'https://*.licdn.com/*'],
});
