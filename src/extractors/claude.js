// =============================================================================
// Chat Archive — Claude.ai Extractor (Pass 0 + Direct Text Fallback)
// =============================================================================
// Architecture: Appendix C
// Turn container: div[data-test-render-count] wraps user+assistant pair
// Copy buttons: button[data-testid="action-bar-copy"] on both roles
// Role signals: [data-testid="user-message"] (user), [data-is-streaming] (assistant)

async function extractClaudeConversation() {
  const startTime = Date.now();
  const turns = [];
  const errors = [];
  const rawArtifacts = [];    // { processed: ProcessedArtifact, turnNumber: number }
  let artifactPanelCount = 0; // Panel opens only (card surface)

  // 1. Find scroll container
  const scrollContainer = findClaudeScrollContainer();
  if (!scrollContainer) {
    return { turns: [], errors: ['Scroll container not found'], partial: true };
  }

  // 2. Load all turns via scrolling
  await scrollToLoadAll(scrollContainer, '[data-test-render-count]', startTime);

  // 3. Get turn pair containers
  const turnContainers = document.querySelectorAll('[data-test-render-count]');
  console.log(`[Chat Archive] Claude: Found ${turnContainers.length} turn containers`);

  if (turnContainers.length === 0) {
    return { turns: [], errors: ['No turn containers found'], partial: true };
  }

  // 4. Test clipboard access
  const hasClipboard = await testClipboardAccess();
  console.log(`[Chat Archive] Claude: Clipboard access: ${hasClipboard}`);

  // 5. Extract each turn pair
  for (let i = 0; i < turnContainers.length; i++) {
    if (Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) {
      errors.push(`Extraction timed out after ${SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS}ms`);
      break;
    }
    if (turns.length >= SAFETY_LIMITS.MAX_TURNS) {
      errors.push(`Hit maximum turn limit (${SAFETY_LIMITS.MAX_TURNS})`);
      break;
    }

    const container = turnContainers[i];

    try {
      // Scroll into view to ensure content is rendered
      container.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(150);

      // Extract user turn
      const userTurn = await extractClaudeTurn(container, 'user', hasClipboard);
      if (userTurn) {
        userTurn.artifacts = [];
        turns.push(flagIfOversized(userTurn));
      }

      // Extract assistant turn
      const assistantTurn = await extractClaudeTurn(container, 'assistant', hasClipboard);
      if (assistantTurn) {
        assistantTurn.artifacts = [];
        turns.push(flagIfOversized(assistantTurn));
      }

      // Artifact pass — runs after text extraction for this container.
      // Artifacts are associated with the assistant turn (current last turn, 1-indexed).
      const assistantTurnNumber = turns.length;
      const candidates = detectArtifacts(container, i);

      for (const candidate of candidates) {
        if (rawArtifacts.length >= SAFETY_LIMITS.MAX_ARTIFACT_PANELS) {
          errors.push(
            `Artifact limit (${SAFETY_LIMITS.MAX_ARTIFACT_PANELS}) reached at` +
            ` container ${i} — remaining artifacts skipped`
          );
          break;
        }

        try {
          const { content, method } = candidate.surface === 'card'
            ? await extractFromPanel(candidate, hasClipboard)
            : await extractInlineCodeBlock(candidate, hasClipboard);

          if (candidate.surface === 'card') artifactPanelCount++;

          const processed = await processArtifact(content, candidate, method);
          rawArtifacts.push({ processed, turnNumber: assistantTurnNumber });
        } catch (artifactErr) {
          errors.push(
            `Error extracting artifact "${candidate.title}" in container ${i}: ${artifactErr.message}`
          );
          console.warn(`[Chat Archive] Claude: Artifact error in container ${i}:`, artifactErr);
        }
      }
    } catch (err) {
      errors.push(`Error extracting container ${i}: ${err.message}`);
      console.warn(`[Chat Archive] Claude: Error on container ${i}:`, err);
    }
  }

  // Assemble artifact manifest and populate turn cross-references
  const { manifest: artifactManifest, sidecarFiles } = rawArtifacts.length > 0
    ? assembleArtifactManifest(rawArtifacts, turns)
    : { manifest: [], sidecarFiles: [] };

  console.log(
    `[Chat Archive] Claude: Extracted ${turns.length} turns,` +
    ` ${rawArtifacts.length} artifact(s), ${errors.length} errors`
  );
  return {
    turns,
    errors,
    partial: errors.length > 0,
    artifactManifest,
    sidecarFiles,
  };
}

/**
 * Extract a single turn (user or assistant) from a turn-pair container.
 * Pass 0: Try copy button → clipboard. Fallback: direct text extraction.
 */
async function extractClaudeTurn(container, role, hasClipboard) {
  // Determine which sub-element to target
  const roleSelector = role === 'user'
    ? '[data-testid="user-message"]'
    : '[data-is-streaming]';

  // Fallback role selector
  const fallbackSelector = role === 'user'
    ? '.font-user-message'
    : '.font-claude-response';

  const roleElement = container.querySelector(roleSelector)
    || container.querySelector(fallbackSelector);

  if (!roleElement) return null;

  // Find the nearest group container (for hover-triggering copy button visibility)
  const groupContainer = roleElement.closest('.group') || roleElement;

  let content = null;
  let extractionMethod = 'direct';

  // --- Pass 0: Clipboard via copy button ---
  if (hasClipboard) {
    try {
      // Trigger hover to ensure button is interactable
      groupContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(SAFETY_LIMITS.HOVER_SETTLE_MS);

      // Find copy button within this turn's group
      // Claude uses data-testid="action-bar-copy" — but each turn-pair has multiple
      // We need the copy button closest to our role element
      const copyButton = findClaudeCopyButton(groupContainer, container, role);

      if (copyButton) {
        const clipboardContent = await clickCopyAndRead(copyButton);
        if (clipboardContent && clipboardContent.trim().length > 0) {
          content = clipboardContent;
          extractionMethod = 'clipboard';
        }
      }

      groupContainer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    } catch (err) {
      console.warn(`[Chat Archive] Claude: Clipboard extraction failed for ${role}:`, err);
    }
  }

  // --- Fallback: Direct text extraction ---
  if (!content) {
    content = extractClaudeDirectText(container, role);
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  // Timestamp
  const timestampEl = container.querySelector('span.text-text-500.text-xs');
  const timestamp = timestampEl?.textContent?.trim() || undefined;

  return {
    role,
    content: content.trim(),
    timestamp,
    extractionMethod,
    confidence: 0.95,
    classificationSource: 'structural',
  };
}

/**
 * Find the correct copy button for a specific role within a turn-pair container.
 * Each data-test-render-count container has TWO groups (user + assistant),
 * each with their own action bar and copy button.
 */
function findClaudeCopyButton(groupContainer, pairContainer, role) {
  // Try within the immediate group first
  let btn = groupContainer.querySelector('button[data-testid="action-bar-copy"]');
  if (btn) return btn;

  btn = findActionButton(groupContainer, ['Copy']);
  if (btn) return btn;

  // If group didn't have it, search all copy buttons in the pair container
  // and match by proximity to the role element
  const allCopyBtns = pairContainer.querySelectorAll('button[data-testid="action-bar-copy"]');
  if (allCopyBtns.length === 0) return null;

  if (allCopyBtns.length === 1) return allCopyBtns[0];

  // Multiple copy buttons — pick by position:
  // First copy button belongs to user, second to assistant
  if (role === 'user') return allCopyBtns[0];
  if (role === 'assistant') return allCopyBtns[allCopyBtns.length - 1];

  return allCopyBtns[0];
}

/**
 * Direct text extraction fallback for Claude.
 */
function extractClaudeDirectText(container, role) {
  if (role === 'user') {
    const el = container.querySelector('[data-testid="user-message"]');
    return el?.textContent?.trim() || '';
  } else {
    // Prefer .standard-markdown within .font-claude-response
    const markdown = container.querySelector('.font-claude-response .standard-markdown');
    if (markdown) return markdown.textContent?.trim() || '';

    const response = container.querySelector('.font-claude-response');
    if (response) return response.textContent?.trim() || '';

    const streaming = container.querySelector('[data-is-streaming]');
    return streaming?.textContent?.trim() || '';
  }
}

/**
 * Find Claude's scrollable chat container.
 */
function findClaudeScrollContainer() {
  const strategies = [
    () => document.querySelector('.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1'),
    () => {
      const scrollables = document.querySelectorAll('[class*="overflow-y-scroll"]');
      for (const el of scrollables) {
        if (el.querySelector('[data-test-render-count]')) return el;
      }
      return null;
    },
    () => {
      const firstTurn = document.querySelector('[data-test-render-count]');
      return firstTurn ? findScrollableAncestor(firstTurn) : null;
    },
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result;
  }
  return null;
}

/**
 * Group raw artifacts into a versioned manifest, populate turn cross-references,
 * and produce a flat sidecar file list for zip assembly.
 *
 * Identity key: title + canonical_type
 *   Cards with the same title and type across turns are treated as versions
 *   of the same logical artifact. Version numbering is 1-indexed in turn order.
 *
 * Artifact IDs: 'artifact-001', 'artifact-002', ... (first-appearance order)
 *
 * changed flag:
 *   v1 is always true (no prior version to compare).
 *   v2+ is true if content_hash differs from the previous version.
 *
 * Side effect: mutates turns[turnNumber - 1].artifacts[] with cross-reference objects.
 *
 * @param {Array<{processed: Object, turnNumber: number}>} rawArtifacts
 * @param {Array<Object>} turns  - Mutable turns array from extractClaudeConversation
 * @returns {{ manifest: Array, sidecarFiles: Array<{filename: string, content: string}> }}
 */
function assembleArtifactManifest(rawArtifacts, turns) {
  // Group by identity key — Map preserves insertion order (first-appearance ordering)
  const groups = new Map();
  let idCounter = 1;

  for (const entry of rawArtifacts) {
    const { processed } = entry;
    const key = `${processed.title}|${processed.canonical_type}`;

    if (!groups.has(key)) {
      groups.set(key, {
        artifactId: 'artifact-' + String(idCounter++).padStart(3, '0'),
        entries: [],
      });
    }
    groups.get(key).entries.push(entry);
  }

  const manifest    = [];
  const sidecarFiles = [];

  for (const [, group] of groups) {
    const { artifactId, entries } = group;
    const first = entries[0].processed;

    const versions = entries.map((entry, vIdx) => {
      const { processed, turnNumber } = entry;
      const vNum         = vIdx + 1;
      const prevHash     = vIdx > 0 ? entries[vIdx - 1].processed.content_hash : null;
      const slug         = slugify(processed.title);
      const sidecarFilename = `${artifactId}-v${vNum}-${slug}${processed.extension}`;

      // Register content for zip assembly.
      // binary_fetch → Uint8Array, flagged binary: true so JSZip encodes correctly.
      // browser_download → null content, no sidecar entry (file is in user's Downloads).
      if (processed.content !== null) {
        sidecarFiles.push({
          filename: sidecarFilename,
          content:  processed.content,
          ...(processed.content instanceof Uint8Array && { binary: true }),
        });
      }

      // Populate cross-reference on the turn object (1-indexed → 0-indexed array)
      const turnObj = turns[turnNumber - 1];
      if (turnObj) {
        if (!Array.isArray(turnObj.artifacts)) turnObj.artifacts = [];
        turnObj.artifacts.push({
          artifact_id:    artifactId,
          version_number: vNum,
          title:          processed.title,
          canonical_type: processed.canonical_type,
          surface:        processed.surface,
        });
      }

      return {
        version_number:    vNum,
        turn:              turnNumber,
        // null when content could not be captured (browser_download fallback)
        sidecar_filename:  processed.content !== null ? sidecarFilename : null,
        content_hash:      processed.content_hash,
        char_count:        processed.char_count,
        line_count:        processed.line_count,
        // byte_count is set for binary_fetch; expected_filename for browser_download
        ...(processed.byte_count       != null && { byte_count:       processed.byte_count }),
        ...(processed.expected_filename        && { expected_filename: processed.expected_filename }),
        extraction_method: processed.extraction_method,
        extracted_at:      new Date().toISOString(),
        changed:           prevHash === null || processed.content_hash !== prevHash,
        malformed:         processed.malformed,
        type_unknown:      processed.type_unknown,
        oversized:         processed.oversized,
        supplementary:     processed.supplementary,
      };
    });

    manifest.push({
      artifact_id:    artifactId,
      title:          first.title,
      canonical_type: first.canonical_type,
      extension:      first.extension,
      version_count:  versions.length,
      versions,
    });
  }

  return { manifest, sidecarFiles };
}