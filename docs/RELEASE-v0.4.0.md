# Chat Archive — v0.4.0 Release Notes

## Binary Artifact Extraction

Adds full extraction of binary file artifacts (PPTX, DOCX, XLSX) produced by
Claude's `present_files` tool into the zip archive alongside text artifacts.
Previously these were recorded as `not_extractable` with no sidecar content.

Validated against a real conversation containing 4 PPTX artifacts (80KB, 35KB,
46KB, 35KB). All four extracted correctly with valid `PK\x03\x04` magic bytes
and `.pptx` file extensions on first successful run.

---

## Architecture: How Binary Extraction Works

Binary artifact panels (PPTX, DOCX, XLSX) have no code viewer — they show only
"Open in Drive" and "Download" buttons. The panel's SegmentedControl and
`#wiggle-file-content` elements are absent. We exploit this structure:

### Detection (artifact-panel.js)

When the SegmentedControl wait times out (2s), the code immediately checks
whether `button[aria-label="Download"]` exists and whether the canonical type
is a known binary type. If both are true, it's a binary panel. This fast-fail
avoids burning the full `PANEL_OPEN_TIMEOUT_MS` per artifact.

### Interception flow (background.js + artifact-panel.js)

The download URL (`https://claude.ai/api/organizations/.../wiggle/download-file?path=...`)
is a plain authenticated HTTPS URL. The interception approach:

```
1. content script → background: { action: 'setupBinaryInterception' }
   background arms pendingInterception = { tabId, expiry: now + 8s }

2. content script registers chrome.runtime.onMessage listener for 'binaryUrlReady'
   content script clicks button[aria-label="Download"]
   Chrome fires chrome.downloads.onCreated in background

3. background: cancel the download → chrome.tabs.sendMessage → 'binaryUrlReady' + url

4. content script: fetch(url) ← same-origin to claude.ai, session cookies included
   → arrayBuffer() → Uint8Array → added to JSZip directly

5. No ArrayBuffer crosses the message channel — only a URL string.
   The Uint8Array stays in content script memory.
```

### Fallback: browser_download

If any step fails (setup error, 5s interception timeout, fetch error, file
exceeds `BINARY_FETCH_MAX_SIZE`):

- Re-click the Download button so the file lands in the user's Downloads folder
- manifest records `extraction_method: 'browser_download'`, `expected_filename`
- `binary-downloads-readme.txt` is generated in the zip root listing what to add manually
- Markdown export notes "downloaded separately — see readme"

---

## Bug Fixed: Type Label NBSP Normalisation

**Root cause:** Claude's artifact card type label DOM element ends with `&nbsp;`:

```html
<div class="text-xs line-clamp-1 text-text-400 ...">
  Presentation<span class="opacity-50"> · </span>PPTX&nbsp;
</div>
```

`innerText` renders `&nbsp;` as `\u00a0`. JavaScript's `String.trim()` does
NOT strip `\u00a0`, so `resolveType` received `"Presentation · PPTX\u00a0"`
which matched nothing in `TYPE_MAP`.

**Fix (artifact-types.js `resolveType`):**
```javascript
const normalized = rawLabel
  .replace(/\u00a0/g, ' ')  // &nbsp; → regular space
  .replace(/\s+/g, ' ')     // collapse multi-space runs
  .trim();
```

This fix applies to ALL artifact type lookups. Any current or future type label
with a trailing `&nbsp;` will resolve correctly.

---

## New TYPE_MAP Entries

Confirmed from DOM inspection (June 2026):

```javascript
'Presentation · PPTX': { canonical: 'pptx', ext: '.pptx' },  // confirmed
'Document · DOCX':     { canonical: 'docx', ext: '.docx' },  // inferred — validate
'Spreadsheet · XLSX':  { canonical: 'xlsx', ext: '.xlsx' },  // inferred — validate
// Panel header h2 abbreviated forms
'PPTX':                { canonical: 'pptx', ext: '.pptx' },
'DOCX':                { canonical: 'docx', ext: '.docx' },
'XLSX':                { canonical: 'xlsx', ext: '.xlsx' },
```

⚠️ `Document · DOCX` and `Spreadsheet · XLSX` label formats are inferred from
the `Presentation · PPTX` pattern. If DOCX/XLSX artifacts resolve as `unknown`,
inspect the type label element in DevTools and update TYPE_MAP accordingly.

---

## Schema Changes (v1.1 extended, no version bump)

New fields on manifest version objects — additive and non-breaking:

| Field | Type | When present |
|---|---|---|
| `byte_count` | integer | `extraction_method: 'binary_fetch'` |
| `expected_filename` | string | `extraction_method: 'browser_download'` |
| `sidecar_filename` | null | `extraction_method: 'browser_download'` |

---

## New Safety Limits

Added to `SAFETY_LIMITS` in `src/utils/constants.js`:

```javascript
BINARY_INTERCEPT_TIMEOUT_MS: 5_000,  // max wait for background URL relay
BINARY_FETCH_MAX_SIZE: 50_000_000,   // 50MB hard cap on binary fetch
```

---

## Files Changed

| File | Change |
|---|---|
| `background.js` | `pendingInterception` state; `chrome.downloads.onCreated` listener; `setupBinaryInterception` message handler |
| `src/extractors/artifacts/artifact-panel.js` | Binary fast-fail in SegmentedControl catch block; new `attemptBinaryExtraction()` function |
| `src/extractors/artifacts/artifact-types.js` | NBSP normalisation in `resolveType()`; 6 new TYPE_MAP entries for Office formats; `isBinaryType()` helper |
| `src/extractors/artifacts/artifact-code.js` | `processArtifact()` early-return branches for `binary_fetch` (Uint8Array) and `browser_download` (null) |
| `src/extractors/claude.js` | `assembleArtifactManifest()`: binary-aware sidecar push; `byte_count`/`expected_filename` in version objects; `sidecar_filename: null` for `browser_download` |
| `src/utils/constants.js` | Two new `SAFETY_LIMITS` keys; `computeSHA256Binary(uint8Array)` function; `waitForElement()` helper |
| `src/utils/filewriter.js` | `addBinaryToZip()` helper |
| `src/utils/serializer.js` | `sidecarContentMap` filtered to text-only sidecars; `browser_download` handling in MD artifact block; null `sidecar_filename` rendered as expected filename |
| `src/content.js` | Binary-aware sidecar loop (`sidecar.binary` flag); `binary-downloads-readme.txt` generation |
| `manifest.json` | Version bump: `0.3.0` → `0.4.0` |

---

## Known Behaviour: Chrome Multiple-Download Prompt

When a conversation contains multiple binary artifacts, Chrome's built-in
multiple-download protection fires after the first programmatic Download button
click. The user sees: *"chat.claude.ai wants to download multiple files — Allow / Block"*.

Expected — click Allow. One-time prompt per browser session per origin.

---

## Validation

ARCHIVETEST-BINARY (June 28 2026, Chrome 132, macOS, claude.ai):

| Artifact | Size | Method | Extension | Magic bytes |
|---|---|---|---|---|
| Org intelligence | 80,600 bytes | `binary_fetch` | `.pptx` | `PK\x03\x04` ✅ |
| Cost slides | 34,775 bytes | `binary_fetch` | `.pptx` | `PK\x03\x04` ✅ |
| Cost slides v2 | 46,313 bytes | `binary_fetch` | `.pptx` | `PK\x03\x04` ✅ |
| Slide e strategic outcomes | 34,947 bytes | `binary_fetch` | `.pptx` | `PK\x03\x04` ✅ |
| Org intelligence master | 42,066 chars | `dom_walk` | `.md` | text ✅ |

Zero `browser_download` fallbacks. No `binary-downloads-readme.txt` generated.

---

## Remaining Work

- [ ] Confirm `Document · DOCX` and `Spreadsheet · XLSX` type labels against
      live Claude.ai DOM — create a conversation with those artifact types,
      inspect the type label element in DevTools, verify TYPE_MAP strings match
- [ ] Investigate reading download URL from panel DOM without clicking the
      Download button — would eliminate Chrome's multiple-download prompt
- [ ] Test DOCX and XLSX end-to-end once type labels confirmed
- [ ] Update ARCHIVETEST-ARTIFACTS test conversation to include a PPTX artifact

---

## Existing Roadmap (unchanged)

- [ ] User resolution UI for uncertain turn classifications
- [ ] Batch export from conversation history pages
- [ ] Firefox port (Manifest V3 namespace polyfill)
- [ ] Artifact extraction for ChatGPT Canvas, Gemini equivalents
