export interface SseMessage {
  event: string | null;
  data: string;
  id: string | null;
}

/**
 * Parse a Server-Sent Events byte stream into messages (WHATWG SSE rules:
 * blank line ends a message, multiple `data:` lines join with "\n",
 * lines starting with ":" are comments).
 */
export async function* parseSse(stream: AsyncIterable<Uint8Array | string>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | null = null;
  let id: string | null = null;
  let data: string[] = [];

  const flush = (): SseMessage | null => {
    const msg = data.length > 0 ? { event, data: data.join('\n'), id } : null;
    event = null;
    data = [];
    return msg;
  };

  const handleLine = (line: string): SseMessage | null => {
    if (line === '') return flush();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    return null;
  };

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.search(/\r\n|\n|\r/)) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + (buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1));
      const msg = handleLine(line);
      if (msg) yield msg;
    }
  }
  // Stream ended: process an unterminated last line, then any pending message.
  if (buffer) handleLine(buffer);
  const last = flush();
  if (last) yield last;
}
