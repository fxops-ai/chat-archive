// =============================================================================
// Chat Archive — Constants & Types
// =============================================================================

// --- Execution Limits (Anti-Runaway Circuit Breakers) ---
const SAFETY_LIMITS = {
  MAX_TURNS: 500,
  MAX_SCROLL_ITERATIONS: 100,
  MAX_EXTRACTION_TIME_MS: 60_000,
  MAX_CLIPBOARD_WAIT_MS: 2_000,
  MAX_SINGLE_TURN_SIZE: 100_000,
  SCROLL_STABILITY_THRESHOLD: 3,
};

// --- Schema & Version ---
const SCHEMA_VERSION = '1.0';
const EXTENSION_VERSION = '0.2.1';

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
