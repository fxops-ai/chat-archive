// =============================================================================
// Chat Archive — Artifact Content Processor
// =============================================================================
// Post-processes raw artifact content by canonical type:
//   - Computes SHA-256 content_hash (for dedup and `changed` flag in manifest)
//   - Validates content structure (malformed flag)
//   - Extracts supplementary type-specific metadata
//   - Flags oversized content
//
// Entry point: processArtifact(content, candidate, method)
//
// Also exports: slugify(title)
//   Used by manifest assembly in claude.js to build sidecar filenames.
//   Lives here because it operates on artifact titles, not turn content.
//
// Dependencies (all injected via build concatenation order):
//   constants.js    — SAFETY_LIMITS, computeSHA256()
//   artifact-types.js — (canonical type names referenced as string constants)
// =============================================================================

/**
 * Process raw artifact content into a structured result.
 * Called once per artifact per turn, for both card and code_block surfaces.
 *
 * @param {string|null}       content   - Raw string from extraction; null if extraction failed
 * @param {ArtifactCandidate} candidate - Descriptor from artifact-detector.js
 * @param {string}            method    - 'clipboard'|'dom_walk'|'inline_clipboard'|'inline_direct'|'failed'
 * @returns {Promise<ProcessedArtifact>}
 */
async function processArtifact(content, candidate, method) {
  // --- Binary fetch: content is Uint8Array ---
  // Returned by attemptBinaryExtraction when the binary panel download was
  // intercepted, fetched, and fits within BINARY_FETCH_MAX_SIZE.
  if (method === 'binary_fetch' && content instanceof Uint8Array) {
    const byteCount  = content.byteLength;
    const oversized  = byteCount > SAFETY_LIMITS.BINARY_FETCH_MAX_SIZE;
    const content_hash = await computeSHA256Binary(content);
    return {
      title:             candidate.title,
      canonical_type:    candidate.canonicalType,
      extension:         candidate.extension,
      surface:           candidate.surface,
      content,           // Uint8Array — added to zip as binary in claude.js
      content_hash,
      byte_count:        byteCount,
      char_count:        0,
      line_count:        0,
      extraction_method: 'binary_fetch',
      malformed:         false,
      type_unknown:      candidate.canonicalType === 'unknown',
      oversized,
      supplementary:     {},
    };
  }

  // --- Browser download fallback: content is null ---
  // Returned by attemptBinaryExtraction when interception or fetch failed.
  // The file landed (or should have landed) in the user's Downloads folder.
  // claude.js must NOT create a sidecar for this; serializer generates a readme entry.
  if (method === 'browser_download') {
    const expectedFilename =
      (content?.expected_filename) ||
      (candidate.title.replace(/[<>:"/\\|?*]/g, '_') + candidate.extension);
    return {
      title:             candidate.title,
      canonical_type:    candidate.canonicalType,
      extension:         candidate.extension,
      surface:           candidate.surface,
      content:           null,
      content_hash:      '',
      byte_count:        null,
      char_count:        0,
      line_count:        0,
      extraction_method: 'browser_download',
      expected_filename: expectedFilename,
      malformed:         false,
      type_unknown:      candidate.canonicalType === 'unknown',
      oversized:         false,
      supplementary:     {},
    };
  }

  // --- Text content (all other methods) ---
  const safeContent = (content ?? '').trim();
  const canonical   = candidate.canonicalType;
  const oversized   = safeContent.length > SAFETY_LIMITS.MAX_ARTIFACT_CONTENT_SIZE;
  const type_unknown = canonical === 'unknown';

  // Per-type post-processing (validation + supplementary metadata)
  let malformed    = false;
  let supplementary = {};

  if (safeContent.length > 0 && !type_unknown) {
    const result  = runTypeHandler(safeContent, canonical);
    malformed     = result.malformed;
    supplementary = result.supplementary;
  }

  // SHA-256 content hash — empty string when content is absent
  const content_hash = safeContent.length > 0
    ? await computeSHA256(safeContent)
    : '';

  if (type_unknown && safeContent.length > 0) {
    console.warn(
      `[Chat Archive] Unknown artifact type label: "${candidate.typeLabel}" — content saved as .txt`
    );
  }

  if (method === 'failed') {
    console.warn(
      `[Chat Archive] Artifact extraction failed for "${candidate.title}" — empty content in manifest`
    );
  }

  return {
    title:             candidate.title,
    canonical_type:    canonical,
    extension:         candidate.extension,
    surface:           candidate.surface,
    content:           safeContent,
    content_hash,
    line_count:        safeContent.length > 0 ? safeContent.split('\n').length : 0,
    char_count:        safeContent.length,
    extraction_method: method,
    malformed,
    type_unknown,
    oversized,
    supplementary,
  };
}

// --- Per-Type Post-Processors ---
// All receive a non-empty content string.
// All return { malformed: boolean, supplementary: Object }.
// None may throw — parse errors set malformed: true and log a warning.

/**
 * Dispatch to the appropriate type handler.
 * Types not listed here are valid but need no post-processing.
 */
function runTypeHandler(content, canonical) {
  switch (canonical) {
    case 'html': return processHtml(content);
    case 'svg':  return processSvg(content);
    default:     return { malformed: false, supplementary: {} };
  }
}

/**
 * HTML handler.
 * Supplementary: page_title (from <title> tag, if present).
 * Malformed: content doesn't begin with <!DOCTYPE or <html (case-insensitive).
 * HTML fragments (e.g. a bare <div>) are flagged but still extracted.
 */
function processHtml(content) {
  const trimmed  = content.trimStart().toLowerCase();
  const malformed = !trimmed.startsWith('<!doctype') && !trimmed.startsWith('<html');

  if (malformed) {
    console.warn(
      '[Chat Archive] HTML artifact does not start with <!DOCTYPE or <html — flagged malformed'
    );
  }

  let page_title = null;
  try {
    const doc  = new DOMParser().parseFromString(content, 'text/html');
    page_title = doc.querySelector('title')?.textContent?.trim() || null;
  } catch {
    // DOMParser unavailable or threw — non-fatal, page_title stays null
  }

  return {
    malformed,
    supplementary: page_title ? { page_title } : {},
  };
}

/**
 * SVG handler.
 * Supplementary: viewBox, width, height from the root <svg> element.
 * Malformed: content doesn't contain '<svg'.
 */
function processSvg(content) {
  const malformed = !content.includes('<svg');

  if (malformed) {
    console.warn('[Chat Archive] SVG artifact does not contain <svg — flagged malformed');
  }

  const supplementary = {};

  if (!malformed) {
    try {
      const doc        = new DOMParser().parseFromString(content, 'image/svg+xml');
      const parseError = doc.querySelector('parsererror');

      if (!parseError) {
        const svgEl = doc.querySelector('svg');
        if (svgEl) {
          const viewBox = svgEl.getAttribute('viewBox');
          const width   = svgEl.getAttribute('width');
          const height  = svgEl.getAttribute('height');
          if (viewBox) supplementary.viewBox = viewBox;
          if (width)   supplementary.width   = width;
          if (height)  supplementary.height  = height;
        }
      }
    } catch {
      // DOMParser failure — non-fatal, supplementary stays empty
    }
  }

  return { malformed, supplementary };
}

// --- Slug Utility ---

/**
 * Generate a URL-safe slug from an artifact title for use in sidecar filenames.
 * Filename pattern:  artifact-{id}-v{version}-{slug}{extension}
 * Example:  artifact-001-v2-directory-listing.sh
 *
 * Rules:
 *   - Lowercase
 *   - Spaces → hyphens
 *   - Non-alphanumeric (except hyphens) → removed
 *   - Consecutive hyphens collapsed to one
 *   - Leading/trailing hyphens stripped
 *   - Capped at 40 characters, breaking at a hyphen where possible
 *   - Falls back to 'artifact' if title reduces to an empty string
 *
 * @param {string} title - Artifact title from DOM
 * @returns {string}     - URL-safe slug, 1–40 characters
 */
function slugify(title) {
  let slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return 'artifact';
  if (slug.length <= 40) return slug;

  // Truncate at 40, preferring a word boundary (last hyphen past position 20)
  let truncated = slug.slice(0, 40);
  const lastHyphen = truncated.lastIndexOf('-');
  if (lastHyphen > 20) {
    truncated = truncated.slice(0, lastHyphen);
  }

  return truncated || 'artifact';
}