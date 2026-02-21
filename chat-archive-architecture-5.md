# Chat Archive Extension — Architecture Specification v1

## Project Summary

A Chrome browser extension that exports chat conversations from AI platforms (Claude.ai, ChatGPT, Grok, Gemini) into durable, human- and machine-readable formats (JSON, Markdown). Uses a two-pass classification system — structural heuristics first, with a small in-browser ML model (Transformers.js) as fallback — to identify user and assistant turns without relying on hardcoded CSS selectors.

---

## Problem Statement

AI chat platforms manage **conversation state** — the live, ephemeral exchange between user and assistant. They do not provide tools to transition conversations into **archive state** — durable, addressable artifacts that exist outside the platform and serve a purpose beyond the session.

This extension bridges that gap. The technical challenge is that platforms do not expose a stable, documented DOM structure. Hardcoded CSS class selectors break when platforms update their frontend. A classification approach that can *reason about* DOM structure rather than memorize it provides resilience against these changes. The product challenge is transforming platform-controlled content into user-controlled files with clear destinations: folders, repos, knowledge bases, future prompts.

---

## Design Principles

1. **Archive over conversation** — we operate in archive state, not conversation state. The product exists at the boundary where an ephemeral conversation becomes a durable, addressable artifact with a destination
2. **Durable output** — JSON as canonical format, Markdown as human-readable format. Both are addressable: they go somewhere and become part of something else
3. **Heuristics first, ML second** — reserve model inference for genuinely ambiguous cases; structural signals at 0.95+ confidence on all verified platforms make ML a fallback for the unknown
4. **Smallest effective model** — minimize download size, memory, and inference time. A 500KB micro-classifier before a 5MB embedding model before a 17MB transformer. Most users never need any of them
5. **Graceful degradation** — flag uncertainty to the user with clear next steps; partial exports are better than failed exports
6. **Standard browser APIs** — prefer stable, secure platform capabilities over novel dependencies
7. **Zero network, zero telemetry** — conversations never leave the browser. This is a security guarantee, not a feature

---

## Target Platforms (v1)

| Platform | URL Pattern | Notes |
|----------|------------|-------|
| Claude.ai | `claude.ai/chat/*` | Anthropic |
| ChatGPT | `chat.openai.com/*`, `chatgpt.com/*` | OpenAI |
| Gemini | `gemini.google.com/*` | Google |
| Grok | `x.com/i/grok*`, `grok.com/*` | xAI |

### Platform Stance: Desktop Only

Chat Archive is a desktop product. This is not a limitation — it is a deliberate design decision rooted in the distinction between **conversation state** and **archive state**.

**Conversation state** is the activity. It happens wherever you are — desktop, phone, tablet. You ask a question, you get an answer, you follow up. The platform manages this state: it's ephemeral, session-bound, and lives inside the platform's UI. Mobile is a natural home for conversation state.

**Archive state** is the artifact. It has a *destination* — a folder, a repo, a knowledge base, a future prompt. Archiving is the act of extracting a conversation from the platform's control and giving it a purpose beyond the session. Archive-state artifacts are *addressable*: a JSON file becomes input to a script, a Markdown file becomes a page in a wiki, a conversation log becomes training data or legal documentation. Addressability requires a filesystem. Filesystems live on desktops.

This distinction drives two design decisions:

**1. The export formats are desktop artifacts.** JSON and Markdown are not just "readable" — they are addressable. They go somewhere and become part of something else. On mobile, a downloaded JSON file lands in a share sheet or a file manager with no clear next step. The user would do more work to make the export useful than they saved by exporting. The archive has no destination on mobile.

**2. The conversations worth archiving are desktop conversations.** Long, substantive AI conversations — the ones users want to preserve — are a desktop activity. Quick mobile queries are ephemeral by nature; they live and die in conversation state. The people who care about durable conversation archives are the same people who have opinions about file organization. They are working at desks, in archive state.

### Browser Compatibility

| Browser | Engine | Works? | Distribution | Notes |
|---------|--------|--------|-------------|-------|
| **Chrome** | Chromium | ✅ Primary target | Chrome Web Store | Native Manifest V3 |
| **Edge** | Chromium | ✅ Works as-is | Chrome Web Store or Edge Add-ons | Zero additional effort |
| **Brave** | Chromium | ✅ Works as-is | Chrome Web Store | Zero additional effort |
| **Opera** | Chromium | ✅ Works as-is | Chrome Web Store | Zero additional effort |
| **Vivaldi** | Chromium | ✅ Works as-is | Chrome Web Store | Zero additional effort |
| **Arc** | Chromium | ✅ Works as-is | Chrome Web Store | Zero additional effort |
| **Firefox** | Gecko | ⚠️ Minor porting | Firefox Add-ons | v1.1 — namespace polyfill, separate submission |
| **Safari (macOS)** | WebKit | ⚠️ Real porting | Mac App Store | Low priority — Mac users can install any Chromium browser |
| **iOS (any browser)** | WebKit | ❌ Not targeted | N/A | Apple requires WebKit; no extension API; mobile file management is impractical for JSON/MD exports |
| **Android Chrome** | Chromium | ❌ Not targeted | N/A | Chrome mobile has no extension support; conversations worth archiving happen at desks |

**Why not mobile?** Chrome on iOS is WebKit under the hood — not real Chromium — and has no extension support. Chrome on Android has no extension support either. Third-party Android browsers (Kiwi, Yandex) technically support Chrome extensions but are niche, and Kiwi is no longer maintained. Even if extensions worked on mobile, the core product promise — "export your conversation to a durable file" — doesn't translate to a platform where file storage is awkward and limited.

**Why not Safari?** A macOS user who wants Chat Archive can install Chrome, Edge, Brave, or any Chromium browser. The Safari Web Extension porting process requires Xcode, an Apple Developer account ($99/year), and App Store review — disproportionate effort for a user base that has a zero-cost alternative. Safari remains a possible future target if demand warrants it.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Chrome Extension                       │
│                                                           │
│  ┌──────────┐    ┌───────────────────────────────────┐   │
│  │  Popup   │    │         Content Script             │   │
│  │   UI     │◄──►│                                    │   │
│  │          │    │  ┌──────────────────────────────┐  │   │
│  │ - Export │    │  │  Pass 0: UI Button Extraction │  │   │
│  │   JSON   │    │  │  (copy/edit button hacks)     │  │   │
│  │ - Export │    │  └──────────┬───────────────────┘  │   │
│  │   MD     │    │             │                       │   │
│  │ - Status │    │      buttons found & working?       │   │
│  │   Panel  │    │        │ YES            │ NO        │   │
│  └──────────┘    │        ▼                ▼           │   │
│                  │  ┌──────────┐  ┌─────────────────┐ │   │
│                  │  │ Content  │  │  DOM Extractor   │ │   │
│                  │  │ via      │  │  (raw element    │ │   │
│                  │  │ clipboard│  │   harvest)       │ │   │
│                  │  └────┬─────┘  └────────┬────────┘ │   │
│                  │       │                  │          │   │
│                  │       │         ┌────────▼────────┐ │   │
│                  │       │         │ Pass 1:         │ │   │
│                  │       │         │ Heuristics      │ │   │
│                  │       │         └────────┬────────┘ │   │
│                  │       │                  │          │   │
│                  │       │         confidence ≥ 0.75?  │   │
│                  │       │          │ YES      │ NO    │   │
│                  │       │          │          ▼       │   │
│                  │       │          │  ┌────────────┐  │   │
│                  │       │          │  │ Pass 2: ML │  │   │
│                  │       │          │  │ (Tfjs)     │  │   │
│                  │       │          │  └─────┬──────┘  │   │
│                  │       │          │        │         │   │
│                  │       ▼          ▼        ▼         │   │
│                  │  ┌──────────────────────────────┐   │   │
│                  │  │   Serializer (JSON / MD)     │   │   │
│                  │  └──────────────┬───────────────┘   │   │
│                  │                 ▼                    │   │
│                  │  ┌──────────────────────────────┐   │   │
│                  │  │   File Writer (Blob + DL API)│   │   │
│                  │  └──────────────────────────────┘   │   │
│                  └───────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Three-Pass Extraction Strategy

The system now uses a **three-pass** approach. Pass 0 is the fastest and most reliable
when available, because it uses the platform's own UI affordances rather than parsing
DOM structure:

| Pass | Method | Speed | Fragility | When Used |
|------|--------|-------|-----------|-----------|
| **0** | UI button hacks (copy/edit) | Medium (sequential, per-turn) | Low-Medium (button labels more stable than class names) | First attempt; platform-aware |
| **1** | Structural heuristics | Fast (single DOM scan) | Medium (pattern-based, no hardcoded selectors) | Fallback when Pass 0 unavailable |
| **2** | ML classification (Tfjs) | Slow (model load + inference) | Low (learns from examples) | Fallback when Pass 1 low-confidence |

---

## Component Specifications

### Component 0: Pass 0 — UI Button Extraction (Platform-Aware)

**Responsibility:** Use each platform's own UI buttons to extract content, bypassing DOM content parsing entirely. This is the highest-fidelity extraction method because it retrieves the same content the platform gives to users via copy/edit.

**Why this is valuable:**
- Platforms format their own content for clipboard — we get clean text/markdown for free
- Button `aria-label` values (e.g., "Copy", "Edit") are user-facing strings that change less frequently than internal class names
- Solves scroll handling simultaneously: we scroll to each turn to find its buttons, which forces lazy-loaded content to render
- Content extracted this way doesn't need role classification per-element — the platform's own turn structure tells us which copy button belongs to which role

**Platform-specific strategies:**

#### Claude.ai — Copy Button ✅ VERIFIED (Feb 2026 ARCHIVETEST)
```
Turn container: div[data-test-render-count] (wraps user+assistant pair)
  Each container holds one user message + one assistant response.

1. Scroll to turn container (div[data-test-render-count])
2. Both user AND assistant turns have Copy buttons:
   button[data-testid="action-bar-copy"][aria-label="Copy"]
3. Buttons hidden with opacity-0 (visible on hover), but .click() works regardless
4. Click Copy button → wait 100-200ms → read navigator.clipboard.readText()
5. Role detection (two independent high-stability signals):
   a. data-testid="user-message" present → user
   b. data-is-streaming attribute present → assistant
   c. Fallback: .font-user-message (user) vs .font-claude-response (assistant)
6. Direct text extraction fallback if clipboard unavailable:
   - User: querySelector('[data-testid="user-message"]').textContent
   - Assistant: querySelector('.font-claude-response .standard-markdown').textContent
7. Timestamp available: span.text-text-500.text-xs (e.g., "12:16 PM")
8. Final message exception: last turn's action buttons are always visible (no opacity-0)
```

#### Gemini — Copy Button (both roles) ✅ VERIFIED (Feb 2026 ARCHIVETEST)
```
Turn container: div.conversation-container[id="{hex_id}"]
  Each container holds one <user-query> + one <model-response>.

1. Scroll to turn container (inside infinite-scroller[data-test-id="chat-history-container"])
2. Both user AND assistant turns have Copy buttons on hover:
   - User: button[aria-label="Copy prompt"] (mattooltip="Copy prompt")
   - Assistant: button[data-test-id="copy-button"][aria-label="Copy"] (mattooltip="Copy response")
3. Buttons hidden via .hide-action-bar class on non-last turns; last turn always visible
4. Click Copy button → wait 100-200ms → read navigator.clipboard.readText()
5. Role detection (multiple high-confidence signals):
   a. <user-query> element present → user (0.99)
   b. <model-response> element present → assistant (0.99)
   c. Copy button aria-label: "Copy prompt" (user) vs "Copy" (assistant)
6. Direct text extraction fallback:
   - User: querySelector('.query-text-line').textContent
   - Assistant: querySelector('.markdown.markdown-main-panel').textContent
7. Turn IDs: container id attribute (hex, e.g., "1e26591aea84bcf0")
8. Edit button: only on LAST user turn (data-test-id="prompt-edit-button")
   NOTE: Edit-button hack from architecture v0 is now OPTIONAL — Copy button
   on both roles makes it unnecessary for content extraction.
```

#### ChatGPT — Copy Button (both roles) ✅ VERIFIED (Feb 2026 ARCHIVETEST, free tier, GPT-5.2)
```
Turn container: article[data-testid="conversation-turn-{N}"]
  Each article is one turn (NOT paired like Claude).
  Flat sibling structure: user article, assistant article, user article, ...

1. Scroll to turn container (article[data-turn-id])
2. Both user AND assistant turns have identical Copy buttons:
   button[data-testid="copy-turn-action-button"][aria-label="Copy"]
3. Buttons hidden by default:
   - User: opacity-0 with group-hover reveal
   - Assistant: CSS mask-image gradient trick with group-hover reveal
4. Click Copy button → wait 100-200ms → read navigator.clipboard.readText()
5. Role detection (multiple high-confidence signals):
   a. data-turn="user"|"assistant" on <article> (0.99)
   b. data-message-author-role="user"|"assistant" on content div (0.99)
   c. Screen-reader text: h5 "You said:" (user) vs h6 "ChatGPT said:" (assistant)
6. Direct text extraction fallback:
   - User: querySelector('.whitespace-pre-wrap').textContent
   - Assistant: querySelector('.markdown.prose').textContent
7. Turn ordering: data-testid="conversation-turn-{N}" (1-indexed, sequential)
8. Unique turn IDs: data-turn-id (UUID for user, "request-WEB:{session}-{N}" for assistant)
9. Model info: data-message-model-slug="gpt-5-2" on assistant messages
```

#### Grok — Copy Button (both roles) + Alignment-Based Role Detection
```
1. Scroll to turn container (div[id^="response-"])
2. Both user AND assistant turns have Copy buttons (aria-label="Copy")
3. Buttons are hidden by default (opacity-0), but .click() works without hover
4. Click Copy button → wait 100-200ms → read navigator.clipboard.readText()
5. Role detection (three independent signals, all high-confidence):
   a. Container alignment: items-end = user, items-start = assistant
   b. Button count: user has 2 (Edit + Copy), assistant has 8+ (Regenerate, Read Aloud, etc.)
   c. Message bubble styling: user has bg-surface-l1 + border, assistant has w-full max-w-none
6. Unique turn IDs: id="response-{uuid}" — excellent for dedup and ordering
7. Exclude: follow-up suggestion buttons on last assistant turn
```

**Button discovery strategy (resilient to selector changes):**

Rather than hardcoding exact button selectors, use a **fuzzy button finder:**

```typescript
function findActionButton(container: Element, intent: 'copy' | 'edit'): HTMLElement | null {
  const strategies = [
    // Strategy 1: aria-label (most stable — user-facing)
    () => container.querySelector(`button[aria-label*="${intent}" i]`),
    // Strategy 2: title attribute
    () => container.querySelector(`button[title*="${intent}" i]`),
    // Strategy 3: data-testid containing intent
    () => container.querySelector(`button[data-testid*="${intent}"]`),
    // Strategy 4: button with SVG icon matching known paths
    () => findButtonBySVGIcon(container, intent),
    // Strategy 5: tooltip text (some platforms use span inside button)
    () => findButtonByTooltipText(container, intent),
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result) return result as HTMLElement;
  }
  return null;
}
```

**Scroll handling (integrated with Pass 0):**

Pass 0 naturally solves the scroll/lazy-loading problem because it must visit each turn sequentially:

```typescript
async function scrollAndExtract(chatContainer: Element): Promise<ExtractedTurn[]> {
  const turns: ExtractedTurn[] = [];

  // Phase 1: Scroll to top to ensure we start at the beginning
  chatContainer.scrollTop = 0;
  await wait(500);

  // Phase 2: Incrementally scroll down, extracting as we go
  let previousTurnCount = 0;
  let stableCount = 0;

  while (stableCount < 3) { // Stop after 3 scrolls with no new content
    const visibleTurns = getTurnContainers(chatContainer);

    for (const turn of visibleTurns) {
      if (turns.some(t => t.elementRef === turn)) continue; // already extracted

      // Scroll this specific turn into full view
      turn.scrollIntoView({ behavior: 'instant', block: 'center' });
      await wait(200); // let lazy content render

      // Attempt button extraction
      const content = await tryButtonExtraction(turn);
      if (content) {
        turns.push(content);
      } else {
        // Mark for Pass 1/2 fallback
        turns.push({ elementRef: turn, content: null, needsFallback: true });
      }
    }

    // Scroll down to trigger loading of more content
    chatContainer.scrollBy(0, chatContainer.clientHeight * 0.8);
    await wait(300);

    if (visibleTurns.length === previousTurnCount) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    previousTurnCount = visibleTurns.length;
  }

  // Phase 3: Gemini-style reverse scroll (catch anything loaded above)
  chatContainer.scrollTop = 0;
  await wait(500);
  // ... re-check for any turns we missed

  return turns;
}
```

**Key insight about role classification in Pass 0:**
When using copy/edit buttons, role determination is often a *byproduct* of the extraction:
- On Claude: only assistant turns have copy buttons; user turns are the ones without
- On Gemini: the `ms-chat-turn` component has role attribution baked in
- On ChatGPT: `data-message-author-role` is on the turn container, read before clicking copy

This means **Pass 0 often eliminates the need for Pass 1 and Pass 2 entirely** for role classification. The heuristic and ML passes become fallback for platforms where buttons are missing or for individual turns where button extraction fails.

**Pass 0 failure conditions (trigger fallback to Pass 1):**
- No recognizable copy/edit buttons found on any turn
- Clipboard API blocked or unavailable
- Platform has redesigned button placement completely
- Buttons found but click produces no content

---

### Component 1: DOM Extractor

**Responsibility:** Harvest raw DOM elements from the chat viewport without classifying them.

**Approach:**
- Identify the scrollable chat container (largest scrollable element with repeated child structure)
- Extract all direct children (candidate turn containers)
- For each candidate, capture:
  - `outerHTML` (trimmed to first 500 chars for classification)
  - `innerText` (full text content)
  - Computed styles: background-color, margin/padding pattern, text-align
  - DOM depth relative to container
  - Sibling index (position in sequence)
  - Any `data-*` attributes, `role` attributes, `aria-*` attributes
  - Class names (as raw strings, not for matching — for feature input)

**Output:** Array of `CandidateElement` objects

```typescript
interface CandidateElement {
  index: number;
  outerHTMLPreview: string;     // first 500 chars
  innerText: string;            // full text
  computedStyles: StyleSignature;
  attributes: Record<string, string>;
  classNames: string[];
  depth: number;
  childCount: number;
  hasCodeBlocks: boolean;       // presence of <pre> or <code>
  textLength: number;
}
```

---

### Component 2: Pass 1 — Structural Heuristics

**Responsibility:** Classify candidate elements using rule-based pattern detection. Fast, no dependencies.

**Heuristic Rules (ordered by confidence):**

| Rule | Signal | Confidence |
|------|--------|------------|
| H1 | Explicit `data-role`, `data-message-author`, or `aria-label` containing "user"/"assistant"/"human"/"ai" | 0.95 |
| H2 | Alternating binary pattern: two distinct structural signatures repeating ABABAB | 0.85 |
| H3 | Asymmetric text length: short turns (user) alternating with long turns (assistant) | 0.70 |
| H4 | Background color differentiation: two alternating background colors | 0.75 |
| H5 | Alignment pattern: right-aligned (user) vs left-aligned (assistant) | 0.80 |
| H6 | Avatar/icon presence on alternating sides | 0.70 |
| H7 | Code block density: elements with `<pre>/<code>` are likely assistant | 0.60 |

**Ensemble logic:**
- Each rule that fires contributes its confidence score
- Combined confidence = weighted average of all firing rules
- **Threshold: 0.75** — if combined confidence ≥ 0.75, accept classification
- Below threshold → flag for Pass 2

**Output per element:**

```typescript
interface HeuristicResult {
  index: number;
  classification: 'user' | 'assistant' | 'system' | 'unknown';
  confidence: number;
  rulesApplied: string[];       // which heuristics fired
  needsMLPass: boolean;         // confidence < threshold
}
```

---

### Component 3: Pass 2 — ML Classification (Deferred to v1.1+)

**Responsibility:** Classify elements that Pass 1 couldn't resolve with sufficient confidence.

**v1 Decision: Defer ML, ship with Pass 0 + Pass 1 + User Resolution UI only.**

Our verified ARCHIVETEST DOM analysis shows that all 5 platform extraction paths provide role detection signals at 0.95+ confidence from structural selectors alone. The ML pass exists for a scenario that is rare on known platforms. It becomes valuable only if: (a) a platform redesigns so radically that all selectors break simultaneously, or (b) the extension expands to platforms we haven't analyzed.

**When ML is added (v1.1+), the model strategy is tiered:**

| Option | Size | When to use |
|--------|------|-------------|
| **Micro-classifier (logistic regression, ONNX)** | **<500KB** | v1.1 — purpose-built binary classifier on DOM feature strings. ~50 training examples per platform. |
| **Quantized embedding model (4-bit ONNX)** | **~5MB** | v2 — general-purpose, for platforms we haven't reverse-engineered. `bge-micro-v2` or `gte-tiny` at 4-bit quantization. |
| ~~Full embedding model (fp32)~~ | ~~17MB~~ | ~~Not recommended. 4-bit quantization loses <2-5% accuracy on this trivially simple binary task. No reason to ship fp32.~~ |

**Why not 17MB?** "Is this a user turn or assistant turn?" is a trivially simple classification task. The feature string is structured (`"classes: [markdown, prose], depth: 3, text length: 2847, has code blocks: true"`), not natural language requiring deep understanding. A decision tree or logistic regression achieves 95%+ accuracy on this. A 17MB transformer is over-engineering.

**Loading strategy (when implemented):**
- Model is NOT loaded on extension install
- Model is loaded only when Pass 1 flags elements as uncertain
- **Explicit user consent required:** "Advanced classification requires a ~500KB download. Proceed?"
- Model is cached in extension storage after first load
- **SRI hash pinning:** downloaded file must match SHA-256 hash pinned in extension source
- **Single-origin:** only downloaded from `huggingface.co`, no configurable URLs

**Confidence output:**

```typescript
interface MLResult {
  index: number;
  classification: 'user' | 'assistant' | 'uncertain';
  confidence: number;
  similarityScores: { user: number; assistant: number };
}
```

---

### Component 4: User Resolution UI

**Responsibility:** When classification is uncertain, present the user with clear options.

**Trigger:** Any element where both Pass 1 and Pass 2 return confidence < 0.6.

**UI behavior:**
- Highlight the ambiguous element(s) on the page with a colored overlay
- Show a small floating panel:
  ```
  ┌──────────────────────────────────────────┐
  │  ⚠ Could not classify 3 of 47 messages  │
  │                                           │
  │  Message 12: "Can you explain..."         │
  │  [ User ] [ Assistant ] [ Skip ]          │
  │                                           │
  │  Message 28: "Here is an example..."      │
  │  [ User ] [ Assistant ] [ Skip ]          │
  │                                           │
  │  Message 29: "[system notification]"      │
  │  [ User ] [ Assistant ] [ Skip ]          │
  │                                           │
  │  [ Apply & Export ]  [ Cancel ]           │
  └──────────────────────────────────────────┘
  ```
- "Skip" excludes the element from the export
- User's manual classifications are stored locally and fed back as additional few-shot examples for future exports on the same platform

---

### Component 5: Serializer

**Responsibility:** Transform classified elements into JSON and/or Markdown. Deterministic code, no ML.

**JSON Schema (canonical format):**

```json
{
  "schema_version": "1.0",
  "export_metadata": {
    "source_platform": "claude.ai",
    "source_url": "https://claude.ai/chat/abc-123",
    "export_timestamp": "2026-02-08T14:30:00Z",
    "extension_version": "1.0.0",
    "classification_method": "heuristic|ml|manual",
    "total_turns": 24,
    "flagged_turns": 0
  },
  "conversation": [
    {
      "turn": 1,
      "role": "user",
      "content": "Hello, can you help me with...",
      "classification_confidence": 0.92,
      "classification_source": "heuristic"
    },
    {
      "turn": 2,
      "role": "assistant",
      "content": "Of course! Here's how...",
      "classification_confidence": 0.88,
      "classification_source": "heuristic"
    }
  ]
}
```

**Markdown template:**

```markdown
# Chat Export — Claude.ai
**Exported:** 2026-02-08 14:30 UTC  
**Source:** https://claude.ai/chat/abc-123  
**Turns:** 24

---

## User
Hello, can you help me with...

---

## Assistant
Of course! Here's how...

---
```

**Why this JSON structure:**
- `schema_version` allows future parsers to handle format evolution
- `classification_confidence` and `classification_source` provide provenance — a future model can assess reliability
- `export_metadata` gives context without polluting the conversation data
- Flat turn array (not nested) is simple to parse in any language
- Both formats are **addressable artifacts** — they have destinations beyond the export itself. The JSON becomes input to a script, a database record, a training example. The Markdown becomes a wiki page, a document section, a searchable reference. This is the transition from conversation state to archive state made concrete.

---

### Component 6: File Writer

**Responsibility:** Write the serialized output to the user's device.

**Implementation:** Standard browser APIs only.

```javascript
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true  // let user choose location
  });
}
```

- JSON → `chat-export-{platform}-{date}.json` / `application/json`
- MD → `chat-export-{platform}-{date}.md` / `text/markdown`

No novel dependencies. Uses Chrome's `downloads` API which is stable and well-documented.

---

## src/utils/constants.js — Shared Utilities Module

> **Note added v0.2.1:** Despite its filename, `constants.js` is the **shared utilities
> module** for the entire codebase. It was documented as "Safety limits, platform
> detection" in earlier versions of this spec. That description is incomplete.
> This section documents what the file actually contains.

---

### What it contains

The file has four sections, concatenated in dependency order by `build.sh`:

#### 1. Safety Limits (Circuit Breakers)

```javascript
const SAFETY_LIMITS = {
  MAX_TURNS: 500,
  MAX_SCROLL_ITERATIONS: 100,
  MAX_EXTRACTION_TIME_MS: 60_000,
  MAX_CLIPBOARD_WAIT_MS: 2_000,
  MAX_SINGLE_TURN_SIZE: 100_000,
  SCROLL_STABILITY_THRESHOLD: 3,
  CLIPBOARD_READ_DELAY_MS: 175,
  SCROLL_STEP_DELAY_MS: 300,
  HOVER_SETTLE_MS: 50,
};
```

#### 2. Version & Schema Constants

```javascript
const SCHEMA_VERSION = '1.0';
const EXTENSION_VERSION = '0.2.1';  // Update here + manifest.json on every release
```

**Important:** Version must be updated in TWO places on every release:
- `src/utils/constants.js` → `EXTENSION_VERSION`
- `manifest.json` → `"version"`

Both must match. The footer of every export file references `EXTENSION_VERSION`.

#### 3. Platform Detection

```javascript
function detectPlatform() { ... }       // Maps hostname → platform ID
function platformToDisplayName() { ... } // Maps platform ID → display string
```

#### 4. Shared DOM Utilities

These functions are used by **all five platform extractors**. They live here rather
than in individual extractor files to avoid duplication and ensure consistent behavior:

| Function | Purpose | Used by |
|----------|---------|---------|
| `wait(ms)` | Promise-based delay | All extractors |
| `testClipboardAccess()` | Verify clipboard API available | All extractors |
| `findActionButton(container, intent)` | Fuzzy button finder (aria-label, testid, title, tooltip) | All extractors |
| `clickCopyAndRead(button)` | Click copy button → read clipboard | All extractors |
| `scrollToLoadAll(container, selector, startTime)` | Scroll to trigger lazy loading | Claude, ChatGPT, Gemini, Grok |
| `scrollToLoadAllGrokX(container, startTime)` | Grok-X specific scroll strategy | Grok-X only |
| `findScrollableAncestor(element)` | Walk DOM to find scrollable parent | All extractors |
| `flagIfOversized(turn)` | Mutate turn object if content >100KB | All extractors |

---

### Why it's named constants.js

Historical artifact. The file started as a constants-only file in Phase 1. As Phase 2
added five platform extractors, shared DOM utilities were added here to avoid
duplicating `wait()`, `findActionButton()`, and `scrollToLoadAll()` across every
extractor file. The name was never updated.

**Renaming to `shared.js` or `utils.js`** is tracked as a future cleanup task.
It would require updating `build.sh` (the concatenation order) and any documentation
references. There is no functional impact — the build system doesn't care about
the filename, only the order in which files are concatenated.

---

### Editing guidelines

**When patching this file:**
1. Always `diff` against the existing version before replacing
2. Never replace the entire file from an external source without verifying all
   four sections are present
3. The version bump (`EXTENSION_VERSION`) is the only routine change — do it
   with a targeted `sed` or find-and-replace, not a full file replacement
4. After any change, rebuild and verify `scrollToLoadAll` appears as both a
   definition and multiple call sites in the built `content.js`

**Verification command (Mac/Linux):**
```bash
grep -n "scrollToLoadAll" content.js
# Should show: one function definition + 4-5 call sites
# If only call sites appear with no definition — the file was stripped
```

**Verification command (Windows PowerShell):**
```powershell
Select-String -Path "content.js" -Pattern "scrollToLoadAll"
```

---

### v0.2.1 post-mortem

During the v0.2.1 patch session, `constants.js` was replaced with a minimal version
containing only `SAFETY_LIMITS`, `SCHEMA_VERSION`, `EXTENSION_VERSION`, and
`detectPlatform()`. The shared DOM utilities — including `scrollToLoadAll()` — were
stripped, causing an immediate `scrollToLoadAll is not defined` runtime error on all
platforms except Grok-X.

**Root cause:** The patching session referenced the Phase 1 source documentation
(`chat-archive-phase1-source.md`), which contained an early version of `constants.js`
before shared utilities were added in Phase 2. The live file had grown significantly
beyond what was documented.

**Detection:** The error surfaced during pre-release testing on the Windows machine
before the GitHub Release was published. The Mac Mini had a backup of the working file
(`constants.js.backup`) which was used to restore the missing functions.

**Prevention:** This architecture section, the warning in README, and the verification
commands above. When in doubt — diff first, replace second.

---

## Standardized Test Conversation

To validate across all four platforms, create the following conversation on each:

```
USER:    "ARCHIVETEST: What are the three primary colors?"
ASST:    [response about red, blue, yellow / red, green, blue]
USER:    "ARCHIVETEST: Can you write a short 2-line poem about rain?"
ASST:    [short poem response]
USER:    "ARCHIVETEST: What is 42 * 17?"
ASST:    [714, possibly with explanation]
USER:    "ARCHIVETEST: Summarize the previous conversation in one sentence."
ASST:    [summary response]
```

**Why this specific conversation:**
- `ARCHIVETEST` keyword makes turns easy to locate and verify
- Turn 1: Simple factual Q&A — tests basic classification
- Turn 2: Creative response — tests longer assistant output
- Turn 3: Math — tests short user prompt / medium assistant response
- Turn 4: Meta-reference — tests that context is captured, not just isolated turns
- 4 exchanges = 8 turns, enough to validate alternating pattern detection

**Validation checklist per platform:**
- [ ] All 8 turns captured
- [ ] Roles correctly assigned (no user/assistant swaps)
- [ ] `ARCHIVETEST` keyword present in user turns
- [ ] JSON validates against schema
- [ ] MD renders correctly in a markdown viewer

---

## Extension Manifest & Permissions

```json
{
  "manifest_version": 3,
  "name": "Chat Archive",
  "version": "1.0.0",
  "permissions": [
    "activeTab",
    "downloads",
    "storage"
  ],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://gemini.google.com/*",
    "https://x.com/*",
    "https://grok.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://claude.ai/chat/*",
        "https://chat.openai.com/*",
        "https://chatgpt.com/*",
        "https://gemini.google.com/*",
        "https://x.com/i/grok*",
        "https://grok.com/*"
      ],
      "js": ["content.js"]
    }
  ],
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "web_accessible_resources": [
    {
      "resources": ["models/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

**Permission justification:**
- `activeTab` — access current tab DOM
- `downloads` — write export files
- `storage` — cache model, store user corrections for few-shot refinement
- Host permissions — scoped to the four target platforms only

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Platform DOM changes break heuristics | Medium | High (expected) | User resolution UI fallback; community reports trigger rapid selector updates |
| Platform adds anti-scraping measures | High | Low-Medium | Extension accesses already-rendered DOM (same as user sees); no network requests to platform APIs |
| Long conversations cause memory/hang | Medium | Medium | Hard execution limits (500 turns, 60s timeout); process in chunks; stream to output |
| Grok has two completely different DOMs | Medium | Confirmed | URL-based platform detection; separate extraction strategies; treat as 5 platforms not 4 |
| Clipboard race condition | Low | Low | Validate content matches expected turn; retry once; fall back to direct text extraction |
| Extension update supply chain attack | Critical | Very Low | 2FA on developer account; no auto-deploy; SRI hashes on any downloaded assets |
| Infinite scroll / lazy load runaway | Medium | Low | MAX_SCROLL_ITERATIONS=100 hard cap; stability detection (3 consecutive unchanged counts) |
| Browser differences (Safari vs Chrome) | Low | Low | Core selectors are framework-generated (identical cross-browser); clipboard API behavior may differ (direct text fallback covers this) |

---

## Security Architecture

### Threat Model

The extension operates in a sensitive context — it reads the full content of users' AI conversations. A compromised or misbehaving extension could exfiltrate private conversations, inject misleading content into exports, or degrade browser performance. This section defines the security boundaries, circuit breakers, and cascade failure response plan.

### Core Security Guarantee

**Chat Archive makes zero network requests. Conversations never leave the browser.**

This is the single most important security property. The extension:
- Makes no `fetch`, `XMLHttpRequest`, or `WebSocket` calls
- Has no telemetry, analytics, or crash reporting endpoints
- Has no background service worker that phones home
- Cannot exfiltrate data without first gaining new permissions (which Chrome flags to the user)

Even if the extension code is compromised, the blast radius is limited to: reading what's already visible on the page and writing local files. There is no pathway to send data to an external server without Chrome's permission system alerting the user.

### Permission Minimalism

| Permission | Purpose | Risk Level |
|------------|---------|------------|
| `activeTab` | Access current tab DOM for extraction | **Minimal** — only active tab, only on user action |
| `downloads` | Write export files to user's device | **Low** — write-only, user chooses save location |
| `storage` | Cache user classification corrections | **Low** — never stores conversation content |
| `clipboardRead` | Read clipboard after programmatic copy-button click | **Low** — read-only, scoped to extraction flow |
| Host permissions (4 domains) | Inject content script on chat platforms | **Scoped** — only the 4 target domains |

**Explicitly NOT requested:**
- ❌ `clipboardWrite` — the extension never writes to clipboard
- ❌ `tabs` — no ability to enumerate or manipulate other tabs
- ❌ `webRequest` / `webRequestBlocking` — no ability to intercept network traffic
- ❌ `<all_urls>` — no broad page access
- ❌ `scripting` — no dynamic code injection beyond the declared content scripts
- ❌ `identity` — no OAuth or account access

### Execution Limits (Anti-Runaway Circuit Breakers)

Every extraction operation is bounded by hard limits that cannot be overridden:

```typescript
const SAFETY_LIMITS = {
  MAX_TURNS: 500,              // Hard cap on turns extracted per export
  MAX_SCROLL_ITERATIONS: 100,  // Stop scrolling after 100 attempts
  MAX_EXTRACTION_TIME_MS: 60_000,  // Kill switch: abort after 60 seconds
  MAX_CLIPBOARD_WAIT_MS: 2_000,   // Per-turn clipboard read timeout
  MAX_SINGLE_TURN_SIZE: 100_000,  // Flag turns exceeding 100KB as suspicious
  SCROLL_STABILITY_THRESHOLD: 3,  // Stop after 3 consecutive unchanged turn counts
} as const;
```

**Behavior when limits are hit:**
1. Extraction stops immediately
2. All successfully extracted turns are preserved
3. User sees a clear message: "Extracted {N} of {estimated total} turns. Export is partial due to [reason]."
4. Partial export is still valid JSON/Markdown — never silently truncated or corrupted

### Content Integrity Checks

Before writing the final export file, the serializer validates:

| Check | What it catches |
|-------|----------------|
| Turn alternation pattern | Verify rough user/assistant alternation (with tolerance for system messages, regenerations) |
| No consecutive duplicate content | Clipboard race condition or copy-button malfunction |
| No suspiciously large turns | Single turn >100KB flagged in export metadata |
| Schema validation | JSON output validates against schema before write |
| Turn count sanity | Export metadata includes `total_turns` and `flagged_turns` counts |

These are **sanity checks, not security enforcement** — they catch "something went subtly wrong" before the user trusts a corrupted export.

### Storage Policy

The `storage` permission is used exclusively for:
- User classification corrections (fed back as few-shot examples)
- Extension settings (export format preference, etc.)

**Never stored:**
- ❌ Conversation content
- ❌ User messages or assistant responses
- ❌ URLs of visited conversations
- ❌ Timestamps of export activity
- ❌ Any personally identifiable information

### ML Model Security (Future — v1.1+)

If a classification model is added in a future version:

**Subresource Integrity (SRI):**
The exact SHA-256 hash of the model file is pinned in the extension source code. If the downloaded file does not match the hash, the extension refuses to load it and falls back to User Resolution UI. This prevents supply chain attacks, CDN corruption, and MITM attacks.

```typescript
const MODEL_INTEGRITY = {
  url: 'https://huggingface.co/chat-archive/classifier-v1/resolve/main/model.onnx',
  sha256: 'a1b2c3d4...',  // Pinned at build time, updated only via extension update
  sizeBytes: 512_000,      // Expected size — reject if significantly different
} as const;
```

**Single-origin hosting:**
The model is only downloaded from `huggingface.co`. No user-configurable model URLs. No fallback CDNs.

**Explicit user consent:**
The model is never auto-downloaded. The user sees a dialog:
> "Advanced classification requires a ~500KB download from huggingface.co. This is a one-time download. Proceed?"

**No model execution on untrusted input:**
The model only processes DOM feature strings constructed by the extension itself — never raw user input or raw page content. The feature string is a controlled format: class names, numeric measurements, boolean flags.

### Distribution & Access Control

**v1 distribution strategy:**

The extension is published on the Chrome Web Store. The ML model (if added) lives on a public Hugging Face repository. There is no hard gating on model access — instead, the model download is opt-in and not prominently advertised.

- **Pavilion Slack** and **FractionalsUnited Slack** communities receive documentation on enabling advanced classification
- **Hugging Face validated accounts** can access the model repo directly
- **General public** uses Pass 0 + Pass 1 + User Resolution UI, which handles 99%+ of cases

If model hosting costs become a concern, graduate to a Cloudflare Worker proxy with token-based access and per-community rate limits. See the Model Access Escalation Plan below.

**Model access escalation plan:**

| Trigger | Action |
|---------|--------|
| <1,000 model downloads/month | No gating needed. Public HF repo. |
| 1,000-10,000 downloads/month | Add Cloudflare Worker proxy with rate limiting (100 downloads/IP/day) |
| >10,000 downloads/month or abuse detected | Require authentication: Slack community invite codes or HF OAuth token |
| Supply chain concern (compromised repo) | SRI check blocks loading automatically; update pinned hash in next extension release |

### Update Channel Trust

| Control | Implementation |
|---------|---------------|
| Developer account security | 2FA enabled, recovery codes stored offline |
| Publishing pipeline | Manual review step for every Chrome Web Store submission; no auto-deploy from CI |
| Version tracking | Every export file includes `extension_version` in metadata; users can correlate exports with specific builds |
| Private distribution (Slack .crx) | Signed with developer key; SHA-256 hash shared alongside download link; users verify before installing |

### Incident Response Plan

| Severity | Signal | Response | Timeline |
|----------|--------|----------|----------|
| **Low** | User reports corrupted export | Investigate extraction logs, patch selector or integrity check | Days |
| **Low** | User reports extension hanging | Verify execution limits are firing, patch if not | Days |
| **Medium** | Security researcher reports vulnerability | Acknowledge within 24h, patch and publish fix | 48-72 hours |
| **High** | Chrome Web Store account compromised | Revoke all sessions immediately; contact Google Developer Support; notify Slack communities to disable extension pending verification | Hours |
| **High** | HF model repo compromised | SRI check prevents loading automatically (no user action needed); investigate and update pinned hash | Hours |
| **Critical** | Malicious code found in published extension | Pull from Chrome Web Store immediately; post incident notice in both Slack communities; publish post-mortem with timeline and blast radius analysis | Immediate |

**Key principle:** The extension should be safe to leave installed even if a patch cannot be shipped for a week. Because it makes zero network requests and has minimal permissions, a compromised version's worst case is "it reads your visible chat page and writes a malformed local file." There is no autonomous action, no external API access, and no credential exposure.

### Cross-Browser Notes

ARCHIVETEST DOM captures were performed in Safari (Claude, Grok) and Chrome (Gemini, ChatGPT). DOM selector structures are generated by each platform's JavaScript framework and are identical across browser engines. The extension targets Chrome (Manifest v3), but the security model applies equally to a future Safari Web Extension port. One behavioral difference: Safari's clipboard API may require different permission handling — the direct text extraction fallback (which bypasses clipboard entirely) covers this.

---

## Development Phases

### Phase 1 — Scaffold (Week 1)
- Extension skeleton (manifest, popup, content script)
- DOM Extractor for one platform (Claude.ai)
- File Writer (JSON only)
- Manual classification (user clicks to tag turns) — validates the pipeline end-to-end
- **Execution limits and circuit breakers from day one**

### Phase 2 — Heuristics (Week 2)
- Implement Pass 0 (copy button extraction) for all 5 platform paths
- Implement Pass 1 heuristic rules as fallback
- Test against all 4 platforms using standardized test conversation
- Confidence scoring and threshold tuning
- Add Markdown export
- **Content integrity checks in serializer**

### Phase 3 — User Resolution & Polish (Week 3)
- User Resolution UI for low-confidence turns
- Feedback loop (store user corrections in `storage`)
- Cross-platform testing matrix (Chrome primary, Safari verification)
- Edge cases: empty turns, system messages, error messages, "regenerated" responses

### Phase 4 — ML Integration (Week 4, optional — defer if Pass 0+1 coverage is sufficient)
- Evaluate whether Pass 2 is needed based on Phase 2-3 testing
- If needed: build micro-classifier (<500KB) or integrate quantized embedding model (~5MB, 4-bit)
- SRI hash pinning, user consent dialog, lazy download
- Gate distribution via Slack communities and HF validated accounts

---

## Open Questions for Next Discussion

1. ~~**Scroll handling**~~ — **RESOLVED.** Pass 0's sequential button extraction naturally forces lazy-loaded content to render. Gemini-style bidirectional scrolling is incorporated as a final verification pass. See Component 0.
2. ~~**Turn grouping**~~ — **PARTIALLY RESOLVED.** Claude.ai uses `data-test-render-count` containers that wrap user+assistant pairs — natural grouping via single selector. Other platforms still need verification. Pass 0's copy button approach may naturally give merged content.
3. **Export trigger** — Keyboard shortcut, toolbar button, or right-click context menu? All three?
4. **Privacy posture** — Should we add a visible notice that "no data leaves your browser"? This could be a trust differentiator.
5. **Clipboard permission UX** — Pass 0 relies on `navigator.clipboard.readText()`. Chrome extensions can request clipboard access, but some browsers may prompt the user. **Claude.ai verified:** direct text extraction via `[data-testid="user-message"]` and `.font-claude-response .standard-markdown` is a reliable fallback when clipboard is unavailable.
6. **Edit mode side effects (Gemini)** — The edit-button hack mutates the DOM temporarily. If the user is actively working in the chat while we export, this could be disruptive. Should we warn the user not to interact during export, or can we make it non-destructive?
7. ~~**Grok button investigation**~~ — **RESOLVED.** See Grok DOM Analysis appendix. Grok has Copy buttons on both user and assistant turns (aria-label="Copy"), plus three independent role detection signals (alignment, button count, bubble styling). Edit button available on user turns only.
8. **Safari vs Chrome differences** — The ARCHIVETEST DOM was captured in Safari. We need to verify the same structure in Chrome, since this is a Chrome extension. Grok may render differently across browsers.
9. ~~**Grok on x.com vs grok.com**~~ — **RESOLVED.** They are completely different DOM structures built on different frameworks. See Appendix B. The extension must detect URL and branch extraction logic accordingly. This effectively makes Grok **two platforms** (5 total extraction paths, not 4).

---

## Appendix A: Grok DOM Analysis (grok.com, February 2026)

**Source:** ARCHIVETEST conversation, Safari browser, grok.com

### Turn Container
```
div.relative.group.flex.flex-col.justify-center.w-full
  id="response-{uuid}"
  style="scroll-margin-top: var(--scroll-margin-top, 0px);"
```

### Role Detection Signals (3 independent, all high-confidence)

| Signal | User | Assistant | Confidence |
|--------|------|-----------|------------|
| Container alignment class | `items-end` | `items-start` | **0.95** |
| Button count in action bar | 2 (Edit, Copy) | 8+ (Regenerate, Read Aloud, Thread, Copy, Share, Like, Dislike, More) | **0.95** |
| Message bubble classes | `bg-surface-l1 border border-border-l1 rounded-br-lg` | `w-full max-w-none` (no bg/border) | **0.90** |
| Response time indicator | Absent | Present (e.g., "949ms") | **0.85** |

### Content Location
```
div.message-bubble
  └─ div.relative
       └─ div.relative
            └─ div.response-content-markdown.markdown
                 └─ <p>, <ol>, <li>, <strong>, etc.
```

### Button Selectors (for Pass 0)
```
Copy (both roles):  button[aria-label="Copy"]
Edit (user only):   button[aria-label="Edit"]
Regenerate (asst):  button[aria-label="Regenerate"]
```

All action buttons have `opacity-0` by default (appear on hover), but programmatic `.click()` works regardless.

### Scroll Container
```
div.w-full.h-full.overflow-y-auto.overflow-x-hidden.scrollbar-gutter-stable
```

### Timeline Navigation (potential alternative scroll strategy)
Right-side timeline with `button[aria-label="Go to response"]` elements — could be used to programmatically navigate to each turn instead of manual scrolling.

### Elements to Exclude
- Follow-up suggestion buttons after last assistant turn (inside `div#last-reply-container`)
- Input form at bottom
- Navigation chrome (top bar, timeline scrubber)

---

## Appendix B: Grok DOM Analysis (x.com/i/grok, February 2026)

**Source:** ARCHIVETEST conversation, Safari browser, x.com/i/grok

### ⚠️ CRITICAL: Two Completely Different DOMs

**grok.com and x.com/i/grok share ZERO common selectors.** They are built on different frameworks:

| Aspect | grok.com | x.com/i/grok |
|--------|----------|--------------|
| **Framework** | Tailwind CSS (human-readable classes) | React Native Web (hashed: `css-175oi2r`, `r-*`) |
| **Turn containers** | `div[id="response-{uuid}"]` | No per-turn IDs; flat sibling divs |
| **Copy button label** | `aria-label="Copy"` | `aria-label="Copy text"` |
| **User copy button** | ✅ Present (hidden, both roles) | ❌ Absent (assistant only) |
| **Buttons visible** | On hover only (`opacity-0`) | Always visible on assistant turns |
| **Timeline nav** | ✅ Right-side scrubber | ❌ Not present |
| **Follow-ups** | After last turn only | After EVERY assistant turn (`data-testid="follow_ups_list"`) |
| **Response time** | Shown (e.g., "949ms") | Not shown |

**Implication:** The extension needs a URL-based platform detector that selects the correct extraction strategy. Grok is effectively **two platforms**, not one.

### Role Detection Signals (x.com/i/grok)

| Signal | User | Assistant | Confidence |
|--------|------|-----------|------------|
| `data-testid="follow_ups_list"` after block | Absent | Present (after every response) | **0.95** |
| `button[aria-label="Copy text"]` present | ❌ No | ✅ Yes | **0.95** |
| Like/Dislike buttons present | ❌ No | ✅ Yes | **0.90** |
| Text container class `r-1kt6imw` | ✅ Yes | ❌ No | **0.80** |
| Text container class `r-rjixqe` | ❌ No | ✅ Yes | **0.80** |
| Content contains `<ol>`, `<li>`, formatted HTML | Rare | Common | **0.60** |

### Pass 0 Strategy (x.com/i/grok)
```
Assistant content:
  1. Find button[aria-label="Copy text"] → click → read clipboard
  2. Role confirmed by button's existence

User content:
  1. No copy button available — must use innerText extraction
  2. Find the text container div with class r-1kt6imw
  3. Extract innerText, strip whitespace
  4. Role confirmed by ABSENCE of action buttons and follow_ups_list
```

### Button Selectors
```
Copy (assistant only):  button[aria-label="Copy text"]
Share (assistant only):  button[aria-label="Share"]
Like (assistant only):   button[aria-label="Like"]
Dislike (assistant only): button[aria-label="Dislike"]
Regenerate (last asst):  button[aria-label="Regenerate"]
```

### Content Location
```
Both roles: div[dir="ltr"][style*="display: block"] > span (deeply nested)
Content spans: css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3
```

### Elements to Exclude
- `data-testid="follow_ups_list"` containers (follow-up suggestion buttons)
- Top toolbar (Focus Mode, Auto selector, Copy share link, Bookmark, Chat history, New Chat)
- Bottom input area (textarea, attach, submit)
- "Think Harder" / "See new posts" buttons

### Fuzzy Button Finder Update

The `findActionButton` function must account for the label difference:

```typescript
// Updated for cross-Grok compatibility
function findCopyButton(container: Element): HTMLElement | null {
  const strategies = [
    () => container.querySelector('button[aria-label="Copy"]'),         // grok.com
    () => container.querySelector('button[aria-label="Copy text"]'),    // x.com/i/grok
    () => container.querySelector('button[aria-label*="copy" i]'),     // case-insensitive fallback
    () => container.querySelector('button[aria-label*="Copy" i]'),     // broader fallback
  ];
  for (const s of strategies) {
    const r = s();
    if (r) return r as HTMLElement;
  }
  return null;
}
```


---

## Appendix C: Claude.ai DOM Analysis (February 2026)

**Source:** ARCHIVETEST conversation, Safari browser, claude.ai

### Turn Container Structure

Each message pair (user + assistant) is wrapped in a single container:

```html
<div data-test-render-count="2">
  <!-- User message -->
  <div class="mb-1 mt-6 group">...</div>
  
  <!-- Assistant message -->
  <div class="group" style="height: auto; opacity: 1; transform: none;">...</div>
</div>
```

`data-test-render-count` is present on every turn pair. Value increments with renders (typically "2" for completed pairs, "1" for final incomplete turn).

### Selector Stability Assessment

| Selector | Purpose | Stability |
|----------|---------|-----------|
| `[data-test-render-count]` | Turn container (wraps user+assistant pair) | **HIGH** |
| `[data-testid="user-message"]` | User message content | **HIGH** |
| `[data-is-streaming]` | Assistant message container | **HIGH** |
| `button[data-testid="action-bar-copy"]` | Copy button (both roles) | **HIGH** |
| `.font-claude-response` | Assistant content wrapper | **MEDIUM** |
| `.standard-markdown` | Formatted assistant content | **MEDIUM** |
| `span.text-text-500.text-xs` | Timestamp | **LOW** (styling classes) |
| `.artifact-block-cell` | Artifact blocks | **UNKNOWN** (untested) |

### User Message DOM

```html
<div data-testid="user-message" class="font-large !font-user-message ...">
  <p class="whitespace-pre-wrap break-words">ARCHIVETEST: What are the three primary colors?</p>
</div>
```

Container classes: `.mb-1.mt-6.group` (outer), `.bg-bg-300.rounded-xl` (bubble), `items-end` alignment.

Action buttons (on hover): Retry, Edit, Copy (`button[data-testid="action-bar-copy"][aria-label="Copy"]`), plus timestamp.

### Assistant Message DOM

```html
<div data-is-streaming="false" class="group relative relative pb-3">
  <div class="font-claude-response relative leading-[1.65rem] ...">
    <div class="standard-markdown grid-cols-1 grid ...">
      <p class="font-claude-response-body ...">The three primary colors...</p>
    </div>
  </div>
</div>
```

Action buttons: Copy (`button[data-testid="action-bar-copy"]`), Thumbs up (`aria-label="Give positive feedback"`), Thumbs down (`aria-label="Give negative feedback"`), Retry.

### Button Visibility Pattern

All action buttons use `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition` — hidden until hover. **Exception:** the final message in the conversation has always-visible buttons (no `opacity-0`).

**Key finding:** `opacity-0` buttons are still present in the DOM and respond to programmatic `.click()`. No hover simulation required for extraction, though optional `mouseenter` dispatch can be added for reliability.

### Scroll Container

```html
<div class="overflow-y-scroll overflow-x-hidden pt-6 flex-1">
  <div class="relative w-full min-h-full">
    <div class="mx-auto flex size-full max-w-3xl flex-col md:px-2">
      <div class="flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1">
        <!-- Turn containers here -->
      </div>
    </div>
  </div>
</div>
```

The 8-turn ARCHIVETEST conversation loaded all turns simultaneously (no lazy loading observed). Longer conversations likely lazy-load and require scroll-to-load strategy.

### Complete Extraction Implementation

```typescript
interface ClaudeTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  renderCount: number;
  extractionMethod: 'clipboard' | 'direct';
}

async function extractClaudeConversation(): Promise<ClaudeTurn[]> {
  const turns: ClaudeTurn[] = [];
  
  // 1. Load all turns via scroll
  const scrollContainer = document.querySelector('.overflow-y-scroll.overflow-x-hidden.pt-6.flex-1');
  if (!scrollContainer) throw new Error('Scroll container not found');
  await loadAllTurns(scrollContainer);
  
  // 2. Get all turn containers
  const turnContainers = document.querySelectorAll('[data-test-render-count]');
  
  // 3. Test clipboard access
  const hasClipboard = await testClipboardAccess();
  
  // 4. Extract each turn
  for (const container of turnContainers) {
    const renderCount = parseInt(container.getAttribute('data-test-render-count') || '0');
    
    const userTurn = await extractTurnFromContainer(container, 'user', hasClipboard);
    if (userTurn) turns.push({ ...userTurn, renderCount });
    
    const assistantTurn = await extractTurnFromContainer(container, 'assistant', hasClipboard);
    if (assistantTurn) turns.push({ ...assistantTurn, renderCount });
  }
  
  return turns;
}

async function extractTurnFromContainer(
  container: Element, role: 'user' | 'assistant', hasClipboard: boolean
): Promise<Omit<ClaudeTurn, 'renderCount'> | null> {
  const roleSelector = role === 'user' 
    ? '[data-testid="user-message"]' 
    : '[data-is-streaming]';
  
  if (!container.querySelector(roleSelector)) return null;
  
  let content: string;
  let extractionMethod: 'clipboard' | 'direct';
  
  if (hasClipboard) {
    try {
      const group = container.querySelector('.group');
      if (group) {
        group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await wait(50);
      }
      
      const copyButton = container.querySelector('button[data-testid="action-bar-copy"]');
      if (!copyButton) throw new Error('Copy button not found');
      
      (copyButton as HTMLElement).click();
      await wait(150);
      content = await navigator.clipboard.readText();
      extractionMethod = 'clipboard';
      
      if (group) group.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    } catch (error) {
      content = extractDirectText(container, role);
      extractionMethod = 'direct';
    }
  } else {
    content = extractDirectText(container, role);
    extractionMethod = 'direct';
  }
  
  const timestampEl = container.querySelector('span.text-text-500.text-xs');
  const timestamp = timestampEl?.textContent?.trim();
  
  return { role, content, timestamp, extractionMethod };
}

function extractDirectText(container: Element, role: 'user' | 'assistant'): string {
  if (role === 'user') {
    return container.querySelector('[data-testid="user-message"]')?.textContent?.trim() || '';
  } else {
    return container.querySelector('.font-claude-response .standard-markdown')?.textContent?.trim() || '';
  }
}

async function loadAllTurns(scrollContainer: Element): Promise<void> {
  let previousCount = 0;
  let stableIterations = 0;
  
  scrollContainer.scrollTop = 0;
  await wait(500);
  
  while (stableIterations < 3) {
    const currentTurns = document.querySelectorAll('[data-test-render-count]');
    if (currentTurns.length === previousCount) {
      stableIterations++;
    } else {
      stableIterations = 0;
      previousCount = currentTurns.length;
    }
    scrollContainer.scrollBy(0, scrollContainer.clientHeight * 0.8);
    await wait(300);
  }
}

async function testClipboardAccess(): Promise<boolean> {
  try { await navigator.clipboard.readText(); return true; }
  catch { return false; }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Artifacts (Untested)

Artifact containers are expected at `.artifact-block-cell`. Extraction strategy: click to open side panel → switch tabs → click copy → read clipboard → close panel. **Needs verification with actual artifact-containing conversation.**

### Elements to Exclude
- Input area at bottom of chat
- Navigation sidebar
- Top toolbar
- System notifications or error banners

### Testing Checklist

- [ ] Extract 4-turn conversation (ARCHIVETEST)
- [ ] Extract 20+ turn conversation (test lazy loading)
- [ ] Extract conversation with code blocks
- [ ] Extract conversation with artifacts
- [ ] Test clipboard permission denial → direct text fallback
- [ ] Verify timestamp extraction
- [ ] Verify markdown formatting preservation via clipboard
- [ ] Test in Chrome (ARCHIVETEST was Safari)


---

## Appendix D: Gemini DOM Analysis (gemini.google.com, February 2026)

**Source:** ARCHIVETEST conversation, Chrome browser, gemini.google.com

### ⚠️ CRITICAL: Architecture Doc Update

The original architecture spec described Gemini extraction using an **Edit button hack** (`ms-chat-turn`, `ms-autosize-textarea[data-value]`). The Feb 2026 DOM shows **none of these selectors exist**. Gemini has been rebuilt on Angular with Material Design components. The Edit button hack is no longer needed because **Copy buttons are available on both user and assistant turns**.

### Framework

Angular (identified by `_ngcontent-ng-c*` attribute prefixes, `_nghost-ng-c*` host bindings, and `ng-tns-c*-*` view encapsulation IDs). Uses Angular Material (`mat-icon-button`, `mat-mdc-*`, `mdc-button`).

### Turn Container Structure

Each conversation turn (user + assistant pair) is wrapped in:

```html
<div class="conversation-container message-actions-hover-boundary"
     id="1e26591aea84bcf0">
  <user-query>...</user-query>
  <model-response>...</model-response>
</div>
```

Turn IDs are hex strings (e.g., `1e26591aea84bcf0`, `02261f956b6fcb66`). These are stable, unique identifiers — excellent for dedup and ordering.

### Scroll Container

```html
<div id="chat-history" class="chat-history-scroll-container">
  <infinite-scroller data-test-id="chat-history-container" class="chat-history">
    <!-- Turn containers here -->
  </infinite-scroller>
</div>
```

The `infinite-scroller` component suggests lazy loading for long conversations. The ARCHIVETEST (4 turns) loaded all turns simultaneously.

### Selector Stability Assessment

| Selector | Purpose | Stability |
|----------|---------|-----------|
| `div.conversation-container[id]` | Turn container | **HIGH** (semantic class + unique ID) |
| `user-query` | User message element | **HIGH** (custom element, semantic) |
| `model-response` | Assistant message element | **HIGH** (custom element, semantic) |
| `button[aria-label="Copy prompt"]` | User copy button | **HIGH** (user-facing label) |
| `button[data-test-id="copy-button"]` | Assistant copy button | **HIGH** (test ID) |
| `.query-text-line` | User text content | **MEDIUM** (class name) |
| `.markdown.markdown-main-panel` | Assistant text content | **MEDIUM** (class name) |
| `message-content` | Assistant content wrapper | **HIGH** (custom element) |
| `infinite-scroller[data-test-id="chat-history-container"]` | Scroll container | **HIGH** (test ID) |
| `.hide-action-bar` | Button visibility toggle | **MEDIUM** (class name) |
| `button[data-test-id="prompt-edit-button"]` | Edit button (last turn only) | **HIGH** (test ID) |

### User Message DOM

```html
<user-query>
  <span class="user-query-container">
    <user-query-content style="--max-lines-for-collapse-count: 5;">
      <div class="user-query-container">
        <div class="query-content" id="user-query-content-0">
          <!-- Copy button -->
          <button aria-label="Copy prompt" mattooltip="Copy prompt" class="action-button">
            <mat-icon fonticon="content_copy"></mat-icon>
          </button>
          <!-- Edit button (LAST TURN ONLY) -->
          <button data-test-id="prompt-edit-button" aria-label="Edit" class="action-button">
            <mat-icon fonticon="edit"></mat-icon>
          </button>
          <!-- Content bubble -->
          <span class="user-query-bubble-with-background">
            <div class="query-text gds-body-l" dir="ltr">
              <p class="query-text-line">ARCHIVETEST: What are the three primary colors?</p>
            </div>
          </span>
        </div>
      </div>
    </user-query-content>
  </span>
</user-query>
```

**Key observations:**
- Edit button present only on last user turn (turn 4); turns 1-3 have Copy only
- Content in `p.query-text-line` — clean text, no formatting
- User query content IDs increment: `user-query-content-0`, `user-query-content-1`, etc.

### Assistant Message DOM

```html
<model-response>
  <response-container class="reduced-bottom-padding">
    <div class="response-container response-container-with-gpi">
      <!-- Header: TTS, Show Code toggle -->
      <div class="response-container-header">
        <tts-control><!-- Listen button --></tts-control>
      </div>
      <!-- Content area -->
      <div class="presented-response-container">
        <bard-avatar><!-- Gemini sparkle SVG --></bard-avatar>
        <div class="response-container-content">
          <message-content id="message-content-id-r_{turn_id}">
            <div class="markdown markdown-main-panel"
                 id="model-response-message-contentr_{turn_id}">
              <p data-path-to-node="0">Response text...</p>
              <h3 data-path-to-node="2">Heading...</h3>
              <ul data-path-to-node="4">...</ul>
            </div>
          </message-content>
        </div>
      </div>
      <!-- Footer: action buttons -->
      <div class="response-container-footer">
        <message-actions class="hide-action-bar">
          <thumb-up-button><!-- Good response --></thumb-up-button>
          <thumb-down-button><!-- Bad response --></thumb-down-button>
          <copy-button>
            <button data-test-id="copy-button" aria-label="Copy">
              <mat-icon fonticon="content_copy"></mat-icon>
            </button>
          </copy-button>
          <!-- More menu, Redo (last turn only) -->
        </message-actions>
      </div>
    </div>
  </response-container>
</model-response>
```

### Button Visibility Pattern

Non-last turns: `<message-actions class="hide-action-bar">` — buttons hidden until hover.
Last turn: `<message-actions>` (no `hide-action-bar` class) — buttons always visible.

This is the same pattern as Claude (`opacity-0`) and Grok (`opacity-0`), but implemented via a different CSS mechanism (class toggle vs opacity).

**Key finding:** Buttons are in the DOM regardless of visibility. Programmatic `.click()` should work on hidden buttons, but may need verification since Angular Material buttons use ripple effects and event handling.

### Content Types Observed

| Turn | Content Type | Special Elements |
|------|-------------|-----------------|
| 1 | Structured (headings, lists, bold) | Source citations (`source-footnote`, `source-inline-chip`) |
| 2 | Short prose (poem) | `<hr>` separator |
| 3 | Code execution | `<code-block>`, `<processing-state>`, KaTeX math (`span.math-inline`) |
| 4 | Short prose with math | Source citations, KaTeX math |

### Code Block Structure (Turn 3)

```html
<code-block>
  <div class="code-block" style="height: 0px; display: none;">
    <!-- Hidden by default, shown via "Show code" toggle -->
    <div class="code-block-decoration header-formatted">
      <span>Python</span>
      <button aria-label="Copy code" mattooltip="Copy code" class="copy-button">
        <mat-icon fonticon="content_copy"></mat-icon>
      </button>
    </div>
    <pre><code data-test-id="code-content">print(42 * 17)</code></pre>
    <div class="code-block-decoration header">Code output</div>
    <pre><code data-test-id="code-output-stdout-stderr">714</code></pre>
  </div>
</code-block>
```

**Note:** Code blocks are hidden (`display: none`) by default. A "Show code" toggle (`data-test-id="toggle-code-button"`) reveals them. The code content and output are accessible in the DOM regardless of visibility.

### Math Rendering (KaTeX)

```html
<span class="math-inline" data-math="42 \times 17">
  <span class="katex">
    <span class="katex-html">42 × 17</span>
  </span>
</span>
```

The `data-math` attribute contains the LaTeX source — useful for extraction if we want to preserve math notation.

### Role Detection Signals (5 independent, all high-confidence)

| Signal | User | Assistant | Confidence |
|--------|------|-----------|------------|
| Custom element name | `<user-query>` | `<model-response>` | **0.99** |
| Copy button aria-label | `"Copy prompt"` | `"Copy"` | **0.95** |
| Content container class | `.query-text-line` | `.markdown.markdown-main-panel` | **0.90** |
| `data-test-id="copy-button"` present | ❌ No | ✅ Yes | **0.90** |
| Bubble styling | `.user-query-bubble-with-background` | No bubble (full-width) | **0.85** |

### Pass 0 Strategy (Gemini)

```
Both roles — Copy Button:
  1. Scroll to turn container (div.conversation-container[id])
  2. User: click button[aria-label="Copy prompt"] → wait → read clipboard
  3. Assistant: click button[data-test-id="copy-button"] → wait → read clipboard
  4. Role: confirmed by which button was found

Direct text fallback:
  User: querySelector('.query-text-line').textContent
  Assistant: querySelector('.markdown.markdown-main-panel').textContent
     Strip: source-footnote, source-inline-chip, bard-avatar, processing-state
```

### Complete Extraction Implementation

```typescript
interface GeminiTurn {
  role: 'user' | 'assistant';
  content: string;
  turnId: string;
  extractionMethod: 'clipboard' | 'direct';
}

async function extractGeminiConversation(): Promise<GeminiTurn[]> {
  const turns: GeminiTurn[] = [];
  
  const scrollContainer = document.querySelector(
    'infinite-scroller[data-test-id="chat-history-container"]'
  );
  if (!scrollContainer) throw new Error('Scroll container not found');
  
  await loadAllTurns(scrollContainer);
  
  const turnContainers = document.querySelectorAll('div.conversation-container[id]');
  const hasClipboard = await testClipboardAccess();
  
  for (const container of turnContainers) {
    const turnId = container.id;
    
    // Extract user turn
    const userQuery = container.querySelector('user-query');
    if (userQuery) {
      const content = hasClipboard
        ? await extractViaCopy(userQuery, 'button[aria-label="Copy prompt"]')
        : extractDirectText(userQuery, 'user');
      turns.push({
        role: 'user',
        content: content || '',
        turnId,
        extractionMethod: hasClipboard ? 'clipboard' : 'direct'
      });
    }
    
    // Extract assistant turn
    const modelResponse = container.querySelector('model-response');
    if (modelResponse) {
      const content = hasClipboard
        ? await extractViaCopy(modelResponse, 'button[data-test-id="copy-button"]')
        : extractDirectText(modelResponse, 'assistant');
      turns.push({
        role: 'assistant',
        content: content || '',
        turnId,
        extractionMethod: hasClipboard ? 'clipboard' : 'direct'
      });
    }
  }
  
  return turns;
}

async function extractViaCopy(container: Element, buttonSelector: string): Promise<string> {
  const button = container.querySelector(buttonSelector);
  if (!button) throw new Error('Copy button not found');
  (button as HTMLElement).click();
  await wait(150);
  return navigator.clipboard.readText();
}

function extractDirectText(container: Element, role: 'user' | 'assistant'): string {
  if (role === 'user') {
    return container.querySelector('.query-text-line')?.textContent?.trim() || '';
  } else {
    // Clone to strip unwanted elements
    const markdown = container.querySelector('.markdown.markdown-main-panel');
    if (!markdown) return '';
    const clone = markdown.cloneNode(true) as Element;
    // Remove source citations, avatars, processing states
    clone.querySelectorAll(
      'source-footnote, source-inline-chip, sources-carousel-inline, bard-avatar, processing-state'
    ).forEach(el => el.remove());
    return clone.textContent?.trim() || '';
  }
}
```

### Elements to Exclude
- Lottie SVG animations (avatar sparkles, thumb up/down animations, regenerate animation)
- `source-footnote` superscripts and `sources-carousel-inline` chips
- `processing-state` sections ("Analysis", "Query successful")
- `bard-avatar` SVGs
- Code block decoration headers ("Python", "Code output")
- Hidden code blocks (`display: none`) — but content is accessible if needed
- KaTeX HTML rendering (use `data-math` attribute for LaTeX source instead)
- `freemium-rag-disclaimer`, `sensitive-memories-banner` (empty in ARCHIVETEST)

### Testing Checklist

- [ ] Extract 4-turn conversation (ARCHIVETEST)
- [ ] Extract conversation with code execution (verify code block extraction)
- [ ] Extract conversation with source citations (verify citation stripping)
- [ ] Extract conversation with math (verify KaTeX/data-math handling)
- [ ] Test clipboard extraction on hidden buttons (.hide-action-bar)
- [ ] Test direct text extraction fallback
- [ ] Verify infinite-scroller lazy loading on 20+ turn conversation
- [ ] Test in Chrome (ARCHIVETEST was Chrome)
- [ ] Verify Edit button hack still works as optional fallback for user content


---

## Appendix E: ChatGPT DOM Analysis (chatgpt.com, February 2026)

**Source:** ARCHIVETEST conversation, free tier, ChatGPT 5.2 (GPT-5.2), chatgpt.com

### ⚠️ CRITICAL: Architecture Doc Update

The original architecture spec referenced `[data-testid^="conversation-turn-"]` and `data-message-author-role` selectors for ChatGPT. **Both still exist in Feb 2026**, but the DOM has evolved significantly. Key changes: the `data-turn` attribute on `<article>` elements provides direct role detection (no need for `data-message-author-role` parsing), and **Copy buttons now exist on both user AND assistant turns** with identical `data-testid="copy-turn-action-button"`.

### Framework

React with Tailwind CSS (extensive utility classes), Radix UI primitives (`data-state`, `id="radix-*"`). SVG icons loaded via sprite sheets (`/cdn/assets/sprites-core-*.svg`).

### Turn Container Structure

Each turn is a standalone `<article>` element (NOT paired like Claude's `data-test-render-count`):

```html
<!-- User turn -->
<article data-turn-id="81586ee8-6e17-4608-a071-bf58be094f48"
         data-testid="conversation-turn-1"
         data-scroll-anchor="false"
         data-turn="user">
  <h5 class="sr-only">You said:</h5>
  <div>
    <div data-message-author-role="user"
         data-message-id="81586ee8-6e17-4608-a071-bf58be094f48">
      <div class="user-message-bubble-color corner-superellipse/1.1 rounded-[18px]">
        <div class="whitespace-pre-wrap">ARCHIVETEST: What are the three primary colors?</div>
      </div>
    </div>
    <!-- Copy button -->
    <button aria-label="Copy" data-testid="copy-turn-action-button">...</button>
  </div>
</article>

<!-- Assistant turn -->
<article data-turn-id="request-WEB:ebdc4c50-646e-4d63-9d35-7fa1e20c83ea-0"
         data-testid="conversation-turn-2"
         data-scroll-anchor="false"
         data-turn="assistant">
  <h6 class="sr-only">ChatGPT said:</h6>
  <div>
    <div data-message-author-role="assistant"
         data-message-id="7290306f-436e-41be-bc5e-c5d42d1927e3"
         data-message-model-slug="gpt-5-2">
      <div class="markdown prose dark:prose-invert w-full wrap-break-word light markdown-new-styling">
        <p data-start="0" data-end="48">That depends on the system...</p>
      </div>
    </div>
    <!-- Copy button -->
    <button aria-label="Copy" data-testid="copy-turn-action-button">...</button>
  </div>
</article>
```

Turn numbering: `data-testid="conversation-turn-{N}"` where N is 1-indexed and sequential across both roles.

### Scroll Container

```html
<div data-scroll-root="" class="...overflow-y-auto...">
  <!-- header, then main#main containing all articles -->
</div>
```

The `data-scroll-root` attribute is a reliable selector for the scrollable container.

### Selector Stability Assessment

| Selector | Purpose | Stability |
|----------|---------|-----------|
| `article[data-testid^="conversation-turn-"]` | Turn container | **HIGH** (test ID, established pattern) |
| `article[data-turn="user"]` | User turns | **HIGH** (semantic attribute) |
| `article[data-turn="assistant"]` | Assistant turns | **HIGH** (semantic attribute) |
| `[data-message-author-role]` | Role detection (legacy) | **HIGH** (long-standing attribute) |
| `button[data-testid="copy-turn-action-button"]` | Copy button (both roles) | **HIGH** (test ID) |
| `[data-scroll-root]` | Scroll container | **HIGH** (semantic attribute) |
| `.whitespace-pre-wrap` | User message text | **MEDIUM** (Tailwind utility class) |
| `.markdown.prose` | Assistant message text | **MEDIUM** (common pattern) |
| `[data-message-model-slug]` | Model info on assistant turns | **MEDIUM** (may change with versions) |
| `.user-message-bubble-color` | User bubble styling | **LOW** (styling class) |

### User Message DOM

```html
<div data-message-author-role="user"
     data-message-id="{uuid}">
  <div class="user-message-bubble-color corner-superellipse/1.1 rounded-[18px] px-4 py-1.5">
    <div class="whitespace-pre-wrap">ARCHIVETEST: What are the three primary colors?</div>
  </div>
</div>
```

User messages use `data-multiline` attribute when content wraps to multiple lines.

### Assistant Message DOM

```html
<div data-message-author-role="assistant"
     data-message-id="{uuid}"
     data-message-model-slug="gpt-5-2">
  <div class="markdown prose dark:prose-invert w-full wrap-break-word light markdown-new-styling">
    <p data-start="0" data-end="48">Response text...</p>
    <ul data-start="50" data-end="232">
      <li data-start="50" data-end="118">
        <p data-start="52" data-end="118"><strong>Bold text</strong></p>
      </li>
    </ul>
  </div>
</div>
```

**Notable:** Assistant markdown elements have `data-start` and `data-end` attributes (character offsets). The last paragraph has `data-is-last-node` and `data-is-only-node` attributes. These could be useful for content extraction verification.

### Button Visibility Pattern

**User turns:** Buttons use `opacity-0` + `pointer-events-none`, revealed via `group-hover/turn-messages:opacity-100 group-hover/turn-messages:pointer-events-auto`.

**Assistant turns:** Buttons use a CSS `mask-image` gradient trick: `[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]` with `[mask-size:300%_100%]` and `[mask-position:100%_0%]`. On hover, mask slides to `[mask-position:0_0]` to reveal buttons.

**Key finding:** Both techniques leave buttons in the DOM. Programmatic `.click()` works regardless of visibility state — no hover simulation needed.

### Role Detection Signals (7 independent, all high-confidence)

| Signal | User | Assistant | Confidence |
|--------|------|-----------|------------|
| `data-turn` attribute on `<article>` | `"user"` | `"assistant"` | **0.99** |
| `data-message-author-role` attribute | `"user"` | `"assistant"` | **0.99** |
| Screen-reader heading | `<h5>` "You said:" | `<h6>` "ChatGPT said:" | **0.95** |
| Bubble class | `.user-message-bubble-color` | No bubble | **0.90** |
| Content class | `.whitespace-pre-wrap` | `.markdown.prose` | **0.90** |
| `data-message-model-slug` present | ❌ No | ✅ Yes (e.g., `"gpt-5-2"`) | **0.85** |
| `.agent-turn` class on wrapper | ❌ No | ✅ Yes | **0.85** |

### Copy Button Details

All turns share the same copy button structure:

```html
<button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg"
        aria-label="Copy"
        aria-pressed="false"
        data-testid="copy-turn-action-button"
        data-state="closed">
  <span class="flex items-center justify-center touch:w-10 h-8 w-8">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon">
      <use href="/cdn/assets/sprites-core-*.svg#ce3544" fill="currentColor"></use>
    </svg>
  </span>
</button>
```

`aria-pressed="false"` toggles to `"true"` after click (visual feedback: checkmark icon).

### Pass 0 Strategy (ChatGPT)

```
Both roles — Copy Button:
  1. Find all article[data-testid^="conversation-turn-"]
  2. For each: click button[data-testid="copy-turn-action-button"] → wait → read clipboard
  3. Role: read data-turn attribute ("user" | "assistant") on the article
  4. Ordering: parse turn number from data-testid (conversation-turn-{N})

Direct text fallback:
  User: querySelector('.whitespace-pre-wrap').textContent
  Assistant: querySelector('.markdown.prose').textContent
```

### Complete Extraction Implementation

```typescript
interface ChatGPTTurn {
  role: 'user' | 'assistant';
  content: string;
  turnNumber: number;
  turnId: string;
  messageId: string;
  modelSlug?: string;
  extractionMethod: 'clipboard' | 'direct';
}

async function extractChatGPTConversation(): Promise<ChatGPTTurn[]> {
  const turns: ChatGPTTurn[] = [];
  
  const scrollContainer = document.querySelector('[data-scroll-root]');
  if (!scrollContainer) throw new Error('Scroll container not found');
  
  await loadAllTurns(scrollContainer);
  
  const articles = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
  const hasClipboard = await testClipboardAccess();
  
  for (const article of articles) {
    const role = article.getAttribute('data-turn') as 'user' | 'assistant';
    if (!role) continue;
    
    const turnId = article.getAttribute('data-turn-id') || '';
    const testId = article.getAttribute('data-testid') || '';
    const turnNumber = parseInt(testId.replace('conversation-turn-', '')) || 0;
    
    const messageDiv = article.querySelector('[data-message-author-role]');
    const messageId = messageDiv?.getAttribute('data-message-id') || '';
    const modelSlug = messageDiv?.getAttribute('data-message-model-slug') || undefined;
    
    let content: string;
    let extractionMethod: 'clipboard' | 'direct';
    
    if (hasClipboard) {
      try {
        const copyBtn = article.querySelector('button[data-testid="copy-turn-action-button"]');
        if (!copyBtn) throw new Error('Copy button not found');
        (copyBtn as HTMLElement).click();
        await wait(150);
        content = await navigator.clipboard.readText();
        extractionMethod = 'clipboard';
      } catch {
        content = extractDirectText(article, role);
        extractionMethod = 'direct';
      }
    } else {
      content = extractDirectText(article, role);
      extractionMethod = 'direct';
    }
    
    turns.push({ role, content, turnNumber, turnId, messageId, modelSlug, extractionMethod });
  }
  
  return turns;
}

function extractDirectText(article: Element, role: 'user' | 'assistant'): string {
  if (role === 'user') {
    return article.querySelector('.whitespace-pre-wrap')?.textContent?.trim() || '';
  } else {
    return article.querySelector('.markdown.prose')?.textContent?.trim() || '';
  }
}

async function loadAllTurns(scrollContainer: Element): Promise<void> {
  let previousCount = 0;
  let stableIterations = 0;
  
  scrollContainer.scrollTop = 0;
  await wait(500);
  
  while (stableIterations < 3) {
    const currentTurns = document.querySelectorAll('article[data-testid^="conversation-turn-"]');
    if (currentTurns.length === previousCount) {
      stableIterations++;
    } else {
      stableIterations = 0;
      previousCount = currentTurns.length;
    }
    scrollContainer.scrollBy(0, scrollContainer.clientHeight * 0.8);
    await wait(300);
  }
}
```

### Elements to Exclude
- Header (`#page-header`) with model selector and login/signup buttons
- Composer form at bottom (`form[data-type="unified-composer"]`)
- Scroll-to-bottom button
- Disclaimer text ("ChatGPT can make mistakes...")
- `<br class="sr-only">` between articles

### Testing Checklist

- [ ] Extract 4-turn conversation (ARCHIVETEST)
- [ ] Extract 20+ turn conversation (test lazy loading / scroll)
- [ ] Extract conversation with code blocks
- [ ] Extract conversation with images/file attachments
- [ ] Test clipboard extraction on hidden buttons (both visibility mechanisms)
- [ ] Test direct text extraction fallback
- [ ] Verify turn ordering via data-testid numbering
- [ ] Test on paid tier (may have different model slugs, additional buttons)
- [ ] Test in Chrome (ARCHIVETEST source browser unspecified)
