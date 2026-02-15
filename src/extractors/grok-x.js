// =============================================================================
// Chat Archive — Grok x.com Extractor (Pass 0 + Direct Text Fallback)
// =============================================================================
// Architecture: Appendix B
// CRITICAL: x.com/i/grok has ZERO common selectors with grok.com
// Framework: React Native Web (hashed classes: css-175oi2r, r-*)
// Copy button: aria-label="Copy text" on ASSISTANT only
// User turns: NO copy button — must use direct text extraction
// Role signals: follow_ups_list presence (assistant), button presence

async function extractGrokXConversation() {
  const startTime = Date.now();
  const turns = [];
  const errors = [];

  // 1. Find scroll container — no reliable selector, walk up from content
  const scrollContainer = findGrokXScrollContainer();
  if (!scrollContainer) {
    return { turns: [], errors: ['Scroll container not found'], partial: true };
  }

  // 2. Scroll to load all content
  // x.com Grok doesn't have clean turn containers — we need to identify turn boundaries
  await scrollToLoadAllGrokX(scrollContainer, startTime);

  // 3. Identify turn blocks
  // x.com Grok uses flat sibling divs without per-turn IDs.
  // Strategy: find all "Copy text" buttons (assistant markers) and work outward
  const turnBlocks = identifyGrokXTurnBlocks();
  console.log(`[Chat Archive] Grok-X: Identified ${turnBlocks.length} turn blocks`);

  if (turnBlocks.length === 0) {
    return { turns: [], errors: ['No turn blocks identified'], partial: true };
  }

  // 4. Clipboard test
  const hasClipboard = await testClipboardAccess();
  console.log(`[Chat Archive] Grok-X: Clipboard access: ${hasClipboard}`);

  // 5. Extract each turn
  for (let i = 0; i < turnBlocks.length; i++) {
    if (Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) {
      errors.push(`Extraction timed out`);
      break;
    }
    if (turns.length >= SAFETY_LIMITS.MAX_TURNS) {
      errors.push(`Hit maximum turn limit`);
      break;
    }

    const block = turnBlocks[i];

    try {
      block.element.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(150);

      const turn = await extractGrokXTurn(block, hasClipboard);
      if (turn) turns.push(flagIfOversized(turn));
    } catch (err) {
      errors.push(`Error on block ${i}: ${err.message}`);
      console.warn(`[Chat Archive] Grok-X: Error on block ${i}:`, err);
    }
  }

  console.log(`[Chat Archive] Grok-X: Extracted ${turns.length} turns, ${errors.length} errors`);
  return { turns, errors, partial: errors.length > 0 };
}

/**
 * Identify turn blocks in x.com/i/grok's flat DOM structure.
 * Strategy: 
 *   - Assistant turns have "Copy text" buttons and/or follow_ups_list
 *   - User turns are the blocks between assistant turns that have no action buttons
 */
function identifyGrokXTurnBlocks() {
  const blocks = [];

  // Find all major content containers in the chat area
  // x.com uses deeply nested divs with hashed classes
  // Best approach: find all "Copy text" buttons and their ancestor containers
  const copyButtons = document.querySelectorAll('button[aria-label="Copy text"]');
  const followUps = document.querySelectorAll('[data-testid="follow_ups_list"]');

  // Build a set of assistant container elements
  const assistantContainers = new Set();
  const assistantElements = [];

  for (const btn of copyButtons) {
    // Walk up to find the turn-level container
    // Typically: button → action bar → content block → turn container
    let container = btn.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      // Heuristic: turn containers tend to be direct children of the main scroll area
      if (container.parentElement &&
          container.parentElement.children.length > 2 &&
          container.previousElementSibling) {
        break;
      }
      container = container.parentElement;
    }
    if (container && !assistantContainers.has(container)) {
      assistantContainers.add(container);
      assistantElements.push({ element: container, role: 'assistant', copyButton: btn });
    }
  }

  // If we found assistant containers, their siblings before each are likely user turns
  if (assistantElements.length > 0) {
    // Get the parent that holds all turn siblings
    const parent = assistantElements[0].element.parentElement;
    if (!parent) return assistantElements;

    const children = Array.from(parent.children);
    let lastAssistantIdx = -1;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];

      if (assistantContainers.has(child)) {
        // Everything between lastAssistantIdx and this is user content
        // But often there's just one user block before each assistant
        if (i > 0 && i - 1 > lastAssistantIdx) {
          // Check each block between last assistant and this assistant
          for (let j = lastAssistantIdx + 1; j < i; j++) {
            const candidate = children[j];
            const text = candidate.textContent?.trim() || '';
            // Filter out empty blocks, navigation, follow-ups
            if (text.length > 0 &&
                !candidate.querySelector('[data-testid="follow_ups_list"]') &&
                !candidate.querySelector('button[aria-label="Copy text"]') &&
                !candidate.querySelector('textarea')) {
              blocks.push({ element: candidate, role: 'user', copyButton: null });
            }
          }
        }
        blocks.push(assistantContainers.has(child)
          ? assistantElements.find((a) => a.element === child) || { element: child, role: 'assistant', copyButton: null }
          : { element: child, role: 'assistant', copyButton: null });
        lastAssistantIdx = i;
      }
    }

    return blocks;
  }

  // Fallback: no assistant markers found — try raw text extraction with heuristics
  return [];
}

async function extractGrokXTurn(block, hasClipboard) {
  const { element, role, copyButton } = block;

  let content = null;
  let extractionMethod = 'direct';

  // --- Pass 0: Clipboard (assistant only on x.com) ---
  if (role === 'assistant' && hasClipboard && copyButton) {
    try {
      const clipContent = await clickCopyAndRead(copyButton);
      if (clipContent && clipContent.trim().length > 0) {
        content = clipContent;
        extractionMethod = 'clipboard';
      }
    } catch (err) {
      console.warn(`[Chat Archive] Grok-X: Assistant clipboard failed:`, err);
    }
  }

  // --- Direct text extraction ---
  if (!content) {
    content = extractGrokXDirectText(element, role);
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  return {
    role,
    content: content.trim(),
    extractionMethod,
    confidence: role === 'assistant' ? 0.95 : 0.80,
    classificationSource: 'structural',
  };
}

function extractGrokXDirectText(element, role) {
  // Clone and strip non-content elements
  const clone = element.cloneNode(true);

  // Remove follow-up suggestions, buttons, textareas
  clone.querySelectorAll(
    '[data-testid="follow_ups_list"], button, textarea, svg, [role="img"]'
  ).forEach((el) => el.remove());

  // For user turns, look for the specific text container class
  if (role === 'user') {
    // x.com Grok user text containers have class r-1kt6imw
    const userText = element.querySelector('[class*="r-1kt6imw"]');
    if (userText) return userText.textContent?.trim() || '';
  }

  // For assistant turns, look for formatted content
  if (role === 'assistant') {
    const assistantText = element.querySelector('[class*="r-rjixqe"]');
    if (assistantText) return assistantText.textContent?.trim() || '';
  }

  return clone.textContent?.trim() || '';
}

async function scrollToLoadAllGrokX(scrollContainer, startTime) {
  let previousHeight = 0;
  let stableIterations = 0;
  let scrollIterations = 0;

  scrollContainer.scrollTop = 0;
  await wait(500);

  while (
    stableIterations < SAFETY_LIMITS.SCROLL_STABILITY_THRESHOLD &&
    scrollIterations < SAFETY_LIMITS.MAX_SCROLL_ITERATIONS
  ) {
    if (startTime && Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) break;

    const currentHeight = scrollContainer.scrollHeight;
    if (currentHeight === previousHeight) {
      stableIterations++;
    } else {
      stableIterations = 0;
      previousHeight = currentHeight;
    }

    scrollContainer.scrollBy(0, scrollContainer.clientHeight * 0.8);
    await wait(SAFETY_LIMITS.SCROLL_STEP_DELAY_MS);
    scrollIterations++;
  }

  scrollContainer.scrollTop = 0;
  await wait(200);
}

function findGrokXScrollContainer() {
  const strategies = [
    // x.com's Grok chat area
    () => {
      const grokSection = document.querySelector('[data-testid="GrokChat"]');
      if (grokSection) {
        const scrollable = grokSection.querySelector('[class*="overflow-y-auto"]')
          || grokSection.querySelector('[style*="overflow"]');
        if (scrollable) return scrollable;
        return findScrollableAncestor(grokSection);
      }
      return null;
    },
    // Generic: find scrollable ancestor of first copy button
    () => {
      const firstBtn = document.querySelector('button[aria-label="Copy text"]');
      return firstBtn ? findScrollableAncestor(firstBtn) : null;
    },
    // Broadest: main scrollable area on x.com
    () => document.querySelector('main [class*="overflow"][class*="auto"]'),
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result;
  }
  return null;
}
