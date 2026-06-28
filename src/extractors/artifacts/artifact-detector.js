// =============================================================================
// Chat Archive — Artifact Detector
// =============================================================================
// Scans a single [data-test-render-count] turn container for artifact surfaces
// and returns a flat array of ArtifactCandidate descriptors.
//
// Two surfaces are detected:
//
//   Surface A — Artifact cards  (.artifact-block-cell)
//     Produced by Claude's present_files tool.
//     Each card has a View button that opens the content panel.
//     DOM structure (confirmed June 2026):
//       div.group/artifact-block
//         button[aria-label="View {title}"]
//         div.artifact-block-cell
//           div.leading-tight.text-sm.line-clamp-1   ← title
//           div.text-xs.line-clamp-1.text-text-400   ← type label ("SH", "Code · HTML", etc.)
//           button[aria-label="Download {title}"]    ← do NOT click
//
//   Surface B — Inline code blocks  (div[role="group"][aria-label="… code"])
//     Fenced code blocks rendered in assistant turn text.
//     DOM structure (confirmed June 2026):
//       div[role="group"][aria-label="{lang} code"]
//         div.text-text-500.font-small               ← language label ("bash", "python", etc.)
//         pre.code-block__code
//           code.language-{lang}                     ← content via innerText
//         button[aria-label="Copy to clipboard"]     ← copy button
//
// Candidates are returned in DOM order (cards first within a turn, then code
// blocks), with positionInTurn assigned sequentially across both surfaces.
// positionInTurn is used by claude.js for stable ordering within the manifest.
//
// This module does NOT extract content — it only builds descriptors.
// Content extraction is handled by artifact-panel.js.
//
// Dependencies (injected via build concatenation order):
//   artifact-types.js — resolveType(), resolveCodeBlockLang(), extForCanonical()
// =============================================================================

/**
 * Scan a turn container for all artifact surfaces.
 *
 * @param {Element} container  - A [data-test-render-count] turn pair element
 * @param {number}  turnIndex  - 0-based index of this turn in the conversation
 * @returns {ArtifactCandidate[]}
 */
function detectArtifacts(container, turnIndex) {
  const candidates = [];
  let position = 0;

  // --- Surface A: Artifact cards ---
  const cells = container.querySelectorAll('.artifact-block-cell');

  for (const cell of cells) {
    const titleEl = cell.querySelector('div.leading-tight.text-sm.line-clamp-1');

    // Type label selector uses multiple strategies — the exact element and classes
    // vary by artifact type (div vs span, presence of line-clamp-1, etc.).
    // Try the confirmed spec selector first; fall back to any text-text-400
    // descendant that isn't the title element.
    const typeLabelEl =
      cell.querySelector('div.text-xs.line-clamp-1.text-text-400') ||
      cell.querySelector('span.text-xs.line-clamp-1.text-text-400') ||
      cell.querySelector('[class*="text-text-400"]:not([class*="leading-tight"])') ||
      null;

    const title     = titleEl?.innerText?.trim()     || 'Untitled';
    const typeLabel = typeLabelEl?.innerText?.trim() || '';

    // View button lives in the parent card element (sibling of .artifact-block-cell).
    // Walking to parentElement is more reliable than querying the full turn container,
    // which could match buttons from other cards in the same turn.
    const outerCard  = cell.parentElement;
    const viewButton = outerCard
      ? outerCard.querySelector('button[aria-label^="View "]')
      : null;

    if (!viewButton) {
      // Without a View button we cannot open the panel — skip this card.
      // Possible causes: DOM change, artifact still loading, or a "Download only" card.
      console.warn(
        `[Chat Archive] Artifact card "${title}" has no View button — skipping.` +
        ' If this artifact should be exported, please report the DOM structure.'
      );
      continue;
    }

    const { canonical: canonicalType, ext: extension } = resolveType(typeLabel);

    candidates.push({
      surface:       'card',
      title,
      typeLabel,
      canonicalType,
      extension,
      turnIndex,
      positionInTurn: position++,
      viewButton,
      copyButton:  null,
      codeElement: null,
    });
  }

  // --- Surface B: Inline code blocks ---
  // Only present in assistant turns, but we query the full container for
  // simplicity — user turn text does not render code block UI.
  const codeBlocks = container.querySelectorAll(
    'div[role="group"][aria-label$=" code"]'
  );

  for (const block of codeBlocks) {
    // Language label element
    const langEl = block.querySelector('div.text-text-500.font-small');
    const lang   = langEl?.innerText?.trim().toLowerCase() || '';

    // Copy button (opacity-0 by default, but clickable without hover)
    const copyButton = block.querySelector('button[aria-label="Copy to clipboard"]') || null;

    // Code element — try most-specific selector first, fall back to generic
    const codeElement =
      block.querySelector('pre.code-block__code code') ||
      block.querySelector('code[class*="language-"]') ||
      block.querySelector('pre code') ||
      null;

    if (!codeElement && !copyButton) {
      // Can't extract via either method — no point creating a candidate
      console.warn(
        `[Chat Archive] Inline code block (lang: "${lang}") has no code element` +
        ' and no copy button — skipping.'
      );
      continue;
    }

    const canonicalType = resolveCodeBlockLang(lang);
    const extension     = extForCanonical(canonicalType);

    // Title for inline code blocks is the language string.
    // Falls back to 'code' for unlabelled blocks.
    const title = lang || 'code';

    candidates.push({
      surface:       'code_block',
      title,
      typeLabel:     lang,        // raw language string ("bash", "python", etc.)
      canonicalType,
      extension,
      turnIndex,
      positionInTurn: position++,
      viewButton:  null,
      copyButton,
      codeElement,
    });
  }

  return candidates;
}