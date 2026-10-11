import type { ExtractionContext, JsonSchema, UtteranceWindow } from './types.js';

export const COMMITMENT_TOOL_NAME = 'record_commitments';

export const COMMITMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    commitments: {
      type: 'array',
      description: 'Every promise the wearer made in this window. Empty if none.',
      items: {
        type: 'object',
        properties: {
          who: { type: ['string', 'null'], description: 'Person or role the promise was made to; null if unclear.' },
          what: { type: 'string', description: 'Short imperative action, max 60 characters, e.g. "Send Musa the price list".' },
          dueText: { type: ['string', 'null'], description: 'Time words as spoken, e.g. "by 3 PM", "Friday"; null if none.' },
          dueAt: {
            type: ['string', 'null'],
            description: 'Resolved due time, ISO 8601 with UTC offset, using the provided current time and timezone; null if no time was stated or implied.',
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          quote: { type: 'string', description: 'The exact words containing the promise.' },
        },
        required: ['who', 'what', 'dueText', 'dueAt', 'confidence', 'quote'],
      },
    },
  },
  required: ['commitments'],
};

export const SYSTEM_PROMPT = `You are Nectar, an assistant that finds promises in transcripts recorded by the user's Bee wearable.

The wearer is the speaker labelled "me" (or the speaker who matches the user's name). Record a commitment ONLY when the wearer promises to do something themselves: "I'll send it", "let me get back to you", "I will call the supplier tomorrow", "leave it with me".

Do NOT record:
- Requests the wearer makes of others ("can you send me the list?").
- Promises made by other speakers.
- Vague intentions with no action ("we should catch up sometime") unless the wearer clearly commits.
- Past actions ("I sent it yesterday").
- Small talk, greetings, or thanks.

Rules:
- "what" is a short imperative a person can act on, under 60 characters, naming the object ("Send Musa the price list", not "Send it").
- Resolve "who" and object names using the facts and earlier lines in the window.
- Resolve relative times against the CURRENT TIME given below, in the user's timezone. "By 3 PM" today means 15:00 today; "Friday" means the next Friday; "tomorrow morning" means 09:00 tomorrow; "end of day" means 17:00 today; "later" or no time means dueAt null.
- Confidence: 0.9+ for explicit first-person promises with an action; 0.6-0.8 when the wording or ownership is hedged ("I'll try to", "maybe I can"); below 0.5 when unsure. Do not record anything below 0.4.
- If the same promise is repeated, record it once.
- Always call the ${COMMITMENT_TOOL_NAME} tool, with an empty list when there are no commitments.`;

/** Worked examples shown to the model before the real window. */
export const FEW_SHOT = `EXAMPLES (current time Monday 2026-10-12 10:00, Africa/Monrovia, UTC+00:00)

Transcript:
[me] Musa, I'll send you the new price list by 3 PM.
[Musa] Great, thanks.
Result: [{"who":"Musa","what":"Send Musa the new price list","dueText":"by 3 PM","dueAt":"2026-10-12T15:00:00+00:00","confidence":0.95,"quote":"I'll send you the new price list by 3 PM"}]

Transcript:
[Fatu] Can you check the rice stock before Friday?
[me] Sure, I'll check it Thursday morning.
Result: [{"who":"Fatu","what":"Check the rice stock","dueText":"Thursday morning","dueAt":"2026-10-15T09:00:00+00:00","confidence":0.92,"quote":"Sure, I'll check it Thursday morning."}]

Transcript:
[me] Can you send me the invoice?
[Kollie] I'll send it tonight.
Result: []

Transcript:
[me] Good morning! How was the weekend?
[Ama] Fine, thank you.
Result: []

Transcript:
[me] Let me look into the delivery delay and get back to you.
[Customer] Okay.
Result: [{"who":"Customer","what":"Look into the delivery delay and reply","dueText":null,"dueAt":null,"confidence":0.85,"quote":"Let me look into the delivery delay and get back to you."}]`;

/** Format the current time with weekday and UTC offset in the user's timezone. */
export function describeNow(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const offset = get('timeZoneName').replace('GMT', '') || '+00:00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('weekday')} ${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}, ${timezone}, UTC${offset}`;
}

export function buildUserMessage(
  window: UtteranceWindow,
  context: ExtractionContext,
  now: Date,
  timezone: string,
): string {
  const lines = window.utterances.map((u) => `[${u.speaker ?? 'unknown'}] ${u.text}`).join('\n');
  const facts = context.facts.length ? context.facts.map((f) => `- ${f}`).join('\n') : '(none)';
  return [
    FEW_SHOT,
    '',
    `CURRENT TIME: ${describeNow(now, timezone)}`,
    '',
    'FACTS THE WEARER HAS CONFIRMED:',
    facts,
    '',
    "TODAY'S BRIEF:",
    context.today?.trim() || '(none)',
    '',
    'TRANSCRIPT TO ANALYZE:',
    lines,
  ].join('\n');
}
