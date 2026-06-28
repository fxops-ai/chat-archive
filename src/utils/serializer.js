// =============================================================================
// Chat Archive — Serializer
// =============================================================================
// Transforms extracted turns into JSON (canonical format) and Markdown.
//
// CHANGELOG
// v0.2.1 — Fix: Escape HTML entities in Markdown output to prevent tag
//           contamination. Raw HTML in assistant content (e.g. <style>, <div>)
//           was breaking Markdown renderers by entering HTML mode mid-document.
//           JSON output is unaffected — raw content is preserved as-is there.
//           GitHub issue: HTML tag contamination in .md export (turn 20 bug)

/**
 * Escape HTML entities in a string for safe Markdown output.
 * Only applied in the Markdown serialization path — JSON stores raw content.
 *
 * Escapes: < > & " '
 * This prevents any HTML tags in conversation content from being interpreted
 * as HTML by Markdown renderers, which can corrupt all subsequent formatting.
 *
 * @param {string} text - Raw content string
 * @returns {string} - Content safe for Markdown output
 */
function escapeHtmlForMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')   // Must be first — avoids double-escaping
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize extracted turns into the canonical JSON export format.
 * JSON stores raw, unescaped content — this is the source of truth.
 *
 * @param {Object} extraction - Result from an extractor { turns, errors, partial }
 * @param {string} platform - Platform identifier (e.g., 'claude')
 * @returns {Object} { json: string, metadata: Object, integrityWarnings: string[] }
 */
function serializeToJSON(extraction, platform) {
  const integrityWarnings = runIntegrityChecks(extraction.turns);

  const exportData = {
    schema_version: SCHEMA_VERSION,
    export_metadata: {
      source_platform: platformToDisplayName(platform),
      source_url: window.location.href,
      export_timestamp: new Date().toISOString(),
      extension_version: EXTENSION_VERSION,
      total_turns: extraction.turns.length,
      flagged_turns: extraction.turns.filter((t) => t.flagged).length,
      partial_export: extraction.partial || false,
      extraction_errors: extraction.errors || [],
      integrity_warnings: integrityWarnings,
      has_artifacts:  (extraction.artifactManifest || []).length > 0,
      artifact_count: (extraction.artifactManifest || []).length,
      ...((extraction.artifactManifest || []).length > 0 && {
        zip_filename: generateFilename(platform, 'zip'),
      }),
    },
    artifact_manifest: extraction.artifactManifest || [],
    conversation: extraction.turns.map((turn, index) => ({
      turn: index + 1,
      role: turn.role,
      content: turn.content,           // Raw content — no escaping in JSON
      classification_confidence: turn.confidence || null,
      classification_source: turn.classificationSource || 'manual',
      extraction_method: turn.extractionMethod || 'direct',
      ...(turn.timestamp && { timestamp: turn.timestamp }),
      ...(turn.flagged && { flagged: true, flag_reason: turn.flagReason }),
      artifacts: turn.artifacts || [],
    })),
  };

  return {
    json: JSON.stringify(exportData, null, 2),
    metadata: exportData.export_metadata,
    integrityWarnings,
    artifactManifest: extraction.artifactManifest || [],
    sidecarFiles:     extraction.sidecarFiles     || [],
  };
}

/**
 * Serialize extracted turns into Markdown format.
 * HTML entities are escaped in content to prevent tag contamination.
 *
 * @param {Object} extraction - Result from an extractor { turns, errors, partial }
 * @param {string} platform - Platform identifier (e.g., 'claude')
 * @returns {Object} { markdown: string, metadata: Object, integrityWarnings: string[] }
 */
function serializeToMarkdown(extraction, platform) {
  const integrityWarnings = runIntegrityChecks(extraction.turns);
  const exportTimestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const platformName = platformToDisplayName(platform);

  // Build sidecar content lookup: sidecar_filename → content string.
  // Binary sidecars (Uint8Array, from binary_fetch) are excluded — rendering
  // binary bytes as Markdown text is meaningless, and their manifest entries
  // are handled by the non-code else branch below.
  const sidecarContentMap = new Map(
    (extraction.sidecarFiles || [])
      .filter(f => typeof f.content === 'string')
      .map(f => [f.filename, f.content])
  );
  // Build manifest lookup: `${artifact_id}|${version_number}` → version object
  const manifestVersionMap = new Map();
  for (const entry of (extraction.artifactManifest || [])) {
    for (const v of entry.versions) {
      manifestVersionMap.set(`${entry.artifact_id}|${v.version_number}`, {
        ...v,
        version_count: entry.version_count,
        canonical_type: entry.canonical_type,
      });
    }
  }

  const lines = [];

  // Header
  lines.push(`# Chat Export — ${platformName}`);
  lines.push(`**Exported:** ${exportTimestamp}  `);
  lines.push(`**Source:** ${window.location.href}  `);
  lines.push(`**Turns:** ${extraction.turns.length}`);

  if (extraction.partial) {
    lines.push(`\n> ⚠️ **Partial export** — some turns may be missing. Check JSON export for details.`);
  }

  lines.push('\n---\n');

  // Turns
  for (const turn of extraction.turns) {
    const roleLabel = turn.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${roleLabel}`);

    if (turn.timestamp) {
      lines.push(`*${turn.timestamp}*\n`);
    }

    // v0.2.1: Escape HTML entities to prevent tag contamination in Markdown renderers.
    // Raw HTML in content (e.g. <style>, <div>, <script>) would otherwise cause
    // renderers to enter HTML mode, breaking all subsequent Markdown formatting.
    const safeContent = escapeHtmlForMarkdown(turn.content || '');
    lines.push(safeContent);

    if (turn.flagged) {
      lines.push(`\n> ⚠️ *Flagged: ${turn.flagReason || 'Unknown reason'}*`);
    }

    // Artifact blocks
    const CODE_TYPES = new Set([
      'shell', 'python', 'javascript', 'typescript', 'jsx', 'tsx',
      'css', 'json', 'yaml', 'sql', 'markdown', 'text',
      'c', 'cpp', 'rust', 'go', 'java', 'kotlin', 'swift',
      'ruby', 'php', 'r', 'dockerfile', 'makefile', 'terraform', 'powershell',
    ]);

    for (const ref of (turn.artifacts || [])) {
      const versionData = manifestVersionMap.get(`${ref.artifact_id}|${ref.version_number}`);
      if (!versionData) continue;

      const { canonical_type, version_number, version_count, sidecar_filename } = versionData;
      const title = ref.title;

      lines.push('');
      lines.push(`### Artifact: ${title}`);
      // sidecar_filename is null for browser_download artifacts — show expected filename instead
      const fileRef = sidecar_filename
        ? ` | **File:** \`${sidecar_filename}\``
        : (versionData.expected_filename
            ? ` | **Expected:** \`${versionData.expected_filename}\``
            : '');
      lines.push(`**Type:** ${canonical_type} | **Version:** ${version_number} of ${version_count}${fileRef}`);

      if (CODE_TYPES.has(canonical_type)) {
        const content = sidecarContentMap.get(sidecar_filename) || '';
        lines.push('');
        lines.push('```' + canonical_type);
        lines.push(escapeHtmlForMarkdown(content));
        lines.push('```');
      } else {
        // Non-code types: SVG, HTML, and binary formats (PPTX, DOCX, XLSX).
        // Content lives in the sidecar file rather than inline in Markdown.
        if (versionData.extraction_method === 'browser_download') {
          lines.push(
            `*Binary artifact downloaded to your Downloads folder — ` +
            `see \`binary-downloads-readme.txt\` for instructions.*`
          );
        } else {
          lines.push('*Content saved to sidecar file in zip archive.*');
        }
      }
    }

    lines.push('\n---\n');
  }

  // Footer
  lines.push(`*Exported by Chat Archive v${EXTENSION_VERSION}*`);

  const metadata = {
    source_platform: platformName,
    source_url: window.location.href,
    export_timestamp: new Date().toISOString(),
    extension_version: EXTENSION_VERSION,
    total_turns: extraction.turns.length,
    flagged_turns: extraction.turns.filter((t) => t.flagged).length,
    partial_export: extraction.partial || false,
    extraction_errors: extraction.errors || [],
    integrity_warnings: integrityWarnings,
  };

  return {
    markdown: lines.join('\n'),
    metadata,
    integrityWarnings,
    artifactManifest: extraction.artifactManifest || [],
    sidecarFiles:     extraction.sidecarFiles     || [],
  };
}

/**
 * Run integrity checks on the extracted turns before serialization.
 * These are sanity checks, not security enforcement.
 */
function runIntegrityChecks(turns) {
  const warnings = [];

  if (turns.length === 0) {
    warnings.push('No turns extracted');
    return warnings;
  }

  // Check 1: Turn alternation pattern
  let alternationViolations = 0;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].role === turns[i - 1].role) {
      alternationViolations++;
    }
  }
  if (alternationViolations > 0) {
    warnings.push(
      `${alternationViolations} consecutive same-role turn(s) detected. ` +
        'This may indicate missed turns or system messages.'
    );
  }

  // Check 2: Consecutive duplicate content
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].content === turns[i - 1].content && turns[i].content.length > 0) {
      warnings.push(`Duplicate content detected between turns ${i} and ${i + 1}`);
    }
  }

  // Check 3: Suspiciously large turns
  const largeTurns = turns.filter((t) => t.content.length > SAFETY_LIMITS.MAX_SINGLE_TURN_SIZE);
  if (largeTurns.length > 0) {
    warnings.push(`${largeTurns.length} turn(s) exceed 100KB`);
  }

  // Check 4: Empty turns
  const emptyTurns = turns.filter((t) => !t.content || t.content.trim().length === 0);
  if (emptyTurns.length > 0) {
    warnings.push(`${emptyTurns.length} empty turn(s) detected`);
  }

  return warnings;
}

/**
 * Map platform ID to user-facing display name.
 */
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