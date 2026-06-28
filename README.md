# Chat Archive

**Export AI chat conversations to durable JSON and Markdown formats.**

A Chrome browser extension that extracts conversations from AI chat platforms (Claude.ai, ChatGPT, Gemini, Grok) into portable, machine-readable files. Zero network requests. Zero telemetry. Your conversations never leave your browser.

---

## ✨ Features

- **5 Platform Support**: Claude, ChatGPT, Gemini, Grok (grok.com), Grok-X (x.com/i/grok)
- **Two Export Formats**: JSON (canonical, schema v1.1) and Markdown with metadata
- **Smart Extraction**: Three-pass strategy (clipboard → heuristics → ML fallback)
- **Artifact Extraction**: Full extraction of Claude.ai artifacts — code, HTML, SVG, and binary files (PPTX, DOCX, XLSX)
- **Privacy First**: All processing happens in-browser. No data sent to external servers.
- **Safety Guarantees**: Hard limits (500 turns, 60s timeout), integrity checks, circuit breakers
- **Cross-Platform**: Works on Windows, macOS, Linux (any Chromium browser)

---

## 🚀 Quick Start

### Installation

1. **Download or clone this repository**
   ```bash
   git clone https://github.com/fxops-ai/chat-archive.git
   cd chat-archive
   ```

2. **Load in Chrome** (or Edge, Brave, Vivaldi, Arc, Opera)
   - Open `chrome://extensions/`
   - Enable **"Developer mode"** (toggle in top-right)
   - Click **"Load unpacked"**
   - Select the `chat-archive` folder
   - Extension icon appears in toolbar

### Usage

1. **Navigate to a supported AI chat platform**:
   - [Claude.ai](https://claude.ai/chat/)
   - [ChatGPT](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)
   - [Gemini](https://gemini.google.com)
   - [Grok](https://grok.com) or [x.com/i/grok](https://x.com/i/grok)

2. **Open an existing conversation** (must have at least one exchange)

3. **Click the Chat Archive extension icon** in your toolbar

4. **Click "Export JSON"** (or "Export Markdown")

5. **Choose where to save** the file

   If the conversation contains artifacts, a `.zip` file is created containing the JSON/Markdown plus all artifact sidecar files.

Your conversation is now a durable, addressable artifact. Use it as:
- Input to scripts or automation
- Training data or evaluation sets
- Documentation or knowledge base content
- Backup before deleting conversations
- Migration between platforms

---

## 🏗️ Architecture

### Three-Pass Extraction Strategy

Chat Archive uses a resilient, multi-layer approach to handle platform DOM differences:

#### **Pass 0: Clipboard Extraction** (Primary - 95%+ success rate)
Uses each platform's native copy buttons to extract content.

- **Claude**: `button[data-testid="action-bar-copy"]` on both user and assistant turns
- **ChatGPT**: `button[data-testid="copy-turn-action-button"]` with role from `data-turn` attribute
- **Gemini**: `aria-label="Copy prompt"` (user) / `data-test-id="copy-button"` (assistant)
- **Grok**: `aria-label="Copy"` with 6-signal role detection
- **Grok-X**: `aria-label="Copy text"` with React Native Web class fallbacks

#### **Pass 1: Structural Heuristics** (Fallback)
When clipboard extraction fails, uses 7 rule-based classifiers with ensemble voting at 0.75 acceptance threshold.

#### **Pass 2: ML Classification** (Deferred to v1.1+)
Optional micro-classifier (<500KB) for genuinely ambiguous cases.

### Artifact Extraction (Claude.ai)

Claude artifacts are extracted via a two-surface strategy:

**Surface A — Artifact cards** (files produced by `present_files`):
- Text/code artifacts: panel opened → Copy button → clipboard → sidecar file
- Binary artifacts (PPTX/DOCX/XLSX): download URL interception via background service worker → same-origin fetch → zip

**Surface B — Inline code blocks** (fenced code in assistant turn text):
- Copy button → clipboard, or direct `innerText` fallback

### Export Formats

**JSON (Canonical Format)**
```json
{
  "schema_version": "1.1",
  "export_metadata": {
    "source_platform": "claude.ai",
    "source_url": "https://claude.ai/chat/abc-123",
    "export_timestamp": "2026-06-28T14:30:00Z",
    "total_turns": 24,
    "has_artifacts": true,
    "artifact_count": 3,
    "zip_filename": "chat-export-claude-2026-06-28.zip"
  },
  "artifact_manifest": [...],
  "conversation": [...]
}
```

**Zip structure (when artifacts present)**
```
chat-export-claude-2026-06-28/
├── conversation.json
├── conversation.md
└── artifacts/
    ├── artifact-001-v1-directory-listing.sh
    ├── artifact-002-v1-slides.pptx
    └── artifact-003-v1-diagram.svg
```

---

## 🔒 Security & Privacy

### Core Guarantee
**Chat Archive makes zero network requests.** Conversations never leave your browser.

- ✅ No telemetry, analytics, or crash reporting
- ✅ No external API calls
- ✅ No background service that phones home
- ✅ All processing happens locally in the browser tab

### Permissions Explained

| Permission | Why We Need It | Risk Level |
|------------|----------------|------------|
| `activeTab` | Access current tab DOM for extraction | Minimal |
| `downloads` | Write export files to your device | Low |
| `storage` | Cache user classification corrections | Low |
| `clipboardRead` | Read clipboard after programmatic copy-button click | Low |
| Host permissions (6 domains) | Inject content script on chat platforms | Scoped |

### Safety Limits (Circuit Breakers)

```javascript
MAX_TURNS: 500                   // Hard cap on turns per export
MAX_EXTRACTION_TIME_MS: 60_000   // Kill switch: abort after 60 seconds
MAX_ARTIFACT_PANELS: 50          // Hard cap on artifact panels opened
BINARY_FETCH_MAX_SIZE: 50_000_000 // 50MB cap on binary artifact fetch
```

---

## ✅ Validation

### Test Results (v0.4.0 - June 2026)

| Platform | Test Type | Turns | Result | Confidence | Warnings |
|----------|-----------|-------|--------|------------|----------|
| **Claude.ai** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |
| **Claude.ai** | ARCHIVETEST-BINARY | 5 artifacts | ✅ Pass | — | 0 |
| **ChatGPT** | ARCHIVETEST | 8/8 | ✅ Pass | 0.99 | 0 |
| **Gemini** | ARCHIVETEST | 8/8 | ✅ Pass | 0.99 | 0 |
| **Grok** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |
| **Grok** | Real conversation | 32/32 | ✅ Pass | 0.95 | 0 |
| **Grok-X** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |

**ARCHIVETEST-BINARY (Claude.ai binary artifacts):**

| Artifact | Size | Method | Magic bytes |
|----------|------|--------|-------------|
| Org intelligence | 80,600 bytes | `binary_fetch` | `PK\x03\x04` ✅ |
| Cost slides | 34,775 bytes | `binary_fetch` | `PK\x03\x04` ✅ |
| Cost slides v2 | 46,313 bytes | `binary_fetch` | `PK\x03\x04` ✅ |
| Slide e strategic outcomes | 34,947 bytes | `binary_fetch` | `PK\x03\x04` ✅ |

---

## 📚 Documentation

- **[docs/chat-archive-architecture-5.md](./docs/chat-archive-architecture-5.md)** — Complete system design, three-pass strategy, all 5 platform extractors
- **[docs/chat-archive-artifact-extraction-spec.md](./docs/chat-archive-artifact-extraction-spec.md)** — Artifact extraction architecture, schema v1.1
- **[docs/DOM_STRATEGY_ANALYSIS.md](./docs/DOM_STRATEGY_ANALYSIS.md)** — Platform DOM analysis and selector strategy
- **[docs/RELEASE-v0.4.0.md](./docs/RELEASE-v0.4.0.md)** — v0.4.0 release notes: binary artifact extraction

---

## 🛠️ Development

### Building from Source

```bash
# Make the build script executable (first time only)
chmod +x build.sh

# Build content.js
./build.sh
```

**On Windows:** Use Git Bash to run `./build.sh`

**After build, verify shared utilities are present:**
```bash
grep -n "scrollToLoadAll" content.js
# Should show: one function definition + 4-5 call sites
```

### Project Structure

```
chat-archive/
├── manifest.json           # Chrome extension manifest (v0.4.0)
├── background.js           # Service worker — downloads + binary interception
├── popup.html/js           # Extension popup UI
├── content.js              # Built file (concatenated from src/)
├── build.sh                # Build script
├── src/
│   ├── content.js          # Main orchestrator
│   ├── utils/
│   │   ├── constants.js    # Safety limits, shared DOM utilities, platform detection
│   │   ├── serializer.js   # JSON/MD export formatting
│   │   └── filewriter.js   # Download + zip via Chrome API
│   └── extractors/
│       ├── claude.js       # Claude.ai extraction + artifact orchestration
│       ├── chatgpt.js      # ChatGPT extraction
│       ├── gemini.js       # Gemini extraction
│       ├── grok.js         # Grok (grok.com) extraction
│       ├── grok-x.js       # Grok (x.com/i/grok) extraction
│       ├── heuristics.js   # Pass 1 structural classification
│       └── artifacts/
│           ├── artifact-detector.js  # Finds artifact surfaces in turn containers
│           ├── artifact-panel.js     # Panel interaction + binary extraction
│           ├── artifact-types.js     # Type label → canonical type + extension
│           └── artifact-code.js      # Per-type post-processing
└── docs/
    ├── chat-archive-architecture-5.md
    ├── chat-archive-artifact-extraction-spec.md
    ├── DOM_STRATEGY_ANALYSIS.md
    └── RELEASE-v0.4.0.md
```

### Testing

1. Make changes to files in `src/`
2. Run `./build.sh` to rebuild `content.js`
3. In Chrome: `chrome://extensions/` → Click reload icon on Chat Archive
4. Test on target platform
5. Check browser console for `[Chat Archive]` log messages

---

## 🗺️ Roadmap

### v0.4.0 (Current)
- ✅ Binary artifact extraction (PPTX, DOCX, XLSX)
- ✅ Download URL interception via background service worker
- ✅ NBSP normalisation fix for type label resolution
- ✅ `browser_download` fallback with readme generation

### v0.3.0
- ✅ Claude.ai artifact extraction (code, HTML, SVG, Markdown)
- ✅ Schema v1.1 with artifact manifest
- ✅ Zip output for conversations with artifacts
- ✅ JSZip bundled + SHA-256 pinned at build time

### v0.1.0 – v0.2.1
- ✅ Pass 0 (clipboard) + Pass 1 (heuristics) extraction
- ✅ 5 platform support
- ✅ JSON and Markdown export
- ✅ Safety limits and integrity checks

### v1.1 (Next)
- [ ] User resolution UI for uncertain classifications
- [ ] Batch export from conversation history pages
- [ ] Firefox port (Manifest V3 namespace polyfill)
- [ ] Confirm DOCX/XLSX type labels against live DOM
- [ ] Eliminate Chrome multiple-download prompt for binary artifacts

### v1.2+
- [ ] Artifact extraction for ChatGPT Canvas, Gemini equivalents
- [ ] Image description preservation (multimodal conversations)
- [ ] Enhanced metadata (model versions, regeneration tracking)

---

## 🤝 Contributing

### Reporting Issues

When platforms update their UI and extraction breaks:

1. Open an issue with:
   - Platform name and URL
   - Browser and OS version
   - Error message from browser console (look for `[Chat Archive]` logs)
   - Screenshots of the page structure (right-click → Inspect Element)

2. Include a minimal reproduction:
   - Create a 2-turn conversation
   - Attempt export
   - Share what happened vs. what you expected

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes in `src/`
4. Run `./build.sh` and test with an ARCHIVETEST conversation
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

---

## 📄 License

MIT License — see the LICENSE file for details.

---

## 🙏 Acknowledgments

- DOM analysis methodology informed by the AI chat exporter community
- Built for the AI power-user community

---

**Remember:** This extension operates in archive state, not conversation state. The conversations you export become addressable artifacts with destinations beyond the chat interface.

---

*Chat Archive v0.4.0 — Extracting ephemeral conversations into durable knowledge.*
