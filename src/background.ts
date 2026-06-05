// Minimal background service worker (m0-plan §3, §4). Its only job: on toolbar
// click, open the home tab — or focus the existing one (single-instance).

const HOME_PATH = 'home.html';

let homeTabId: number | undefined;

async function openOrFocusHome(): Promise<void> {
  const homeUrl = chrome.runtime.getURL(HOME_PATH);

  // Reuse the tracked instance if it is still alive.
  if (homeTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(homeTabId);
      if (tab.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        return;
      }
    } catch {
      homeTabId = undefined; // stale; fall through to (re)create
    }
  }

  // Fall back to any existing home tab (e.g. after the worker restarted).
  const existing = await chrome.tabs.query({ url: homeUrl });
  if (existing[0]?.id !== undefined) {
    homeTabId = existing[0].id;
    await chrome.tabs.update(homeTabId, { active: true });
    if (existing[0].windowId !== undefined) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }

  const created = await chrome.tabs.create({ url: homeUrl, active: true });
  homeTabId = created.id;
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusHome();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === homeTabId) homeTabId = undefined;
});
