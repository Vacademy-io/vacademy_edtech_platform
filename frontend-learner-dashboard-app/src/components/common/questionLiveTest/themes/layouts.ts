import type {
  AnswerCommit,
  ExamLayoutKind,
  ResolvedExamTheme,
} from "@/types/exam-theme";

/**
 * Layout kinds the shell can draw today. A theme whose layout is not built
 * yet is drawn with the default layout (its policy still resolves, so the
 * admin's choice is kept and shown once the layout ships).
 *
 * "console" draws every TCS-family preset (layouts/ConsoleLayout.tsx), so
 * those presets apply strict saving and the early-Submit lock.
 */
export const IMPLEMENTED_LAYOUT_KINDS: ReadonlySet<ExamLayoutKind> = new Set<
  ExamLayoutKind
>(["default", "console"]);

/**
 * Layout kinds that draw commit buttons (Save & Next, Save & Mark for Review,
 * Mark for Review & Next). Explicit saving is only safe where a learner can
 * commit every question, including the last one; today's default layout
 * cannot (its Next is disabled on the last question).
 */
export const COMMIT_ACTION_LAYOUT_KINDS: ReadonlySet<ExamLayoutKind> = new Set<
  ExamLayoutKind
>(["console"]);

/** The layout kind the shell will actually draw for this theme. */
export const renderedLayoutKind = (theme: ResolvedExamTheme): ExamLayoutKind =>
  IMPLEMENTED_LAYOUT_KINDS.has(theme.layout.kind) ? theme.layout.kind : "default";

/**
 * The answer-commit mode the store applies. The theme's policy asks for
 * explicit saving; it takes effect only when the drawn layout has the buttons
 * that commit an answer, so no theme can leave a learner unable to save.
 */
export const effectiveAnswerCommit = (theme: ResolvedExamTheme): AnswerCommit =>
  theme.policy.answerCommit === "explicit" &&
  COMMIT_ACTION_LAYOUT_KINDS.has(renderedLayoutKind(theme))
    ? "explicit"
    : "auto";
