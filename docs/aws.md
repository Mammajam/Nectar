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

## What this does not use

- **Strands Agents SDK / AgentCore:** not used. Nectar calls the Bedrock Converse API directly with a forced tool choice, so each window is one structured model call inside a multi-step pipeline (window, context, extract, resolve time, de-duplicate, write). There is no agent loop.
- **Bee MCP tools chosen by the model:** the model does not call tools. Nectar reads facts and today's brief from `bee mcp serve` itself, before the call, and puts them in the prompt.

## Setup

1. Configure credentials (`aws configure` or `AWS_PROFILE`) with `bedrock:InvokeModel` permission.
2. In the Bedrock console, open an Anthropic model once and submit the one-time use-case form (a GitHub URL is accepted).
3. Check access: `npm run check:g0 -- --bedrock`.
4. Measure extraction quality: `npm run eval`.

## Challenges

- **Bedrock account quota (open as of 2026-10-17).** The AWS account used for this project was provisioned with an applied quota of 0 for the "tokens per day" quotas, so every Bedrock call returns `ThrottlingException: Too many tokens per day`, for Claude Haiku 4.5 and for Amazon Nova alike. The Anthropic use-case form and Marketplace subscription are done, and Service Quotas will not accept an increase at or below the default, so the fix has to come from AWS Support. Until it does, the model calls in this repo are covered by tests against a mocked Bedrock endpoint and have not been recorded live. See the friction log for the full entry.

## Evaluation

`npm run eval` runs 10 labeled conversations (`test/fixtures/eval-set.json`): 6 with 8 promises in total, and 4 without (requests to others, small talk, past actions, vague intentions). Gate G2 passes at 80% of commitments correct (action, person, local due date) with fewer than 2 false positives.

Record each run of `npm run eval` here (the Bedrock results have not been recorded yet):

| Date | Model | Correct | False positives | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
