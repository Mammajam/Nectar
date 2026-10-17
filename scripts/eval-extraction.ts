/**
 * Phase 2 gate (G2): run the extractor against labeled conversations.
 *   npm run eval                 uses Bedrock (needs AWS credentials + model access)
 *   npm run eval -- --model us.amazon.nova-lite-v1:0
 * Pass: at least 80% of expected commitments right (action, person, date)
 * and fewer than 2 false positives across the no-promise cases.
 */
import { readFileSync } from 'node:fs';
import { createLlm } from '../src/ai/provider.js';
import { scoreCase, type ExpectedCommitment } from '../src/ai/evaluate.js';
import { CommitmentExtractor } from '../src/ai/extractor.js';
import { loadConfig } from '../src/config.js';
import { loadDotEnv } from '../src/env.js';

interface EvalSet {
  now: string;
  timezone: string;
  facts: string[];
  cases: { id: string; utterances: [string, string][]; expected: ExpectedCommitment[] }[];
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const modelArg = process.argv.indexOf('--model');
  const modelId = modelArg >= 0 ? process.argv[modelArg + 1]! : config.modelId;
  const set = JSON.parse(readFileSync(new URL('../test/fixtures/eval-set.json', import.meta.url), 'utf8')) as EvalSet;

  const extractor = new CommitmentExtractor(createLlm(config, modelId), {
    timezone: set.timezone,
    now: () => new Date(set.now),
  });

  console.log(`Provider ${config.provider}, model ${modelId}, ${set.cases.length} cases, now = ${set.now}\n`);
  let expectedTotal = 0;
  let matchedTotal = 0;
  let falsePositives = 0;
  const started = Date.now();

  for (const c of set.cases) {
    const window = {
      conversationId: c.id,
      utterances: c.utterances.map(([speaker, text]) => ({ speaker, text })),
      startedAt: 0,
      endedAt: 0,
    };
    const t0 = Date.now();
    const got = await extractor.extract(window, { facts: set.facts, today: null });
    const s = scoreCase(c.expected, got, set.timezone);
    expectedTotal += c.expected.length;
    matchedTotal += s.matched;
    falsePositives += s.falsePositives.length;
    const ok = s.missed.length === 0 && s.falsePositives.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(20)} ${s.matched}/${c.expected.length} matched, ${s.falsePositives.length} extra  (${Date.now() - t0} ms)`);
    for (const g of got) {
      console.log(`        got: ${g.what} | who=${g.who ?? '-'} | due=${g.dueAt ?? '-'} | ${Math.round(g.confidence * 100)}%`);
    }
    for (const m of s.missed) console.log(`        missed: [${m.keywords.join(', ')}] who=${m.who ?? '-'} due=${m.dueDate ?? '-'}`);
  }

  const passed = matchedTotal >= Math.ceil(expectedTotal * 0.8) && falsePositives < 2;
  console.log(`\nG2 ${passed ? 'PASSED' : 'NOT YET'}: ${matchedTotal}/${expectedTotal} commitments right, ${falsePositives} false positives, ${((Date.now() - started) / 1000).toFixed(1)} s total`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  console.error('\nIf this is AccessDeniedException: submit the Anthropic use-case form in the Bedrock console, or try --model us.amazon.nova-lite-v1:0');
  process.exit(1);
});
