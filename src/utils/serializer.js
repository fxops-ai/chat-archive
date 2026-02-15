// =============================================================================
// Chat Archive — Serializer (JSON + Markdown)
// =============================================================================
// Transforms extracted turns into durable export formats.
// JSON is the canonical format. Markdown is the human-readable format.
// Both are addressable artifacts — they have destinations beyond the export.

/**
 * Serialize extracted turns into the canonical JSON export format.
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
    },
    conversation: extraction.turns.map((turn, index) => {
      const entry = {
        turn: index + 1,
        role: turn.role || 'unknown',
        content: turn.content,
        classification_confidence: turn.confidence || null,
        classification_source: turn.classificationSource || 'unknown',
      };

      // Optional fields
      if (turn.timestamp) entry.timestamp = turn.timestamp;
      if (turn.flagged) {
        entry.flagged = true;
        entry.flag_reason = turn.flagReason;
      }
      if (turn.extractionMethod) entry.extraction_method = turn.extractionMethod;
      if (turn.turnId) entry.turn_id = turn.turnId;
      if (turn.modelSlug) entry.model = turn.modelSlug;
      if (turn.needsUserResolution) entry.needs_user_resolution = true;

      return entry;
    }),
  };

  return {
    json: JSON.stringify(exportData, null, 2),
    metadata: exportData.export_metadata,
    integrityWarnings,
  };
}

/**
 * Serialize extracted turns into Markdown format.
 */
function serializeToMarkdown(extraction, platform) {
  const integrityWarnings = runIntegrityChecks(extraction.turns);

  const platformName = platformToDisplayName(platform);
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const sourceUrl = window.location.href;

  const lines = [];

  // --- Header ---
  lines.push(`# Chat Export — ${platformName}`);
  lines.push(`**Exported:** ${timestamp}  `);
  lines.push(`**Source:** ${sourceUrl}  `);
  lines.push(`**Turns:** ${extraction.turns.length}`);

  if (extraction.partial) {
    lines.push(`**Status:** Partial export (${extraction.errors.length} errors)`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // --- Turns ---
  for (let i = 0; i < extraction.turns.length; i++) {
    const turn = extraction.turns[i];
    const role = turn.role || 'Unknown';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

    lines.push(`## ${roleLabel}`);

    if (turn.timestamp) {
      lines.push(`*${turn.timestamp}*`);
      lines.push('');
    }

    // Content: preserve as-is (clipboard extraction gives us markdown already)
    lines.push(turn.content || '*(empty)*');

    if (turn.flagged) {
      lines.push('');
      lines.push(`> ⚠️ ${turn.flagReason || 'Flagged'}`);
    }

    if (turn.needsUserResolution) {
      lines.push('');
      lines.push('> ⚠️ Role classification uncertain — may need manual correction');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // --- Footer ---
  if (integrityWarnings.length > 0) {
    lines.push('## Export Notes');
    lines.push('');
    for (const warning of integrityWarnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push(`*Exported by Chat Archive v${EXTENSION_VERSION}*`);

  return {
    markdown: lines.join('\n'),
    metadata: {
      source_platform: platformName,
      source_url: sourceUrl,
      export_timestamp: new Date().toISOString(),
      extension_version: EXTENSION_VERSION,
      total_turns: extraction.turns.length,
      flagged_turns: extraction.turns.filter((t) => t.flagged).length,
      partial_export: extraction.partial || false,
    },
    integrityWarnings,
  };
}

/**
 * Run integrity checks on extracted turns before serialization.
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

  // Check 5: Unresolved roles
  const unknownRoles = turns.filter((t) => !t.role || t.role === 'unknown');
  if (unknownRoles.length > 0) {
    warnings.push(`${unknownRoles.length} turn(s) with unknown roles`);
  }

  return warnings;
}
