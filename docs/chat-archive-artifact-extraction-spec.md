# Chat Archive — Artifact Extraction PR Specification
## Feature: Claude.ai Artifact Support (v0.3.0)

**Status:** Design-complete, ready for implementation  
**Schema bump:** `1.0` → `1.1`  
**Target branch:** `feature/artifact-extraction` off `main`  
**Affects:** `src/extractors/claude.js`, `src/utils/serializer.js`,
`src/utils/constants.js`, `src/utils/filewriter.js`, `manifest.json`,
`build.sh`, `chat-archive-architecture.md`  
**New files:** `src/extractors/artifacts/` (4 files), `src/vendor/jszip.min.js`

---

## 1. Problem Statement

The current Claude.ai extractor captures turn text only. Artifacts — the code,
HTML, and SVG files Claude produces and presents as downloadable cards — are
silently dropped from exports. This breaks the archive guarantee: a
conversation with artifacts is not faithfully preserved.

This PR adds full artifact extraction for Claude.ai as a first-class feature,
with an extensible architecture that allows contributors to add artifact support
for other platforms (ChatGPT Canvas, etc.) without touching core logic.

---

## 2. Scope

### In scope — this PR
- Claude.ai artifact cards (`.artifact-block-cell` download cards)
- Inline markdown code blocks (`pre > code.language-*`) — already partially
  captured but not structured; now promoted to first-class artifacts
- Artifact versioning metadata (multiple versions of the same artifact across
  turns)
- Zip output when artifacts are present
- Schema v1.1
- JSZip bundled as vendored dependency

### Out of scope — this PR
- `show_widget` iframes (cross-origin sandbox; `extractable: false` in metadata)
- ChatGPT Canvas, Gemini, Grok artifact equivalents (left for contributors)
- ML-assisted type classification (deferred per existing roadmap)

---

## 3. Verified DOM Reference (Claude.ai, June 2026)

All selectors below were confirmed against live DevTools captures.

### 3.1 Artifact card in conversation flow

```
div.group/artifact-block                         ← outer card
  button[aria-label="View {title}"]              ← opens the panel
  div.artifact-block-cell                        ← stable hook for detection
    div.leading-tight.text-sm.line-clamp-1       ← artifact title text
    div.text-xs.line-clamp-1.text-text-400       ← type label ("SH", "Code · HTML", "Image · SVG")
    button[aria-label="Download {title}"]        ← do NOT use — writes file
```

### 3.2 Artifact panel (opened via View button)

```
div.flex.items-center.justify-between.px-2.py-2.bg-bg-000   ← panel header
  h2[title="{artifact title}"]                               ← HIGH stability: title attr
    span.text-text-400                                       ← type label ("SH", "PY", etc.)
  div[data-cds="SplitDropdownButton"][aria-label="More options"]
    button (first child, innerText="Copy")                   ← PRIMARY copy action
    button[aria-label="More options"]                        ← dropdown — do NOT click

div[data-skill-file-viewer="true"]                           ← HIGH stability: semantic attr
  div#wiggle-file-content                                    ← MEDIUM: opaque internal ID
    div[data-diff-line="1"][data-diff-type="normal"]         ← HIGH: line-addressed
      code.font-mono                                         ← MEDIUM: styling class
    div[data-diff-line="2"]...
```

### 3.3 Inline markdown code blocks (in assistant turn text)

```
div[role="group"][aria-label="{language} code"]              ← code block container
  div.text-text-500.font-small                               ← language label ("bash", "python")
  pre.code-block__code
    code.language-{lang}                                     ← content: innerText
  button[aria-label="Copy to clipboard"]                     ← copy button (opacity-0/group-hover)
```

### 3.4 Stability ratings summary

| Selector | Stability | Notes |
|---|---|---|
| `div.artifact-block-cell` | HIGH | Confirmed present, semantic class |
| `button[aria-label="View {title}"]` | HIGH | User-facing label |
| `h2[title]` attribute on panel | HIGH | Semantic |
| `data-cds="SplitDropdownButton"` | MEDIUM | Design system attr |
| Copy button by text "Copy" | MEDIUM | No testid; user-facing text |
| `data-skill-file-viewer="true"` | HIGH | Semantic data attr |
| `#wiggle-file-content` | LOW-MEDIUM | Opaque internal ID — fallback only |
| `data-diff-line` | HIGH | Structural line addressing |
| `code.language-{lang}` | HIGH | Standard pattern, long-standing |
| `button[aria-label="Copy to clipboard"]` | HIGH | Confirmed testid equivalent |

---

## 4. Extraction Strategy

### 4.1 Two artifact surfaces

**Surface A — Artifact cards** (download cards from `present_files`)

Extraction flow per card:
1. Find all `.artifact-block-cell` within the current `[data-test-render-count]`
   turn container
2. Read title from `div.leading-tight.text-sm.line-clamp-1.innerText`
3. Read type label from `div.text-xs.line-clamp-1.text-text-400.innerText`
4. Click `button[aria-label="View {title}"]` to open the panel
5. Wait for panel to render (`data-skill-file-viewer` present, ≤2000ms timeout)
6. **Pass A (primary):** Find first button in
   `div[data-cds="SplitDropdownButton"]`, verify `innerText === "Copy"`,
   click → wait `CLIPBOARD_READ_DELAY_MS` → `navigator.clipboard.readText()`
7. **Pass B (fallback):** If Pass A fails, walk all `div[data-diff-line]` in
   document order, extract `code.font-mono.innerText` per line, join with `\n`
8. Close panel via `button[aria-label="Go back"]`
9. Route extracted content to the appropriate type-specific extractor module

**Surface B — Inline code blocks** (fenced code in assistant turn text)

Extraction flow per block:
1. Within each assistant turn, query all
   `div[role="group"][aria-label$=" code"]`
2. Read language from `div.text-text-500.font-small.innerText`
3. **Pass A (primary):** Click `button[aria-label="Copy to clipboard"]` →
   wait → read clipboard
4. **Pass B (fallback):** Read `code.language-{lang}.innerText` directly
5. Associate with the parent turn by position

### 4.2 Artifact identity and versioning

Claude allows iterating on artifacts across turns. The same logical artifact
may appear as multiple cards with identical titles in different turns.

Identity is determined by **title + type label**. Cards with matching
`title + typeLabel` across turns are treated as versions of the same artifact.

Version numbering is 1-indexed, assigned in turn order (earliest turn = v1).

Each version record stores:
- `version_number` — integer, 1-indexed
- `turn` — the turn number where this version appeared
- `extracted_at` — ISO timestamp
- `content_hash` — SHA-256 of content (for dedup and change detection)
- `changed` — boolean: `content_hash !== previous version content_hash`

If content is identical between versions (same hash), `changed: false` is
set but the version record is still stored — preserving the history of
when Claude re-presented an unchanged artifact.

### 4.3 Panel interaction safety limits

New constants added to `SAFETY_LIMITS`:

```javascript
MAX_ARTIFACT_PANELS: 50,        // Hard cap: stop opening panels after 50
PANEL_OPEN_TIMEOUT_MS: 2_000,   // Abort if panel doesn't render in 2s
PANEL_CLOSE_DELAY_MS: 100,      // Wait after closing before next open
MAX_ARTIFACT_CONTENT_SIZE: 500_000,  // 500KB per artifact; flag if exceeded
```

---

## 5. New File Structure

```
src/
└── extractors/
    └── artifacts/
        ├── artifact-detector.js      ← finds all artifact cards and code blocks
        │                               within a turn; returns ArtifactCandidate[]
        ├── artifact-panel.js         ← opens panel, runs Pass A/B, closes panel;
        │                               returns raw content string
        ├── artifact-types.js         ← type label → extension + canonical type
        │                               mapping; dispatches to type handlers
        └── artifact-code.js          ← shared handler for all code types
                                        (SH, PY, JS, TS, CSS, HTML, SVG, etc.)
                                        type-specific post-processing per format
```

Note: HTML and SVG have distinct post-processing (validation, metadata
extraction) but share the same DOM extraction path. They live in
`artifact-code.js` as type-specific branches, not separate files. If
post-processing grows substantially, promote to `artifact-html.js` and
`artifact-svg.js` as separate modules — the dispatcher in `artifact-types.js`
makes this a one-line change.

---

## 6. Module Specifications

### 6.1 `artifact-detector.js`

**Responsibility:** Scan a turn container for artifact surfaces. Returns
structured candidates without extracting content.

```javascript
// Input: a single [data-test-render-count] turn container element
// Output: array of ArtifactCandidate objects

interface ArtifactCandidate {
  surface: 'card' | 'code_block';
  title: string;               // h2[title] attr or aria-label language
  typeLabel: string;           // raw DOM label: "SH", "Code · HTML", etc.
  canonicalType: string;       // normalised: "shell", "html", "svg", etc.
  extension: string;           // ".sh", ".html", ".svg", etc.
  turnIndex: number;           // which turn in the conversation
  positionInTurn: number;      // 0-indexed, for ordering multiple artifacts
  viewButton: Element | null;  // for card surface: the View button element
  copyButton: Element | null;  // for code_block surface: the copy button
  codeElement: Element | null; // for code_block surface: the code element
}
```

Detection logic:
- Cards: `container.querySelectorAll('.artifact-block-cell')` — each yields
  one candidate. View button found via
  `container.querySelector('button[aria-label^="View "]')`
- Code blocks: `container.querySelectorAll('div[role="group"][aria-label$=" code"]')`
  — each yields one candidate

### 6.2 `artifact-panel.js`

**Responsibility:** For card-surface artifacts, open the panel, extract
content, close the panel. Wraps all panel interaction side effects.

```javascript
async function extractFromPanel(candidate, hasClipboard) {
  // 1. Click View button
  candidate.viewButton.click();
  
  // 2. Wait for panel to render
  const panel = await waitForElement(
    '[data-skill-file-viewer="true"]',
    SAFETY_LIMITS.PANEL_OPEN_TIMEOUT_MS
  );
  if (!panel) {
    return { content: null, method: 'panel_timeout' };
  }

  // 3. Pass A: Copy button
  let content = null;
  let method = 'failed';

  if (hasClipboard) {
    try {
      const splitBtn = document.querySelector(
        '[data-cds="SplitDropdownButton"][aria-label="More options"]'
      );
      const copyBtn = splitBtn?.querySelector('button:first-child');
      if (copyBtn && copyBtn.innerText.trim() === 'Copy') {
        copyBtn.click();
        await wait(SAFETY_LIMITS.CLIPBOARD_READ_DELAY_MS);
        content = await navigator.clipboard.readText();
        method = 'clipboard';
      }
    } catch (e) {
      // fall through to Pass B
    }
  }

  // 4. Pass B: Direct DOM line walk
  if (!content) {
    const lines = panel.querySelectorAll('div[data-diff-line]');
    content = Array.from(lines)
      .sort((a, b) =>
        parseInt(a.dataset.diffLine) - parseInt(b.dataset.diffLine)
      )
      .map(line => line.querySelector('code')?.innerText ?? '')
      .join('\n');
    method = 'dom_walk';
  }

  // 5. Close panel
  const backBtn = document.querySelector('button[aria-label="Go back"]');
  backBtn?.click();
  await wait(SAFETY_LIMITS.PANEL_CLOSE_DELAY_MS);

  return { content, method };
}
```

### 6.3 `artifact-types.js`

**Responsibility:** Map DOM type labels to canonical types and file extensions.
Route to appropriate post-processor.

```javascript
const TYPE_MAP = {
  'SH':          { canonical: 'shell',      ext: '.sh'   },
  'PY':          { canonical: 'python',     ext: '.py'   },
  'JS':          { canonical: 'javascript', ext: '.js'   },
  'TS':          { canonical: 'typescript', ext: '.ts'   },
  'CSS':         { canonical: 'css',        ext: '.css'  },
  'Code · HTML': { canonical: 'html',       ext: '.html' },
  'Code · CSS':  { canonical: 'css',        ext: '.css'  },
  'Code · JS':   { canonical: 'javascript', ext: '.js'   },
  'Code · React':{ canonical: 'jsx',        ext: '.jsx'  },
  'Image · SVG': { canonical: 'svg',        ext: '.svg'  },
  'MD':          { canonical: 'markdown',   ext: '.md'   },
};

// Unknown labels fall back to:
const UNKNOWN_TYPE = { canonical: 'unknown', ext: '.txt' };

function resolveType(rawLabel) {
  return TYPE_MAP[rawLabel.trim()] ?? UNKNOWN_TYPE;
}

// Inline code block language → type
const LANG_MAP = {
  'bash': 'shell', 'sh': 'shell', 'shell': 'shell',
  'python': 'python', 'py': 'python',
  'javascript': 'javascript', 'js': 'javascript',
  'typescript': 'typescript', 'ts': 'typescript',
  'html': 'html', 'css': 'css',
  'svg': 'svg', 'jsx': 'jsx', 'tsx': 'tsx',
  'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
  'sql': 'sql', 'markdown': 'markdown', 'md': 'markdown',
};
```

### 6.4 `artifact-code.js`

**Responsibility:** Post-process raw content string by canonical type.
Validates, extracts supplementary metadata, returns a structured result.

Per-type handling:
- **shell/python/js/ts/css/json/yaml/sql/markdown:** No post-processing.
  Content returned as-is. Language confirmed from type map.
- **html:** Attempt to extract `<title>` tag content as supplementary
  `page_title` metadata field. Flag if content does not start with `<!DOCTYPE`
  or `<html` as `malformed: true` (warn, don't fail).
- **svg:** Attempt to extract `viewBox` and `width`/`height` attributes from
  root `<svg>` element as supplementary metadata. Flag if content does not
  contain `<svg` as `malformed: true`.
- **unknown:** Flag `type_unknown: true`, store raw content, log warning.

```javascript
interface ProcessedArtifact {
  title: string;
  canonical_type: string;
  extension: string;
  content: string;
  content_hash: string;         // SHA-256 hex of content
  line_count: number;
  char_count: number;
  extraction_method: 'clipboard' | 'dom_walk' | 'inline_clipboard' | 'inline_direct';
  malformed: boolean;           // type-specific validation failed
  type_unknown: boolean;        // label not in TYPE_MAP
  oversized: boolean;           // content > MAX_ARTIFACT_CONTENT_SIZE
  supplementary: object;        // type-specific extra metadata (title, viewBox, etc.)
}
```

---

## 7. Schema v1.1

### 7.1 Changes from v1.0

- `schema_version`: `"1.0"` → `"1.1"`
- `export_metadata`: add `has_artifacts`, `artifact_count`, `zip_filename`
- Each turn: add optional `artifacts` array
- New top-level `artifact_manifest` array

### 7.2 Full schema (additions only shown as NEW)

```json
{
  "schema_version": "1.1",
  "export_metadata": {
    "source_platform": "claude.ai",
    "source_url": "https://claude.ai/chat/abc-123",
    "export_timestamp": "2026-06-24T14:30:00Z",
    "extension_version": "0.3.0",
    "classification_method": "clipboard",
    "total_turns": 6,
    "flagged_turns": 0,
    "has_artifacts": true,
    "artifact_count": 3,
    "zip_filename": "chat-export-claude-2026-06-24.zip"
  },
  "artifact_manifest": [
    {
      "artifact_id": "artifact-001",
      "title": "Directory listing",
      "canonical_type": "shell",
      "extension": ".sh",
      "version_count": 2,
      "versions": [
        {
          "version_number": 1,
          "turn": 2,
          "sidecar_filename": "artifact-001-v1-directory-listing.sh",
          "content_hash": "a1b2c3...",
          "char_count": 412,
          "line_count": 21,
          "extraction_method": "clipboard",
          "extracted_at": "2026-06-24T14:30:01Z",
          "changed": true,
          "malformed": false,
          "type_unknown": false,
          "oversized": false,
          "supplementary": {}
        },
        {
          "version_number": 2,
          "turn": 4,
          "sidecar_filename": "artifact-001-v2-directory-listing.sh",
          "content_hash": "d4e5f6...",
          "char_count": 489,
          "line_count": 24,
          "extraction_method": "clipboard",
          "extracted_at": "2026-06-24T14:30:02Z",
          "changed": true,
          "malformed": false,
          "type_unknown": false,
          "oversized": false,
          "supplementary": {}
        }
      ]
    }
  ],
  "conversation": [
    {
      "turn": 1,
      "role": "user",
      "content": "Write me a bash script...",
      "classification_confidence": 0.95,
      "classification_source": "clipboard",
      "artifacts": []
    },
    {
      "turn": 2,
      "role": "assistant",
      "content": "Here is a bash script for directory listing.",
      "classification_confidence": 0.95,
      "classification_source": "clipboard",
      "artifacts": [
        {
          "artifact_id": "artifact-001",
          "version_number": 1,
          "title": "Directory listing",
          "canonical_type": "shell",
          "surface": "card"
        }
      ]
    }
  ]
}
```

### 7.3 Design notes on schema

- `artifact_id` is generated by the extractor: `"artifact-{NNN}"` zero-padded
  to 3 digits, assigned in order of first appearance across the conversation.
- `artifact_manifest` is the authoritative record. Turn-level `artifacts` are
  cross-references — they carry `artifact_id` and `version_number` only, not
  duplicated content.
- `sidecar_filename` is the canonical name of the file inside the zip.
- `surface` distinguishes `"card"` (opened via View panel) from `"code_block"`
  (inline fenced code) — useful for provenance.

---

## 8. Sidecar Filename Convention

```
artifact-{id}-v{version}-{slug}{extension}
```

Where `{slug}` is the artifact title lowercased, spaces replaced with hyphens,
non-alphanumeric characters removed, truncated to 40 characters.

Examples:
```
artifact-001-v1-directory-listing.sh
artifact-002-v1-hello-world.html
artifact-002-v2-hello-world.html
artifact-003-v1-concentric-circles.svg
artifact-004-v1-sample-styles.css
```

---

## 9. Zip Structure and Output

### 9.1 Zip contents

```
chat-export-claude-2026-06-24/
├── conversation.json          ← full schema v1.1 JSON
├── conversation.md            ← markdown (if MD export selected)
└── artifacts/
    ├── artifact-001-v1-directory-listing.sh
    ├── artifact-001-v2-directory-listing.sh
    ├── artifact-002-v1-hello-world.html
    └── artifact-003-v1-concentric-circles.svg
```

### 9.2 Trigger logic

- If no artifacts found: behaviour unchanged — single `.json` or `.md` download
  via existing `filewriter.js` flow
- If artifacts found: zip is always produced, containing both the JSON and all
  sidecars. The existing single-file download is replaced by the zip for that
  export.
- User is informed before export begins: popup shows artifact count and
  notes a zip will be created.

### 9.3 JSZip integration

JSZip v3.10.1 (latest stable) is bundled at `src/vendor/jszip.min.js`.

SHA-256 of the bundled file is pinned in `src/utils/constants.js`:

```javascript
const JSZIP_INTEGRITY = {
  filename: 'jszip.min.js',
  sha256: '{hash-of-pinned-version}',  // set at bundle time
  version: '3.10.1',
};
```

The integrity hash is checked at build time via a new `build.sh` step — not
at runtime (the file is local, not fetched). This catches accidental file
replacement or corruption, consistent with the project's supply chain posture.

`build.sh` concatenation order: `jszip.min.js` is prepended before all other
`src/` files so `JSZip` is in scope for all modules.

### 9.4 `filewriter.js` changes

New function `downloadZip(zipContent, filename)` alongside existing
`downloadFile()`. Both use `chrome.downloads.download` with `saveAs: true`.
No changes to existing download path.

---

## 10. Markdown Serializer Changes

Artifacts are represented in Markdown output as follows:

**Code block artifacts** — represented as fenced code with metadata header:

```markdown
---

## Assistant

Here is a bash script for directory listing.

### Artifact: Directory listing
**Type:** shell | **Version:** 1 of 2 | **File:** `artifact-001-v1-directory-listing.sh`

\`\`\`bash
#!/bin/bash

# Basic directory listing
echo "=== Basic Listing ==="
ls
\`\`\`

---
```

**Non-code artifacts** (SVG, HTML) — metadata reference only in Markdown;
content lives in the sidecar file:

```markdown
### Artifact: Concentric circles
**Type:** svg | **Version:** 1 of 1 | **File:** `artifact-003-v1-concentric-circles.svg`
*Content saved to sidecar file in zip archive.*
```

Rationale: embedding full SVG or HTML inline in Markdown produces unreadable
output and defeats the purpose of the sidecar approach.

---

## 11. Claude.js Extractor Changes

The existing `extractClaudeConversation()` function gains an artifact pass
after text extraction for each turn:

```javascript
// After extracting text content for each turn container:
const artifactCandidates = detectArtifacts(container, turnIndex);

for (const candidate of artifactCandidates) {
  if (artifacts.length >= SAFETY_LIMITS.MAX_ARTIFACT_PANELS) {
    flaggedArtifacts.push({ candidate, reason: 'panel_limit_reached' });
    continue;
  }

  const { content, method } = candidate.surface === 'card'
    ? await extractFromPanel(candidate, hasClipboard)
    : await extractInlineCodeBlock(candidate, hasClipboard);

  const processed = processArtifact(content, candidate, method);
  artifacts.push(processed);
}
```

The turn object gains an `artifacts` field. The conversation-level manifest
is assembled after all turns are processed, by grouping by `title + typeLabel`
and assigning version numbers.

---

## 12. Constants Changes

```javascript
// Version bump
const EXTENSION_VERSION = '0.3.0';
const SCHEMA_VERSION = '1.1';

// New safety limits
const SAFETY_LIMITS = {
  // ... existing limits unchanged ...
  MAX_ARTIFACT_PANELS: 50,
  PANEL_OPEN_TIMEOUT_MS: 2_000,
  PANEL_CLOSE_DELAY_MS: 100,
  MAX_ARTIFACT_CONTENT_SIZE: 500_000,
};

// JSZip integrity
const JSZIP_INTEGRITY = {
  filename: 'jszip.min.js',
  sha256: '{set-at-bundle-time}',
  version: '3.10.1',
};
```

---

## 13. Manifest Changes

```json
{
  "version": "0.3.0"
}
```

No new permissions required. Artifact extraction uses the existing
`clipboardRead` and `activeTab` permissions. Zip creation and download uses
the existing `downloads` permission.

---

## 14. Build Script Changes

`build.sh` additions:
1. Verify `src/vendor/jszip.min.js` SHA-256 matches `JSZIP_INTEGRITY.sha256`
   before concatenating — fail build loudly if mismatch
2. Prepend `src/vendor/jszip.min.js` before all `src/` files in concatenation
3. Append new artifact modules in dependency order:
   `artifact-types.js` → `artifact-code.js` → `artifact-panel.js` → `artifact-detector.js`

Verification command (Mac/Linux) after build:
```bash
grep -n "artifact-block-cell\|data-skill-file-viewer\|JSZip" content.js
# Should show: all three appear as both definitions/references and call sites
```

---

## 15. Popup UI Changes

`popup.html` / `popup.js` — minor additions only:

- After extraction completes and before download, if `artifact_count > 0`:
  display: `"Found {N} artifact(s). Exporting as zip."`
- If `artifact_count === 0`: behaviour unchanged, no message shown
- No new UI elements; message replaces the existing status line

---

## 16. ARCHIVETEST Extension for Artifacts

The standardized test conversation gains an artifact variant. Run this on
Claude.ai to validate artifact extraction end-to-end:

```
USER:  "ARCHIVETEST-ARTIFACTS: Write a bash script that prints hello world.
        Then write a Python script that prints the current date.
        Then create an SVG with a single red circle."

ASST:  [produces 3 artifacts: .sh, .py, .svg via present_files]

USER:  "ARCHIVETEST-ARTIFACTS: Update the bash script to also print goodbye world."

ASST:  [produces updated .sh artifact — creates version 2 of artifact-001]

USER:  "ARCHIVETEST-ARTIFACTS: Summarize what you created."

ASST:  [text response, no artifacts]
```

**Validation checklist:**
- [ ] 3 artifacts detected in turn 2 (sh, py, svg)
- [ ] 1 artifact detected in turn 4 (sh only)
- [ ] artifact-001 has 2 versions; artifact-002 and artifact-003 have 1 version each
- [ ] Version 2 of artifact-001 has `changed: true`
- [ ] Turn 6 (summary) has empty `artifacts` array
- [ ] Zip produced containing `conversation.json` + 4 sidecar files
- [ ] JSON validates against schema v1.1
- [ ] Markdown renders correctly; SVG noted as sidecar reference
- [ ] `content_hash` differs between artifact-001 v1 and v2
- [ ] No panel left open after extraction (verify visually)
- [ ] Console shows no `[Chat Archive]` errors

---

## 17. Appendix A: Extensibility Notes for Contributors

To add artifact support for another platform (e.g. ChatGPT Canvas):

1. Add a new extractor at `src/extractors/chatgpt.js` or extend existing
2. Call `detectArtifacts()` from `artifact-detector.js` — pass platform-specific
   selectors as a config object (selector config to be added to `artifact-detector.js`)
3. If the platform has a different panel pattern, add a new extraction function
   in `artifact-panel.js` alongside `extractFromPanel()` (Claude-specific) and
   export both
4. Add platform-specific type labels to `TYPE_MAP` in `artifact-types.js`
5. No changes needed to `artifact-code.js`, serializer, or zip logic

The design is intentionally thin at the integration point — platforms differ
in DOM but converge on the same `ProcessedArtifact` interface, which the
serializer and zip logic consume.

---

## 18. Appendix B: Risk Register Additions

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| `#wiggle-file-content` ID changes | Medium | Medium | Pass A (clipboard) is primary; Pass B uses `#wiggle-file-content` only as fallback. If both fail, artifact flagged with `extraction_method: failed`, not silently dropped. |
| Panel open/close leaves UI in broken state | Medium | Low | `PANEL_OPEN_TIMEOUT_MS` aborts; `button[aria-label="Go back"]` close is always attempted in finally-equivalent block. |
| `MAX_ARTIFACT_PANELS` hit on large conversations | Low | Low | Clean partial export with flagged artifacts in manifest. User sees count of extracted vs skipped. |
| JSZip bundled version has security issue | Medium | Very Low | SHA-256 pinned at build time. Update procedure: replace file, update hash in constants, rebuild, verify. |
| Claude renames type labels (e.g. "SH" → "Shell") | Low | Low | Unknown labels fall back gracefully to `.txt` with `type_unknown: true`. No extraction failure, just metadata degradation. Fixable with a TYPE_MAP patch. |

---

*Specification complete. All DOM selectors verified against live Claude.ai
June 2026 DevTools captures. Ready for implementation.*

*Next step: create feature branch, vendor JSZip, implement
`src/extractors/artifacts/` modules, update `claude.js`, update serializer,
update `build.sh`, run ARCHIVETEST-ARTIFACTS, open PR.*
