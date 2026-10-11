import { describe, expect, it } from 'vitest';
import { factsFromText, McpContextProvider, mcpText, pickTools, type McpLike } from '../src/ai/context.js';

describe('Bee MCP context', () => {
  it('picks today and facts tools by name', () => {
    expect(pickTools(['bee_status', 'bee_get_today', 'bee_list_facts', 'bee_search'])).toEqual({ today: 'bee_get_today', facts: 'bee_list_facts' });
    expect(pickTools(['today_brief', 'facts_list'])).toEqual({ today: 'today_brief', facts: 'facts_list' });
    expect(pickTools(['bee_status'])).toEqual({ today: null, facts: null });
  });

  it('parses facts from markdown lists and JSON', () => {
    expect(factsFromText('# Facts\n- Musa is my supplier\n- Fatu runs Duala\n')).toEqual(['Musa is my supplier', 'Fatu runs Duala']);
    expect(factsFromText(JSON.stringify({ facts: [{ text: 'A fact' }, { text: '' }] }))).toEqual(['A fact']);
    expect(factsFromText('["x is y", "z"]')).toEqual(['x is y', 'z']);
  });

  it('reads text content from MCP results', () => {
    expect(mcpText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\nb');
    expect(mcpText(null)).toBe('');
  });

  it('calls the tools once and caches the context', async () => {
    const calls: string[] = [];
    const mcp: McpLike = {
      listTools: async () => ({ tools: [{ name: 'bee_get_today' }, { name: 'bee_list_facts' }] }),
      callTool: async ({ name }) => {
        calls.push(name);
        return { content: [{ type: 'text', text: name === 'bee_get_today' ? '10:00 Supplier call' : '- Musa is my supplier' }] };
      },
      close: async () => {},
    };
    const p = new McpContextProvider(mcp);
    const ctx = await p.get();
    await p.get();
    expect(ctx).toEqual({ facts: ['Musa is my supplier'], today: '10:00 Supplier call' });
    expect(calls).toEqual(['bee_get_today', 'bee_list_facts']);
  });
});
