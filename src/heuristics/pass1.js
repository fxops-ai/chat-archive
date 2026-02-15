// =============================================================================
// Chat Archive — Pass 1: Structural Heuristics
// =============================================================================
// Classifies turns using rule-based pattern detection when Pass 0
// (button extraction) didn't produce confident role assignments.
//
// Heuristic rules are ordered by confidence:
//   H1: Explicit role attributes (0.95)
//   H2: Alternating binary pattern (0.85)
//   H3: Asymmetric text length (0.70)
//   H4: Background color differentiation (0.75)
//   H5: Alignment pattern (0.80)
//   H6: Avatar/icon presence (0.70)
//   H7: Code block density (0.60)
//
// Combined confidence = weighted average of all firing rules.
// Threshold: 0.75 — accept classification if combined >= 0.75

const HEURISTIC_THRESHOLD = 0.75;

/**
 * Run heuristic classification on an array of extracted turns.
 * Turns that already have confidence >= threshold are left untouched.
 * Turns with lower confidence (or no role) get heuristic analysis.
 *
 * @param {Array} turns - Array of turn objects from extractors
 * @returns {Array} Same array with updated role/confidence/classificationSource
 */
function applyHeuristics(turns) {
  if (turns.length === 0) return turns;

  // Collect turns that need classification
  const needsClassification = [];
  for (let i = 0; i < turns.length; i++) {
    if (!turns[i].role || (turns[i].confidence || 0) < HEURISTIC_THRESHOLD) {
      needsClassification.push(i);
    }
  }

  if (needsClassification.length === 0) {
    console.log('[Chat Archive] Heuristics: All turns already classified at high confidence');
    return turns;
  }

  console.log(`[Chat Archive] Heuristics: ${needsClassification.length} turns need classification`);

  // Run each heuristic rule across the full conversation for context
  const results = turns.map((turn, index) => ({
    index,
    scores: { user: 0, assistant: 0 },
    rulesApplied: [],
    totalWeight: 0,
  }));

  // H1: Explicit role attributes (already handled by extractors, but double-check)
  applyH1ExplicitRoles(turns, results);

  // H2: Alternating binary pattern
  applyH2AlternatingPattern(turns, results);

  // H3: Asymmetric text length
  applyH3TextLength(turns, results);

  // H4: Background color / styling differentiation (requires DOM — use cached data)
  // (Skipped in post-extraction heuristics — this runs on already-extracted text)

  // H5: Content-based alignment signals (encoded in content or metadata)
  applyH5ContentSignals(turns, results);

  // H7: Code block density
  applyH7CodeBlocks(turns, results);

  // Apply results to turns that need classification
  for (const idx of needsClassification) {
    const result = results[idx];
    if (result.totalWeight === 0) continue;

    const userScore = result.scores.user / result.totalWeight;
    const assistantScore = result.scores.assistant / result.totalWeight;
    const confidence = Math.max(userScore, assistantScore);
    const role = userScore > assistantScore ? 'user' : 'assistant';

    if (confidence >= HEURISTIC_THRESHOLD) {
      turns[idx].role = role;
      turns[idx].confidence = parseFloat(confidence.toFixed(3));
      turns[idx].classificationSource = 'heuristic';
      turns[idx].heuristicRules = result.rulesApplied;
    } else {
      // Mark as uncertain for User Resolution UI
      turns[idx].confidence = parseFloat(confidence.toFixed(3));
      turns[idx].classificationSource = 'heuristic-uncertain';
      turns[idx].heuristicRules = result.rulesApplied;
      turns[idx].needsUserResolution = true;
    }
  }

  const resolved = needsClassification.filter(
    (i) => turns[i].confidence >= HEURISTIC_THRESHOLD && turns[i].role
  ).length;
  console.log(`[Chat Archive] Heuristics: Resolved ${resolved}/${needsClassification.length} turns`);

  return turns;
}

// --- Individual Heuristic Rules ---

/**
 * H1: Explicit role attributes in content or metadata.
 * Confidence: 0.95. Weight: 3.
 */
function applyH1ExplicitRoles(turns, results) {
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    // Already classified with high confidence from extractor
    if (turn.role && (turn.confidence || 0) >= 0.90) {
      const target = turn.role === 'user' ? 'user' : 'assistant';
      results[i].scores[target] += 3 * 0.95;
      results[i].totalWeight += 3;
      results[i].rulesApplied.push('H1-explicit');
    }
  }
}

/**
 * H2: Alternating binary pattern.
 * If we have high-confidence turns at known positions, the turns between them
 * should alternate. Confidence: 0.85. Weight: 2.
 */
function applyH2AlternatingPattern(turns, results) {
  // Find anchor points (turns with high confidence)
  const anchors = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role && (turns[i].confidence || 0) >= 0.90) {
      anchors.push({ index: i, role: turns[i].role });
    }
  }

  if (anchors.length === 0) {
    // No anchors — assume first turn is user (most conversations start this way)
    for (let i = 0; i < turns.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
      results[i].scores[expectedRole] += 2 * 0.85;
      results[i].totalWeight += 2;
      results[i].rulesApplied.push('H2-alternation-noanchor');
    }
    return;
  }

  // Propagate from anchors
  for (let i = 0; i < turns.length; i++) {
    // Find nearest anchor
    let nearest = anchors[0];
    let minDist = Math.abs(i - nearest.index);
    for (const anchor of anchors) {
      const dist = Math.abs(i - anchor.index);
      if (dist < minDist) {
        minDist = dist;
        nearest = anchor;
      }
    }

    // Expected role based on distance from anchor (alternating)
    const offset = i - nearest.index;
    const anchorIsUser = nearest.role === 'user';
    const expectedRole = (offset % 2 === 0) === anchorIsUser ? 'user' : 'assistant';

    // Confidence decreases with distance from anchor
    const distancePenalty = Math.max(0, 1 - minDist * 0.05);
    const weight = 2 * distancePenalty;

    results[i].scores[expectedRole] += weight * 0.85;
    results[i].totalWeight += weight;
    results[i].rulesApplied.push('H2-alternation');
  }
}

/**
 * H3: Asymmetric text length.
 * User messages tend to be shorter than assistant responses.
 * Confidence: 0.70. Weight: 1.
 */
function applyH3TextLength(turns, results) {
  if (turns.length < 2) return;

  // Calculate median text length
  const lengths = turns.map((t) => (t.content || '').length);
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median === 0) return;

  for (let i = 0; i < turns.length; i++) {
    const len = lengths[i];
    const ratio = len / median;

    // Short messages are more likely user turns
    if (ratio < 0.5) {
      results[i].scores.user += 1 * 0.70;
      results[i].totalWeight += 1;
      results[i].rulesApplied.push('H3-short');
    } else if (ratio > 2.0) {
      results[i].scores.assistant += 1 * 0.70;
      results[i].totalWeight += 1;
      results[i].rulesApplied.push('H3-long');
    }
    // Near-median: no signal
  }
}

/**
 * H5: Content-based signals.
 * Assistant messages tend to contain markdown formatting, lists, code blocks.
 * User messages tend to be questions or short directives.
 * Confidence: 0.65. Weight: 1.
 */
function applyH5ContentSignals(turns, results) {
  for (let i = 0; i < turns.length; i++) {
    const text = turns[i].content || '';

    // Assistant signals
    let assistantSignals = 0;
    if (text.includes('```')) assistantSignals += 2;          // Code fences
    if (/^\s*[-*]\s/m.test(text)) assistantSignals += 1;     // Bullet lists
    if (/^\s*\d+\.\s/m.test(text)) assistantSignals += 1;   // Numbered lists
    if (/^#{1,3}\s/m.test(text)) assistantSignals += 1;      // Markdown headings
    if (text.length > 500) assistantSignals += 1;             // Long content

    // User signals
    let userSignals = 0;
    if (text.endsWith('?')) userSignals += 2;                 // Questions
    if (text.length < 100) userSignals += 1;                  // Short
    if (/^(can you|please|help|what|how|why|when|where|who|is|are|do|does)/i.test(text)) {
      userSignals += 1;                                       // Question starters
    }

    if (assistantSignals > userSignals) {
      results[i].scores.assistant += 1 * 0.65;
      results[i].totalWeight += 1;
      results[i].rulesApplied.push('H5-content-assistant');
    } else if (userSignals > assistantSignals) {
      results[i].scores.user += 1 * 0.65;
      results[i].totalWeight += 1;
      results[i].rulesApplied.push('H5-content-user');
    }
  }
}

/**
 * H7: Code block density.
 * Messages with code blocks are almost always assistant turns.
 * Confidence: 0.60 (lower because users sometimes paste code too).
 * Weight: 1.
 */
function applyH7CodeBlocks(turns, results) {
  for (let i = 0; i < turns.length; i++) {
    const text = turns[i].content || '';
    const codeBlocks = (text.match(/```/g) || []).length / 2;

    if (codeBlocks >= 1) {
      results[i].scores.assistant += 1 * 0.60;
      results[i].totalWeight += 1;
      results[i].rulesApplied.push('H7-codeblocks');
    }
  }
}

/**
 * Post-heuristic integrity: verify the overall conversation makes sense.
 * Returns an array of warning strings.
 */
function heuristicIntegrityCheck(turns) {
  const warnings = [];

  // Check that we have at least some role diversity
  const roles = new Set(turns.map((t) => t.role).filter(Boolean));
  if (roles.size < 2 && turns.length > 1) {
    warnings.push('All turns classified as the same role — heuristics may have failed');
  }

  // Check for runs of same role > 3
  let maxRun = 0;
  let currentRun = 1;
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].role === turns[i - 1].role) {
      currentRun++;
      maxRun = Math.max(maxRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  if (maxRun > 3) {
    warnings.push(`${maxRun} consecutive turns with the same role detected`);
  }

  // Count uncertain turns
  const uncertain = turns.filter((t) => t.needsUserResolution).length;
  if (uncertain > 0) {
    warnings.push(`${uncertain} turn(s) could not be confidently classified`);
  }

  return warnings;
}
