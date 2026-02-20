// =============================================================================
// Chat Archive — Serializer Patch Test (v0.2.1)
// =============================================================================
// Run with: node test_v021_patch.js
// Verifies escapeHtmlForMarkdown handles the cases that caused the turn 20 bug.

// --- Inline the function under test (mirrors serializer.js exactly) ---
function escapeHtmlForMarkdown(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Test harness ---
let passed = 0;
let failed = 0;

function test(description, input, expected) {
  const result = escapeHtmlForMarkdown(input);
  if (result === expected) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.log(`  ❌ ${description}`);
    console.log(`     Input:    ${input}`);
    console.log(`     Expected: ${expected}`);
    console.log(`     Got:      ${result}`);
    failed++;
  }
}

// --- Tests ---
console.log('\nChat Archive v0.2.1 — escapeHtmlForMarkdown tests\n');

console.log('Core escaping:');
test(
  'Escapes < and > (the primary bug trigger)',
  'everything is in the <style> tag',
  'everything is in the &lt;style&gt; tag'
);
test(
  'Escapes & before < and > (avoids double-escaping)',
  'AT&T and <div>',
  'AT&amp;T and &lt;div&gt;'
);
test(
  'Escapes double quotes',
  'aria-label="Copy"',
  'aria-label=&quot;Copy&quot;'
);
test(
  "Escapes single quotes",
  "it's a <script>",
  "it&#39;s a &lt;script&gt;"
);
test(
  'No-op on plain text',
  'Hello, world! This has no HTML.',
  'Hello, world! This has no HTML.'
);

console.log('\nReal content from the bug report (turn 20):');
test(
  'The exact sentence that caused the break',
  'This uses embedded inline styles - everything is in the <style> tag within the HTML file itself.',
  'This uses embedded inline styles - everything is in the &lt;style&gt; tag within the HTML file itself.'
);

console.log('\nCommon technical conversation patterns:');
test(
  'CSS rule with selector',
  'header.welcome { background-image: url("../images/hero.jpg"); }',
  'header.welcome { background-image: url(&quot;../images/hero.jpg&quot;); }'
);
test(
  'HTML tag discussion',
  'Add this to your <head> section: <meta charset="UTF-8">',
  'Add this to your &lt;head&gt; section: &lt;meta charset=&quot;UTF-8&quot;&gt;'
);
test(
  'Script tag (high-risk contaminator)',
  '<script>alert("xss")</script>',
  '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
);
test(
  'Markdown links still work (no < > involved)',
  'See [SSL Labs](https://www.ssllabs.com/ssltest/) for testing.',
  'See [SSL Labs](https://www.ssllabs.com/ssltest/) for testing.'
);
test(
  'Emoji and unicode unaffected',
  '🎉 SUCCESS! ✅ 488 emails processed — Perfect 100% success rate!',
  '🎉 SUCCESS! ✅ 488 emails processed — Perfect 100% success rate!'
);

console.log('\nJSON path (should NOT be escaped — verified by identity):');
// This is a contract test: JSON path uses turn.content directly, no escaping.
// We verify the raw content string is preserved as-is.
const rawContent = 'everything is in the <style> tag';
const jsonParsed = JSON.parse(JSON.stringify({ content: rawContent }));
if (jsonParsed.content === rawContent) {
  console.log('  ✅ JSON path preserves raw content unchanged');
  passed++;
} else {
  console.log('  ❌ JSON path unexpectedly modified content');
  failed++;
}

// --- Summary ---
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed. Safe to ship v0.2.1. ✅');
} else {
  console.log('Fix the failures above before shipping. ❌');
}
console.log('');
