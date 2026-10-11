/** A promise the user made, as extracted from a window of conversation. */
export interface Commitment {
  /** Who the promise was made to (name or role), or null if unclear. */
  who: string | null;
  /** The action, phrased as a short imperative: "Send Musa the price list". */
  what: string;
  /** The time words as spoken: "by 3 PM", "Friday", or null. */
  dueText: string | null;
  /** Resolved due time as ISO 8601 with offset, or null when no time was given. */
  dueAt: string | null;
  /** 0..1 confidence that this is a real commitment made by the wearer. */
  confidence: number;
  /** The exact words that contain the promise. */
  quote: string;
}

export interface WindowUtterance {
  speaker: string | null;
  text: string;
}

export interface UtteranceWindow {
  conversationId: string;
  utterances: WindowUtterance[];
  startedAt: number;
  endedAt: number;
}

export interface ExtractionContext {
  /** Confirmed Bee facts, e.g. "Musa is my supplier for rice". */
  facts: string[];
  /** Today's brief (calendar events, etc.) as plain text, if available. */
  today: string | null;
}

/** Minimal JSON Schema subset we pass to the model as a tool input schema. */
export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  system: string;
  user: string;
  tool: { name: string; description: string; schema: JsonSchema };
  maxTokens?: number;
}

/** Any model that can return tool-shaped structured output. */
export interface StructuredLlm {
  readonly modelId: string;
  structured(req: StructuredRequest): Promise<unknown>;
}
