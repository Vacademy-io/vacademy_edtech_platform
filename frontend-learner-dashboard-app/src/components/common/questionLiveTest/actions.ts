/**
 * Action registry for the console exam layouts (design 3.6).
 *
 * Each button of a console layout (Save & Next, Mark for Review & Next,
 * Clear Response, Submit, ...) is an entry here: a label key, a visual
 * variant, `isEnabled(ctx)` and `run(ctx)`. Layouts only arrange ids; the
 * rules below are the same for every layout and are unit-tested.
 *
 * Saving rules (strict themes, `answerCommit: "explicit"`):
 * - picking an option or typing writes a draft only (the store does this);
 * - Save & Next commits the draft, clears the review mark and moves on;
 * - Mark for Review & Next and Save & Mark for Review commit the draft, set
 *   the mark and move on (an answered and marked question is evaluated);
 * - Clear Response removes the draft and the saved answer and the mark;
 * - Back, Next, a palette jump and a section tab move without saving: the
 *   store's `setCurrentQuestion` throws the outgoing draft away.
 * Practice-friendly themes (`strict: false`) save every pick at once, so
 * `commitDraft` has nothing to do and Submit is always allowed; every other
 * rule is the same.
 *
 * Moving on: the next question of the section, then the first question of
 * the next section. After the last question of the paper the console wraps
 * to the first question of the first section (the console being copied does
 * this), when that section may still be entered; otherwise it stays.
 * A paper without free switching and without section clocks opens its
 * sections one after another (navigation-logic `isSequentialPaper`): Save &
 * Next and Next cross into the next section from the last question, an
 * earlier section never opens again and the paper does not wrap.
 */
import type {
  AssessmentPreviewData,
  QuestionDto,
  QuestionState,
} from "@/types/assessment";
import type { ResolvedExamTheme } from "@/types/exam-theme";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";
import { canEnterSection, nextTarget } from "./engine/navigation-logic";

export type ExamActionId =
  | "save-next"
  | "mark-review-next"
  | "save-mark-review"
  | "clear"
  | "back"
  | "next"
  | "submit"
  | "question-paper"
  | "view-instructions";

/** How a layout draws the button; the theme CSS gives each one its look. */
export type ExamActionVariant =
  | "primary"
  | "secondary"
  | "save-mark"
  | "mark"
  | "submit"
  | "link";

/** The part of the assessment store the actions read and call. */
export interface ExamActionStore {
  assessment: AssessmentPreviewData | null;
  currentSection: number;
  currentQuestion: QuestionDto | null;
  questionStates: Record<string, QuestionState>;
  sectionTimers: Record<number, { timeLeft: number } | undefined>;
  entireTestTimer: number;
  isSubmitted: boolean;
  commitDraft: (questionId: string) => void;
  setMarkedForReview: (questionId: string, value: boolean) => void;
  clearResponse: (questionId: string) => void;
  setCurrentSection: (sectionIndex: number) => void;
  setCurrentQuestion: (question: QuestionDto) => void;
}

export interface ExamActionContext {
  /** Fresh store state on every call (`useAssessmentStore.getState`). */
  getStore: () => ExamActionStore;
  theme: ResolvedExamTheme;
  /** "" until the attempt context is read (treated as timed). */
  playMode: string;
  openSubmit: () => void;
  openQuestionPaper: () => void;
  openInstructions: () => void;
}

export interface ExamAction {
  id: ExamActionId;
  /** Key in the `questionTest` namespace. */
  labelKey: string;
  variant: ExamActionVariant;
  isEnabled: (ctx: ExamActionContext) => boolean;
  run: (ctx: ExamActionContext) => void;
}

type Target = { section: number; question: QuestionDto };

const sectionsOf = (store: ExamActionStore) => store.assessment?.section_dtos ?? [];

const indexInSection = (store: ExamActionStore): number => {
  const questions =
    sectionsOf(store)[store.currentSection]?.question_preview_dto_list ?? [];
  return questions.findIndex(
    (question) => question.question_id === store.currentQuestion?.question_id,
  );
};

/**
 * Where Save & Next (and Next) go: the next question, the next section's
 * first question, or (after the last question of the paper) the first
 * question of the first section. Null = stay.
 */
export function consoleNextTarget(store: ExamActionStore): Target | null {
  const sections = sectionsOf(store);
  if (sections.length === 0) return null;
  const currentIndex = indexInSection(store);
  if (currentIndex < 0) return null;
  const target = nextTarget({
    sections,
    currentSection: store.currentSection,
    currentIndex,
    sectionTimers: store.sectionTimers,
  });
  if (target) return target;

  const lastSection = sections.length - 1;
  const lastIndex =
    (sections[lastSection]?.question_preview_dto_list.length ?? 0) - 1;
  const isLastOfPaper =
    store.currentSection === lastSection && currentIndex === lastIndex;
  if (!isLastOfPaper) return null;

  const first = sections[0]?.question_preview_dto_list[0];
  if (!first || first.question_id === store.currentQuestion?.question_id) {
    return null;
  }
  const canSwitch = Boolean(store.assessment?.can_switch_section);
  if (
    store.currentSection !== 0 &&
    !canEnterSection(canSwitch, 0, store.sectionTimers, store.currentSection)
  ) {
    return null;
  }
  return { section: 0, question: first };
}

/**
 * Where Back goes: the previous question, else the last question of the
 * previous section when it may be entered. Null on the first question.
 */
export function consolePrevTarget(store: ExamActionStore): Target | null {
  const sections = sectionsOf(store);
  const currentIndex = indexInSection(store);
  if (currentIndex < 0) return null;
  const questions = sections[store.currentSection]?.question_preview_dto_list ?? [];
  if (currentIndex > 0) {
    return { section: store.currentSection, question: questions[currentIndex - 1] };
  }
  const previous = store.currentSection - 1;
  if (previous < 0) return null;
  const canSwitch = Boolean(store.assessment?.can_switch_section);
  if (!canSwitch || !canEnterSection(canSwitch, previous, store.sectionTimers)) {
    return null;
  }
  const list = sections[previous]?.question_preview_dto_list ?? [];
  const last = list[list.length - 1];
  return last ? { section: previous, question: last } : null;
}

/**
 * Opens a question, moving section first when needed. When the store refuses
 * the section (a locked section on a paper without free switching), the
 * learner stays where they are rather than landing on a question of a
 * section that is not open.
 */
export function goToTarget(
  getStore: () => ExamActionStore,
  target: Target | null,
): void {
  if (!target) return;
  const store = getStore();
  if (target.section !== store.currentSection) {
    store.setCurrentSection(target.section);
    if (getStore().currentSection !== target.section) return;
  }
  getStore().setCurrentQuestion(target.question);
}

/**
 * Palette jump inside the current section. Throws away the unsaved pick of
 * the question being left (setCurrentQuestion) and marks the target visited.
 */
export function jumpToQuestion(store: ExamActionStore, question: QuestionDto): void {
  store.setCurrentQuestion(question);
}

/**
 * Palette jump that may cross sections (palettes that list the whole paper).
 * Same rule as a jump inside the section: no save, the outgoing pick is
 * thrown away and the target becomes visited. A question in a section that
 * may not be entered (no free switching, or its clock is at 0) is ignored.
 * Returns whether the question was opened.
 */
export function jumpToPaletteTarget(
  getStore: () => ExamActionStore,
  target: Target,
): boolean {
  const store = getStore();
  if (store.isSubmitted) return false;
  if (target.section !== store.currentSection) {
    const canSwitch = Boolean(store.assessment?.can_switch_section);
    if (!canEnterSection(canSwitch, target.section, store.sectionTimers, store.currentSection)) {
      return false;
    }
  }
  goToTarget(getStore, target);
  return getStore().currentQuestion?.question_id === target.question.question_id;
}

/** The current section's own clock has run out (section-timed papers). */
const isSectionTimeUp = (store: ExamActionStore) =>
  store.sectionTimers[store.currentSection]?.timeLeft === 0;

/** A question is open and may still be answered. */
const canAct = (ctx: ExamActionContext): boolean => {
  const store = ctx.getStore();
  return (
    Boolean(store.assessment && store.currentQuestion) &&
    !store.isSubmitted &&
    !isSectionTimeUp(store)
  );
};

/**
 * Submit is held back until the time is up on themes with
 * `earlySubmit: "disabled-until-end"` (strict GATE and RRB JE). Untimed
 * papers (practice, survey) have no "end", so Submit stays open for them.
 */
export function isSubmitLocked(ctx: ExamActionContext): boolean {
  if (ctx.theme.policy.earlySubmit !== "disabled-until-end") return false;
  if (isUntimedPlayMode(ctx.playMode)) return false;
  return ctx.getStore().entireTestTimer > 0;
}

/** Saves the pick (if any), sets or clears the mark, then moves on. */
const saveAndMove = (ctx: ExamActionContext, marked: boolean) => {
  const before = ctx.getStore();
  const question = before.currentQuestion;
  if (!question) return;
  before.commitDraft(question.question_id);
  before.setMarkedForReview(question.question_id, marked);
  goToTarget(ctx.getStore, consoleNextTarget(ctx.getStore()));
};

export const EXAM_ACTIONS: Record<ExamActionId, ExamAction> = {
  "save-next": {
    id: "save-next",
    labelKey: "examThemes.tcs.actions.saveNext",
    variant: "primary",
    isEnabled: canAct,
    run: (ctx) => saveAndMove(ctx, false),
  },
  "mark-review-next": {
    id: "mark-review-next",
    labelKey: "examThemes.tcs.actions.markReviewNext",
    variant: "secondary",
    isEnabled: canAct,
    run: (ctx) => saveAndMove(ctx, true),
  },
  "save-mark-review": {
    id: "save-mark-review",
    labelKey: "examThemes.tcs.actions.saveMarkReview",
    variant: "save-mark",
    isEnabled: canAct,
    run: (ctx) => saveAndMove(ctx, true),
  },
  clear: {
    id: "clear",
    labelKey: "examThemes.tcs.actions.clearResponse",
    variant: "secondary",
    isEnabled: canAct,
    run: (ctx) => {
      const store = ctx.getStore();
      const question = store.currentQuestion;
      if (!question) return;
      store.clearResponse(question.question_id);
      // Back to Not Answered, as the console shows it after a clear.
      ctx.getStore().setMarkedForReview(question.question_id, false);
    },
  },
  back: {
    id: "back",
    labelKey: "examThemes.tcs.actions.back",
    variant: "secondary",
    isEnabled: (ctx) => canAct(ctx) && consolePrevTarget(ctx.getStore()) !== null,
    run: (ctx) => goToTarget(ctx.getStore, consolePrevTarget(ctx.getStore())),
  },
  next: {
    id: "next",
    labelKey: "examThemes.tcs.actions.next",
    variant: "secondary",
    isEnabled: (ctx) => canAct(ctx) && consoleNextTarget(ctx.getStore()) !== null,
    run: (ctx) => goToTarget(ctx.getStore, consoleNextTarget(ctx.getStore())),
  },
  submit: {
    id: "submit",
    labelKey: "examThemes.tcs.actions.submit",
    variant: "submit",
    isEnabled: (ctx) => {
      const store = ctx.getStore();
      return Boolean(store.assessment) && !store.isSubmitted && !isSubmitLocked(ctx);
    },
    run: (ctx) => {
      if (isSubmitLocked(ctx)) return;
      ctx.openSubmit();
    },
  },
  "question-paper": {
    id: "question-paper",
    labelKey: "examThemes.tcs.links.questionPaper",
    variant: "link",
    isEnabled: (ctx) => Boolean(ctx.getStore().assessment),
    run: (ctx) => ctx.openQuestionPaper(),
  },
  "view-instructions": {
    id: "view-instructions",
    labelKey: "examThemes.tcs.links.instructions",
    variant: "link",
    isEnabled: () => true,
    run: (ctx) => ctx.openInstructions(),
  },
};

/** Runs an action when it is enabled. Returns whether it ran. */
export function runExamAction(id: ExamActionId, ctx: ExamActionContext): boolean {
  const action = EXAM_ACTIONS[id];
  if (!action.isEnabled(ctx)) return false;
  action.run(ctx);
  return true;
}
