// =============================================================================
// Chat Archive — Grok.com Extractor (Pass 0 + Direct Text Fallback)
// =============================================================================
// Architecture: Appendix A
// Turn container: div[id^="response-"] with scroll-margin-top
// Copy buttons: aria-label="Copy" on both roles (opacity-0 but clickable)
// Role signals: items-end (user) vs items-start (assistant) — 0.95
//               Button count: 2 (user) vs 8+ (assistant) — 0.95
//               Bubble styling: bg-surface-l1 (user) vs w-full (assistant) — 0.90

async function extractGrokConversation() {
  const startTime = Date.now();
  const turns = [];
  const errors = [];

  // 1. Find scroll container
  const scrollContainer = findGrokScrollContainer();
  if (!scrollContainer) {
    return { turns: [], errors: ['Scroll container not found'], partial: true };
  }

  // 2. Load all turns
  await scrollToLoadAll(scrollContainer, 'div[id^="response-"]', startTime);

  // 3. Get turn containers
  const turnContainers = document.querySelectorAll('div[id^="response-"]');
  console.log(`[Chat Archive] Grok: Found ${turnContainers.length} turn containers`);

  if (turnContainers.length === 0) {
    return { turns: [], errors: ['No turn containers found'], partial: true };
  }

  // 4. Clipboard test
  const hasClipboard = await testClipboardAccess();
  console.log(`[Chat Archive] Grok: Clipboard access: ${hasClipboard}`);

  // 5. Extract each turn
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
      container.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(150);

      const turn = await extractGrokTurn(container, hasClipboard);
      if (turn) turns.push(flagIfOversized(turn));
    } catch (err) {
      errors.push(`Error extracting turn ${i}: ${err.message}`);
      console.warn(`[Chat Archive] Grok: Error on turn ${i}:`, err);
    }
  }

  console.log(`[Chat Archive] Grok: Extracted ${turns.length} turns, ${errors.length} errors`);
  return { turns, errors, partial: errors.length > 0 };
}

async function extractGrokTurn(container, hasClipboard) {
  const turnId = container.id; // "response-{uuid}"

  // --- Role detection (3 independent signals) ---
  const role = detectGrokRole(container);
  if (!role) return null;

  // --- Pass 0: Clipboard ---
  let content = null;
  let extractionMethod = 'direct';

  if (hasClipboard) {
    try {
      const copyBtn = container.querySelector('button[aria-label="Copy"]')
        || findActionButton(container, ['Copy']);
      if (copyBtn) {
        const clipContent = await clickCopyAndRead(copyBtn);
        if (clipContent && clipContent.trim().length > 0) {
          content = clipContent;
          extractionMethod = 'clipboard';
        }
      }
    } catch (err) {
      console.warn(`[Chat Archive] Grok: Clipboard failed for ${turnId}:`, err);
    }
  }

  // --- Fallback: Direct text ---
  if (!content) {
    content = extractGrokDirectText(container, role);
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  return {
    role,
    content: content.trim(),
    turnId,
    extractionMethod,
    confidence: 0.95,
    classificationSource: 'structural',
  };
}

/**
 * Detect role using three independent signals.
 * Signal 1: Container alignment (items-end = user, items-start = assistant)
 * Signal 2: Button count (2 = user, 8+ = assistant)
 * Signal 3: Message bubble styling (bg-surface-l1 = user)
 */
function detectGrokRole(container) {
  const signals = { user: 0, assistant: 0 };

  // Signal 1: Alignment classes
  const classes = container.className || '';
  if (classes.includes('items-end')) signals.user += 2;
  else if (classes.includes('items-start')) signals.assistant += 2;

  // Also check child flex containers for alignment
  const flexChild = container.querySelector('[class*="items-end"]');
  const flexChildStart = container.querySelector('[class*="items-start"]');
  if (flexChild && !flexChildStart) signals.user += 1;
  if (flexChildStart && !flexChild) signals.assistant += 1;

  // Signal 2: Button count
  const buttons = container.querySelectorAll('button');
  if (buttons.length <= 3) signals.user += 2;
  else if (buttons.length >= 5) signals.assistant += 2;

  // Signal 3: Bubble styling
  const hasBubble = container.querySelector('[class*="bg-surface-l1"]');
  const hasFullWidth = container.querySelector('[class*="max-w-none"]');
  if (hasBubble) signals.user += 1;
  if (hasFullWidth) signals.assistant += 1;

  // Signal 4: Edit button (user only)
  const editBtn = container.querySelector('button[aria-label="Edit"]');
  if (editBtn) signals.user += 2;

  // Signal 5: Regenerate button (assistant only)
  const regenBtn = container.querySelector('button[aria-label="Regenerate"]');
  if (regenBtn) signals.assistant += 2;

  // Signal 6: Response time indicator (assistant only)
  const responseTime = container.querySelector('[class*="text-xs"]');
  if (responseTime && /\d+ms/.test(responseTime.textContent || '')) {
    signals.assistant += 1;
  }

  if (signals.user > signals.assistant) return 'user';
  if (signals.assistant > signals.user) return 'assistant';

  // Tie-breaker: default to alternation pattern (handled by heuristics pass)
  return null;
}

function extractGrokDirectText(container, role) {
  // Look for the message content area
  const markdown = container.querySelector('.message-bubble .response-content-markdown');
  if (markdown) return markdown.textContent?.trim() || '';

  // Broader: any .markdown inside the container
  const markdownAlt = container.querySelector('.markdown');
  if (markdownAlt) return markdownAlt.textContent?.trim() || '';

  // Broadest: main text content, excluding buttons
  const clone = container.cloneNode(true);
  // Remove action bars, follow-up suggestions
  clone.querySelectorAll('button, [class*="follow-up"], #last-reply-container').forEach(
    (el) => el.remove()
  );
  return clone.textContent?.trim() || '';
}

function findGrokScrollContainer() {
  const strategies = [
    () => document.querySelector('.w-full.h-full.overflow-y-auto.overflow-x-hidden'),
    () => document.querySelector('[class*="overflow-y-auto"][class*="scrollbar-gutter"]'),
    () => {
      const firstTurn = document.querySelector('div[id^="response-"]');
      return firstTurn ? findScrollableAncestor(firstTurn) : null;
    },
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result;
  }
  return null;
}
