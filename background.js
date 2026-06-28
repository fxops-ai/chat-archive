// =============================================================================
// Chat Archive — Background Service Worker
// =============================================================================
// Handles file downloads (content scripts can't use chrome.downloads directly).
// Zero network requests. No telemetry. No phone-home.

// =============================================================================
// Binary download interception — v0.4.0
// =============================================================================
// When a binary artifact panel (PPTX, DOCX, XLSX) is open, the content script
// programmatically clicks the Download button and asks us to intercept the
// resulting download. We cancel it and relay the URL back so the content script
// can fetch the bytes directly into the JSZip archive.
//
// Only one interception is pending at a time; a 3-second expiry beyond
// BINARY_INTERCEPT_TIMEOUT_MS prevents stale state from catching unrelated downloads.
// =============================================================================

let pendingInterception = null; // { tabId, expiry }

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!pendingInterception) return;

  // Only intercept downloads originating from claude.ai
  if (!downloadItem.url.startsWith('https://claude.ai/')) return;

  if (Date.now() > pendingInterception.expiry) {
    pendingInterception = null;
    return;
  }

  const { tabId } = pendingInterception;
  pendingInterception = null; // consume — one intercept per setup

  // Cancel the browser download so the file doesn't land in Downloads,
  // then relay the URL to the waiting content script.
  chrome.downloads.cancel(downloadItem.id)
    .catch(() => { /* already completed or unavailable — still relay URL */ })
    .finally(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'binaryUrlReady',
        url: downloadItem.url,
      });
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'setupBinaryInterception') {
    // Content script is about to click a Download button on a binary artifact panel.
    // Arm the onCreated interceptor so the next claude.ai download is caught.
    if (!sender.tab?.id) {
      sendResponse({ success: false, error: 'No tab context — cannot intercept' });
      return;
    }
    pendingInterception = {
      tabId:  sender.tab.id,
      expiry: Date.now() + 8_000, // 3s buffer beyond BINARY_INTERCEPT_TIMEOUT_MS (5s)
    };
    sendResponse({ success: true });
    return;
  }

  if (message.action === 'getTabInfo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ url: tabs[0].url, id: tabs[0].id });
      } else {
        sendResponse({ url: null, id: null });
      }
    });
    return true;
  }
});

async function handleDownload({ content, filename, mimeType, isBase64 = false }) {
  try {
    let blob;
    if (isBase64) {
      // Binary content (e.g. zip) was base64-encoded in the content script for
      // JSON-safe message passing. Decode here before creating the Blob.
      // atob() is available in MV3 service workers (Chrome 92+).
      //
      // Size guard — derived from SAFETY_LIMITS in constants.js:
      //   MAX_ARTIFACT_PANELS × MAX_ARTIFACT_CONTENT_SIZE × base64 overhead (4/3)
      //   = 50 × 500_000 × 1.34 ≈ 33.5MB → 35MB with headroom.
      // If SAFETY_LIMITS values change, update this constant to match.
      const MAX_ZIP_BASE64_LENGTH = 35_000_000;
      if (content.length > MAX_ZIP_BASE64_LENGTH) {
        return {
          success: false,
          error:
            `Zip payload (${(content.length / 1_000_000).toFixed(1)}MB) exceeds the ` +
            `${MAX_ZIP_BASE64_LENGTH / 1_000_000}MB limit. ` +
            'Export contains too many or too large artifacts.',
        };
      }
      const binary = atob(content);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mimeType });
    } else {
      blob = new Blob([content], { type: mimeType });
    }

    const url = URL.createObjectURL(blob);

    const downloadId = await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });

    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    return { success: true, downloadId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}