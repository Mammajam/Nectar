import { describe, expect, it } from 'vitest';
import { parseSse } from '../src/bee/sse.js';

async function collect(chunks: string[]) {
  async function* gen() {
    for (const c of chunks) yield new TextEncoder().encode(c);
  }
  const out = [];
  for await (const m of parseSse(gen())) out.push(m);
  return out;
}

describe('parseSse', () => {
  it('parses events split across chunk boundaries', async () => {
    const msgs = await collect(['event: new-utt', 'erance\ndata: {"utterance":', '{"text":"hi"}}\n\n']);
    expect(msgs).toEqual([{ event: 'new-utterance', data: '{"utterance":{"text":"hi"}}', id: null }]);
  });

  it('joins multi-line data, skips comments and handles CRLF', async () => {
    const msgs = await collect([': keepalive\r\n', 'id: 5\r\ndata: a\r\ndata: b\r\n\r\n']);
    expect(msgs).toEqual([{ event: null, data: 'a\nb', id: '5' }]);
  });

  it('emits a trailing message without a final blank line', async () => {
    const msgs = await collect(['data: last']);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.data).toBe('last');
  });
});
