import { COMMITMENT_SCHEMA, COMMITMENT_TOOL_NAME, SYSTEM_PROMPT, buildUserMessage } from './prompt.js';
import { isObject } from '../bee/types.js';
import type { Commitment, ExtractionContext, StructuredLlm, UtteranceWindow } from './types.js';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Validate the model's tool input; drop anything malformed instead of trusting it. */
export function parseCommitments(raw: unknown): Commitment[] {
  const list = isObject(raw) && Array.isArray(raw.commitments) ? raw.commitments : [];
  const out: Commitment[] = [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const what = str(item.what);
    const confidence = Number(item.confidence);
    if (!what || !Number.isFinite(confidence)) continue;
    let dueAt = str(item.dueAt);
    if (dueAt && Number.isNaN(Date.parse(dueAt))) dueAt = null;
    out.push({
      who: str(item.who),
      what: what.slice(0, 120),
      dueText: str(item.dueText),
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      confidence: Math.min(1, Math.max(0, confidence)),
      quote: str(item.quote) ?? what,
    });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/** Remove repeats of the same promise within one window. */
export function dedupeCommitments(items: Commitment[]): Commitment[] {
  const best = new Map<string, Commitment>();
  for (const c of items) {
    const key = norm(c.what);
    const prev = best.get(key);
    if (!prev || c.confidence > prev.confidence) best.set(key, c);
  }
  return [...best.values()];
}

export interface ExtractorOptions {
  timezone: string;
  /** Below this, a commitment is discarded entirely. */
  minConfidence?: number;
  now?: () => Date;
}

export class CommitmentExtractor {
  private readonly minConfidence: number;
  private readonly now: () => Date;

  constructor(
    private readonly llm: StructuredLlm,
    private readonly opts: ExtractorOptions,
  ) {
    this.minConfidence = opts.minConfidence ?? 0.4;
    this.now = opts.now ?? (() => new Date());
  }

  async extract(window: UtteranceWindow, context: ExtractionContext = { facts: [], today: null }): Promise<Commitment[]> {
    if (window.utterances.length === 0) return [];
    const raw = await this.llm.structured({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(window, context, this.now(), this.opts.timezone),
      tool: {
        name: COMMITMENT_TOOL_NAME,
        description: 'Record the commitments the wearer made in the transcript.',
        schema: COMMITMENT_SCHEMA,
      },
    });
    return dedupeCommitments(parseCommitments(raw)).filter((c) => c.confidence >= this.minConfidence);
  }
}
