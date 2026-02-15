# Chat Archive

**Export AI chat conversations to durable JSON and Markdown formats.**

A Chrome browser extension that extracts conversations from AI chat platforms (Claude.ai, ChatGPT, Gemini, Grok) into portable, machine-readable files. Zero network requests. Zero telemetry. Your conversations never leave your browser.

Acknowledgement and thanks to Jerren@trifall.com for hinting at use of gpt icon actions to capture user and assistant content in his security-first chat-export repo https://github.com/Trifall/chat-export

---

## ✨ Features

- **5 Platform Support**: Claude, ChatGPT, Gemini, Grok (grok.com), Grok-X (x.com/i/grok)
- **Two Export Formats**: JSON (canonical, schema v1.0) and Markdown with metadata
- **Smart Extraction**: Three-pass strategy (clipboard → heuristics → ML fallback)
- **Privacy First**: All processing happens in-browser. No data sent to external servers.
- **Safety Guarantees**: Hard limits (500 turns, 60s timeout), integrity checks, circuit breakers
- **Cross-Platform**: Works on Windows, macOS, Linux (any Chromium browser)

---

## 🚀 Quick Start

### Installation

1. **Download or clone this repository**
   ```bash
   git clone https://github.com/fxops-ai/gpt2json-extension.git
   cd gpt2json-extension
   git checkout v2-archive-extraction
   ```

2. **Load in Chrome** (or Edge, Brave, Vivaldi, Arc, Opera)
   - Open `chrome://extensions/`
   - Enable **"Developer mode"** (toggle in top-right)
   - Click **"Load unpacked"**
   - Select the `gpt2json-extension` folder
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
Uses each platform's native copy buttons to extract content. This is the highest-fidelity method because it retrieves the same formatted content the platform gives to users.

- **Claude**: `button[data-testid="action-bar-copy"]` on both user and assistant turns
- **ChatGPT**: `button[data-testid="copy-turn-action-button"]` with role from `data-turn` attribute
- **Gemini**: `aria-label="Copy prompt"` (user) / `data-test-id="copy-button"` (assistant)
- **Grok**: `aria-label="Copy"` with 6-signal role detection (alignment, button count, styling)
- **Grok-X**: `aria-label="Copy text"` with React Native Web class fallbacks

#### **Pass 1: Structural Heuristics** (Fallback)
When clipboard extraction fails, uses 7 rule-based classifiers:
- H1: Explicit role attributes (0.95 confidence)
- H2: Alternating pattern detection (0.85)
- H3: Text length asymmetry (0.70)
- H5: Content signals (code blocks, questions) (0.65)
- H7: Code block density (0.60)

Ensemble voting with 0.75 acceptance threshold. Uncertain turns flagged for manual resolution.

#### **Pass 2: ML Classification** (Deferred to v1.1+)
Optional micro-classifier (<500KB) for genuinely ambiguous cases. Not yet implemented because Pass 0+1 achieve 95%+ confidence on all verified platforms.

### Export Formats

**JSON (Canonical Format)**
```json
{
  "schema_version": "1.0",
  "export_metadata": {
    "source_platform": "claude.ai",
    "source_url": "https://claude.ai/chat/abc-123",
    "export_timestamp": "2026-02-15T14:30:00Z",
    "total_turns": 24,
    "flagged_turns": 0
  },
  "conversation": [
    {
      "turn": 1,
      "role": "user",
      "content": "Hello, can you help me with...",
      "classification_confidence": 0.95,
      "classification_source": "clipboard"
    }
  ]
}
```

**Markdown**
```markdown
# Chat Export — Claude.ai
**Exported:** 2026-02-15 14:30 UTC
**Source:** https://claude.ai/chat/abc-123
**Turns:** 24

---

## User
Hello, can you help me with...

---

## Assistant
Of course! Here's how...
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
| `activeTab` | Access current tab DOM for extraction | Minimal - only active tab, only on user action |
| `downloads` | Write export files to your device | Low - write-only, user chooses save location |
| `storage` | Cache user classification corrections | Low - never stores conversation content |
| `clipboardRead` | Read clipboard after programmatic copy-button click | Low - read-only, scoped to extraction flow |
| Host permissions (4 domains) | Inject content script on chat platforms | Scoped - only the 4 target domains |

### Safety Limits (Circuit Breakers)

```javascript
MAX_TURNS: 500              // Hard cap on turns per export
MAX_EXTRACTION_TIME_MS: 60_000  // Kill switch: abort after 60 seconds
MAX_SINGLE_TURN_SIZE: 100_000   // Flag turns exceeding 100KB
SCROLL_STABILITY_THRESHOLD: 3   // Stop scrolling after 3 unchanged counts
```

All extraction operations are bounded by hard limits that cannot be overridden. If limits are hit, you get a partial export with clear error messages—never silently truncated data.

---

## ✅ Validation

### Test Results (v0.1.0 - Feb 2026)

| Platform | Test Type | Turns | Result | Confidence | Warnings |
|----------|-----------|-------|--------|------------|----------|
| **Claude.ai** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |
| **ChatGPT** | ARCHIVETEST | 8/8 | ✅ Pass | 0.99 | 0 |
| **Gemini** | ARCHIVETEST | 8/8 | ✅ Pass | 0.99 | 0 |
| **Grok** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |
| **Grok** | Real conversation | 32/32 | ✅ Pass | 0.95 | 0 |
| **Grok-X** | ARCHIVETEST | 8/8 | ✅ Pass | 0.95 | 0 |

**Tested on:** Windows 11 (Chrome 132), macOS (Safari for DOM analysis, Chrome for validation)

**ARCHIVETEST Conversation** (standardized validation):
```
USER:    "ARCHIVETEST: What are the three primary colors?"
ASST:    [response about red, blue, yellow / red, green, blue]
USER:    "ARCHIVETEST: Can you write a short 2-line poem about rain?"
ASST:    [short poem response]
USER:    "ARCHIVETEST: What is 42 * 17?"
ASST:    [714, possibly with explanation]
USER:    "ARCHIVETEST: Summarize the previous conversation in one sentence."
ASST:    [summary response]
```

All platforms: Zero extraction errors, zero integrity warnings, all roles correctly classified.

---

## 📚 Documentation

Detailed technical documentation is available in the repository:

- **[chat-archive-architecture.md](./chat-archive-architecture.md)** - Complete system design, three-pass strategy, export formats, security architecture
- **[DOM_STRATEGY_ANALYSIS.md](./DOM_STRATEGY_ANALYSIS.md)** - How the extension handles platform DOM differences, reverse-engineering methodology
- **Appendices in architecture.md**:
  - Appendix A: Grok DOM Analysis (grok.com)
  - Appendix B: Grok-X DOM Analysis (x.com/i/grok)
  - Appendix C: Claude DOM Analysis
  - Appendix D: Gemini DOM Analysis
  - Appendix E: ChatGPT DOM Analysis

Each appendix includes:
- Turn container structure
- Selector stability assessment (HIGH/MEDIUM/LOW ratings)
- Role detection signals with confidence scores
- Complete extraction implementation
- Elements to exclude
- Testing checklists

---

## 🛠️ Development

### Building from Source

The extension uses a simple shell script to concatenate source files:

```bash
# Make the build script executable (first time only)
chmod +x build.sh

# Build content.js
./build.sh
```

**On Windows:** Use Git Bash (comes with Git for Windows) to run `./build.sh`

### Project Structure

```
gpt2json-extension/
├── manifest.json           # Chrome extension manifest
├── background.js           # Service worker (handles downloads)
├── popup.html/js           # Extension popup UI
├── content.js              # Built file (concatenated from src/)
├── build.sh                # Build script
├── src/
│   ├── content.js          # Main content script orchestrator
│   ├── utils/
│   │   ├── constants.js    # Safety limits, platform detection
│   │   ├── serializer.js   # JSON/MD export formatting
│   │   └── filewriter.js   # Download via Chrome API
│   └── extractors/
│       ├── claude.js       # Claude.ai extraction
│       ├── chatgpt.js      # ChatGPT extraction
│       ├── gemini.js       # Gemini extraction
│       ├── grok.js         # Grok (grok.com) extraction
│       ├── grok-x.js       # Grok (x.com/i/grok) extraction
│       └── heuristics.js   # Pass 1 structural classification
└── docs/
    ├── chat-archive-architecture.md
    └── DOM_STRATEGY_ANALYSIS.md
```

### Testing

1. Make changes to files in `src/`
2. Run `./build.sh` to rebuild `content.js`
3. In Chrome: `chrome://extensions/` → Click reload icon on Chat Archive
4. Test on target platform
5. Check browser console for `[Chat Archive]` log messages

---

## 🗺️ Roadmap

### v1.0 (Current - Phase 1 Complete)
- ✅ Pass 0 (clipboard) + Pass 1 (heuristics) extraction
- ✅ 5 platform support (Claude, ChatGPT, Gemini, Grok, Grok-X)
- ✅ JSON and Markdown export
- ✅ Safety limits and integrity checks
- ✅ Cross-platform validation (Windows/Mac)

### v1.1 (Next)
- [ ] User resolution UI for uncertain classifications
- [ ] Batch export (multiple conversations from platform history pages)
- [ ] Firefox port (minimal namespace polyfill for Manifest V3)
- [ ] Optional ML micro-classifier (<500KB, explicit user consent)
- [ ] Enhanced metadata (timestamps, model versions, regeneration tracking)

### v1.2 (Future)
- [ ] Artifact extraction (Claude's code/document artifacts)
- [ ] Image description preservation (multimodal conversations)
- [ ] Custom export templates (user-defined JSON schemas)
- [ ] Conversation diffing (compare versions, track edits)

### v2.0 (Vision)
- [ ] Safari Web Extension (macOS/iOS if API support improves)
- [ ] Encrypted export (optional password protection)
- [ ] Cloud sync integration (Google Drive, Dropbox, GitHub Gists)
- [ ] Conversation search and indexing

---

## 🤝 Contributing

Contributions are welcome! This project is in active development.

### Areas Where Help Is Needed

1. **Platform Testing**
   - Test on different browsers (Edge, Brave, Opera, Vivaldi)
   - Validate on different OS versions
   - Report DOM changes when platforms update their UI

2. **New Platform Support**
   - Perplexity.ai
   - Pi (Inflection)
   - Character.AI
   - Poe (multiple models)

3. **Feature Development**
   - User resolution UI (flagged turns)
   - Batch export from conversation history pages
   - Firefox compatibility layer

4. **Documentation**
   - Video tutorials
   - Troubleshooting guide
   - Translation to other languages

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (create ARCHIVETEST conversation, export, validate)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push to your fork (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Reporting Issues

When platforms update their UI and extraction breaks:

1. Open an issue with:
   - Platform name and URL
   - Browser and OS version
   - Error message from browser console (look for `[Chat Archive]` logs)
   - Screenshots of the page structure (right-click → Inspect Element)

2. Include a minimal reproduction:
   - Create a simple 2-turn conversation
   - Attempt export
   - Share what happened vs. what you expected

---

## 📄 License

[Choose your license - MIT, Apache 2.0, GPL, etc.]

This project is licensed under the [LICENSE NAME] License - see the LICENSE file for details.

---

## 🙏 Acknowledgments

- Inspired by the need for durable conversation archives in the age of AI assistants
- DOM analysis methodology informed by [Chat Export for Claude](https://github.com/yoeven/ai-chat-exporter) and similar projects
- Built with love for the AI power-user community

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/fxops-ai/gpt2json-extension/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fxops-ai/gpt2json-extension/discussions)
- **Email**: [john@fxops.ai]

---

**Remember:** This extension operates in archive state, not conversation state. The conversations you export become addressable artifacts with destinations beyond the chat interface. Use them wisely.

---

*Chat Archive v0.1.0 - Extracting ephemeral conversations into durable knowledge.*
