// =============================================================================
// Chat Archive — Content Script (Orchestrator)
// =============================================================================
// Injected into AI chat platform pages. Orchestrates:
//   Pass 0: Platform-specific button extraction (clipboard)
//   Pass 1: Structural heuristics (fallback for uncertain turns)
//   Serialization: JSON + Markdown
//   Download: via Chrome API or blob fallback

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
    return true;
  }

  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return;
  }
});

/**
 * Main extraction pipeline.
 * 1. Platform-specific Pass 0 extraction (clipboard + direct text)
 * 2. Pass 1 heuristics on any uncertain turns
 * 3. Serialize to requested format(s)
 * 4. Download
 */
async function handleExtraction(options) {
  const platform = detectPlatform();
  if (!platform) {
    return { success: false, error: 'Not on a supported chat platform' };
  }

  const format = options.format || 'json'; // 'json', 'markdown', 'both'
  console.log(`[Chat Archive] Starting extraction: platform=${platform}, format=${format}`);
  const startTime = Date.now();

  // --- Pass 0: Platform-specific extraction ---
  let extraction;
  try {
    switch (platform) {
      case 'claude':
        extraction = await extractClaudeConversation();
        break;
      case 'chatgpt':
        extraction = await extractChatGPTConversation();
        break;
      case 'gemini':
        extraction = await extractGeminiConversation();
        break;
      case 'grok':
        extraction = await extractGrokConversation();
        break;
      case 'grok-x':
        extraction = await extractGrokXConversation();
        break;
      default:
        return { success: false, error: `Unknown platform: ${platform}` };
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

  // --- Pass 1: Heuristics for uncertain turns ---
  try {
    extraction.turns = applyHeuristics(extraction.turns);
    const heuristicWarnings = heuristicIntegrityCheck(extraction.turns);
    extraction.errors = (extraction.errors || []).concat(heuristicWarnings);
  } catch (err) {
    console.warn('[Chat Archive] Heuristics pass failed (non-fatal):', err);
  }

  // --- Serialize and download ---
  const downloadResults = [];

  if (format === 'json' || format === 'both') {
    try {
      const { json, metadata, integrityWarnings } = serializeToJSON(extraction, platform);
      const filename = generateFilename(platform, 'json');
      await downloadFile(json, filename, 'application/json');
      downloadResults.push({ format: 'json', metadata, integrityWarnings });
    } catch (err) {
      return { success: false, error: `JSON export failed: ${err.message}` };
    }
  }

  if (format === 'markdown' || format === 'both') {
    try {
      const { markdown, metadata, integrityWarnings } = serializeToMarkdown(extraction, platform);
      const filename = generateFilename(platform, 'md');
      await downloadFile(markdown, filename, 'text/markdown');
      downloadResults.push({ format: 'markdown', metadata, integrityWarnings });
    } catch (err) {
      if (format === 'markdown') {
        return { success: false, error: `Markdown export failed: ${err.message}` };
      }
      // If 'both', JSON succeeded — report partial success
      console.warn('[Chat Archive] Markdown export failed (JSON succeeded):', err);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Chat Archive] Export complete: ${extraction.turns.length} turns in ${elapsed}ms`);

  // Merge metadata from first download result
  const primaryResult = downloadResults[0] || {};

  return {
    success: true,
    metadata: {
      ...(primaryResult.metadata || {}),
      extraction_time_ms: elapsed,
      formats_exported: downloadResults.map((r) => r.format),
    },
    integrityWarnings: primaryResult.integrityWarnings || [],
  };
}
