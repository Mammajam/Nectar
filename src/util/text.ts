const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'my', 'your', 'his', 'her', 'their',
  'our', 'it', 'is', 'be', 'me', 'him', 'them', 'us', 'i', 'will', 'ill', 'this', 'that', 'about', 'up', 'back', 'due',
]);

/** Very light stemming so "updated"/"updating"/"updates" all match "update". */
export function stem(w: string): string {
  if (w.length > 6 && /(at|iz|us|ar)ing$/.test(w)) return `${w.slice(0, -3)}e`; // updating -> update
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3); // sending -> send
  if (w.length > 5 && /(at|iz|us|ar)ed$/.test(w)) return w.slice(0, -1); // updated -> update
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2); // called -> call
  if (w.length > 4 && w.endsWith('es') && /(at|iz|us|ar)es$/.test(w)) return w.slice(0, -1); // updates -> update
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1); // lists -> list
  return w;
}

/** Lowercase content words, lightly stemmed ("sent" stays, "lists" -> "list"). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Share of the smaller token set found in the other (0..1). Robust to extra words. */
export function overlap(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / Math.min(x.size, y.size);
}
