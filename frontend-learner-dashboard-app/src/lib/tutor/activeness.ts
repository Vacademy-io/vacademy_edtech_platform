/**
 * The activeness score: pure bookkeeping, no camera or React here, so it can
 * be unit-tested and the same numbers feed the live badge and the session
 * average sent to the server.
 *
 * Three parts, each 0–100:
 *  - onScreen:  share of samples with the learner in front of the camera
 *  - listening: while the teacher speaks, share of samples facing the screen
 *               with eyes open
 *  - answering: per question, how promptly it was answered (a skip or a
 *               question left unanswered scores low; a nudge halves it)
 *
 * Live score = the last LIVE_WINDOW_MS; session score = the whole session.
 * A part with no data yet (no question asked, teacher not spoken) is left out
 * and the weights of the others are rescaled.
 */

export const WEIGHTS = { onScreen: 0.35, listening: 0.35, answering: 0.3 } as const;
export const LIVE_WINDOW_MS = 120_000;
/** Answered within this many ms = full marks; falls to FLOOR at SLOW_MS. */
export const PROMPT_MS = 20_000;
export const SLOW_MS = 90_000;
const SLOW_FLOOR = 0.3;
const SKIP_SCORE = 0.2;

export interface ActivenessParts {
  onScreen: number | null;
  listening: number | null;
  answering: number | null;
}

interface Tick {
  at: number;
  face: boolean;
  attentive: boolean;
  speaking: boolean;
}

interface Answer {
  at: number;
  score: number;
}

export const answerScore = (latencyMs: number, nudged: boolean): number => {
  const t = Math.min(1, Math.max(0, (latencyMs - PROMPT_MS) / (SLOW_MS - PROMPT_MS)));
  const s = 1 - t * (1 - SLOW_FLOOR);
  return nudged ? s * 0.5 : s;
};

export const combine = (parts: ActivenessParts): number | null => {
  let sum = 0;
  let w = 0;
  (Object.keys(WEIGHTS) as (keyof ActivenessParts)[]).forEach((k) => {
    const v = parts[k];
    if (v === null) return;
    sum += v * WEIGHTS[k];
    w += WEIGHTS[k];
  });
  return w > 0 ? Math.round(sum / w) : null;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : null);

export class ActivenessMeter {
  private ticks: Tick[] = [];
  private answers: Answer[] = [];
  // Session totals (ticks are trimmed to the live window; these are not).
  private total = { samples: 0, face: 0, speaking: 0, attentiveSpeaking: 0 };
  private answerSum = 0;
  private answerCount = 0;
  private questionOpenedAt: number | null = null;
  private questionNudged = false;
  awayCount = 0;
  awayMs = 0;
  trackedMs = 0;

  /** One camera reading (a background tab is fed in as readings with no face). */
  addSample(at: number, s: { face: boolean; facing: boolean; eyesOpen: boolean }, speaking: boolean, dtMs: number) {
    const attentive = s.face && s.facing && s.eyesOpen;
    this.ticks.push({ at, face: s.face, attentive, speaking });
    this.trimTo(at);
    this.total.samples += 1;
    if (s.face) this.total.face += 1;
    if (speaking) {
      this.total.speaking += 1;
      if (attentive) this.total.attentiveSpeaking += 1;
    }
    this.trackedMs += dtMs;
    if (!s.face) this.awayMs += dtMs;
  }

  questionOpened(at: number) {
    this.questionOpenedAt = at;
    this.questionNudged = false;
  }

  nudged() {
    this.questionNudged = true;
  }

  /** The open question closed: answered after the latency, or skipped / abandoned. */
  questionClosed(at: number, how: "answered" | "skipped") {
    if (this.questionOpenedAt === null) return;
    const score = how === "skipped" ? SKIP_SCORE : answerScore(at - this.questionOpenedAt, this.questionNudged);
    this.questionOpenedAt = null;
    this.answers.push({ at, score });
    this.answerSum += score;
    this.answerCount += 1;
  }

  /** A question open for longer than SLOW_MS already counts against the learner. */
  private pendingAnswer(at: number): number | null {
    if (this.questionOpenedAt === null || at - this.questionOpenedAt < SLOW_MS) return null;
    return this.questionNudged ? SLOW_FLOOR * 0.5 : 0;
  }

  private trimTo(at: number) {
    const cut = at - LIVE_WINDOW_MS;
    while (this.ticks.length && this.ticks[0]!.at < cut) this.ticks.shift();
    while (this.answers.length && this.answers[0]!.at < cut) this.answers.shift();
  }

  live(at: number): { score: number | null; parts: ActivenessParts } {
    this.trimTo(at);
    const face = this.ticks.filter((t) => t.face).length;
    const speaking = this.ticks.filter((t) => t.speaking);
    const scores = this.answers.map((a) => a.score);
    const pending = this.pendingAnswer(at);
    if (pending !== null) scores.push(pending);
    const parts: ActivenessParts = {
      onScreen: pct(face, this.ticks.length),
      listening: pct(speaking.filter((t) => t.attentive).length, speaking.length),
      answering: scores.length ? Math.round((100 * scores.reduce((a, b) => a + b, 0)) / scores.length) : null,
    };
    return { score: combine(parts), parts };
  }

  session(at: number): { score: number | null; parts: ActivenessParts } {
    const pending = this.pendingAnswer(at);
    const n = this.answerCount + (pending !== null ? 1 : 0);
    const parts: ActivenessParts = {
      onScreen: pct(this.total.face, this.total.samples),
      listening: pct(this.total.attentiveSpeaking, this.total.speaking),
      answering: n ? Math.round((100 * (this.answerSum + (pending ?? 0))) / n) : null,
    };
    return { score: combine(parts), parts };
  }
}
