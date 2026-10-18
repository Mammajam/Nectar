# Bee feature research: what the platform already does

Research date: 2026-10-18. Question: does the Bee platform have the features Nectar builds?

## Short answer

Partly. Bee provides the plumbing: to-dos with alarms, Bee's own to-do suggestions, a live stream, a changefeed, facts, today's brief, voice notes, and an MCP server. Bee does not document the commitment loop that Nectar adds: deduplicated scheduling with due times, a pre-meeting recap, an evening review with rollover, and reliable voice close-out.

## Feature by feature

| Nectar feature | Built into Bee? | Evidence |
| --- | --- | --- |
| Detect promises in conversation | Partly | Bee proposes to-dos from conversations (`bee todos suggestions`). The bundled Bee skill describes Bee as extracting "commitments." Nectar's own extractor adds wearer-only filtering, confidence scores and due-time resolution. |
| To-do with alarm | Yes | `bee todos create --alarm-at`, `bee todos update --alarm-at / --clear-alarm` ([CLI docs](https://docs.bee.computer/docs/cli)) |
| Accept Bee's suggestions | Yes | `bee todos accept-suggestion`, `dismiss-suggestion` (CLI docs). Used in `src/actions/scheduler.ts`. |
| Match against existing to-dos and suggestions | No | Nectar's scheduler does this. No dedupe is documented for Bee. |
| Due time separate from the alarm | No | To-dos carry only `alarmAt` (CLI and [Realtime docs](https://docs.bee.computer/docs/realtime)). |
| Live stream of utterances and to-do events | Yes | `bee stream` with `--types`; event types `new-utterance`, `todo-created`, `todo-updated`, `journal-*` (Realtime docs). Delivery is at-most-once. |
| Catch-up after downtime | Yes | `bee changed --cursor` ([Agentic Sync docs](https://docs.bee.computer/docs/agentic-sync)) |
| Context from facts and today's brief | Yes | `bee facts`, `bee today --context`, `bee mcp serve` (CLI docs) |
| Pre-meeting recap | No | `bee today` shows calendar events and emails. No push before a meeting and no per-attendee commitment list is documented. |
| Voice close-out ("done with the price list") | Partly | Journals (voice notes) carry `aiResponse.todos` and `followUp` (Realtime docs). In testing, a spoken completion arrived as an ambient utterance and no journal event fired (`FRICTION_LOG.md`, 2026-10-18). Completing a to-do in the app or on the watch works (`todo-updated`). |
| Evening review and rollover | No | Daily summaries exist (`bee daily`). No kept-versus-open scoring and no automatic rescheduling. Rescheduling is possible with `--alarm-at`. |
| Email follow-ups and meeting invites from commitments | Unconfirmed | Amazon's announcement lists "Actions" that draft follow-up emails and create meeting invites from commitments ([aboutamazon.com](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features)). Not in the developer docs I could read. |

## Caveats

- Public Bee docs were partly readable. The todos, daily and alarm pages were not fully visible, so "No" means "not documented," not "confirmed absent."
- Bee's docs describe `alarmAt` but not how the wrist is notified when an alarm fires. Nectar's "alarm on your wrist" behavior depends on that. Check it on a live account.
- Bee's proposed to-dos may overlap with Nectar's extractor. Nectar already accepts Bee's suggestions when they match, which limits duplicates.

## Sources

- [Bee docs](https://docs.bee.computer/docs) (Getting Started, MCP, Search, API)
- [Bee CLI reference](https://docs.bee.computer/docs/cli)
- [Bee Realtime](https://docs.bee.computer/docs/realtime)
- [Bee Agentic Sync](https://docs.bee.computer/docs/agentic-sync)
- [Amazon: Bee new features](https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features)
- Local: `.claude/skills/bee-cli/SKILL.md`, `src/bee/cli.ts`, `src/actions/scheduler.ts`, `FRICTION_LOG.md`
