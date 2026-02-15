// =============================================================================
// Chat Archive — Popup Script (Phase 2)
// =============================================================================

const statusEl = document.getElementById('status');
const exportBtn = document.getElementById('exportBtn');
const resultsEl = document.getElementById('results');
const formatBtns = document.querySelectorAll('.format-btn');

const PLATFORM_DISPLAY = {
  claude: 'Claude.ai',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  'grok-x': 'Grok (x.com)',
};

let currentTabId = null;
let detectedPlatform = null;
let selectedFormat = 'json';

// --- Format selector ---
formatBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    formatBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.format;
    updateExportButtonLabel();
  });
});

function updateExportButtonLabel() {
  const labels = {
    json: 'Export JSON',
    markdown: 'Export Markdown',
    both: 'Export Both',
  };
  exportBtn.textContent = labels[selectedFormat] || 'Export';
}

// --- Initialization ---
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showStatus('error', 'No active tab found.');
      return;
    }
    currentTabId = tab.id;

    const url = tab.url || '';
    const supportedDomains = [
      'claude.ai/chat',
      'chat.openai.com',
      'chatgpt.com',
      'gemini.google.com',
      'x.com/i/grok',
      'grok.com',
    ];

    const isSupported = supportedDomains.some((d) => url.includes(d));
    if (!isSupported) {
      showStatus('error', 'Navigate to a supported AI chat to export.');
      return;
    }

    try {
      const response = await sendToTab(currentTabId, { action: 'detect' });
      if (response && response.supported) {
        detectedPlatform = response.platform;
        const name = PLATFORM_DISPLAY[detectedPlatform] || detectedPlatform;
        showStatus(
          'info',
          `Detected: <span class="platform-name">${name}</span>. Ready to export.`
        );
        exportBtn.disabled = false;
        updateExportButtonLabel();
      } else {
        showStatus(
          'warning',
          'On a supported site, but content script not responding. Try refreshing the page.'
        );
      }
    } catch (err) {
      showStatus('warning', 'Content script not loaded. Try refreshing the page.');
    }
  } catch (err) {
    showStatus('error', `Error: ${err.message}`);
  }
}

// --- Export ---
exportBtn.addEventListener('click', async () => {
  if (!currentTabId || !detectedPlatform) return;

  exportBtn.disabled = true;
  exportBtn.innerHTML = '<span class="spinner"></span> Extracting...';
  showStatus('info', 'Extracting conversation...');
  resultsEl.classList.remove('visible');

  try {
    const response = await sendToTab(currentTabId, {
      action: 'extract',
      options: { format: selectedFormat },
    });

    if (response && response.success) {
      const meta = response.metadata || {};
      const formatLabel =
        meta.formats_exported?.join(' + ').toUpperCase() ||
        selectedFormat.toUpperCase();
      showStatus(
        'success',
        `Exported ${meta.total_turns || '?'} turns as ${formatLabel} from ${
          PLATFORM_DISPLAY[detectedPlatform] || detectedPlatform
        }.`
      );
      showResults(meta, response.integrityWarnings);
    } else {
      showStatus('error', response?.error || 'Export failed.');
      if (response?.errors?.length) {
        showResults({ errors: response.errors }, []);
      }
    }
  } catch (err) {
    showStatus('error', `Export failed: ${err.message}`);
  }

  exportBtn.disabled = false;
  updateExportButtonLabel();
});

// --- UI Helpers ---
function showStatus(type, html) {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = html;
}

function showResults(metadata, warnings) {
  let html = '';

  if (metadata.total_turns !== undefined) {
    html += `<div class="stat"><span class="stat-label">Turns</span><span class="stat-value">${metadata.total_turns}</span></div>`;
  }
  if (metadata.flagged_turns !== undefined && metadata.flagged_turns > 0) {
    html += `<div class="stat"><span class="stat-label">Flagged</span><span class="stat-value">${metadata.flagged_turns}</span></div>`;
  }
  if (metadata.extraction_time_ms !== undefined) {
    html += `<div class="stat"><span class="stat-label">Time</span><span class="stat-value">${metadata.extraction_time_ms}ms</span></div>`;
  }
  if (metadata.partial_export) {
    html += `<div class="stat"><span class="stat-label">Status</span><span class="stat-value" style="color:#b45309">Partial</span></div>`;
  }
  if (metadata.formats_exported) {
    html += `<div class="stat"><span class="stat-label">Formats</span><span class="stat-value">${metadata.formats_exported.join(', ')}</span></div>`;
  }

  if (warnings && warnings.length > 0) {
    html += '<div class="warnings">';
    warnings.forEach((w) => {
      html += `<div>⚠ ${escapeHtml(w)}</div>`;
    });
    html += '</div>';
  }

  if (metadata.errors && metadata.errors.length > 0) {
    html += '<div class="warnings">';
    metadata.errors.forEach((e) => {
      html += `<div>⚠ ${escapeHtml(e)}</div>`;
    });
    html += '</div>';
  }

  if (html) {
    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

init();
