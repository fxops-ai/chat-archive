// =============================================================================
// Chat Archive — ChatGPT Extractor (Pass 0 + Direct Text Fallback)
// =============================================================================
// Architecture: Appendix E
// Turn container: article[data-testid="conversation-turn-{N}"] — one per turn (flat)
// Copy button: button[data-testid="copy-turn-action-button"] on both roles
// Role signals: data-turn="user"|"assistant" on <article> (0.99)
//               data-message-author-role="user"|"assistant" (0.99)

async function extractChatGPTConversation() {
  const startTime = Date.now();
  const turns = [];
  const errors = [];

  // 1. Find scroll container
  const scrollContainer = findChatGPTScrollContainer();
  if (!scrollContainer) {
    return { turns: [], errors: ['Scroll container not found'], partial: true };
  }

  // 2. Load all turns
  await scrollToLoadAll(
    scrollContainer,
    'article[data-testid^="conversation-turn-"]',
    startTime
  );

  // 3. Get all articles
  const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
  console.log(`[Chat Archive] ChatGPT: Found ${articles.length} turn articles`);

  if (articles.length === 0) {
    return { turns: [], errors: ['No turn articles found'], partial: true };
  }

  // 4. Clipboard test
  const hasClipboard = await testClipboardAccess();
  console.log(`[Chat Archive] ChatGPT: Clipboard access: ${hasClipboard}`);

  // 5. Extract each article
  for (let i = 0; i < articles.length; i++) {
    if (Date.now() - startTime > SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS) {
      errors.push(`Extraction timed out after ${SAFETY_LIMITS.MAX_EXTRACTION_TIME_MS}ms`);
      break;
    }
    if (turns.length >= SAFETY_LIMITS.MAX_TURNS) {
      errors.push(`Hit maximum turn limit (${SAFETY_LIMITS.MAX_TURNS})`);
      break;
    }

    const article = articles[i];

    try {
      article.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(150);

      const turn = await extractChatGPTTurn(article, hasClipboard);
      if (turn) turns.push(flagIfOversized(turn));
    } catch (err) {
      errors.push(`Error extracting turn ${i}: ${err.message}`);
      console.warn(`[Chat Archive] ChatGPT: Error on turn ${i}:`, err);
    }
  }

  console.log(`[Chat Archive] ChatGPT: Extracted ${turns.length} turns, ${errors.length} errors`);
  return { turns, errors, partial: errors.length > 0 };
}

async function extractChatGPTTurn(article, hasClipboard) {
  // --- Role detection (multiple high-confidence signals) ---
  let role = article.getAttribute('data-turn'); // 'user' or 'assistant'

  if (!role) {
    // Fallback: data-message-author-role
    const msgDiv = article.querySelector('[data-message-author-role]');
    role = msgDiv?.getAttribute('data-message-author-role');
  }

  if (!role) {
    // Fallback: screen reader heading
    const h5 = article.querySelector('h5.sr-only');
    const h6 = article.querySelector('h6.sr-only');
    if (h5 && h5.textContent?.includes('You said')) role = 'user';
    else if (h6 && h6.textContent?.includes('ChatGPT said')) role = 'assistant';
  }

  if (role !== 'user' && role !== 'assistant') return null;

  // --- Turn metadata ---
  const testId = article.getAttribute('data-testid') || '';
  const turnNumber = parseInt(testId.replace('conversation-turn-', '')) || 0;
  const turnId = article.getAttribute('data-turn-id') || '';
  const msgDiv = article.querySelector('[data-message-author-role]');
  const modelSlug = msgDiv?.getAttribute('data-message-model-slug') || undefined;

  // --- Pass 0: Clipboard extraction ---
  let content = null;
  let extractionMethod = 'direct';

  if (hasClipboard) {
    try {
      const copyBtn = article.querySelector('button[data-testid="copy-turn-action-button"]');
      if (!copyBtn) {
        // Fuzzy fallback
        const fallback = findActionButton(article, ['Copy']);
        if (fallback) {
          const clipContent = await clickCopyAndRead(fallback);
          if (clipContent && clipContent.trim().length > 0) {
            content = clipContent;
            extractionMethod = 'clipboard';
          }
        }
      } else {
        const clipContent = await clickCopyAndRead(copyBtn);
        if (clipContent && clipContent.trim().length > 0) {
          content = clipContent;
          extractionMethod = 'clipboard';
        }
      }
    } catch (err) {
      console.warn(`[Chat Archive] ChatGPT: Clipboard failed for turn ${turnNumber}:`, err);
    }
  }

  // --- Fallback: Direct text ---
  if (!content) {
    content = extractChatGPTDirectText(article, role);
    extractionMethod = 'direct';
  }

  if (!content || content.trim().length === 0) return null;

  return {
    role,
    content: content.trim(),
    turnNumber,
    turnId,
    modelSlug,
    extractionMethod,
    confidence: 0.99, // data-turn attribute is extremely reliable
    classificationSource: 'structural',
  };
}

function extractChatGPTDirectText(article, role) {
  if (role === 'user') {
    const el = article.querySelector('.whitespace-pre-wrap');
    return el?.textContent?.trim() || '';
  } else {
    // Try .markdown.prose first, then broader selectors
    const markdown = article.querySelector('.markdown.prose');
    if (markdown) return markdown.textContent?.trim() || '';

    const markdownNew = article.querySelector('.markdown');
    if (markdownNew) return markdownNew.textContent?.trim() || '';

    // Last resort: grab all text from the message div
    const msgDiv = article.querySelector('[data-message-author-role="assistant"]');
    return msgDiv?.textContent?.trim() || '';
  }
}

function findChatGPTScrollContainer() {
  const strategies = [
    () => document.querySelector('[data-scroll-root]'),
    () => {
      const firstArticle = document.querySelector('article[data-testid^="conversation-turn-"]');
      return firstArticle ? findScrollableAncestor(firstArticle) : null;
    },
    () => document.querySelector('main [class*="overflow-y-auto"]'),
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result;
  }
  return null;
}
