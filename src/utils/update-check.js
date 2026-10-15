// =============================================================================
// Chat Archive — Update check
// =============================================================================
// Compares the installed extension version with manifest.json on GitHub main.
// The version request and the later archive download are the only network
// calls. Conversation content is never sent.
//
// Loaded by popup.html and update.html. Not part of the content-script bundle.

const UPDATE_VERSION_URL = 'https://raw.githubusercontent.com/fxops-ai/chat-archive/main/manifest.json';
const UPDATE_ARCHIVE_URL = 'https://codeload.github.com/fxops-ai/chat-archive/zip/refs/heads/main';
const UPDATE_CHECK_KEY = 'updateCheck';
const UPDATE_CHECK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const UPDATE_DIR_DB = 'chat-archive-update';
const UPDATE_DIR_STORE = 'handles';
const UPDATE_DIR_KEY = 'extensionRoot';

function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}

function stripArchiveRoot(entryName) {
  const normalized = String(entryName).replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  if (slash === -1) return '';
  return normalized.slice(slash + 1);
}

function isSafeRelativePath(relativePath) {
  if (!relativePath || relativePath.endsWith('/')) return false;
  const parts = relativePath.split('/');
  const skipped = new Set(['__MACOSX', '.DS_Store', '.git', 'node_modules']);
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || skipped.has(part)) return false;
  }
  return true;
}

function readInstalledVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return null;
  }
}

async function fetchLatestVersion() {
  const res = await fetch(UPDATE_VERSION_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Couldn't reach GitHub (${res.status}).`);
  }
  const data = await res.json();
  if (!data || !/^\d+\.\d+\.\d+$/.test(data.version)) {
    throw new Error('The latest version number was unreadable.');
  }
  return data.version;
}

async function getLatestVersion({ force = false, maxAgeMs = UPDATE_CHECK_MAX_AGE_MS } = {}) {
  if (!force && typeof chrome !== 'undefined' && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(UPDATE_CHECK_KEY);
    const cached = stored[UPDATE_CHECK_KEY];
    if (cached?.latestVersion && Date.now() - cached.checkedAt < maxAgeMs) {
      return cached.latestVersion;
    }
  }

  const latestVersion = await fetchLatestVersion();
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
      [UPDATE_CHECK_KEY]: { latestVersion, checkedAt: Date.now() },
    });
  }
  return latestVersion;
}
