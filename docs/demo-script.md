# Demo video script: terminal and wrist (2:50)

Replaces the "console" scenes of the original script. Everything judges need to see is on two surfaces: the **terminal** (Nectar's run log) and the **wrist** (Bee to-dos and alarms). No web console.

**Stage One requirements this video must meet:** live Bee data from an Apple Watch running Bee in the first 30 s, something useful done with it, under 3:00, public on YouTube, in English, no third-party music. Bee calls must be visible in code (scene 7).

## Setup

- **Layout:** terminal on the left (font 18-20 pt, dark theme, 1080p), watch on the right (second camera, or the iPhone's Bee to-do list mirrored). Terminal started with `npm run dev` before recording; clear the screen first.
- **Config for filming:** `NECTAR_TIMEZONE=Africa/Monrovia`, `NECTAR_LOG_LEVEL=info`, `NECTAR_REVIEW_TIME=off` (the review is run by hand in scene 6).
- **Calendar:** one real event about 12 minutes ahead, titled with the person you owe (for example "Supplier call: Musa"), present in `bee today`. Scene 4 depends on it.
- **Never on screen:** `.env`, AWS credentials, the Bee token, other people's names beyond what they consented to.

## Timing rules the script is built around

- **"In ten minutes", not "by 3 PM".** The alarm fires 10 min before the due time, but never sooner than 60 s from now. A promise due in ten minutes therefore rings about one minute after Nectar creates the to-do, which is watchable.
- **Nectar waits 20 s of silence** before it analyzes a conversation, and Bee adds transcription delay. Cut these waits in the edit and show an on-screen label ("20 s pause cut"). Do not claim a lag figure you have not measured with `npm run check:g0 -- --stream 60`.

## Shot list

| Time | Scene | You say / do | Terminal | Wrist |
| --- | --- | --- | --- | --- |
| 0:00-0:12 | **Hook** | VO: "I make twenty promises a day. I keep maybe half. Bee remembers what I said. Nectar makes sure I do it." | Nectar running: `Signed in to Bee`, `Context from Bee MCP server; model ...`, `stream connected` | Watch on your wrist, at work |
| 0:12-0:55 | **1. Capture** | To Musa, on camera: "I'll send you the price list in ten minutes." | `[utterance] conv ...: ...I'll send you the price list in ten minutes`, then (after the cut) `[commitment open] Send Musa the price list -> Musa | due ... (9x%)`, `[todo created] "Send Musa the price list · due 3:10 PM" alarm ...` | The new to-do appears on the watch |
| 0:55-1:20 | **2. The nudge** | Hold the watch to the camera and let it ring. VO: "No custom app: it's a native Bee alarm." | (show the clock) | Alarm fires; text readable, under 80 characters |
| 1:20-1:50 | **3. Pre-meeting recap** | VO: "Ten minutes before the call, it reminds me what I owe the person I'm about to meet." | `[recap] "10 AM Supplier call: you owe Send Musa the price list" before Supplier call` | The recap to-do rings |
| 1:50-2:15 | **4. Voice close-out** | Say into a Bee voice note: "Done with the price list for Musa." | `[journal] Done with the price list for Musa`, then `[done via voice] Send Musa the price list ("the price list for Musa")` | The to-do is checked off |
| 2:15-2:35 | **5. Evening review** | Run `npm run review` live. VO: "At the end of the day: what I kept, what moves to tomorrow." | `[review 2026-10-xx] Nectar: 2/3 kept today. Open: ...`, then `kept:` and `carried to tomorrow:` lines | The summary to-do arrives |
| 2:35-2:50 | **6. How it works and why** | VO: "Bee stream, proxy API and MCP, Amazon Bedrock to find the promise, Bee to-dos to nudge. For managers who make verbal promises all day." Repo link on screen. | Architecture diagram (README), then a 2 s flash of `src/bee/` | |

The "kept" count in scene 5 replaces the old console counter: the review line itself is the proof that the loop closed.

## Scene notes

1. **Capture.** This must be live and un-staged-looking: your real colleague, your real voice. The terminal shows transcribed speech, so before recording make sure the colleague has consented on camera, and keep the terminal crop to your own line if they have not agreed to appear. The `[commitment open]` line proves the Bedrock extraction.
2. **Nudge.** Film the watch face and the terminal clock in the same frame once, so the viewer can see the alarm is real.
3. **Recap.** Depends on `bee today --json`, whose shape is undocumented. Verify it before the shoot (see the fallback below).
4. **Close-out.** Speak naturally ("done with the price list" is enough). If you say it before the to-do exists, nothing completes.
5. **Review.** Do not run it at the start of the video; by then there must be at least two promises in the day's data, one done and one open, so the line reads "1/2 kept" or better.

## Pre-shoot checks (do these once, before recording)

- [ ] `npm run check:g0 -- --bedrock --alarm --stream 60`: all pass, alarm reaches the watch, utterances carry `conversation_uuid`.
- [ ] A spoken "done with..." voice note completes a to-do (this is scene 4).
- [ ] A calendar event 10-12 min ahead produces a `[recap]` line (scene 3).
- [ ] `npm run eval` has been run, so the Bedrock numbers are recorded in `docs/aws.md`.
- [ ] No duplicate to-dos on the watch after a full day of use.

## Fallback

If the recap does not work live by Oct 19, **cut scene 3** and give its 30 s to scene 1 (a second promise, with a different person) and scene 4. The video is stronger with three live scenes than with one that fails on camera. Remove the recap line from the README and the Devpost text if it is cut.

## Edit and upload

- Cut every wait; label each cut on screen. Keep real timestamps visible at least once.
- No third-party music. Narration only, or ambient sound.
- Captions in English.
- Export under 3:00 (target 2:50); upload to YouTube as **public**, and test that it plays logged out.
- Put the repo URL in the description and on the last frame. Upload a day early.
