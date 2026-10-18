# Nectar: Bee remembers what you said. Nectar makes sure you do it.

**Track:** Bee (Wearable AI). **Repo:** https://github.com/Mammajam/Nectar

## Inspiration
I make promises out loud all day: "I'll send you the price list in ten minutes." Nothing writes them down, so nothing reminds me. Bee already hears everything I say; Nectar turns the promises into reminders and checks whether I kept them.

## What it does
Nectar is an ambient commitment agent for Bee. It reads live conversation data from the Bee on my Apple Watch, uses Claude Haiku to find the promises I make, and turns each one into a native Bee to-do with an alarm, so there is no custom watch app to install.

- **Detect:** finds first-person promises in noisy, real transcripts, resolves names and times, and ignores requests, small talk and past actions.
- **Nudge:** creates a Bee to-do with an alarm 10 minutes before it is due, matching existing to-dos and Bee's own suggestions first so nothing is duplicated.
- **Recover:** `bee stream` is at-most-once, so Nectar catches up from Bee's changefeed at startup and every 5 minutes.
- **Also implemented and unit-tested, not shown in the video:** pre-meeting recaps of what you owe the people you are about to meet, voice close-out ("done with the price list"), and an evening review of what you kept.

## How we built it
TypeScript on Node 22 with a local SQLite store. All Bee access goes through the official Bee CLI: the local REST proxy (to-dos, facts, conversations, changefeed), `bee stream` for live utterances, and `bee mcp serve` for the facts and today's brief that ground the model. Claude Haiku (`claude-haiku-5-5`) runs through the Anthropic API with forced tool use, so the output is always schema-valid JSON. 173 unit tests, CI on every push, and a 10-case labeled evaluation (7/7 commitments right, 0 false positives).

**A note on AWS:** the model layer is provider-neutral and includes an Amazon Bedrock client, but the new AWS account's Bedrock quotas were applied at 0 for the whole hackathon, so the Bedrock path was not exercised live. The video and the numbers above use the Anthropic API.

## Challenges
Real data is messier than the docs. The details are in `FRICTION_LOG.md`; the biggest were:
- Conversations have a numeric `id` in the API but a `uuid` on the live stream, so one conversation had two keys until we joined them.
- The REST conversation response was nested differently than the CLI's, so catch-up silently stored nothing until we tested on a live account.
- The proxy rejected a plain `application/json` content type with a 415.
- Speech recognition spells names differently each time ("Mariama", "Maraman"), which can create a duplicate to-do; matching on a Bee fact is the next fix.
- Bee labelled some of my own speech as "Unknown", so a promise can be missed.

## Accomplishments
Testing against my own live Bee data found real bugs that mocks never would, and each one is logged and fixed with a test. On restart Nectar re-analyzes caught-up speech and links to existing to-dos instead of creating new ones.

## What we learned
Ambient AI needs a reliable path for events it missed, and the hard parts are identity (who said it, which conversation) and time (when "tomorrow" is), not the model call.

## What's next
Confirm alarms on the Apple Watch itself (in the demo the alarm arrived as a notification on my Mac; I could not capture it on the watch), normalize names through Bee facts to stop duplicates, and exercise the Bedrock path once the account quotas are lifted.

## Built with
TypeScript, Node.js, SQLite, Bee CLI / API / MCP, Anthropic API (Claude Haiku), Amazon Bedrock (supported, not run live), Vitest, GitHub Actions.

## Try it
`git clone https://github.com/Mammajam/Nectar`, follow the Quick start in the README (needs a Bee account in Developer Mode and an Anthropic API key).

## Privacy
Bee records the people around you. Nectar keeps its data on your machine and sends only the conversation window being analyzed to the model API. Ask for consent before recording colleagues.
