import type { BeeEvent } from '../bee/types.js';
import type { UtteranceWindow } from './types.js';

export interface WindowerOptions {
  /** Flush a conversation after this much silence. */
  pauseMs?: number;
  /** Flush early when a window gets this long. */
  maxUtterances?: number;
  /** Lines from the previous window carried over as context. */
  overlap?: number;
}

interface Buffer {
  utterances: UtteranceWindow['utterances'];
  startedAt: number;
  lastAt: number;
  carried: number;
}

/**
 * Groups live utterances per conversation and releases a window after a pause.
 * Call `add` for each event and `tick` on a timer; both return ready windows.
 * The last few lines of each window are carried into the next one so a promise
 * that spans a flush ("...the price list." / "I'll send it by 3") keeps context.
 */
export class UtteranceWindower {
  private readonly buffers = new Map<string, Buffer>();
  private readonly pauseMs: number;
  private readonly maxUtterances: number;
  private readonly overlap: number;

  constructor(opts: WindowerOptions = {}) {
    this.pauseMs = opts.pauseMs ?? 20_000;
    this.maxUtterances = opts.maxUtterances ?? 40;
    this.overlap = opts.overlap ?? 3;
  }

  add(event: BeeEvent, now = Date.now()): UtteranceWindow[] {
    if (event.kind !== 'utterance' || !event.utterance.text?.trim()) return [];
    const id = event.conversationId ?? 'unknown';
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = { utterances: [], startedAt: now, lastAt: now, carried: 0 };
      this.buffers.set(id, buf);
    }
    buf.utterances.push({ speaker: event.utterance.speaker ?? null, text: event.utterance.text.trim() });
    buf.lastAt = now;
    // Only new lines count toward the limit, not the ones carried over.
    return buf.utterances.length - buf.carried >= this.maxUtterances ? [this.flush(id, now)] : [];
  }

  /** Release every conversation that has been quiet for `pauseMs`. */
  tick(now = Date.now()): UtteranceWindow[] {
    const ready: UtteranceWindow[] = [];
    for (const [id, buf] of this.buffers) {
      if (buf.utterances.length > buf.carried && now - buf.lastAt >= this.pauseMs) ready.push(this.flush(id, now));
    }
    return ready;
  }

  /** Release everything (used on shutdown). */
  flushAll(now = Date.now()): UtteranceWindow[] {
    return [...this.buffers.keys()]
      .filter((id) => {
        const b = this.buffers.get(id)!;
        return b.utterances.length > b.carried;
      })
      .map((id) => this.flush(id, now));
  }

  private flush(id: string, now: number): UtteranceWindow {
    const buf = this.buffers.get(id)!;
    const window: UtteranceWindow = { conversationId: id, utterances: [...buf.utterances], startedAt: buf.startedAt, endedAt: now };
    const carry = buf.utterances.slice(-this.overlap);
    this.buffers.set(id, { utterances: carry, startedAt: now, lastAt: now, carried: carry.length });
    return window;
  }
}
