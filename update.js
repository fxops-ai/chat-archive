// =============================================================================
// Chat Archive — Update page
// =============================================================================
// Writes the latest GitHub main archive into the unpacked extension folder
// the user loaded, then reloads the extension. Chrome does not auto-update
// unpacked extensions, and a popup cannot keep a folder picker open.

const statusEl = document.getElementById('status');
const currentEl = document.getElementById('currentVersion');
const latestEl = document.getElementById('latestVersion');
const folderEl = document.getElementById('folderStatus');
const updateBtn = document.getElementById('updateBtn');
const chooseBtn = document.getElementById('chooseBtn');
const checkBtn = document.getElementById('checkBtn');

let latestVersion = null;
let busy = false;

function showStatus(type, text) {
  statusEl.className = `status ${type}`;
  statusEl.textContent = text;
}

function setBusy(on) {
  busy = on;
  updateBtn.disabled = on || !canUpdate();
  chooseBtn.disabled = on;
  checkBtn.disabled = on;
}

function canUpdate() {
  const current = readInstalledVersion();
  return !!(latestVersion && current && isNewer(latestVersion, current));
}

function renderVersions() {
  const current = readInstalledVersion();
  currentEl.textContent = current || 'Unknown';
  latestEl.textContent = latestVersion || 'Unknown';

  if (!current) {
    showStatus('error', 'This page has to be opened from the Chat Archive extension.');
    updateBtn.disabled = true;
    return;
  }
  if (!latestVersion) return;

  if (isNewer(latestVersion, current)) {
    showStatus('warning', `Version ${latestVersion} is ready to install.`);
    updateBtn.disabled = busy;
    updateBtn.textContent = `Update to ${latestVersion}`;
  } else if (compareVersions(latestVersion, current) === 0) {
    showStatus('success', `You're on the latest version (${current}).`);
    updateBtn.disabled = true;
    updateBtn.textContent = 'Up to date';
  } else {
    showStatus('info', `This copy (${current}) is newer than GitHub (${latestVersion}).`);
    updateBtn.disabled = true;
    updateBtn.textContent = 'Up to date';
  }
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(UPDATE_DIR_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(UPDATE_DIR_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readStoredDir() {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPDATE_DIR_STORE, 'readonly');
    const req = tx.objectStore(UPDATE_DIR_STORE).get(UPDATE_DIR_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function storeDir(handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPDATE_DIR_STORE, 'readwrite');
    tx.objectStore(UPDATE_DIR_STORE).put(handle, UPDATE_DIR_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function assertChatArchiveDir(dirHandle) {
  let manifestHandle;
  try {
    manifestHandle = await dirHandle.getFileHandle('manifest.json');
  } catch (err) {
    if (err && err.name === 'NotFoundError') {
      throw new Error('That folder is not the Chat Archive extension.');
    }
    throw err;
  }
  const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
  if (manifest.name !== 'Chat Archive') {
    throw new Error('That folder is not the Chat Archive extension.');
  }
  return manifest;
}

async function refreshFolderStatus() {
  if (!window.showDirectoryPicker) {
    folderEl.textContent = 'This browser cannot write the extension folder. Download the zip from GitHub instead.';
    return;
  }
  try {
    const handle = await readStoredDir();
    if (!handle) {
      folderEl.textContent = 'No folder chosen yet. Update will ask for the folder you loaded in chrome://extensions.';
      return;
    }
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      folderEl.textContent = `Folder ready: ${handle.name}`;
    } else {
      folderEl.textContent = `Folder remembered: ${handle.name}. Update will ask to use it again.`;
    }
  } catch {
    folderEl.textContent = 'No folder chosen yet.';
  }
}

async function chooseFolder() {
  const handle = await showDirectoryPicker({
    id: 'chat-archive-root',
    mode: 'readwrite',
  });
  await assertChatArchiveDir(handle);
  await storeDir(handle);
  folderEl.textContent = `Folder ready: ${handle.name}`;
  return handle;
}

async function ensureExtensionDir() {
  let handle = await readStoredDir();
  if (handle) {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') handle = null;
  }
  if (!handle) handle = await chooseFolder();
  await assertChatArchiveDir(handle);
  return handle;
}

async function writeRelativeFile(dirHandle, relativePath, bytes) {
  const parts = relativePath.split('/');
  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function applyArchive(dirHandle, arrayBuffer) {
  if (typeof JSZip === 'undefined') {
    throw new Error('Could not read the update archive.');
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries = [];
  zip.forEach((relativePath, entry) => {
    const stripped = stripArchiveRoot(relativePath);
    if (!entry.dir && isSafeRelativePath(stripped)) {
      entries.push({ path: stripped, entry });
    }
  });
  if (!entries.some((item) => item.path === 'manifest.json')) {
    throw new Error('Download did not contain the Chat Archive extension.');
  }

  let written = 0;
  for (const item of entries) {
    const bytes = await item.entry.async('uint8array');
    await writeRelativeFile(dirHandle, item.path, bytes);
    written += 1;
    if (written % 10 === 0 || written === entries.length) {
      showStatus('info', `Writing files… ${written} of ${entries.length}`);
    }
  }
  return written;
}

async function runUpdate() {
  if (busy || !canUpdate()) return;
  if (!window.showDirectoryPicker) {
    showStatus('error', 'Folder updates need Chrome or another Chromium browser.');
    return;
  }

  setBusy(true);
  try {
    showStatus('info', 'Choose the Chat Archive folder if asked, then wait.');
    const dir = await ensureExtensionDir();
    showStatus('info', 'Downloading the update…');
    const res = await fetch(UPDATE_ARCHIVE_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const written = await applyArchive(dir, await res.arrayBuffer());
    showStatus('success', `Updated ${written} files. Reloading the extension…`);
    chrome.runtime.reload();
  } catch (err) {
    setBusy(false);
    if (err && err.name === 'AbortError') {
      showStatus('info', 'Folder choice cancelled.');
    } else {
      showStatus('error', err.message || 'Update failed.');
    }
  }
}

async function checkNow() {
  if (busy) return;
  setBusy(true);
  showStatus('info', 'Checking GitHub…');
  try {
    latestVersion = await getLatestVersion({ force: true });
    busy = false;
    chooseBtn.disabled = false;
    checkBtn.disabled = false;
    renderVersions();
  } catch (err) {
    busy = false;
    chooseBtn.disabled = false;
    checkBtn.disabled = false;
    latestEl.textContent = 'Unavailable';
    updateBtn.disabled = true;
    showStatus('error', err.message || 'Update check failed.');
  }
}

checkBtn.addEventListener('click', checkNow);
chooseBtn.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    await chooseFolder();
    setBusy(false);
    renderVersions();
  } catch (err) {
    setBusy(false);
    if (err && err.name === 'AbortError') {
      showStatus('info', 'Folder choice cancelled.');
    } else {
      showStatus('error', err.message || 'Could not use that folder.');
    }
  }
});
updateBtn.addEventListener('click', runUpdate);

currentEl.textContent = readInstalledVersion() || 'Unknown';
latestEl.textContent = 'Checking…';
refreshFolderStatus();
checkNow();
