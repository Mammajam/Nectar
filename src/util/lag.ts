/**
 * Hand-timed stream lag. Stream utterances carry no timestamp, so the lag is
 * measured from the moment the speaker presses Enter after finishing a sentence
 * to the first utterance received after that.
 */
export class LagMeter {
  private pressedAt: number | null = null;
  private lags: number[] = [];

  /** The speaker finished a sentence and pressed Enter. */
  press(now = Date.now()): void {
    this.pressedAt = now;
  }

  /** An utterance arrived. Returns the lag in ms when it is the first since the last press. */
  heard(now = Date.now()): number | null {
    if (this.pressedAt === null) return null;
    const lag = now - this.pressedAt;
    this.pressedAt = null;
    this.lags.push(lag);
    return lag;
  }

  get measurements(): readonly number[] {
    return this.lags;
  }

  /** "4 s after Enter" style summary, or why nothing was measured. */
  summary(): string {
    if (this.lags.length === 0) return 'lag not measured (press Enter after a sentence)';
    const secs = this.lags.map((l) => Math.round(l / 100) / 10);
    return `lag ${secs.map((s) => `${s} s`).join(', ')} after Enter`;
  }
}
