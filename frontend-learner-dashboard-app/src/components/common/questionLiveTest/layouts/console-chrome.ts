/**
 * Per-preset details of the console chrome that are not behaviour: banner
 * style, the header links and their order, the clock label, the label for
 * numerical questions, which tool slots the group row has, and the button
 * arrangement of each console layout. Colours live in
 * styles/exam-themes/tcs.css under [data-exam-theme="<preset>"] (and
 * nta-mock.css under [data-exam-layout="nta-mock"]).
 */
import type {
  ExamLayoutVariant,
  ExamPresetId,
  ResolvedExamTheme,
} from "@/types/exam-theme";
import type { ExamActionId } from "../actions";

export type HeaderLinkId = "question-paper" | "view-instructions";

export interface ConsoleChrome {
  /** Blue strip with the institute logo and name, or a white strip with a centred title. */
  bannerStyle: "blue" | "white";
  /** Header links, left to right. */
  headerLinks: HeaderLinkId[];
  /** "View Instructions" (JEE Advanced) or "Instructions". */
  instructionsLabel: "viewInstructions" | "instructions";
  /**
   * "Time Left: 179:50" (colon, space), "Time Left :179:56" (space, colon),
   * or "Remaining Time" with the time in a pill (NTA mock).
   */
  clockLabel: "colon-space" | "space-colon" | "pill";
  /** "Question No. 1" (TCS console) or "Question 1:" (NTA mock). */
  questionLabel: "question-no" | "question-colon";
  /**
   * The round scroll button beside the question number: a triangle shown
   * only on a long question (TCS console), or an arrow that is always shown
   * (NTA mock).
   */
  scrollJump: "when-long" | "always";
  /**
   * Short exam name in plain text at the left of the NTA mock's orange band
   * ("" = none). Never a logo or wordmark.
   */
  examShortName: string;
  /** Label of NUMERIC questions in the Question Type row. */
  numericLabel: "nat" | "numerical";
  /** Calculator slot at the right end of the group row (shown when the institute enables the calculator). */
  calculatorSlot: boolean;
  /** The palette and legend sit in a box with a dark border. */
  paletteBorder: boolean;
  /** Zoom In / Zoom Out buttons in the group row (question text size). */
  zoomSlot: boolean;
  /** Faint diagonal candidate-name watermark across the question pane. */
  watermark: boolean;
  /**
   * The blue "View in" bar above the question: `select` = always drawn with
   * the language select (disabled while the paper has one language),
   * `empty` = always drawn, with the select only for a multi-language paper,
   * `when-languages` = drawn only for a multi-language paper.
   */
  viewInBar: "select" | "empty" | "when-languages";
  /** Scroll arrows on both sides of the single group tab. */
  groupArrows: boolean;
  /** "Question Type: MCQ" and marks row (the NTA mock has none). */
  questionTypeRow: boolean;
}

const TCS_DEFAULT: ConsoleChrome = {
  bannerStyle: "blue",
  headerLinks: ["question-paper", "view-instructions"],
  instructionsLabel: "instructions",
  clockLabel: "space-colon",
  questionLabel: "question-no",
  scrollJump: "when-long",
  examShortName: "",
  numericLabel: "numerical",
  calculatorSlot: false,
  paletteBorder: false,
  zoomSlot: false,
  watermark: false,
  viewInBar: "empty",
  groupArrows: true,
  questionTypeRow: true,
};

const BY_PRESET: Partial<Record<ExamPresetId, Partial<ConsoleChrome>>> = {
  "jee-main": {
    examShortName: "JEE Main",
  },
  "jee-advanced": {
    headerLinks: ["view-instructions", "question-paper"],
    instructionsLabel: "viewInstructions",
    clockLabel: "colon-space",
    viewInBar: "select",
    groupArrows: false,
  },
  gate: {
    bannerStyle: "white",
    numericLabel: "nat",
    calculatorSlot: true,
    paletteBorder: true,
    viewInBar: "when-languages",
  },
  "rrb-je": {
    // The Question Paper link is hidden on this console.
    headerLinks: ["view-instructions"],
    calculatorSlot: true,
    zoomSlot: true,
    watermark: true,
  },
};

/**
 * Chrome of a layout variant, applied over the preset's. The NTA mock has
 * no header links (its screen has none), the "Remaining Time" pill and
 * "Question N:" headings.
 */
const BY_LAYOUT: Partial<Record<ExamLayoutVariant, Partial<ConsoleChrome>>> = {
  "nta-mock": {
    headerLinks: [],
    clockLabel: "pill",
    questionLabel: "question-colon",
    scrollJump: "always",
    questionTypeRow: false,
  },
};

export const consoleChromeFor = (theme: ResolvedExamTheme): ConsoleChrome => ({
  ...TCS_DEFAULT,
  ...BY_PRESET[theme.id],
  ...BY_LAYOUT[theme.layout.variant],
});

export interface ConsoleButtonLayout {
  /** Bottom bar, left group. */
  left: ExamActionId[];
  /** Bottom bar, right group. */
  right: ExamActionId[];
}

/**
 * Bottom-bar buttons per console layout, as `BottomActionBar` draws them
 * (desktop TCS console, and the phone screen of every console layout, where
 * the buttons sit in a three-column grid: left group first).
 * The NTA mock's desktop arrangement is `NTA_MOCK_BUTTONS`.
 */
export const CONSOLE_BUTTONS: Record<Exclude<ExamLayoutVariant, "default">, ConsoleButtonLayout> = {
  "tcs-console": {
    left: ["mark-review-next", "clear"],
    right: ["save-next"],
  },
  // Phone: the first row matches the desktop's first row; Back and Next
  // frame Mark for Review & Next on the second. Submit is in the sheet.
  "nta-mock": {
    left: ["save-next", "save-mark-review", "clear"],
    right: ["back", "mark-review-next", "next"],
  },
};

export interface NtaButtonLayout {
  /** Rows of buttons under the question, top to bottom. */
  rows: ExamActionId[][];
  /** The separate strip below: left group and right group. */
  strip: ConsoleButtonLayout;
}

/**
 * Desktop NTA mock: SAVE & NEXT, SAVE & MARK FOR REVIEW, CLEAR RESPONSE;
 * then MARK FOR REVIEW & NEXT; then a strip with << BACK, NEXT >> on the
 * left and SUBMIT on the right.
 */
export const NTA_MOCK_BUTTONS: NtaButtonLayout = {
  rows: [["save-next", "save-mark-review", "clear"], ["mark-review-next"]],
  strip: { left: ["back", "next"], right: ["submit"] },
};

export const consoleButtonsFor = (theme: ResolvedExamTheme): ConsoleButtonLayout =>
  theme.layout.variant === "default"
    ? CONSOLE_BUTTONS["tcs-console"]
    : CONSOLE_BUTTONS[theme.layout.variant];
