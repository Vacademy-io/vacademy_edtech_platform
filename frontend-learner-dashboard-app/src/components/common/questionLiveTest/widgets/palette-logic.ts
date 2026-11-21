/**
 * Pure rules behind the console palette, legend and the Exam Summary table.
 *
 * Chip status comes from the saved state only (`questionStates`, which the
 * store changes on a save action, a visit, a mark or a clear). An unsaved
 * draft never changes a chip, so the palette shows what will be submitted.
 */
import type { QuestionDto, QuestionState } from "@/types/assessment";
import {
  getQuestionStatus,
  type QuestionStatus,
} from "../question-status-colors";

export type StatusCounts = Record<QuestionStatus, number>;

export const emptyStatusCounts = (): StatusCounts => ({
  answered: 0,
  "not-answered": 0,
  "not-visited": 0,
  marked: 0,
  "answered-marked": 0,
});

/** Chip status of one question. */
export const chipStatusOf = (
  questionStates: Record<string, QuestionState | undefined>,
  questionId: string,
): QuestionStatus => getQuestionStatus(questionStates[questionId]);

/** How many questions of a list are in each status. */
export function statusCounts(
  questions: Pick<QuestionDto, "question_id">[],
  questionStates: Record<string, QuestionState | undefined>,
): StatusCounts {
  const counts = emptyStatusCounts();
  for (const question of questions) {
    counts[chipStatusOf(questionStates, question.question_id)] += 1;
  }
  return counts;
}

export interface ExamSummaryRow {
  sectionId: string;
  name: string;
  total: number;
  counts: StatusCounts;
}

/** One Exam Summary row per section, in paper order. */
export function examSummaryRows(
  sections: {
    id: string;
    name: string;
    question_preview_dto_list: Pick<QuestionDto, "question_id">[];
  }[],
  questionStates: Record<string, QuestionState | undefined>,
): ExamSummaryRow[] {
  return sections.map((section) => ({
    sectionId: section.id,
    name: section.name,
    total: section.question_preview_dto_list.length,
    counts: statusCounts(section.question_preview_dto_list, questionStates),
  }));
}

/** Chip label: 1, 2, ... or 01, 02, ... */
export const chipLabel = (index: number, numbering: "plain" | "two-digit") =>
  numbering === "two-digit" ? String(index + 1).padStart(2, "0") : String(index + 1);

/**
 * Console clock text. `MMM:SS` counts total minutes (179:52, never 2:59:52);
 * `HH:MM:SS` is the hours form. Negative input reads as 0.
 */
export function formatConsoleClock(
  totalSeconds: number,
  format: "MMM:SS" | "HH:MM:SS",
): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (value: number) => String(value).padStart(2, "0");
  if (format === "HH:MM:SS") {
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** Marks as the console prints them: 4, 0.5, 0.33 (at most two decimals). */
export function formatMarks(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 100) / 100);
}

/** Positive and negative marks from a question's `marking_json`. */
export function parseMarking(markingJson: string | null | undefined): {
  correct: number;
  negative: number;
} {
  try {
    const data = JSON.parse(markingJson || "{}")?.data ?? {};
    const correct = Number(data.totalMark ?? 0);
    const negative = Number(data.negativeMark ?? 0);
    return {
      correct: Number.isFinite(correct) ? correct : 0,
      negative: Number.isFinite(negative) ? Math.abs(negative) : 0,
    };
  } catch {
    return { correct: 0, negative: 0 };
  }
}

/** One chip of the palette: the question, its section and its number. */
export interface PaletteEntry<Q extends Pick<QuestionDto, "question_id"> = QuestionDto> {
  section: number;
  question: Q;
  /** 1-based number shown on the chip and in the question heading. */
  number: number;
}

/**
 * The chips a palette shows. `section` scope: the open section's questions,
 * numbered from 1 in that section (TCS console). `paper` scope: every
 * question of the paper in order, numbered across sections (NTA mock, whose
 * legend counts and chips cover the whole paper).
 */
export function paletteEntries<Q extends Pick<QuestionDto, "question_id">>(
  sections: { question_preview_dto_list: Q[] }[],
  scope: "section" | "paper",
  currentSection: number,
): PaletteEntry<Q>[] {
  if (scope === "section") {
    return (sections[currentSection]?.question_preview_dto_list ?? []).map(
      (question, index) => ({ section: currentSection, question, number: index + 1 }),
    );
  }
  const entries: PaletteEntry<Q>[] = [];
  sections.forEach((section, sectionIndex) => {
    for (const question of section.question_preview_dto_list) {
      entries.push({ section: sectionIndex, question, number: entries.length + 1 });
    }
  });
  return entries;
}
