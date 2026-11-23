/**
 * The learner AI report as data (GET /learner/report/ai-data), and the figures the on-screen
 * report derives from it. Thresholds follow the PDF builder (AiReportHtmlBuilderV2 /
 * AiReportCharts in assessment_service), so a section shows on screen exactly when the
 * downloaded PDF prints it.
 */

export type Outcome = "CORRECT" | "PARTIAL" | "WRONG" | "SKIPPED" | "PENDING";

export interface ReportSection {
  id: string;
  name: string;
  index: number;
  max: number;
  score: number;
  class_average: number | null;
  time_seconds: number;
  class_average_time_seconds: number | null;
  class_top: number | null;
}

export interface ReportQuestion {
  question_id: string;
  section_id: string;
  section_index: number;
  section_name: string;
  number: number;
  max: number;
  marks: number;
  outcome: Outcome;
  time_seconds: number | null;
  class_correct_percent: number | null;
  class_average_time_seconds: number | null;
  short_text: string | null;
  type: string | null;
  text: string | null;
  your_answer: string | null;
  correct_answer: string | null;
  feedback: string | null;
  criteria: { name: string; marks: string; reason: string | null }[];
  explanation: string | null;
}

export interface AiReportWebData {
  institute_name: string | null;
  assessment_name: string | null;
  student_name: string | null;
  enrollment_number: string | null;
  /** Registration answers the assessment prints under the name (roll number, college, ...); absent on older servers. */
  student_details?: { label: string; value: string }[] | null;
  attempt_date: number | null;
  headline: string | null;
  subline: string | null;
  score: number;
  max_score: number;
  time_taken_seconds: number | null;
  duration_limit_minutes: number | null;
  has_class: boolean;
  rank: number | null;
  participants: number | null;
  percentile: number | null;
  class_average: number | null;
  class_highest: number | null;
  class_average_time_seconds: number | null;
  class_scores: number[];
  marking_note: string | null;
  hide_question_wise: boolean;
  hide_your_answer: boolean;
  hide_correct_answer: boolean;
  hide_explanation: boolean;
  sections: ReportSection[];
  questions: ReportQuestion[];
  history: { assessment_name: string | null; date: number | null; percent: number }[];
  potential: { score: number; rank: number | null; percentile: number | null; skipped_considered: number } | null;
  // The processed AI JSON; its shape is typed where it is read.
  ai: Record<string, any>;
}

/** Marks as the PDF prints them: whole numbers bare, else up to two decimals, a real minus sign. */
export function num(v: number): string {
  const hundredths = Math.round(Math.abs(v) * 100);
  if (hundredths === 0) return "0";
  const s = hundredths % 100 === 0 ? String(hundredths / 100) : String(Number((hundredths / 100).toFixed(2)));
  return (v < 0 ? "−" : "") + s;
}

/** Always one decimal (averages). */
export function num1(v: number): string {
  return (v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1);
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function pct(score: number, max: number): number {
  return max > 0 ? (100 * score) / max : 0;
}

/** The PDF compares against the class only with at least 5 students. */
export function hasClassOf5(d: AiReportWebData): boolean {
  return d.has_class && (d.participants ?? 0) >= 5;
}

export function count(d: AiReportWebData, outcome: Outcome): number {
  return d.questions.filter((q) => q.outcome === outcome).length;
}

/** The marks lost per wrong answer when every wrong answer lost the same; else null. */
export function uniformPenalty(d: AiReportWebData): string | null {
  const losses = new Set(d.questions.filter((q) => q.outcome === "WRONG" && q.marks < 0).map((q) => q.marks));
  return losses.size === 1 ? num([...losses][0]!) : null;
}

export interface SpeedBand {
  key: "under10" | "10to30" | "31to60" | "over60";
  right: number;
  total: number;
  percent: number;
}

/** Accuracy by time spent per question (answered and graded questions only). */
export function speedBands(qs: ReportQuestion[]): SpeedBand[] {
  const keys: SpeedBand["key"][] = ["under10", "10to30", "31to60", "over60"];
  const right = [0, 0, 0, 0];
  const total = [0, 0, 0, 0];
  for (const q of qs) {
    if (q.time_seconds == null || q.outcome === "SKIPPED" || q.outcome === "PENDING") continue;
    const t = q.time_seconds;
    const b = t < 10 ? 0 : t <= 30 ? 1 : t <= 60 ? 2 : 3;
    total[b]!++;
    if (q.outcome === "CORRECT") right[b]!++;
  }
  return keys.map((key, i) => ({
    key,
    right: right[i]!,
    total: total[i]!,
    percent: total[i]! > 0 ? (100 * right[i]!) / total[i]! : 0,
  }));
}

/** Accuracy in each quarter of the paper, in paper order; null under 8 graded questions. */
export function quarterAccuracy(qs: ReportQuestion[]): { label: string; percent: number }[] | null {
  const graded = qs.filter((q) => q.outcome !== "PENDING");
  if (graded.length < 8) return null;
  const n = graded.length;
  const out: { label: string; percent: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const from = Math.floor((n * k) / 4);
    const to = Math.floor((n * (k + 1)) / 4);
    let right = 0;
    for (let i = from; i < to; i++) if (graded[i]!.outcome === "CORRECT") right++;
    out.push({ label: `Q${from + 1}–${to}`, percent: to > from ? (100 * right) / (to - from) : 0 });
  }
  return out;
}

export interface Quadrant {
  quickRight: number;
  slowRight: number;
  quickWrong: number;
  slowWrong: number;
  classRef: boolean;
}

/** Quick/slow by the class average for each question (else the learner's median), right/wrong. */
export function confidenceQuadrant(qs: ReportQuestion[]): Quadrant | null {
  const rows = qs.filter(
    (q) => q.outcome !== "SKIPPED" && q.time_seconds != null && (q.outcome === "CORRECT" || q.outcome === "WRONG"),
  );
  if (rows.length < 6) return null;
  const times = rows.map((q) => q.time_seconds!).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const out: Quadrant = { quickRight: 0, slowRight: 0, quickWrong: 0, slowWrong: 0, classRef: false };
  for (const q of rows) {
    const ref = q.class_average_time_seconds ?? median;
    const quick = q.time_seconds! <= ref;
    const right = q.outcome === "CORRECT";
    if (quick && right) out.quickRight++;
    else if (right) out.slowRight++;
    else if (quick) out.quickWrong++;
    else out.slowWrong++;
    if (q.class_average_time_seconds != null) out.classRef = true;
  }
  return out;
}

export interface NegativeMarking {
  earned: number;
  lost: number;
  /** Score without the wrong answers given in under 10 seconds; null when there were none. */
  withoutGuesses: number | null;
  guesses: number;
}

export function negativeMarking(d: AiReportWebData): NegativeMarking | null {
  const earned = d.questions.reduce((s, q) => s + (q.marks > 0 ? q.marks : 0), 0);
  const lost = d.questions.reduce((s, q) => s + (q.marks < 0 ? q.marks : 0), 0);
  if (lost >= 0) return null;
  const guesses = d.questions.filter((q) => q.marks < 0 && q.time_seconds != null && q.time_seconds < 10);
  const guessLoss = guesses.reduce((s, q) => s + q.marks, 0);
  return { earned, lost, withoutGuesses: guesses.length ? d.score - guessLoss : null, guesses: guesses.length };
}

/** Questions missed that at least 3 in 5 classmates got right (top 3). */
export function easyMarksMissed(d: AiReportWebData): ReportQuestion[] {
  if (!hasClassOf5(d) || d.hide_question_wise) return [];
  return d.questions
    .filter((q) => (q.outcome === "WRONG" || q.outcome === "SKIPPED") && q.class_correct_percent != null && q.class_correct_percent >= 60)
    .sort((a, b) => b.class_correct_percent! - a.class_correct_percent!)
    .slice(0, 3);
}

/** Questions 30% or fewer of the class got right, and the learner did (top 5). */
export function expertise(d: AiReportWebData): ReportQuestion[] {
  if (!hasClassOf5(d) || d.hide_question_wise) return [];
  return d.questions
    .filter((q) => q.outcome === "CORRECT" && q.class_correct_percent != null && q.class_correct_percent <= 30)
    .sort((a, b) => a.class_correct_percent! - b.class_correct_percent!)
    .slice(0, 5);
}

export interface HistogramBin {
  label: string;
  count: number;
  mine: boolean;
}

/** Class scores grouped into up to 10 equal ranges from 0 (or the lowest negative score) to the maximum. */
export function histogram(scores: number[], mine: number, max: number): HistogramBin[] {
  if (!scores.length || max <= 0) return [];
  const lo = Math.min(0, ...scores);
  const hi = Math.max(max, ...scores);
  const bins = 10;
  const width = (hi - lo) / bins;
  const binOf = (v: number) => Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
  const counts = new Array<number>(bins).fill(0);
  for (const s of scores) counts[binOf(s)]!++;
  const myBin = binOf(mine);
  return counts.map((c, i) => ({
    label: `${num(Math.round((lo + i * width) * 10) / 10)}–${num(Math.round((lo + (i + 1) * width) * 10) / 10)}`,
    count: c,
    mine: i === myBin,
  }));
}

/** The section a question belongs to, as "Physics 3" with several sections, else "Question 3". */
export function questionTitle(d: AiReportWebData, q: ReportQuestion): string {
  return d.sections.length > 1 ? `${q.section_name} ${q.number}` : `Q${q.number}`;
}
