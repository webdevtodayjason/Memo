# OpenClaw Integration Guide

This document explains how to integrate OpenClaw-Mem with OpenClaw Gateway.

## Overview

OpenClaw-Mem integrates with OpenClaw through:
1. **Worker Service** - HTTP API for memory operations
2. **Skill** - Agent-facing commands for searching memory
3. **Hooks** - (Future) Automatic capture via lifecycle hooks

## Quick Start

### 1. Install OpenClaw-Mem

```bash
# From npm (when published)
npm install -g openclaw-mem

# Or from source
git clone https://github.com/webdevtodayjason/openclaw_memory
cd openclaw_memory
npm install
npm run build
npm link
```

### 2. Start the Worker

```bash
# Initialize config
openclaw-mem install

# Start daemon
openclaw-mem start-daemon

# Verify
curl http://127.0.0.1:37778/api/health
```

### 3. Install the Skill

```bash
# Copy skill to OpenClaw skills directory
cp -r skill ~/.openclaw/skills/openclaw-mem

# Or symlink for development
ln -s /path/to/openclaw-mem/skill ~/.openclaw/skills/openclaw-mem
```

### 4. Use in Sessions

Ask the agent to search memory:

```
> Search memory for "morning briefing script"

> Show observation #1234

> What did we work on yesterday?
```

## Manual Integration (Current)

Until automatic hooks are implemented, you can manually log observations:

### From Shell Scripts

```bash
# Log an observation
curl -X POST http://127.0.0.1:37778/api/observations \
  -H "Content-Type: application/json" \
  -d '{
    "session_key": "my-session",
    "type": "decision",
    "tool_name": "manual",
    "input": "Decided to use SQLite for storage",
    "output": "Chosen for simplicity and portability",
    "summary": "Architecture decision: SQLite for memory storage",
    "importance": 0.9
  }'
```

### From Node.js

```typescript
import { onToolResult } from 'openclaw-mem';

// After a tool executes
await onToolResult({
  sessionKey: 'my-session',
  toolName: 'Write',
  input: 'Created new file...',
  output: 'Successfully wrote...',
  type: 'code_change'
});
```

## Automatic Integration (Planned)

### Phase 1: Event Listener

OpenClaw emits agent events for tool execution. We can listen to these:

```typescript
// In OpenClaw startup
import { subscribeToAgentEvents } from './infra/agent-events';
import { onToolResult } from 'openclaw-mem';

subscribeToAgentEvents((event) => {
  if (event.stream === 'tool' && event.data.phase === 'result') {
    onToolResult({
      sessionKey: event.runId,
      toolName: event.data.name,
      input: JSON.stringify(event.data.args),
      output: JSON.stringify(event.data.result),
    });
  }
});
```

### Phase 2: Internal Hooks

Register with OpenClaw's internal hook system:

```typescript
import { registerInternalHook } from 'openclaw/hooks';
import { onSessionStart, onToolResult, onSessionEnd } from 'openclaw-mem';

// Session start
registerInternalHook('agent:bootstrap', async (event) => {
  const result = await onSessionStart({
    sessionKey: event.sessionKey,
    projectPath: event.context.workspaceDir
  });
  
  // Inject context into system prompt
  if (result.success && result.data?.contextText) {
    // Add to bootstrap files or system prompt
  }
});

// Session end
registerInternalHook('command:stop', async (event) => {
  await onSessionEnd({
    sessionKey: event.sessionKey
  });
});
```

### Phase 3: Plugin Package

Create an OpenClaw extension package:

```
openclaw-mem-extension/
├── package.json
├── index.js          # Extension entry point
├── hooks/
│   ├── session-start.js
│   ├── tool-result.js
│   └── session-end.js
└── README.md
```

## Context Injection

On session start, past observations can be injected:

### Via System Prompt

Add to `AGENTS.md` or system prompt:

```markdown
## Recent Memory

The following observations are from previous sessions:

[#1234 2026-02-01] Fixed cron PATH issue
[#1235 2026-02-01] Morning briefing: weather, calendar, silver
[#1240 2026-02-02] Silver price heartbeat implemented

Use `mem-search.sh search <query>` for more context.
```

### Via API

```bash
# Get context for injection
curl "http://127.0.0.1:37778/api/context?max_tokens=4000"
```

Returns:
```json
{
  "observations": [...],
  "totalTokens": 3847,
  "contextText": "[#1234 2/1/2026] Fixed cron PATH issue..."
}
```

## MEMORY.md Integration

Use MEMORY.md as a curated index:

```markdown
# MEMORY.md

## Morning Briefing Script
Fixed PATH issue for cron compatibility.
See: observation #1234

## Silver Tracking
Heartbeat-based price monitoring.
See: observations #5678, #5679

## OpenClaw-Mem
Built persistent memory system.
See: observations #7890-#7920
```

When you need details, query:
- `mem-search.sh get 1234`
- Or ask: "Show me observation #1234"

## API Reference

### Store Observation

```http
POST /api/observations
Content-Type: application/json

{
  "session_key": "string",
  "type": "string",           // bugfix, decision, architecture, etc.
  "tool_name": "string",
  "input": "string",
  "output": "string",
  "summary": "string",        // Optional
  "importance": 0.0-1.0       // Optional, default 0.5
}
```

### Search

```http
POST /api/search
Content-Type: application/json

{
  "query": "string",
  "type": "string",           // Optional filter
  "since": "ISO date",        // Optional filter
  "limit": 10                 // Optional
}
```

### Get Context

```http
GET /api/context?max_tokens=4000&project_path=/path
```

### Session Hooks

```http
POST /api/hooks/session-start
{ "session_key": "...", "project_path": "..." }

POST /api/hooks/tool-result
{ "session_key": "...", "tool_name": "...", "input": "...", "output": "..." }

POST /api/hooks/session-end
{ "session_key": "...", "summary": "..." }
```

## Troubleshooting

### Worker won't start
```bash
# Check if port is in use
lsof -i :37778

# Check logs
cat ~/.openclaw-mem/worker.log
```

### No observations appearing
```bash
# Check stats
openclaw-mem stats

# Verify session exists
curl http://127.0.0.1:37778/api/sessions
```

### Search returns empty
- Ensure FTS5 index is built (automatic on insert)
- Check query syntax (FTS5 uses specific syntax)
- Try simpler queries

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

PRs welcome for:
- OpenClaw Gateway integration
- Additional hook types
- Vector search (Chroma)
- Web UI viewer
