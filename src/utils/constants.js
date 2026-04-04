// =============================================================================
// Chat Archive — Constants & Shared Utilities
// =============================================================================

// --- Execution Limits (Anti-Runaway Circuit Breakers) ---
const SAFETY_LIMITS = {
  MAX_TURNS: 500,
  MAX_SCROLL_ITERATIONS: 100,
  MAX_EXTRACTION_TIME_MS: 120_000,      // Raised from 60s — long conversations are a primary use case
  MAX_CLIPBOARD_WAIT_MS: 2_000,
  MAX_SINGLE_TURN_SIZE: 100_000,
  SCROLL_STABILITY_THRESHOLD: 3,
  CLIPBOARD_READ_DELAY_MS: 100,         // Reduced from 175ms — saves ~4.5s on a 60-turn conversation
  SCROLL_STEP_DELAY_MS: 150,            // Reduced from 300ms — halves scroll phase duration
  HOVER_SETTLE_MS: 50,
};

const SCHEMA_VERSION = '1.0';
const EXTENSION_VERSION = '0.2.2';     // Bumped from 0.2.1

// --- Platform Detection ---
function detectPlatform() {
  const host = window.location.hostname;
  const path = window.location.pathname;

  if (host === 'claude.ai') return 'claude';
  if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt';
  if (host === 'gemini.google.com') return 'gemini';
  if (host === 'grok.com') return 'grok';
  if (host === 'x.com' && path.startsWith('/i/grok')) return 'grok-x';
  return null;
}

function platformToDisplayName(platform) {
  const names = {
    claude: 'claude.ai',
    chatgpt: 'chatgpt.com',
    gemini: 'gemini.google.com',
    grok: 'grok.com',
    'grok-x': 'x.com/i/grok',
  };
  return names[platform] || platform;
}

// --- Shared DOM Utilities ---

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test if clipboard read access is available.
 * Some browsers block navigator.clipboard.readText() in extension contexts.
 */
async function testClipboardAccess() {
  try {
    await navigator.clipboard.readText();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fuzzy button finder — resilient to selector changes.
 * Searches by aria-label, title, data-testid, and tooltip text.
 */
function findActionButton(container, intent) {
  // intent: 'copy', 'edit', 'copy text', 'copy prompt', etc.
  const intents = Array.isArray(intent) ? intent : [intent];

  for (const label of intents) {
    const strategies = [
      // Strategy 1: exact aria-label (most stable — user-facing)
      () => container.querySelector(`button[aria-label="${label}"]`),
      // Strategy 2: case-insensitive aria-label contains
      () => container.querySelector(`button[aria-label*="${label}" i]`),
      // Strategy 3: data-testid containing intent
      () => container.querySelector(`button[data-testid*="${label.toLowerCase().replace(/\s+/g, '-')}"]`),
      // Strategy 4: title attribute
      () => container.querySelector(`button[title*="${label}" i]`),
      // Strategy 5: mattooltip (Angular Material)
      () => container.querySelector(`button[mattooltip*="${label}" i]`),
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result) return result;
      } catch {
        // Selector syntax error — skip
      }
    }
  }
  return null;
}

/**
 * Click a copy button and read the resulting clipboard content.
 * Returns the clipboard text, or null on failure.
 */
async function clickCopyAndRead(button) {
  if (!button) return null;

  try {
    // Snapshot current clipboard to detect change
    let previous = '';
    try {
      previous = await navigator.clipboard.readText();
    } catch {
      // Clipboard empty or inaccessible — ok, we'll still try
    }

    button.click();
    await wait(SAFETY_LIMITS.CLIPBOARD_READ_DELAY_MS);

    const content = await navigator.clipboard.readText();

    // Verify we got something (and ideally something different)
    if (content && content.length > 0) {
      return content;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scroll a container to load all lazy-loaded content.
 * Returns the number of scroll iterations performed.
 */
async function scrollToLoadAll(scrollContainer, countSelector, startTime) {
  let previousCount = 0;
  let stableIterations = 0;
  let scrollIterations = 0;

  scrollContainer.scrollTop = 0;
  await wait(500);

  while (
    stableIterations < SAFETY_LIMITS.SCROLL_STABILITY_THRESHOLD &&
    scrollIterations < SAFETY_LIMITS.MAX_SCROLL_ITERATIONS
  ) {
    if (startTime && Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) break;

    const currentElements = document.querySelectorAll(countSelector);
    if (currentElements.length === previousCount) {
      stableIterations++;
    } else {
      stableIterations = 0;
      previousCount = currentElements.length;
    }

    scrollContainer.scrollBy(0, scrollContainer.clientHeight * 0.8);
    await wait(SAFETY_LIMITS.SCROLL_STEP_DELAY_MS);
    scrollIterations++;
  }

  // Scroll back to top for clean state
  scrollContainer.scrollTop = 0;
  await wait(200);

  console.log(`[Chat Archive] Scroll complete: ${previousCount} elements after ${scrollIterations} scrolls`);
  return scrollIterations;
}

/**
 * Find the scrollable ancestor of a given element.
 */
function findScrollableAncestor(element) {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Flag a turn for size if needed, mutates the turn object.
 */
function flagIfOversized(turn) {
  if (turn.content && turn.content.length > SAFETY_LIMITS.MAX_SINGLE_TURN_SIZE) {
    turn.flagged = true;
    turn.flagReason = 'Content exceeds 100KB';
  }
  return turn;
}