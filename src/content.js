// =============================================================================
// Chat Archive — Content Script
// =============================================================================
// Injected into AI chat platform pages. Orchestrates extraction pipeline.
// Phase 1: Claude.ai only, direct text extraction, JSON + Markdown export.

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'detect') {
    const platform = detectPlatform();
    sendResponse({ platform, supported: platform !== null });
    return;
  }

  if (message.action === 'extract') {
    handleExtraction(message.options || {})
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return;
  }
});

/**
 * Main extraction pipeline.
 */
async function handleExtraction(options) {
  const platform = detectPlatform();
  if (!platform) {
    return { success: false, error: 'Not on a supported chat platform' };
  }

  const format = options.format || 'json'; // 'json' | 'markdown'
  console.log(`[Chat Archive] Starting extraction for platform: ${platform}, format: ${format}`);
  const startTime = Date.now();

  let extraction;

  try {
    switch (platform) {
      case 'claude':
        extraction = await extractClaudeConversation();
        break;
      default:
        return {
          success: false,
          error: `Platform "${platform}" extraction not yet implemented. Coming in Phase 2.`,
        };
    }
  } catch (err) {
    console.error('[Chat Archive] Extraction failed:', err);
    return { success: false, error: `Extraction failed: ${err.message}` };
  }

  if (!extraction || extraction.turns.length === 0) {
    return {
      success: false,
      error: 'No conversation turns found. Is there a conversation on this page?',
      errors: extraction?.errors || [],
    };
  }

  let content, filename, mimeType, metadata, integrityWarnings;

  if (format === 'markdown') {
    const result = serializeToMarkdown(extraction, platform);
    content = result.markdown;
    metadata = result.metadata;
    integrityWarnings = result.integrityWarnings;
    filename = generateFilename(platform, 'md');
    mimeType = 'text/markdown';
  } else {
    const result = serializeToJSON(extraction, platform);
    content = result.json;
    metadata = result.metadata;
    integrityWarnings = result.integrityWarnings;
    filename = generateFilename(platform, 'json');
    mimeType = 'application/json';
  }

  try {
    await downloadViaBackground(content, filename, mimeType);
  } catch (err) {
    console.warn('[Chat Archive] Background download failed, trying blob fallback:', err);
    try {
      downloadViaBlob(content, filename, mimeType);
    } catch (blobErr) {
      return { success: false, error: `Download failed: ${blobErr.message}` };
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Chat Archive] Export complete: ${extraction.turns.length} turns in ${elapsed}ms`);

  return {
    success: true,
    metadata: {
      ...metadata,
      extraction_time_ms: elapsed,
    },
    integrityWarnings,
  };
}
