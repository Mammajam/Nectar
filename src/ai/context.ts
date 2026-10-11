import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { BeeClient } from '../bee/client.js';
import type { ExtractionContext } from './types.js';

export interface ContextProvider {
  get(): Promise<ExtractionContext>;
  close(): Promise<void>;
}

/** Minimal MCP surface we use, so tests can fake it. */
export interface McpLike {
  listTools(): Promise<{ tools: { name: string }[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

/** Pull the text parts out of an MCP tool result. */
export function mcpText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

/** Choose Bee MCP tools by name, tolerant of naming changes between CLI versions. */
export function pickTools(names: string[]): { today: string | null; facts: string | null } {
  const find = (...patterns: RegExp[]) => names.find((n) => patterns.some((p) => p.test(n))) ?? null;
  return {
    today: find(/^bee_get_today$/, /today/),
    facts: find(/^bee_list_facts$/, /facts?_list|list_facts?/),
  };
}

/** Parse fact lines from a tool's text output (markdown list or JSON). */
export function factsFromText(text: string, limit = 30): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed) ? parsed : (parsed as { facts?: unknown })?.facts;
    if (Array.isArray(arr)) {
      return arr
        .map((f) => (typeof f === 'string' ? f : (f as { text?: unknown })?.text))
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .slice(0, limit);
    }
  } catch {
    /* not JSON: fall through to line parsing */
  }
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .filter((l) => l.length > 3 && !l.startsWith('#'))
    .slice(0, limit);
}

/**
 * Context from Bee's MCP server (`bee mcp serve`, stdio). Gives the model the
 * user's confirmed facts and today's brief so names and times resolve.
 */
export class McpContextProvider implements ContextProvider {
  private cache: { at: number; value: ExtractionContext } | null = null;

  constructor(
    private readonly mcp: McpLike,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  static async connect(beeBin: string): Promise<McpContextProvider> {
    const transport = new StdioClientTransport({ command: beeBin, args: ['mcp', 'serve'] });
    const client = new Client({ name: 'nectar', version: '0.2.0' });
    await client.connect(transport);
    return new McpContextProvider(client as unknown as McpLike);
  }

  async get(): Promise<ExtractionContext> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const { tools } = await this.mcp.listTools();
    const picked = pickTools(tools.map((t) => t.name));
    const [today, facts] = await Promise.all([
      picked.today ? this.mcp.callTool({ name: picked.today, arguments: {} }).then(mcpText) : Promise.resolve(''),
      picked.facts
        ? this.mcp.callTool({ name: picked.facts, arguments: { limit: 30 } }).then((r) => factsFromText(mcpText(r)))
        : Promise.resolve([]),
    ]);
    const value: ExtractionContext = { facts, today: today ? today.slice(0, 4000) : null };
    this.cache = { at: Date.now(), value };
    return value;
  }

  close(): Promise<void> {
    return this.mcp.close();
  }
}

/** Fallback: confirmed facts from the REST proxy (no today's brief). */
export class ApiContextProvider implements ContextProvider {
  constructor(private readonly client: BeeClient) {}

  async get(): Promise<ExtractionContext> {
    const page = await this.client.listFacts({ limit: 50 });
    const facts = page.items.filter((f) => f.confirmed !== false).map((f) => f.text).filter(Boolean).slice(0, 30);
    return { facts, today: null };
  }

  async close(): Promise<void> {}
}

/** Use MCP when it starts, otherwise fall back to the REST API. */
export async function createContextProvider(beeBin: string, client: BeeClient): Promise<{ provider: ContextProvider; via: 'mcp' | 'api' }> {
  try {
    const provider = await withTimeout(McpContextProvider.connect(beeBin), 10_000);
    return { provider, via: 'mcp' };
  } catch {
    return { provider: new ApiContextProvider(client), via: 'api' };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}
