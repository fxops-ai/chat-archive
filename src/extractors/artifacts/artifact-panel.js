// =============================================================================
// Chat Archive — Artifact Content Extraction
// =============================================================================
// Handles the two artifact content surfaces:
//
//   Surface A — Artifact panel (card artifacts from present_files):
//     extractFromPanel(candidate, hasClipboard)
//     Opens the panel, extracts via clipboard (Pass A) or DOM line walk (Pass B),
//     closes the panel. Panel close is in a finally block — always attempted.
//
//   Surface B — Inline code blocks (fenced code in assistant turn text):
//     extractInlineCodeBlock(candidate, hasClipboard)
//     Extracts via copy button (Pass A) or direct innerText read (Pass B).
//     No DOM side-effects — no open/close lifecycle.
//
// Dependencies (injected via build concatenation order):
//   constants.js — SAFETY_LIMITS, wait(), waitForElement()
// =============================================================================

// --- Surface A: Artifact Panel ---

/**
 * Open the artifact panel for a card-surface artifact, extract its content,
 * and close the panel. The close is always attempted regardless of whether
 * extraction succeeded, to avoid leaving the UI in a broken state.
 *
 * Pass A (primary):   Click the panel's Copy button → read clipboard.
 * Pass B (fallback):  Walk div[data-diff-line] elements, read code.innerText per line.
 *
 * @param {ArtifactCandidate} candidate     - Candidate from artifact-detector.js
 * @param {boolean}           hasClipboard  - Whether clipboard API is available
 * @returns {Promise<{ content: string|null, method: string }>}
 */
async function extractFromPanel(candidate, hasClipboard) {
  // Scroll the card into view before clicking — required for Claude's
  // React panel handler to fire. Cards scrolled out of viewport after
  // turn-loading don't respond to programmatic .click().
  candidate.viewButton.scrollIntoView({ behavior: 'instant', block: 'center' });
  await wait(SAFETY_LIMITS.HOVER_SETTLE_MS);  // 50ms — let layout settle
  candidate.viewButton.click();

  // 2a. Switch to Code view before waiting for content.
  // HTML/React artifacts default to Preview mode (live rendered component) which
  // does NOT render #wiggle-file-content. Code view always renders the source in
  // the file-viewer format. Switching here is safe for all types: for MD/code
  // artifacts it switches from prose preview to raw source (better quality).
  // We wait briefly for the segmented control to appear, then click "Code".
  try {
    await waitForElement(
      '[data-cds="SegmentedControl"][aria-label="File view mode"]',
      2000
    );
    const codeTab = document.querySelector(
      '[data-cds="SegmentedControl"][aria-label="File view mode"] [aria-label="Code"]'
    );
    if (codeTab) {
      codeTab.click();
      await wait(SAFETY_LIMITS.HOVER_SETTLE_MS);
    }
  } catch {
    // SegmentedControl absent.
    // Fast-fail: check immediately whether #wiggle-file-content is also absent.
    // If both are missing AND a Download button is present, this is a binary panel
    // (PPTX, DOCX, XLSX). Avoids burning the full PANEL_OPEN_TIMEOUT_MS (5s) waiting
    // for a file viewer that will never appear.
    const immediateFileViewer = document.querySelector('#wiggle-file-content');
    if (!immediateFileViewer) {
      const downloadBtn = document.querySelector('button[aria-label="Download"]');
      if (downloadBtn) {
        console.log(
          `[Chat Archive] Binary panel detected for "${candidate.title}" — attempting binary extraction`
        );

        // Type correction from panel h2 header when card label was unresolved.
        if (candidate.canonicalType === 'unknown') {
          const h2 = document.querySelector('h2[title]');
          if (h2) {
            const spans = h2.querySelectorAll('span.text-text-400');
            const panelTypeLabel = spans[spans.length - 1]?.innerText?.trim();
            if (panelTypeLabel) {
              const resolved = resolveType(panelTypeLabel);
              if (resolved.canonical !== 'unknown') {
                candidate.canonicalType = resolved.canonical;
                candidate.extension     = resolved.ext;
                candidate.typeLabel     = panelTypeLabel;
                console.log(
                  `[Chat Archive] Binary type resolved via panel header: ` +
                  `"${panelTypeLabel}" → ${resolved.canonical} for "${candidate.title}"`
                );
              }
            }
          }
        }

        // Attempt binary extraction; always close the panel afterwards.
        let binaryResult = { content: null, method: 'failed' };
        try {
          binaryResult = await attemptBinaryExtraction(downloadBtn, candidate);
        } catch (err) {
          console.warn(
            `[Chat Archive] attemptBinaryExtraction threw unexpectedly for "${candidate.title}":`,
            err.message
          );
        } finally {
          const backBtn = document.querySelector('button[aria-label="Go back"]');
          if (backBtn) {
            backBtn.click();
            await wait(SAFETY_LIMITS.PANEL_CLOSE_DELAY_MS);
          }
        }
        return binaryResult;
      }
    }
    // Not a binary panel (or Download button absent) — fall through.
    // #wiggle-file-content may still appear below for single-mode text artifacts.
  }

  // 2b. Wait for panel content to render.
  // #wiggle-file-content is the content container in Code view — present for all
  // artifact types once Code mode is active.
  let contentEl;
  try {
    contentEl = await waitForElement(
      '#wiggle-file-content',
      SAFETY_LIMITS.PANEL_OPEN_TIMEOUT_MS
    );
  } catch {
    console.warn(
      `[Chat Archive] Panel content did not render within ${SAFETY_LIMITS.PANEL_OPEN_TIMEOUT_MS}ms` +
      ` for artifact: "${candidate.title}"`
    );
    return { content: null, method: 'panel_timeout' };
  }
  // panel: the data-skill-file-viewer container, used for scoped Pass B queries
  const panel = contentEl.closest('[data-skill-file-viewer="true"]') || contentEl;

  // 3. Extract content — panel close always runs in finally
  let content = null;
  let method  = 'failed';

  try {
    // --- Pass A: Panel Copy button → clipboard ---
    if (hasClipboard) {
      try {
        // The Copy action lives in a SplitDropdownButton.
        // First child button is Copy; second opens the dropdown — do NOT click that.
        const splitBtn = document.querySelector(
          '[data-cds="SplitDropdownButton"][aria-label="More options"]'
        );
        const copyBtn = splitBtn?.querySelector('button:first-child');

        if (copyBtn && copyBtn.innerText.trim() === 'Copy') {
          copyBtn.click();
          await wait(SAFETY_LIMITS.CLIPBOARD_READ_DELAY_MS);
          const text = await navigator.clipboard.readText();

          if (text && text.trim().length > 0) {
            content = text;
            method  = 'clipboard';
          }
        }
      } catch (err) {
        console.warn(
          `[Chat Archive] Panel clipboard extraction failed for "${candidate.title}":`,
          err.message
        );
        // Fall through to Pass B
      }
    }

    // --- Pass B: DOM line walk ---
    // Walk div[data-diff-line] nodes in numeric order, read code.innerText per line.
    // Numeric sort is required — DOM order is not guaranteed to be sequential.
    if (!content) {
      const lineEls = panel.querySelectorAll('div[data-diff-line]');

      if (lineEls.length > 0) {
        const sorted = Array.from(lineEls).sort(
          (a, b) => parseInt(a.dataset.diffLine, 10) - parseInt(b.dataset.diffLine, 10)
        );
        // Each line element contains a <code> child with the line text.
        // Lines with no code child (e.g. blank lines) contribute an empty string.
        const joined = sorted
          .map((el) => el.querySelector('code')?.innerText ?? '')
          .join('\n');

        if (joined.trim().length > 0) {
          content = joined;
          method  = 'dom_walk';
        }
      }

      // --- Pass C: Prose fallback ---
      // MD and other document artifacts render in Preview mode as formatted prose,
      // not as data-diff-line code rows. contentEl IS #wiggle-file-content —
      // no second query needed; content is guaranteed rendered at this point.
      if (!content) {
        const text = contentEl.innerText?.trim();
        if (text && text.length > 0) {
          content = text;
          method  = 'dom_prose';
        }
      }

      if (!content) {
        console.warn(
          `[Chat Archive] All extraction passes failed for artifact "${candidate.title}"`
        );
      }
    }
    // --- Type correction from panel header ---
    // When the card's type label didn't resolve (type_unknown), the panel header
    // h2 is the authoritative source — Claude renders the canonical label there
    // (e.g. "MD", "SH") regardless of what the card's inner div showed.
    // Card type takes precedence: this only fires when the card gave 'unknown'.
    if (candidate.canonicalType === 'unknown') {
      // Panel h2 is a sibling container above data-skill-file-viewer; use
      // document.querySelector since only one panel h2 exists while open.
      const h2 = document.querySelector('h2[title]');
      if (h2) {
        const spans = h2.querySelectorAll('span.text-text-400');
        const panelTypeLabel = spans[spans.length - 1]?.innerText?.trim();
        if (panelTypeLabel) {
          const resolved = resolveType(panelTypeLabel);
          if (resolved.canonical !== 'unknown') {
            candidate.canonicalType = resolved.canonical;
            candidate.extension     = resolved.ext;
            candidate.typeLabel     = panelTypeLabel;
            console.log(
              `[Chat Archive] Type corrected via panel header: ` +
              `"${panelTypeLabel}" → ${resolved.canonical} for "${candidate.title}"`
            );
          }
        }
      }
    }

  } finally {
    // 4. Always close the panel — regardless of extraction outcome.
    // Unclosed panels block the next panel open and leave the UI broken.
    const backBtn = document.querySelector('button[aria-label="Go back"]');
    if (backBtn) {
      backBtn.click();
      await wait(SAFETY_LIMITS.PANEL_CLOSE_DELAY_MS);
    } else {
      console.warn(
        '[Chat Archive] "Go back" button not found — panel may remain open. ' +
        'User may need to close it manually.'
      );
    }
  }

  return { content, method };
}

// --- Binary Extraction ---

/**
 * Intercept a binary artifact's Download button click, fetch the bytes in-context
 * (session cookies included automatically), and return them as a Uint8Array for
 * inclusion in the JSZip archive.
 *
 * Flow:
 *   1. Tell background.js to arm the download interceptor (setupBinaryInterception).
 *   2. Register a one-time listener for the 'binaryUrlReady' relay message.
 *   3. Click the Download button → triggers chrome.downloads.onCreated in background.
 *   4. Background cancels the browser download, relays the URL here.
 *   5. fetch(url) → arrayBuffer() — same-origin to claude.ai, session cookies included.
 *   6. Return { content: Uint8Array, method: 'binary_fetch' }.
 *
 * Fallback (any step fails): { content: null, method: 'browser_download' }.
 * If the download was already cancelled by background before the failure, we re-click
 * the Download button so the file still lands in the user's Downloads folder.
 *
 * @param {HTMLElement}       downloadBtn - The Download button in the binary panel
 * @param {ArtifactCandidate} candidate   - Descriptor for logging and filename generation
 * @returns {Promise<{ content: Uint8Array|null, method: string, expected_filename?: string }>}
 */
async function attemptBinaryExtraction(downloadBtn, candidate) {
  const expectedFilename =
    candidate.title.replace(/[<>:"/\\|?*]/g, '_') + candidate.extension;

  // 1. Arm the background interceptor.
  const setupOk = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'setupBinaryInterception' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[Chat Archive] setupBinaryInterception messaging error:',
          chrome.runtime.lastError.message
        );
        resolve(false);
      } else {
        resolve(response?.success === true);
      }
    });
  });

  if (!setupOk) {
    console.warn(
      `[Chat Archive] Binary interception setup failed for "${candidate.title}" — ` +
      'falling back to native browser download'
    );
    downloadBtn.click(); // let the download proceed normally
    return { content: null, method: 'browser_download', expected_filename: expectedFilename };
  }

  // 2. Register URL relay listener, THEN click Download.
  // Listener registered before click — guarantees we cannot miss the event.
  let interceptedUrl = null;
  try {
    interceptedUrl = await new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(urlListener);
        reject(new Error(
          `Timed out after ${SAFETY_LIMITS.BINARY_INTERCEPT_TIMEOUT_MS}ms ` +
          `waiting for intercepted URL`
        ));
      }, SAFETY_LIMITS.BINARY_INTERCEPT_TIMEOUT_MS);

      function urlListener(message) {
        if (message.action === 'binaryUrlReady') {
          clearTimeout(timeoutHandle);
          chrome.runtime.onMessage.removeListener(urlListener);
          resolve(message.url);
        }
        // Return undefined — don't keep the message channel open.
      }

      chrome.runtime.onMessage.addListener(urlListener);
      downloadBtn.click(); // triggers chrome.downloads.onCreated in background
    });
  } catch (err) {
    // Timeout — the original download click may have been intercepted and cancelled.
    // Cannot reliably re-trigger (panel may be closing). User can manually re-download.
    console.warn(
      `[Chat Archive] Binary interception failed for "${candidate.title}": ${err.message}`
    );
    return { content: null, method: 'browser_download', expected_filename: expectedFilename };
  }

  // 3. Fetch binary content from the intercepted URL.
  // Same-origin to claude.ai — browser sends session cookies automatically.
  try {
    console.log(
      `[Chat Archive] Fetching binary for "${candidate.title}": ${interceptedUrl}`
    );
    const fetchResponse = await fetch(interceptedUrl);
    if (!fetchResponse.ok) {
      throw new Error(`HTTP ${fetchResponse.status} ${fetchResponse.statusText}`);
    }

    const arrayBuffer = await fetchResponse.arrayBuffer();
    const byteCount   = arrayBuffer.byteLength;

    if (byteCount > SAFETY_LIMITS.BINARY_FETCH_MAX_SIZE) {
      throw new Error(
        `Artifact too large: ${(byteCount / 1_000_000).toFixed(1)}MB exceeds ` +
        `the ${SAFETY_LIMITS.BINARY_FETCH_MAX_SIZE / 1_000_000}MB limit`
      );
    }

    const uint8Array = new Uint8Array(arrayBuffer);
    console.log(
      `[Chat Archive] Binary fetch complete: ${byteCount} bytes for "${candidate.title}"`
    );
    return { content: uint8Array, method: 'binary_fetch' };

  } catch (err) {
    console.warn(
      `[Chat Archive] Binary fetch failed for "${candidate.title}": ${err.message}`
    );
    // Download was intercepted and cancelled by background. Re-trigger natively —
    // background's pendingInterception is already cleared (consumed by onCreated),
    // so this click goes through as a normal browser download.
    try { downloadBtn.click(); } catch { /* ignore if panel already closed */ }
    return { content: null, method: 'browser_download', expected_filename: expectedFilename };
  }
}

// --- Surface B: Inline Code Blocks ---

/**
 * Extract content from an inline markdown code block within an assistant turn.
 * These are fenced code blocks rendered as div[role="group"][aria-label="... code"].
 * No panel interaction — no open/close lifecycle.
 *
 * Pass A (primary):  Click the block's copy button → read clipboard.
 * Pass B (fallback): Read candidate.codeElement.innerText directly.
 *
 * @param {ArtifactCandidate} candidate     - Candidate from artifact-detector.js
 * @param {boolean}           hasClipboard  - Whether clipboard API is available
 * @returns {Promise<{ content: string|null, method: string }>}
 */
async function extractInlineCodeBlock(candidate, hasClipboard) {
  let content = null;
  let method  = 'inline_direct'; // default; overridden below if clipboard succeeds

  // --- Pass A: Copy button → clipboard ---
  if (hasClipboard && candidate.copyButton) {
    try {
      candidate.copyButton.click();
      await wait(SAFETY_LIMITS.CLIPBOARD_READ_DELAY_MS);
      const text = await navigator.clipboard.readText();

      if (text && text.trim().length > 0) {
        content = text;
        method  = 'inline_clipboard';
      }
    } catch (err) {
      console.warn(
        `[Chat Archive] Inline code block clipboard extraction failed for "${candidate.title}":`,
        err.message
      );
      // Fall through to Pass B
    }
  }

  // --- Pass B: Direct innerText read ---
  if (!content && candidate.codeElement) {
    const text = candidate.codeElement.innerText;
    if (text && text.trim().length > 0) {
      content = text;
      method  = 'inline_direct';
    }
  }

  if (!content) {
    console.warn(
      `[Chat Archive] Both extraction passes failed for inline code block "${candidate.title}"`
    );
  }

  return { content, method };
}