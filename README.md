<p align="center">
  <img src="assets/Memo-Logo.png" alt="Memo - The Memory Keeper" width="300">
</p>

<h1 align="center">OpenClaw Persistent Memory</h1>

<p align="center">
  <i>Meet <a href="MEMO.md"><b>Memo</b></a> — the friendly crab-bot who never forgets.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openclaw-persistent-memory"><img src="https://img.shields.io/npm/v/openclaw-persistent-memory.svg" alt="npm"></a>
  <a href="https://github.com/webdevtodayjason/openclaw-persistent-memory/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License"></a>
</p>

---

**Persistent memory system for OpenClaw** - automatically captures context across sessions, enabling semantic search and progressive disclosure of past work.

> Inspired by and adapted from [Claude-Mem](https://github.com/thedotmack/claude-mem) by Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

## Why OpenClaw-Mem?

OpenClaw agents wake up fresh each session. Currently, continuity relies on:
- Manually maintained `MEMORY.md` files
- Daily logs in `memory/YYYY-MM-DD.md`
- Reading through past context files

**OpenClaw-Mem changes this:**
- 🧠 **Automatic capture** - Every tool use, decision, and observation is recorded
- 🔍 **Semantic search** - Query past work with natural language
- 📊 **Progressive disclosure** - Start with summaries, drill into details (token-efficient)
- 🔗 **Reference IDs** - Link MEMORY.md entries to specific observations
- 🖥️ **Web viewer** - Browse memory stream at http://localhost:37778

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           OpenClaw Gateway                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│   │ SessionStart │    │  ToolResult  │    │  SessionEnd  │         │
│   │    Hook      │    │    Hook      │    │    Hook      │         │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘         │
│          │                   │                   │                  │
│          └───────────────────┼───────────────────┘                  │
│                              │                                      │
│                              ▼                                      │
│                    ┌─────────────────┐                              │
│                    │  OpenClaw-Mem   │                              │
│                    │  Worker Service │                              │
│                    │  (port 37778)   │                              │
│                    └────────┬────────┘                              │
│                              │                                      │
│          ┌──────────────────┼──────────────────┐                   │
│          │                  │                  │                    │
│          ▼                  ▼                  ▼                    │
│   ┌────────────┐    ┌────────────┐    ┌────────────┐               │
│   │   SQLite   │    │   Chroma   │    │  Web UI    │               │
│   │  Database  │    │  Vector DB │    │  Viewer    │               │
│   └────────────┘    └────────────┘    └────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Components

1. **Worker Service** (`src/worker/`) - HTTP API server
   - Receives observations from hooks
   - Stores in SQLite + vector embeddings
   - Provides search endpoints
   - Serves web viewer UI

2. **Lifecycle Hooks** (`src/hooks/`) - OpenClaw integration points
   - `session-start.ts` - Inject past context, start worker
   - `tool-result.ts` - Capture tool observations
   - `session-end.ts` - Generate session summary

3. **Database** (`src/database/`) - Storage layer
   - SQLite for structured data (sessions, observations, summaries)
   - FTS5 for full-text search
   - Chroma for vector/semantic search

4. **Search** (`src/search/`) - Query engine
   - Hybrid search (keyword + semantic)
   - Progressive disclosure (index → timeline → details)
   - Token cost tracking

5. **MCP Tools** (`src/mcp/`) - Model Context Protocol integration
   - `search` - Query memory with filters
   - `timeline` - Chronological context
   - `get_observations` - Fetch full details by ID

---

## Installation

### Step 1: Install the Worker Service

```bash
# Clone the repo
git clone https://github.com/webdevtodayjason/openclaw_memory
cd openclaw_memory

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
```

### Step 2: Start the Worker

```bash
# Start in foreground (for testing)
npm run dev

# Or start as daemon
openclaw-mem start-daemon

# Verify it's running
curl http://127.0.0.1:37778/api/health
```

### Step 3: Install the OpenClaw Extension

```bash
# Copy extension to OpenClaw extensions directory
cp -r extension ~/.openclaw/extensions/openclaw-mem

# Or symlink for development
ln -s $(pwd)/extension ~/.openclaw/extensions/openclaw-mem
```

### Step 4: Configure OpenClaw

Add to your OpenClaw config (`~/.openclaw/config.yaml`):

```yaml
extensions:
  openclaw-mem:
    enabled: true
    workerUrl: "http://127.0.0.1:37778"
    autoCapture: true      # Auto-capture tool results
    autoRecall: true       # Auto-inject past context
    maxContextTokens: 4000 # Token budget for context injection
```

### Step 5: Verify Installation

```bash
# Check worker status
openclaw mem status

# Should show: ✓ Worker running
```

---

## Usage

### Automatic Operation

Once installed, OpenClaw-Mem works automatically:
- **Session starts** → Past context injected
- **Tools execute** → Observations captured
- **Session ends** → Summary generated

### Querying Memory

In any OpenClaw session, you can search past work:

```
> What did we work on with the morning briefing script?

[OpenClaw-Mem searches observations]

Found 3 relevant observations:
- #1234 (2026-02-01): Fixed PATH issue for cron compatibility
- #1235 (2026-02-01): Added weather and calendar to briefing
- #1236 (2026-02-01): Configured email delivery to iCloud

Want me to show details for any of these?
```

### MEMORY.md Integration

Your `MEMORY.md` becomes an index:

```markdown
# MEMORY.md

## Morning Briefing Script
Fixed PATH issue for cron on 2026-02-01.
See: observation #1234

## Silver Price Tracking
Heartbeat-based monitoring implemented.
See: observations #5678, #5679, #5680
```

### Web Viewer

Browse the memory stream at: **http://localhost:37778**

Features:
- Real-time observation feed
- Search interface
- Session timeline
- Export/import

---

## API Reference

### Worker Service Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/observations` | POST | Store new observation |
| `/api/observations/:id` | GET | Get observation by ID |
| `/api/search` | POST | Search observations |
| `/api/timeline` | POST | Get chronological context |
| `/api/sessions` | GET | List sessions |
| `/api/sessions/:id/summary` | GET | Get session summary |
| `/api/context` | GET | Get context for injection |

### MCP Tools

#### `search`
```typescript
search({
  query: string,           // Natural language query
  type?: string,           // Filter: observation, decision, bugfix, etc.
  since?: string,          // ISO date filter
  project?: string,        // Project filter
  limit?: number           // Max results (default: 10)
})
```

#### `timeline`
```typescript
timeline({
  observationId?: number,  // Center on this observation
  query?: string,          // Or search and show context
  range?: number           // Hours before/after (default: 2)
})
```

#### `get_observations`
```typescript
get_observations({
  ids: number[]            // Observation IDs to fetch
})
```

---

## Configuration

Settings stored in `~/.openclaw-mem/settings.json`:

```json
{
  "port": 37778,
  "dataDir": "~/.openclaw-mem",
  "database": {
    "path": "~/.openclaw-mem/memory.db"
  },
  "vectorDb": {
    "enabled": true,
    "path": "~/.openclaw-mem/chroma"
  },
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000,
    "includeTypes": ["decision", "bugfix", "architecture"],
    "excludeTypes": ["routine"]
  },
  "summarization": {
    "enabled": true,
    "model": "claude-3-haiku"
  },
  "ui": {
    "enabled": true,
    "theme": "dark"
  }
}
```

---

## Development

### Prerequisites

- Node.js 18+
- Bun (optional, for faster execution)
- OpenClaw installed

### Setup

```bash
git clone https://github.com/openclaw/openclaw-mem
cd openclaw-mem
npm install
npm run dev
```

### Testing

```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
```

### Building

```bash
npm run build           # Compile TypeScript
npm run build:ui        # Build web viewer
npm run package         # Create distributable
```

---

## Roadmap

### v0.1.0 (MVP) ✅
- [x] Project structure
- [x] Worker service with SQLite
- [x] Basic hooks (session-start, tool-result, session-end)
- [x] Simple search (FTS5)
- [x] Context injection
- [x] CLI tool
- [x] Skill for agents

### v0.2.0
- [ ] Vector search (Chroma integration)
- [ ] Progressive disclosure
- [ ] Web viewer UI
- [ ] MCP tools

### v0.3.0
- [ ] Session summaries with AI
- [ ] MEMORY.md auto-linking
- [ ] Import/export
- [ ] Multi-project support

### v1.0.0
- [x] Full OpenClaw plugin integration ✅
- [ ] Publish to npm
- [ ] Publish to ClawHub (https://clawhub.ai)
- [ ] Documentation site
- [ ] Community contributions

---

## Credits

This project is adapted from [Claude-Mem](https://github.com/thedotmack/claude-mem) by Alex Newman ([@thedotmack](https://github.com/thedotmack)).

Claude-Mem is licensed under AGPL-3.0. This adaptation maintains compatibility with that license while adding OpenClaw-specific integrations.

---

## License

**GNU Affero General Public License v3.0** (AGPL-3.0)

See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a Pull Request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

---

## Links

- **OpenClaw**: https://github.com/openclaw/openclaw
- **Documentation**: https://docs.openclaw.ai/plugins/openclaw-mem
- **Discord**: https://discord.com/invite/clawd
- **Original Claude-Mem**: https://github.com/thedotmack/claude-mem
