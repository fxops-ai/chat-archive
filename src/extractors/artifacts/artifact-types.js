// =============================================================================
// Chat Archive — Artifact Type Mapping
// =============================================================================
// Maps DOM type labels (as shown in Claude's artifact cards and panel headers)
// to canonical type identifiers and file extensions.
//
// Two surfaces need mapping:
//   - Artifact cards:  raw label from div.text-xs.line-clamp-1.text-text-400
//                      e.g. "SH", "Code · HTML", "Image · SVG"
//   - Inline code blocks: language string from div.text-text-500.font-small
//                          e.g. "bash", "python", "javascript"
//
// Unknown labels degrade gracefully to { canonical: 'unknown', ext: '.txt' }
// with type_unknown: true in the ProcessedArtifact — no extraction failure.
// =============================================================================

// --- Artifact Card Type Labels ---
// Keys are the exact strings rendered in Claude's type label element.
// Values must remain in sync with artifact-code.js per-type handlers.
const TYPE_MAP = {
  // Shell / scripting
  'SH':            { canonical: 'shell',      ext: '.sh'   },
  // Python
  'PY':            { canonical: 'python',     ext: '.py'   },
  // JavaScript variants
  'JS':            { canonical: 'javascript', ext: '.js'   },
  'Code · JS':     { canonical: 'javascript', ext: '.js'   },
  'Code · React':  { canonical: 'jsx',        ext: '.jsx'  },
  // TypeScript variants
  'TS':            { canonical: 'typescript', ext: '.ts'   },
  'Code · TS':     { canonical: 'typescript', ext: '.ts'   },
  'Code · TSX':    { canonical: 'tsx',        ext: '.tsx'  },
  // Web
  'Code · HTML':   { canonical: 'html',       ext: '.html' },
  'CSS':           { canonical: 'css',        ext: '.css'  },
  'Code · CSS':    { canonical: 'css',        ext: '.css'  },
  // Image
  'Image · SVG':   { canonical: 'svg',        ext: '.svg'  },
  // Data / config
  'JSON':          { canonical: 'json',       ext: '.json' },
  'YAML':          { canonical: 'yaml',       ext: '.yaml' },
  'SQL':           { canonical: 'sql',        ext: '.sql'  },
  // Document
  'MD':            { canonical: 'markdown',   ext: '.md'   },
  // Text (plain artifact with no specific type)
  'TXT':           { canonical: 'text',       ext: '.txt'  },
  // Office / binary document formats
  // Card label format confirmed from DOM inspection (Jun 2026):
  //   "Presentation · PPTX\u00a0" — rendered by type label div + &nbsp; suffix.
  //   resolveType() normalises \u00a0 before lookup (see below).
  // Panel header h2 may show abbreviated form — both forms listed as fallback.
  'Presentation · PPTX': { canonical: 'pptx', ext: '.pptx' },
  'Document · DOCX':     { canonical: 'docx', ext: '.docx' },
  'Spreadsheet · XLSX':  { canonical: 'xlsx', ext: '.xlsx' },
  // Abbreviated panel-header fallbacks
  'PPTX':                { canonical: 'pptx', ext: '.pptx' },
  'DOCX':                { canonical: 'docx', ext: '.docx' },
  'XLSX':                { canonical: 'xlsx', ext: '.xlsx' },
};

// Fallback for labels not in TYPE_MAP.
// Preserves content and signals the metadata gap without failing extraction.
const UNKNOWN_TYPE = { canonical: 'unknown', ext: '.txt' };

/**
 * Resolve a raw DOM type label to a canonical type descriptor.
 *
 * Normalisation applied before lookup:
 *   1. Replace \u00a0 (&nbsp;) with regular space — Claude's type label div ends
 *      with &nbsp; which innerText renders as \u00a0, and String.trim() does NOT
 *      strip it. Without this step, "Presentation · PPTX\u00a0" misses the map.
 *   2. Collapse multiple spaces to one (defensive, handles span-injected whitespace).
 *   3. Trim leading/trailing whitespace.
 *
 * @param {string} rawLabel - Type label string from the DOM
 * @returns {{ canonical: string, ext: string }}
 */
function resolveType(rawLabel) {
  const normalized = rawLabel
    .replace(/\u00a0/g, ' ')  // &nbsp; → regular space
    .replace(/\s+/g, ' ')     // collapse any multi-space runs
    .trim();
  return TYPE_MAP[normalized] ?? UNKNOWN_TYPE;
}

// --- Inline Code Block Language Strings ---
// Keys are the language identifier strings from Claude's inline code block
// language label (div.text-text-500.font-small). Maps to canonical type names
// matching the values used in TYPE_MAP above.
const LANG_MAP = {
  // Shell
  'bash':       'shell',
  'sh':         'shell',
  'shell':      'shell',
  'zsh':        'shell',
  // Python
  'python':     'python',
  'py':         'python',
  'python3':    'python',
  // JavaScript
  'javascript': 'javascript',
  'js':         'javascript',
  'node':       'javascript',
  // TypeScript
  'typescript': 'typescript',
  'ts':         'typescript',
  // React / JSX
  'jsx':        'jsx',
  'tsx':        'tsx',
  // Web
  'html':       'html',
  'css':        'css',
  // Image
  'svg':        'svg',
  // Data / config
  'json':       'json',
  'yaml':       'yaml',
  'yml':        'yaml',
  'sql':        'sql',
  'toml':       'toml',
  'xml':        'xml',
  // Document
  'markdown':   'markdown',
  'md':         'markdown',
  // Systems / compiled
  'c':          'c',
  'cpp':        'cpp',
  'c++':        'cpp',
  'rust':       'rust',
  'go':         'go',
  'java':       'java',
  'kotlin':     'kotlin',
  'swift':      'swift',
  'ruby':       'ruby',
  'rb':         'ruby',
  'php':        'php',
  'r':          'r',
  // Infra / scripting
  'dockerfile': 'dockerfile',
  'makefile':   'makefile',
  'terraform':  'terraform',
  'hcl':        'terraform',
  'powershell': 'powershell',
  'ps1':        'powershell',
  // Plain text (explicit)
  'text':       'text',
  'txt':        'text',
  'plaintext':  'text',
  'plain':      'text',
};

/**
 * Map an inline code block language string to a canonical type name.
 * Returns 'unknown' for unrecognised language strings.
 *
 * @param {string} lang - Language string from the code block label
 * @returns {string} canonical type name
 */
function resolveCodeBlockLang(lang) {
  return LANG_MAP[lang.toLowerCase().trim()] ?? 'unknown';
}

/**
 * Derive a file extension from a canonical type name.
 * Used for inline code blocks where we have a canonical type but no TYPE_MAP entry.
 *
 * @param {string} canonical - Canonical type name
 * @returns {string} File extension including leading dot, e.g. '.py'
 */
function extForCanonical(canonical) {
  const EXT_MAP = {
    shell:        '.sh',
    python:       '.py',
    javascript:   '.js',
    typescript:   '.ts',
    jsx:          '.jsx',
    tsx:          '.tsx',
    html:         '.html',
    css:          '.css',
    svg:          '.svg',
    json:         '.json',
    yaml:         '.yaml',
    sql:          '.sql',
    toml:         '.toml',
    xml:          '.xml',
    markdown:     '.md',
    text:         '.txt',
    c:            '.c',
    cpp:          '.cpp',
    rust:         '.rs',
    go:           '.go',
    java:         '.java',
    kotlin:       '.kt',
    swift:        '.swift',
    ruby:         '.rb',
    php:          '.php',
    r:            '.r',
    dockerfile:   '.dockerfile',
    makefile:     '.makefile',
    terraform:    '.tf',
    powershell:   '.ps1',
  };
  return EXT_MAP[canonical] ?? '.txt';
}