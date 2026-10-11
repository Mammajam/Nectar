# AWS integration (AWS Builder mini challenge)

Nectar uses **Amazon Bedrock** as its reasoning layer. Every commitment shown on the wrist was extracted by a Bedrock model.

## Services used

| Service | API | Where in code | Purpose |
| --- | --- | --- | --- |
| Amazon Bedrock Runtime | `Converse` (`@aws-sdk/client-bedrock-runtime`) | `src/ai/bedrock.ts` | Structured extraction of commitments from Bee transcripts |
| Bedrock cross-region inference profile | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (default) | `src/config.ts` | Low-latency Claude Haiku for short, frequent windows |
| Amazon Nova (optional fallback) | `us.amazon.nova-lite-v1:0` | `NECTAR_MODEL_ID` | Works without the Anthropic use-case form |

## How the pipeline uses Bedrock

1. Bee utterances are grouped per conversation and released after 20 s of silence (`src/ai/windowing.ts`).
2. Context comes from Bee's MCP server: confirmed facts and today's brief (`src/ai/context.ts`).
3. `BedrockStructuredLlm` calls `Converse` with a single tool, `record_commitments`, whose JSON Schema defines `who`, `what`, `dueText`, `dueAt`, `confidence` and `quote`. Tool choice is forced, so the model must answer with schema-shaped JSON (`src/ai/prompt.ts`).
4. The output is validated, de-duplicated and stored as `open` (confidence at least 0.7) or `suggested` (`src/ai/extractor.ts`, `src/pipeline.ts`).
5. Throttling and transient errors are retried with exponential backoff; access errors fail fast with a clear message.

Temperature is 0 for repeatable output. The current time and timezone are sent with every request so the model resolves "Friday" or "by 3 PM" to a timestamp.

## Setup

1. Configure credentials (`aws configure` or `AWS_PROFILE`) with `bedrock:InvokeModel` permission.
2. In the Bedrock console, open an Anthropic model once and submit the one-time use-case form (a GitHub URL is accepted).
3. Check access: `npm run check:g0 -- --bedrock`.
4. Measure extraction quality: `npm run eval`.

## Evaluation

`npm run eval` runs 10 labeled conversations (`test/fixtures/eval-set.json`): 6 with 8 promises in total, and 4 without (requests to others, small talk, past actions, vague intentions). Gate G2 passes at 80% of commitments correct (action, person, local due date) with fewer than 2 false positives.

| Date | Model | Correct | False positives | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
