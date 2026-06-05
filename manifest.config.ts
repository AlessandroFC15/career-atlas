import { defineManifest } from '@crxjs/vite-plugin';

// M0 manifest. Permissions and host_permissions per m0-plan §4.
export default defineManifest({
  manifest_version: 3,
  name: 'Career Atlas',
  version: '0.1.0',
  description: 'Map who you overlapped with and where they went next, rooted in your own career.',
  // No default_popup: the toolbar click opens/focuses the home tab (handled in the background worker).
  action: {
    default_title: 'Open Career Atlas',
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  permissions: ['storage', 'scripting', 'tabs'],
  host_permissions: ['https://www.linkedin.com/*', 'https://*.licdn.com/*'],
});
