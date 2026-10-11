import type { Commitment } from './types.js';

export interface ExpectedCommitment {
  /** All keywords must appear (case-insensitive) in `what`. */
  keywords: string[];
  /** If set, must appear (case-insensitive) in `who`. */
  who: string | null;
  /** Expected due date (YYYY-MM-DD in the case timezone), or null for "no time". */
  dueDate: string | null;
}

export interface CaseScore {
  matched: number;
  missed: ExpectedCommitment[];
  falsePositives: Commitment[];
  dateErrors: number;
}

const localDate = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** Match extracted commitments to expected ones (each used once). */
export function scoreCase(expected: ExpectedCommitment[], got: Commitment[], timezone: string): CaseScore {
  const remaining = [...got];
  const missed: ExpectedCommitment[] = [];
  let matched = 0;
  let dateErrors = 0;
  for (const exp of expected) {
    const idx = remaining.findIndex((c) => exp.keywords.every((k) => c.what.toLowerCase().includes(k.toLowerCase())));
    if (idx < 0) {
      missed.push(exp);
      continue;
    }
    const [c] = remaining.splice(idx, 1);
    const whoOk = exp.who === null || (c!.who ?? '').toLowerCase().includes(exp.who.toLowerCase());
    const dateOk = exp.dueDate === null ? c!.dueAt === null : c!.dueAt !== null && localDate(c!.dueAt, timezone) === exp.dueDate;
    if (whoOk && dateOk) matched++;
    else {
      dateErrors += dateOk ? 0 : 1;
      missed.push(exp);
    }
  }
  return { matched, missed, falsePositives: remaining, dateErrors };
}
