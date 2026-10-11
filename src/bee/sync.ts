import type { BeeClient } from './client.js';
import { classifyEvent, conversationRefs, isObject, type BeeEvent, type BeeUtterance } from './types.js';
import type { Store } from '../store/db.js';

export const CHANGES_CURSOR_KEY = 'bee.changes.cursor';

export interface CatchUpResult {
  changesSeen: number;
  conversationsFetched: number;
  /** Conversations not yet COMPLETED; skipped until Bee reports them again. */
  conversationsSkipped: number;
  newUtterances: number;
  cursor: string | null;
}

/** Find the utterance list in a conversation response (shape not documented). */
export function utterancesOf(conversation: unknown): BeeUtterance[] {
  if (!isObject(conversation)) return [];
  const direct = conversation.utterances;
  if (Array.isArray(direct)) return direct as BeeUtterance[];
  const transcript = conversation.transcript;
  if (isObject(transcript) && Array.isArray(transcript.utterances)) return transcript.utterances as BeeUtterance[];
  if (Array.isArray(transcript)) return transcript as BeeUtterance[];
  return [];
}

/**
 * Replay what changed while Nectar was offline. `bee stream` is at-most-once,
 * so this runs on startup (and can run on a timer) to fill gaps.
 * Utterances are deduplicated by the store, so running it twice is safe.
 */
export async function catchUp(
  client: BeeClient,
  store: Store,
  onNewEvent?: (event: BeeEvent) => void,
): Promise<CatchUpResult> {
  const page = await client.changes(store.get(CHANGES_CURSOR_KEY));
  const conversationIds = new Set<string>();
  let skipped = 0;
  for (const c of page.changes) {
    if (c.type !== 'conversation') continue;
    // The changefeed lists conversations still in progress; wait until they are complete.
    if (c.state !== undefined && c.state.toUpperCase() !== 'COMPLETED') {
      skipped++;
      continue;
    }
    conversationIds.add(String(c.id));
  }

  let newUtterances = 0;
  for (const id of conversationIds) {
    const conversation = await client.getConversation(id);
    // One key everywhere: the uuid. Use the learned map first, then the API's own uuid;
    // fall back to the numeric id only when neither is known.
    const refs = isObject(conversation) ? conversationRefs(conversation) : { id: null, uuid: null };
    if (refs.uuid) store.linkConversation(id, refs.uuid);
    const uuid = store.uuidFor(id) ?? refs.uuid;
    for (const utterance of utterancesOf(conversation)) {
      if (typeof utterance?.text !== 'string') continue;
      const event = classifyEvent(uuid ? { utterance, conversation_uuid: uuid } : { utterance, conversation_id: id });
      if (store.insertEvent(event)) {
        newUtterances++;
        onNewEvent?.(event);
      }
    }
  }

  if (page.cursor) store.set(CHANGES_CURSOR_KEY, page.cursor);
  return {
    changesSeen: page.changes.length,
    conversationsFetched: conversationIds.size,
    conversationsSkipped: skipped,
    newUtterances,
    cursor: page.cursor,
  };
}
