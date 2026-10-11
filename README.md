# Nectar

**Bee remembers what you said. Nectar makes sure you do it.**

Nectar is an ambient commitment agent for [Bee](https://docs.bee.computer/docs), Amazon's wearable AI. It listens to live conversation data from Bee on an Apple Watch, detects promises you make ("I'll send the price list by 3 PM"), and turns them into Bee to-dos whose alarms fire on your wrist.

Built for the Amazon Developer *Build, Ship, Shape* hackathon, Bee (Wearable AI) track.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Access and foundations: repo, config, gate-check script | Done (run `npm run check:g0` on your machine) |
| 1 | Bee data layer: API client, live stream, catch-up, SQLite store | Done |
| 2 | Commitment extraction with Amazon Bedrock + Bee MCP context | Done; run `npm run eval` for gate G2 |
| 3 | To-do + wrist alarm, evening review, voice close-out | Planned |
| 4 | Hardening, tests, optional features | Planned |
| 5 | Demo video and submission | Planned |

## How it uses Bee

All Bee access goes through the official CLI, [`@beeai/cli`](https://docs.bee.computer/docs):

| Bee surface | Where in code | Used for |
| --- | --- | --- |
| `bee proxy` (local REST API at `127.0.0.1:8787/v1/*`) | `src/bee/proxy.ts`, `src/bee/client.ts` | To-dos, facts, conversations, changefeed |
| `bee stream --json` (live events) | `src/bee/stream.ts` (`CliStreamSource`) | New utterances, conversations, journals, to-dos |
| `GET /v1/stream` (SSE) | `src/bee/stream.ts` (`SseStreamSource`) | Alternative live source (`NECTAR_STREAM_MODE=sse`) |
| `GET /v1/changes` with cursor | `src/bee/sync.ts` | Catch-up after downtime (the stream is at-most-once) |
| `bee mcp serve` (MCP, stdio) | `src/ai/context.ts` (`McpContextProvider`) | Confirmed facts and today's brief as context for the model |

```
Apple Watch (Bee) -> Bee iOS app -> Bee cloud -> bee CLI (proxy + stream + MCP) -> Nectar
Nectar: utterances -> 20 s windows -> Amazon Bedrock (Converse, forced tool) -> commitments (SQLite)
Phase 3: commitments -> POST /v1/todos (alarm_at) -> alarm on the watch
```

AWS details for the AWS Builder mini challenge: [docs/aws.md](docs/aws.md).

## Setup

Requirements: Node.js 22.13+ (uses the built-in `node:sqlite`), an Apple Watch running Bee, and the Bee iOS app.

1. In the Bee iOS app, unlock **Developer Mode** by tapping the version number 5 times.
2. Install the CLI and sign in:
   ```bash
   npm i -g @beeai/cli
   bee login
   bee status
   ```
3. Install and configure Nectar:
   ```bash
   npm install
   cp .env.example .env
   ```
4. Run the Phase 0 gate check:
   ```bash
   npm run check:g0                 # read-only checks
   npm run check:g0 -- --stream 60  # listen 60 s; talk near your watch
   npm run check:g0 -- --alarm      # create a test to-do with an alarm in 5 min
   ```
5. Set up Amazon Bedrock (see [docs/aws.md](docs/aws.md)), then check access and extraction quality:
   ```bash
   npm run check:g0 -- --bedrock
   npm run eval
   ```
6. Start Nectar:
   ```bash
   npm run dev
   ```
   Nectar reads `.env` automatically. Press Ctrl+C to stop. Talk near your watch; after 20 s of silence you'll see lines like:
   ```
   [commitment open] Send Musa the price list -> Musa | due 2026-10-12T15:00:00.000Z (95%)
   ```
   List what it has captured with `npm run commitments`.

## Development

```bash
npm test          # unit tests (Vitest)
npm run typecheck # TypeScript strict mode
npm run build     # compile to dist/
```

| Path | Purpose |
| --- | --- |
| `src/bee/client.ts` | Typed client for the Bee proxy API, tolerant of undocumented response shapes |
| `src/bee/stream.ts` | Live event sources with automatic reconnect and backoff |
| `src/bee/sse.ts` | Server-Sent Events parser |
| `src/bee/sync.ts` | Cursor-based catch-up from `/v1/changes` |
| `src/bee/types.ts` | Bee types and event classification by structural keys |
| `src/store/db.ts` | SQLite store: events (deduplicated), commitments, cursor |
| `src/ai/windowing.ts` | Groups utterances per conversation; releases a window after silence |
| `src/ai/context.ts` | Bee MCP client for facts and today's brief (REST fallback) |
| `src/ai/prompt.ts` | System prompt, worked examples and the `record_commitments` tool schema |
| `src/ai/bedrock.ts` | Bedrock Converse client with forced tool use and retries |
| `src/ai/extractor.ts` | Validates, de-duplicates and filters model output |
| `src/pipeline.ts` | Utterances -> windows -> context -> extraction -> store |
| `scripts/check-g0.ts` | Phase 0 gate check against your real Bee account (`--bedrock` for model access) |
| `scripts/eval-extraction.ts` | Phase 2 gate: scores extraction on labeled conversations |
| `scripts/list-commitments.ts` | Prints captured commitments |

## Assumptions to verify with live data

Bee does not publish full response schemas, so these parts are written defensively and should be checked during Phase 0 (`check:g0` prints sample shapes):

- The shape of `/v1/changes` and its cursor field (`next_cursor` vs. `cursor`).
- Where a conversation's utterances live (`utterances` vs. `transcript`).
- Utterance timestamp field name and unit (used for lag measurement).

Log anything surprising in [FRICTION_LOG.md](FRICTION_LOG.md).

## Privacy

Bee records the people around you. Ask for consent before recording colleagues, and keep `data/` (your local database) out of version control; it is ignored by default.

## License

[MIT](LICENSE)
