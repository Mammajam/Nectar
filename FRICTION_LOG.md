# Friction log

One entry per issue, written the day it happens. Submissions with friction logs can earn up to a 10% judging bonus.

Entries dated 2026-10-11 were found while building and testing against Bee's documentation; add entries from live device use below them.

| Date | Tool | Task attempted | Steps taken | Expected vs. actual | Severity | Workaround | Suggestion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-11 | Bee proxy API | Read the changefeed and conversation transcripts | Read the proxy docs; called `/v1/changes` and `/v1/conversations/:id` | Expected documented response schemas; the docs list endpoints but no response shapes | Medium | Defensive normalizers for several shapes; `npm run check:g0` prints real samples | Publish OpenAPI schemas for the proxy API and stream payloads |
| 2026-10-11 | `bee stream` | Tell journal events from utterances in `--json` mode | Subscribed with `--types`; parsed JSON lines | Expected an event name; JSON mode has none, so events are told apart by their keys | Low | Classify by structural keys (`utterance`, `todo`, `journal`) | Add a `type` field to JSON output |
| 2026-10-11 | `bee stream` | Never miss a promise when the laptop sleeps | Ran the stream; read the realtime docs | Expected resumable delivery; the stream is at-most-once with no replay | Medium | Changefeed catch-up at startup and every 5 min, with de-duplication | Event IDs and `Last-Event-ID` replay on `/v1/stream` |
| 2026-10-11 | Bee CLI | Accept Bee's own to-do suggestions | Looked for a REST route | Expected `/v1/todos/suggestions`; only CLI commands exist | Low | CLI subprocess wrapper that fails soft | REST routes for suggestions and today's brief |
| 2026-10-11 | Bee proxy API | Set alarms and read them back | `POST /v1/todos` with `alarm_at` | Sent ISO 8601, received epoch milliseconds | Low | Convert on read | One format in and out |
| 2026-10-11 | AWS SDK v3 (Bedrock Runtime) | Integration-test Bedrock against a local mock | Pointed the SDK at a local HTTP server via `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` | Expected a normal request; got a bare "Protocol error" because the client uses HTTP/2 | Low | HTTP/2 mock server | Name HTTP/2 in the error message or SDK docs |
| | | | | | | | |
