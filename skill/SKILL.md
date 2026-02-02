---
name: openclaw-mem
version: 0.1.0
description: Persistent memory system - automatic context capture and semantic search
author: OpenClaw Contributors
repository: https://github.com/webdevtodayjason/openclaw_memory
---

# OpenClaw-Mem Skill

Persistent memory system that automatically captures context across sessions.

## Features

- 🧠 **Automatic capture** - Every tool use is recorded
- 🔍 **Semantic search** - Query past work with natural language
- 📊 **Progressive disclosure** - Token-efficient retrieval
- 🔗 **Reference IDs** - Link MEMORY.md to observations

## Setup

1. **Install the worker service:**
   ```bash
   npm install -g openclaw-mem
   openclaw-mem install
   openclaw-mem start-daemon
   ```

2. **Verify it's running:**
   ```bash
   curl http://127.0.0.1:37778/api/health
   ```

## Usage

### Searching Memory

Ask the agent to search past work:

```
> What did we do with the morning briefing script?

> Search memory for "PATH fix cron"

> Show me observation #1234
```

### Memory Commands

- **Search:** "search memory for [query]"
- **Get observation:** "show observation #[id]"
- **Timeline:** "show timeline around observation #[id]"
- **Stats:** "show memory stats"

### MEMORY.md Integration

Reference observations in your MEMORY.md:

```markdown
## Morning Briefing Script
Fixed PATH issue for cron on 2026-02-01.
See: observation #1234
```

## API

The worker service runs on `http://127.0.0.1:37778`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `POST /api/search` | Search observations |
| `GET /api/observations/:id` | Get observation |
| `POST /api/timeline` | Get chronological context |
| `GET /api/stats` | Database statistics |

## Troubleshooting

### Worker not running
```bash
openclaw-mem status
openclaw-mem start-daemon
```

### Search returns empty
- Check if observations exist: `openclaw-mem stats`
- Verify worker is running: `curl http://127.0.0.1:37778/api/health`

## Configuration

Settings in `~/.openclaw-mem/settings.json`:

```json
{
  "port": 37778,
  "contextInjection": {
    "enabled": true,
    "maxTokens": 4000
  }
}
```
