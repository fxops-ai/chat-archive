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
        return {
          success: false,
          error: `Platform "${platform}" extraction not yet implemented.`,
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

  // Serialize — JSON always (canonical format; required for zip when artifacts present).
  // Markdown serialized additionally only if the user requested that format.
  const jsonResult = serializeToJSON(extraction, platform);
  const mdResult   = format === 'markdown' ? serializeToMarkdown(extraction, platform) : null;

  const hasArtifacts = jsonResult.artifactManifest.length > 0;

  if (hasArtifacts) {
    // Build zip: conversation.json + optional conversation.md + artifact sidecars
    const zipFilename = generateFilename(platform, 'zip');
    const folderName  = zipFilename.replace(/\.zip$/, '');
    const zip         = new JSZip();
    const folder      = zip.folder(folderName);

    folder.file('conversation.json', jsonResult.json);

    if (mdResult) {
      folder.file('conversation.md', mdResult.markdown);
    }

    const artifactsFolder = folder.folder('artifacts');
    for (const sidecar of jsonResult.sidecarFiles) {
      if (sidecar.binary) {
        // Uint8Array binary content (PPTX, DOCX, XLSX from binary_fetch)
        artifactsFolder.file(sidecar.filename, sidecar.content, { binary: true });
      } else {
        artifactsFolder.file(sidecar.filename, sidecar.content);
      }
    }

    // Generate readme for any artifacts that fell back to browser_download.
    // These were cancelled by the background interceptor and re-triggered natively,
    // so the file is in the user's Downloads folder — not in the zip.
    const browserDownloadEntries = [];
    for (const entry of jsonResult.artifactManifest) {
      for (const v of entry.versions) {
        if (v.extraction_method === 'browser_download') {
          browserDownloadEntries.push({
            title:             entry.title,
            expected_filename: v.expected_filename || (entry.title + entry.versions[0]?.extension || ''),
            version_number:    v.version_number,
            artifact_id:       entry.artifact_id,
          });
        }
      }
    }

    if (browserDownloadEntries.length > 0) {
      const readmeLines = [
        'Binary Artifacts — Manual Download Required',
        '===========================================',
        '',
        'The following binary artifacts could not be automatically captured into the',
        'zip. They were downloaded to your Downloads folder by the browser. To complete',
        'your archive, move each file into the artifacts/ folder of this zip:',
        '',
        ...browserDownloadEntries.map(({ title, expected_filename, version_number, artifact_id }) =>
          `  ${expected_filename.padEnd(50)}  (${artifact_id} v${version_number} — "${title}")`
        ),
        '',
        'Alternatively, re-export the conversation. Binary fetch occasionally fails on',
        'the first attempt and succeeds on a second try.',
        '',
        `Generated by Chat Archive v${EXTENSION_VERSION}`,
      ];
      folder.file('binary-downloads-readme.txt', readmeLines.join('\n'));
    }

    await downloadZip(zip, zipFilename);
  } else {
    // No artifacts — download single file in the requested format
    if (format === 'markdown') {
      await downloadFile(mdResult.markdown, generateFilename(platform, 'md'), 'text/markdown');
    } else {
      await downloadFile(jsonResult.json, generateFilename(platform, 'json'), 'application/json');
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Chat Archive] Export complete: ${extraction.turns.length} turns in ${elapsed}ms`);

  return {
    success: true,
    metadata: {
      ...jsonResult.metadata,
      extraction_time_ms: elapsed,
      artifact_count: jsonResult.artifactManifest.length,
    },
    integrityWarnings: jsonResult.integrityWarnings,
  };
}