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
function downloadViaBackground(content, filename, mimeType, isBase64 = false) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'download',
        content,
        filename,
        mimeType,
        isBase64,
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

/**
 * Fallback: decode a base64 zip string to a Blob and trigger download via <a> click.
 * Used when background message passing fails for zip downloads.
 */
function downloadZipViaBlob(base64, filename) {
  try {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[Chat Archive] Zip blob fallback also failed:', err);
  }
}

/**
 * Add a binary file (Uint8Array) to a JSZip folder.
 * Convenience wrapper — keeps binary handling explicit at call sites.
 *
 * @param {JSZip}      folder    - JSZip folder object
 * @param {string}     filename  - Filename within the folder
 * @param {Uint8Array} uint8array - Binary content
 */
function addBinaryToZip(folder, filename, uint8array) {
  folder.file(filename, uint8array, { binary: true });
}

/**
 * Download a JSZip instance as a .zip file.
 *
 * Zip binary data cannot cross Chrome message passing as-is — the channel is
 * JSON-only. We generate the zip as base64 (a plain string), send it to
 * background.js with isBase64: true, where atob() decodes it back to binary
 * before creating the Blob. Falls back to direct blob creation in the content
 * script if background messaging fails.
 *
 * @param {JSZip}  zipObj   - Assembled JSZip instance (all files already added)
 * @param {string} filename - Suggested filename shown in the download dialog
 */
async function downloadZip(zipObj, filename) {
  const base64 = await zipObj.generateAsync({ type: 'base64' });

  try {
    await downloadViaBackground(base64, filename, 'application/zip', true);
  } catch (err) {
    console.warn('[Chat Archive] Background zip download failed, trying blob fallback:', err);
    downloadZipViaBlob(base64, filename);
  }
}