import type { BeeEvent } from './bee/types.js';
import type { ContextProvider } from './ai/context.js';
import type { CommitmentExtractor } from './ai/extractor.js';
import type { UtteranceWindower } from './ai/windowing.js';
import type { Commitment, UtteranceWindow } from './ai/types.js';
import type { CommitmentStatus, Store } from './store/db.js';

export interface PipelineResult {
  window: UtteranceWindow;
  saved: { id: number; commitment: Commitment; status: CommitmentStatus }[];
  skippedDuplicates: number;
}

export interface PipelineOptions {
  /** At or above this, a commitment is "open" (Phase 3 turns it into a todo); below it, "suggested". */
  openThreshold?: number;
  onResult?: (r: PipelineResult) => void;
  onError?: (err: unknown, window: UtteranceWindow) => void;
}

/**
 * Phase 2 pipeline: utterances -> windows -> context -> extraction -> store.
 * Windows are processed one at a time so model calls never overlap.
 */
export class CommitmentPipeline {
  private queue: Promise<void> = Promise.resolve();
  private readonly openThreshold: number;

  constructor(
    private readonly windower: UtteranceWindower,
    private readonly extractor: CommitmentExtractor,
    private readonly context: ContextProvider,
    private readonly store: Store,
    private readonly opts: PipelineOptions = {},
  ) {
    this.openThreshold = opts.openThreshold ?? 0.7;
  }

  onEvent(event: BeeEvent, now = Date.now()): void {
    for (const w of this.windower.add(event, now)) this.enqueue(w);
  }

  tick(now = Date.now()): void {
    for (const w of this.windower.tick(now)) this.enqueue(w);
  }

  /** Flush remaining windows and wait for all processing to finish. */
  async drain(now = Date.now()): Promise<void> {
    for (const w of this.windower.flushAll(now)) this.enqueue(w);
    await this.queue;
  }

  private enqueue(window: UtteranceWindow): void {
    this.queue = this.queue
      .then(async () => {
        await this.process(window);
      })
      .catch((err) => this.opts.onError?.(err, window));
  }

  async process(window: UtteranceWindow): Promise<PipelineResult> {
    let context;
    try {
      context = await this.context.get();
    } catch {
      context = { facts: [], today: null };
    }
    const commitments = await this.extractor.extract(window, context);
    const saved: PipelineResult['saved'] = [];
    let skippedDuplicates = 0;
    for (const c of commitments) {
      if (this.store.findSimilarCommitment(c.what, window.conversationId)) {
        skippedDuplicates++;
        continue;
      }
      const status: CommitmentStatus = c.confidence >= this.openThreshold ? 'open' : 'suggested';
      saved.push({ id: this.store.insertCommitment(c, window.conversationId, status), commitment: c, status });
    }
    const result = { window, saved, skippedDuplicates };
    this.opts.onResult?.(result);
    return result;
  }
}
