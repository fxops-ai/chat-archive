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
      if (userTurn) turns.push(flagIfOversized(userTurn));

      // Extract assistant turn
      const assistantTurn = await extractClaudeTurn(container, 'assistant', hasClipboard);
      if (assistantTurn) turns.push(flagIfOversized(assistantTurn));
    } catch (err) {
      errors.push(`Error extracting container ${i}: ${err.message}`);
      console.warn(`[Chat Archive] Claude: Error on container ${i}:`, err);
    }
  }

  console.log(`[Chat Archive] Claude: Extracted ${turns.length} turns, ${errors.length} errors`);
  return { turns, errors, partial: errors.length > 0 };
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
