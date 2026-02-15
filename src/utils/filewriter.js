// =============================================================================
// Chat Archive — File Writer
// =============================================================================
// Writes serialized output to user's device via Chrome downloads API.
// Phase 2: JSON + Markdown.

/**
 * Generate a filename for the export.
 * Format: chat-export-{platform}-{YYYY-MM-DD-HHmmss}.{ext}
 */
function generateFilename(platform, format) {
  const now = new Date();
  const date = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `chat-export-${platform}-${date}.${format}`;
}

/**
 * Download content as a file using the Chrome downloads API via background.js.
 */
function downloadViaBackground(content, filename, mimeType) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'download',
        content,
        filename,
        mimeType,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Download failed'));
        }
      }
    );
  });
}

/**
 * Fallback: Download via Blob URL and <a> click.
 */
function downloadViaBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download a file with fallback from background API to blob.
 */
async function downloadFile(content, filename, mimeType) {
  try {
    await downloadViaBackground(content, filename, mimeType);
  } catch (err) {
    console.warn('[Chat Archive] Background download failed, trying blob fallback:', err);
    downloadViaBlob(content, filename, mimeType);
  }
}
