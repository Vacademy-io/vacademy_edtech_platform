/**
 * Exam themes: how the live-test screen looks and behaves for one assessment.
 *
 * A theme is plain data (tokens, layout, behaviour policy, palette spec) kept
 * in the registry under `components/common/questionLiveTest/themes/`. The
 * assessment carries an `exam_interface` object that names a preset; the
 * learner app resolves it with `resolveExamTheme()`. Scoring never depends on
 * the theme: it only changes the screen.
 */
import type { QuestionStatus } from "@/components/common/questionLiveTest/question-status-colors";

/** Screen families. Presets inside a family share layout, chips and rules. */
export type ExamFamily = "default" | "tcs";

/** Presets the learner app knows. Unknown ids resolve to "default". */
export type ExamPresetId =
  | "default"
  | "jee-main"
  | "jee-advanced"
  | "gate"
  | "rrb-je";

/** Layout component that draws the screen. */
export type ExamLayoutKind = "default" | "console";

/**
 * Arrangement inside a layout kind. `nta-mock` and `tcs-console` are both
 * console layouts (regions on a grid) with different regions and buttons.
 * These are the values of `exam_interface.layout`.
 */
export type ExamLayoutVariant = "default" | "tcs-console" | "nta-mock";

export interface ExamLayoutSpec {
  kind: ExamLayoutKind;
  variant: ExamLayoutVariant;
}

/**
 * `auto`: a picked option counts at once (today's behaviour).
 * `explicit`: a pick is a draft until Save & Next (or Save & Mark) commits it;
 * leaving the question throws the draft away.
 */
export type AnswerCommit = "auto" | "explicit";

/** `toggle`: Mark flips the flag. `set-and-next`: Mark sets it and moves on. */
export type MarkSemantics = "toggle" | "set-and-next" | "checkbox";

export type EarlySubmit = "allowed" | "disabled-until-end";

export type NavigationMode = "free" | "linear" | "forward-only";

export interface BehaviourPolicy {
  answerCommit: AnswerCommit;
  markSemantics: MarkSemantics;
  earlySubmit: EarlySubmit;
  navigation: NavigationMode;
  /** The screen has a Previous / Back button. */
  previousButton: boolean;
  /** Opening a question shows it as Not Answered (TCS rule). */
  visitMarksNotAnswered: boolean;
}

/** `HH:MM:SS` = 02:59:52, `MMM:SS` = 179:52 (total minutes). */
export type ExamTimerFormat = "HH:MM:SS" | "MMM:SS";

export interface ExamTimerSpec {
  /** Which clock the header shows. */
  scope: "test" | "section";
  format: ExamTimerFormat;
}

/** Placeholder for Phase 1, which draws the palette from this spec. */
export interface ExamPaletteSpec {
  kind: "default" | "grid-right";
  /** Chips per row; 0 = the default layout's own grid. */
  columns: number;
  /** `two-digit` = 01, 02, … */
  numbering: "plain" | "two-digit";
  /** Chip renderer. `default` = today's rounded squares. */
  chip: "default" | "tcs-shapes" | "nta-shapes";
  legendOrder: QuestionStatus[];
  /**
   * What the palette covers: the open section (chips numbered from 1 in the
   * section) or the whole paper (chips numbered across sections). The legend
   * counts and the question heading's number follow the same scope.
   */
  countsScope: "section" | "paper";
  /** A bar with the section name above the chips. */
  sectionBar: boolean;
}

export type OptionNumbering = "default" | "none" | "(A)" | "(1)";

export interface ExamOptionSpec {
  style: "card" | "radio-row";
  numbering: OptionNumbering;
}

export interface ExamThemeDefinition {
  id: ExamPresetId;
  family: ExamFamily;
  version: 1;
  /** Generic name shown to admins, e.g. "JEE Main-style CBT". */
  displayName: string;
  /** Name without the exam's mark, e.g. "TCS-style CBT". */
  neutralName: string;
  layout: ExamLayoutSpec;
  policy: BehaviourPolicy;
  timer: ExamTimerSpec;
  palette: ExamPaletteSpec;
  options: ExamOptionSpec;
}

/** A partial theme, merged one level deep over a family's defaults. */
export interface ExamThemePatch {
  layout?: Partial<ExamLayoutSpec>;
  policy?: Partial<BehaviourPolicy>;
  timer?: Partial<ExamTimerSpec>;
  palette?: Partial<ExamPaletteSpec>;
  options?: Partial<ExamOptionSpec>;
}

export interface ExamFamilyDefinition {
  family: ExamFamily;
  base: Omit<ExamThemeDefinition, "id" | "displayName" | "neutralName">;
  /**
   * Policy changes applied when the assessment is "practice-friendly"
   * (`strict: false`): answers count at once, Submit is always allowed.
   */
  practice: Partial<BehaviourPolicy>;
}

export interface ExamPresetDefinition {
  id: ExamPresetId;
  family: ExamFamily;
  displayName: string;
  neutralName: string;
  /** Applied over the family base for every layout. */
  patch?: ExamThemePatch;
  /** Layout used when `exam_interface.layout` is missing or unknown. */
  defaultLayout?: ExamLayoutVariant;
  /** Per-layout patches; a preset with none supports only its base layout. */
  layouts?: Partial<Record<ExamLayoutVariant, ExamThemePatch>>;
  /** A calculator the real exam screen always offers (see ResolvedExamTheme). */
  builtInCalculator?: "basic" | "scientific";
}

/**
 * `exam_interface` as the API sends it (snake_case, versioned). Null or a
 * missing preset means the default screen. Unknown keys are kept by the
 * backend for newer clients and ignored here.
 */
export interface ExamInterface {
  v?: number;
  preset?: string;
  layout?: string;
  /** Strict saving; true unless the admin chose "practice-friendly". */
  strict?: boolean;
  /** Per-test tool switches; `calculator: false` turns a built-in calculator off. */
  tools?: { calculator?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ResolvedExamTheme extends ExamThemeDefinition {
  /** false = practice-friendly: the family's `practice` policy is applied. */
  strict: boolean;
  /** Layouts this preset offers (first = default). */
  availableLayouts: ExamLayoutVariant[];
  /**
   * Calculator the real exam screen has built in (GATE), unless the test turns
   * it off. When set, the learner gets it even if the institute's calculator
   * setting is off. null = the institute's setting decides, as before.
   */
  builtInCalculator: "basic" | "scientific" | null;
}
