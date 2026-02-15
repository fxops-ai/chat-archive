// =============================================================================
// Chat Archive — Gemini Extractor (Pass 0 + Direct Text Fallback)
// =============================================================================
// Architecture: Appendix D
// Turn container: div.conversation-container[id] wraps <user-query> + <model-response>
// Copy buttons: aria-label="Copy prompt" (user), data-test-id="copy-button" (assistant)
// Role signals: <user-query> (0.99), <model-response> (0.99)

async function extractGeminiConversation() {
  const startTime = Date.now();
  const turns = [];
  const errors = [];

  // 1. Find scroll container
  const scrollContainer = findGeminiScrollContainer();
  if (!scrollContainer) {
    return { turns: [], errors: ['Scroll container not found'], partial: true };
  }

  // 2. Load all turns
  await scrollToLoadAll(
    scrollContainer,
    'div.conversation-container[id]',
    startTime
  );

  // 3. Get turn containers
  const turnContainers = document.querySelectorAll('div.conversation-container[id]');
  console.log(`[Chat Archive] Gemini: Found ${turnContainers.length} turn containers`);

  if (turnContainers.length === 0) {
    // Fallback: try older selectors
    const oldContainers = document.querySelectorAll('ms-chat-turn');
    if (oldContainers.length > 0) {
      console.log(`[Chat Archive] Gemini: Found ${oldContainers.length} legacy ms-chat-turn elements`);
      return extractGeminiLegacy(oldContainers, startTime);
    }
    return { turns: [], errors: ['No turn containers found'], partial: true };
  }

  // 4. Clipboard test
  const hasClipboard = await testClipboardAccess();
  console.log(`[Chat Archive] Gemini: Clipboard access: ${hasClipboard}`);

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
    const turnId = container.id;

    try {
      container.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(200);

      // --- User turn ---
      const userQuery = container.querySelector('user-query');
      if (userQuery) {
        const userTurn = await extractGeminiUserTurn(userQuery, turnId, hasClipboard);
        if (userTurn) turns.push(flagIfOversized(userTurn));
      }

      // --- Assistant turn ---
      const modelResponse = container.querySelector('model-response');
      if (modelResponse) {
        const assistantTurn = await extractGeminiAssistantTurn(modelResponse, turnId, hasClipboard);
        if (assistantTurn) turns.push(flagIfOversized(assistantTurn));
      }
    } catch (err) {
      errors.push(`Error extracting container ${i} (${turnId}): ${err.message}`);
      console.warn(`[Chat Archive] Gemini: Error on container ${i}:`, err);
    }
  }

  console.log(`[Chat Archive] Gemini: Extracted ${turns.length} turns, ${errors.length} errors`);
  return { turns, errors, partial: errors.length > 0 };
}

async function extractGeminiUserTurn(userQuery, turnId, hasClipboard) {
  let content = null;
  let extractionMethod = 'direct';

  // Pass 0: Copy button
  if (hasClipboard) {
    try {
      const copyBtn = userQuery.querySelector('button[aria-label="Copy prompt"]')
        || findActionButton(userQuery, ['Copy prompt', 'Copy']);
      if (copyBtn) {
        const clipContent = await clickCopyAndRead(copyBtn);
        if (clipContent && clipContent.trim().length > 0) {
          content = clipContent;
          extractionMethod = 'clipboard';
        }
      }
    } catch (err) {
      console.warn(`[Chat Archive] Gemini: User clipboard failed:`, err);
    }
  }

  // Fallback: direct text
  if (!content) {
    const textEl = userQuery.querySelector('.query-text-line');
    content = textEl?.textContent?.trim() || '';

    // Broader fallback
    if (!content) {
      const queryText = userQuery.querySelector('.query-text');
      content = queryText?.textContent?.trim() || '';
    }
    if (!content) {
      content = userQuery.textContent?.trim() || '';
    }
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  return {
    role: 'user',
    content: content.trim(),
    turnId,
    extractionMethod,
    confidence: 0.99,
    classificationSource: 'structural',
  };
}

async function extractGeminiAssistantTurn(modelResponse, turnId, hasClipboard) {
  let content = null;
  let extractionMethod = 'direct';

  // Pass 0: Copy button
  if (hasClipboard) {
    try {
      const copyBtn = modelResponse.querySelector('button[data-test-id="copy-button"]')
        || modelResponse.querySelector('button[aria-label="Copy"]')
        || findActionButton(modelResponse, ['Copy']);
      if (copyBtn) {
        const clipContent = await clickCopyAndRead(copyBtn);
        if (clipContent && clipContent.trim().length > 0) {
          content = clipContent;
          extractionMethod = 'clipboard';
        }
      }
    } catch (err) {
      console.warn(`[Chat Archive] Gemini: Assistant clipboard failed:`, err);
    }
  }

  // Fallback: direct text (with citation stripping)
  if (!content) {
    content = extractGeminiAssistantDirectText(modelResponse);
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  return {
    role: 'assistant',
    content: content.trim(),
    turnId,
    extractionMethod,
    confidence: 0.99,
    classificationSource: 'structural',
  };
}

/**
 * Direct text extraction for Gemini assistant messages.
 * Clones the element and strips citations, avatars, processing states.
 */
function extractGeminiAssistantDirectText(modelResponse) {
  const markdown = modelResponse.querySelector('.markdown.markdown-main-panel');
  if (!markdown) {
    // Broader fallback
    const messageContent = modelResponse.querySelector('message-content');
    if (messageContent) {
      const clone = messageContent.cloneNode(true);
      stripGeminiDecorations(clone);
      return clone.textContent?.trim() || '';
    }
    return modelResponse.textContent?.trim() || '';
  }

  const clone = markdown.cloneNode(true);
  stripGeminiDecorations(clone);
  return clone.textContent?.trim() || '';
}

/**
 * Remove decorative/non-content elements from a Gemini DOM clone.
 */
function stripGeminiDecorations(element) {
  const selectorsToRemove = [
    'source-footnote',
    'source-inline-chip',
    'sources-carousel-inline',
    'bard-avatar',
    'processing-state',
    'tts-control',
    'thumb-up-button',
    'thumb-down-button',
    'copy-button',
    '.code-block-decoration',
    'freemium-rag-disclaimer',
    'sensitive-memories-banner',
  ];

  for (const selector of selectorsToRemove) {
    try {
      element.querySelectorAll(selector).forEach((el) => el.remove());
    } catch {
      // Invalid selector — skip
    }
  }
}

/**
 * Legacy Gemini extraction for older DOM structure (ms-chat-turn).
 */
async function extractGeminiLegacy(turnElements, startTime) {
  const turns = [];
  const errors = [];

  for (let i = 0; i < turnElements.length; i++) {
    if (Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) break;
    if (turns.length >= SAFETY_LIMITS.MAX_TURNS) break;

    try {
      const el = turnElements[i];
      const content = el.textContent?.trim() || '';
      if (!content) continue;

      // Legacy role detection: alternating pattern
      turns.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content,
        extractionMethod: 'direct',
        confidence: 0.60,
        classificationSource: 'heuristic-alternation',
      });
    } catch (err) {
      errors.push(`Legacy turn ${i}: ${err.message}`);
    }
  }

  return { turns, errors, partial: true };
}

function findGeminiScrollContainer() {
  const strategies = [
    () => document.querySelector('infinite-scroller[data-test-id="chat-history-container"]'),
    () => document.querySelector('#chat-history'),
    () => document.querySelector('.chat-history-scroll-container'),
    () => {
      const firstTurn = document.querySelector('div.conversation-container[id]');
      return firstTurn ? findScrollableAncestor(firstTurn) : null;
    },
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result;
  }
  return null;
}
