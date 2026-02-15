// =============================================================================
// Chat Archive — Background Service Worker
// =============================================================================
// Handles file downloads (content scripts can't use chrome.downloads directly).
// Zero network requests. No telemetry. No phone-home.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
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

async function handleDownload({ content, filename, mimeType }) {
  try {
    const blob = new Blob([content], { type: mimeType });
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
