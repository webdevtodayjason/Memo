/**
 * OpenClaw-Mem Plugin
 *
 * Persistent memory with SQLite + FTS5 for AI conversations.
 * Uses external worker service for storage.
 * Provides auto-recall and auto-capture via lifecycle hooks.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Configuration Schema
// ============================================================================

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    workerUrl: {
      type: "string" as const,
      default: "http://127.0.0.1:37778",
      description: "OpenClaw-Mem worker service URL"
    },
    autoCapture: {
      type: "boolean" as const,
      default: true,
      description: "Automatically capture observations after agent runs"
    },
    autoRecall: {
      type: "boolean" as const,
      default: true,
      description: "Automatically inject relevant context before agent starts"
    },
    maxContextTokens: {
      type: "number" as const,
      default: 4000,
      description: "Maximum tokens for context injection"
    },
    captureTypes: {
      type: "array" as const,
      items: { type: "string" as const },
      default: ["bugfix", "decision", "architecture", "code_change"],
      description: "Observation types to include in context"
    }
  }
};

// ============================================================================
// Types
// ============================================================================

interface PluginConfig {
  workerUrl: string;
  autoCapture: boolean;
  autoRecall: boolean;
  maxContextTokens: number;
  captureTypes: string[];
}

interface Observation {
  id: number;
  session_id: number;
  type: string;
  tool_name: string | null;
  input: string | null;
  output: string | null;
  summary: string | null;
  created_at: string;
  importance: number;
}

// ============================================================================
// Worker Client
// ============================================================================

class MemoryWorkerClient {
  constructor(private workerUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.workerUrl}/api/health`, {
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async search(query: string, limit = 10): Promise<Observation[]> {
    const response = await fetch(`${this.workerUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data = await response.json() as { results: Observation[] };
    return data.results;
  }

  async store(observation: {
    session_key: string;
    type: string;
    tool_name?: string;
    input?: string;
    output?: string;
    summary?: string;
    importance?: number;
  }): Promise<Observation> {
    // First ensure session exists
    await fetch(`${this.workerUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_key: observation.session_key }),
      signal: AbortSignal.timeout(5000)
    });

    // Then store observation
    const response = await fetch(`${this.workerUrl}/api/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(observation),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Store failed: ${response.status}`);
    return response.json();
  }

  async stats(): Promise<{ totalSessions: number; totalObservations: number }> {
    const response = await fetch(`${this.workerUrl}/api/stats`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`Stats failed: ${response.status}`);
    return response.json();
  }

  async getObservation(id: number): Promise<Observation | null> {
    const response = await fetch(`${this.workerUrl}/api/observations/${id}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Get failed: ${response.status}`);
    return response.json();
  }
}

// ============================================================================
// Capture Logic
// ============================================================================

const CAPTURE_TRIGGERS = [
  /remember\b|zapamatuj/i,
  /\bprefer\b|radši|\bi like\b|\bi love\b|\bi hate\b|\bi want\b/i,
  /decided|rozhodli|will use|budeme/i,
  /important|always|never/i,
  /bug|fix|error|issue/i,
  /architecture|design|pattern/i,
  /TODO|FIXME|NOTE/i,
];

// Patterns that indicate system/operational messages, not real user content
const SYSTEM_MESSAGE_PATTERNS = [
  /^Read HEARTBEAT\.md/i,
  /^System:\s*\[/,
  /heartbeat.*workspace context/i,
  /follow it strictly.*do not infer/i,
  /\[message_id:\s*[0-9a-f-]+\]\s*$/,
  /^HEARTBEAT_OK$/i,
  /silver price check/i,
  /price alert/i,
];

// Recent capture dedup: track hashes of recently stored observations
const recentCaptures = new Set<string>();
const DEDUP_MAX_SIZE = 200;

function textHash(text: string): string {
  // Simple hash: first 100 chars normalized
  return text.slice(0, 100).toLowerCase().replace(/\s+/g, " ").trim();
}

function shouldCapture(text: string): boolean {
  if (!text || text.length < 20 || text.length > 2000) return false;
  if (text.includes("<relevant-memories>")) return false;
  if (text.startsWith("<") && text.includes("</")) return false;
  // Reject system/operational messages
  if (SYSTEM_MESSAGE_PATTERNS.some(r => r.test(text))) return false;
  // Strip message_id tags before trigger matching
  const cleaned = text.replace(/\[message_id:\s*[0-9a-f-]+\]/g, "").trim();
  if (cleaned.length < 20) return false;
  // Dedup: skip if we recently captured the same content
  const hash = textHash(cleaned);
  if (recentCaptures.has(hash)) return false;
  return CAPTURE_TRIGGERS.some(r => r.test(cleaned));
}

function markCaptured(text: string): void {
  const cleaned = text.replace(/\[message_id:\s*[0-9a-f-]+\]/g, "").trim();
  const hash = textHash(cleaned);
  recentCaptures.add(hash);
  // Evict oldest entries if set grows too large
  if (recentCaptures.size > DEDUP_MAX_SIZE) {
    const first = recentCaptures.values().next().value;
    if (first) recentCaptures.delete(first);
  }
}

function detectType(text: string): string {
  const lower = text.toLowerCase();
  if (/bug|fix|error|issue|crash/.test(lower)) return "bugfix";
  if (/decided|decision|will use|chose/.test(lower)) return "decision";
  if (/architecture|design|pattern|structure/.test(lower)) return "architecture";
  if (/\bprefer\b|\bi like\b|\bi want\b|\bi love\b|\bi hate\b/.test(lower)) return "preference";
  if (/function|class|method|api/.test(lower)) return "code_change";
  return "observation";
}

// ============================================================================
// Plugin Definition
// ============================================================================

const openclawMemPlugin = {
  id: "openclaw-mem",
  name: "OpenClaw-Mem",
  description: "SQLite-backed persistent memory with auto-recall/capture",
  kind: "memory" as const,
  configSchema,

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig as PluginConfig;
    const workerUrl = cfg?.workerUrl || "http://127.0.0.1:37778";
    const autoCapture = cfg?.autoCapture ?? true;
    const autoRecall = cfg?.autoRecall ?? true;
    
    const client = new MemoryWorkerClient(workerUrl);

    api.logger.info(`openclaw-mem: plugin registered (worker: ${workerUrl})`);

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "Search through persistent memories. Use when you need context about past work, decisions, or observations.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
        }),
        async execute(_toolCallId, params) {
          const { query, limit = 10 } = params as { query: string; limit?: number };

          try {
            const results = await client.search(query, limit);

            if (results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const text = results
              .map((r, i) => `${i + 1}. [${r.type}] ${r.summary || r.output?.slice(0, 100)}...`)
              .join("\n");

            return {
              content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
              details: { count: results.length, observations: results.map(r => ({ id: r.id, type: r.type, summary: r.summary })) },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Memory search failed: ${err}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description: "Save important information in persistent memory.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          type: Type.Optional(Type.String({ description: "Type: bugfix, decision, architecture, preference, observation" })),
          importance: Type.Optional(Type.Number({ description: "Importance 1-10 (default: 5)" })),
        }),
        async execute(_toolCallId, params, ctx) {
          const { text, type, importance = 5 } = params as { text: string; type?: string; importance?: number };

          try {
            const sessionKey = (ctx as { sessionKey?: string })?.sessionKey || "default";
            const observation = await client.store({
              session_key: sessionKey,
              type: type || detectType(text),
              summary: text,
              output: text,
              importance,
            });

            return {
              content: [{ type: "text", text: `Stored memory #${observation.id}: "${text.slice(0, 80)}..."` }],
              details: { action: "created", id: observation.id },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to store memory: ${err}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description: "Get a specific memory by ID.",
        parameters: Type.Object({
          id: Type.Number({ description: "Memory ID" }),
        }),
        async execute(_toolCallId, params) {
          const { id } = params as { id: number };

          try {
            const observation = await client.getObservation(id);
            if (!observation) {
              return {
                content: [{ type: "text", text: `Memory #${id} not found.` }],
                details: { error: "not_found" },
              };
            }

            return {
              content: [{ type: "text", text: `Memory #${id} [${observation.type}]:\n${observation.output || observation.summary}` }],
              details: { observation },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get memory: ${err}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_get" },
    );

    api.registerTool(
      {
        name: "memory_delete",
        label: "Memory Delete",
        description: "Delete a specific memory by ID. Use with caution.",
        parameters: Type.Object({
          id: Type.Number({ description: "Memory ID to delete" }),
        }),
        async execute(_toolCallId, params) {
          const { id } = params as { id: number };

          try {
            const response = await fetch(`${workerUrl}/api/observations/${id}`, {
              method: 'DELETE',
              signal: AbortSignal.timeout(5000)
            });
            
            if (response.status === 404) {
              return {
                content: [{ type: "text", text: `Memory #${id} not found.` }],
                details: { error: "not_found" },
              };
            }
            
            if (!response.ok) {
              throw new Error(`Delete failed: ${response.status}`);
            }

            return {
              content: [{ type: "text", text: `Deleted memory #${id}` }],
              details: { action: "deleted", id },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to delete memory: ${err}` }],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_delete" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const mem = program.command("mem").description("OpenClaw-Mem commands");

        mem
          .command("status")
          .description("Check worker status")
          .action(async () => {
            const healthy = await client.health();
            if (healthy) {
              const stats = await client.stats();
              console.log(`✅ Worker running at ${workerUrl}`);
              console.log(`   Sessions: ${stats.totalSessions}`);
              console.log(`   Observations: ${stats.totalObservations}`);
            } else {
              console.log(`❌ Worker not responding at ${workerUrl}`);
            }
          });

        mem
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", "10")
          .action(async (query, opts) => {
            const results = await client.search(query, parseInt(opts.limit));
            console.log(JSON.stringify(results, null, 2));
          });

        mem
          .command("stats")
          .description("Show memory statistics")
          .action(async () => {
            const stats = await client.stats();
            console.log(JSON.stringify(stats, null, 2));
          });
      },
      { commands: ["mem"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (autoRecall) {
      api.on("before_agent_start", async (event) => {
        api.logger.info(`openclaw-mem: before_agent_start fired, prompt length: ${event.prompt?.length || 0}`);
        api.logger.info(`openclaw-mem: prompt preview: "${event.prompt?.slice(0, 100)}..."`);
        
        if (!event.prompt || event.prompt.length < 10) {
          api.logger.info("openclaw-mem: prompt too short, skipping recall");
          return;
        }

        try {
          const healthy = await client.health();
          api.logger.info(`openclaw-mem: worker healthy: ${healthy}`);
          if (!healthy) {
            api.logger.warn("openclaw-mem: worker not available for recall");
            return;
          }

          // Sanitize prompt: remove message_id metadata and special FTS5 characters
          let searchQuery = event.prompt
            .replace(/\[message_id:[^\]]+\]/g, '')  // Remove [message_id: ...]
            .replace(/[:\[\](){}*"]/g, ' ')          // Remove FTS5 special chars
            .trim();
          
          api.logger.info(`openclaw-mem: sanitized query: "${searchQuery.slice(0, 50)}..."`);
          
          const results = await client.search(searchQuery, 5);
          api.logger.info(`openclaw-mem: search returned ${results.length} results`);
          if (results.length === 0) return;

          const memoryContext = results
            .map(r => `- [${r.type}] ${r.summary || r.output?.slice(0, 200)}`)
            .join("\n");

          api.logger.info(`openclaw-mem: injecting ${results.length} memories into context`);

          return {
            prependContext: `<relevant-memories>\nThe following memories may be relevant:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(`openclaw-mem: recall failed: ${String(err)}`);
        }
      });
    }

    // Auto-capture: analyze and store important information after agent ends
    if (autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }

        try {
          const healthy = await client.health();
          if (!healthy) {
            api.logger.warn("openclaw-mem: worker not available for capture");
            return;
          }

          const texts: string[] = [];
          for (const msg of event.messages) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role;
            if (role !== "user" && role !== "assistant") continue;
            const content = msgObj.content;
            if (typeof content === "string") {
              texts.push(content);
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === "object" && "type" in block &&
                    (block as Record<string, unknown>).type === "text" &&
                    "text" in block) {
                  texts.push((block as Record<string, unknown>).text as string);
                }
              }
            }
          }

          const toCapture = texts.filter(text => text && shouldCapture(text));
          if (toCapture.length === 0) return;

          let stored = 0;
          const sessionKey = (event as Record<string, unknown>).sessionKey as string || "default";

          for (const text of toCapture.slice(0, 3)) {
            // Clean message_id tags before storing
            const cleanText = text.replace(/\[message_id:\s*[0-9a-f-]+\]/g, "").trim();
            await client.store({
              session_key: sessionKey,
              type: detectType(cleanText),
              summary: cleanText.slice(0, 500),
              output: cleanText,
              importance: 5,
            });
            markCaptured(text);
            stored++;
          }

          if (stored > 0) {
            api.logger.info(`openclaw-mem: auto-captured ${stored} memories`);
          }
        } catch (err) {
          api.logger.warn(`openclaw-mem: capture failed: ${String(err)}`);
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "openclaw-mem",
      start: async () => {
        const healthy = await client.health();
        if (healthy) {
          api.logger.info(`openclaw-mem: connected to worker at ${workerUrl}`);
        } else {
          api.logger.warn(`openclaw-mem: worker not available at ${workerUrl} - run 'openclaw-mem start'`);
        }
      },
      stop: () => {
        api.logger.info("openclaw-mem: stopped");
      },
    });
  },
};

export default openclawMemPlugin;
