import { useTranslation } from "react-i18next";
import type { AnswerCommit, ResolvedExamTheme } from "@/types/exam-theme";
import type { QuestionStatus } from "../question-status-colors";
import { consoleButtonsFor, consoleChromeFor } from "../layouts/console-chrome";
import { LEGEND_LABEL_KEY } from "./Legend";
import { ChipShape } from "./PaletteChip";

const SYMBOL_ORDER: QuestionStatus[] = [
  "not-visited",
  "not-answered",
  "answered",
  "marked",
  "answered-marked",
];

const SYMBOL_HELP_KEY: Record<QuestionStatus, string> = {
  "not-visited": "examThemes.tcs.instructions.notVisited",
  "not-answered": "examThemes.tcs.instructions.notAnswered",
  answered: "examThemes.tcs.instructions.answered",
  marked: "examThemes.tcs.instructions.marked",
  "answered-marked": "examThemes.tcs.instructions.answeredMarked",
};

const G = "examThemes.tcs.general";

export interface TcsGeneralInstructionsProps {
  theme: ResolvedExamTheme;
  /** The saving mode the store applies (see `effectiveAnswerCommit`). */
  answerCommit: AnswerCommit;
  /** Submit is held until the clock reaches zero. */
  submitLocked: boolean;
  /** Test length in minutes; 0 or less = no time limit. */
  durationMinutes: number;
  /** The institute enabled the calculator and this console has its slot. */
  calculator?: boolean;
  /**
   * The paper also has a clock per section or per question (it moves the
   * learner on at 0). Unknown before the paper loads: then nothing is said.
   */
  partClock?: "section" | "question" | null;
}

/**
 * General instructions of the console themes (instruction page 1 and the
 * Instructions dialog): the clock, the palette symbols drawn with the real
 * chip shapes, moving between questions, the saving rule of this test and
 * what to have ready. All wording is our own; the button names come from the
 * layout's own button list, so a layout with Back / Next or Save & Mark for
 * Review gets those lines too.
 */
export function TcsGeneralInstructions({
  theme,
  answerCommit,
  submitLocked,
  durationMinutes,
  calculator = false,
  partClock = null,
}: TcsGeneralInstructionsProps) {
  const { t } = useTranslation("questionTest");
  const chrome = consoleChromeFor(theme);
  const buttons = consoleButtonsFor(theme);
  const layoutActions = new Set([...buttons.left, ...buttons.right]);
  const strict = answerCommit === "explicit";
  const timed = durationMinutes > 0;
  // Button names as the buttons print them (examThemes.tcs.actions), so each
  // line names a button with the label it shows in this language.
  const labels = {
    saveNext: t("examThemes.tcs.actions.saveNext"),
    markReviewNext: t("examThemes.tcs.actions.markReviewNext"),
    saveMarkReview: t("examThemes.tcs.actions.saveMarkReview"),
    clearResponse: t("examThemes.tcs.actions.clearResponse"),
    back: t("examThemes.tcs.actions.back"),
    next: t("examThemes.tcs.actions.next"),
    submit: t("examThemes.tcs.actions.submit"),
  };
  const numericLabel =
    chrome.numericLabel === "nat"
      ? t("examThemes.tcs.questionTypes.nat")
      : t("examThemes.tcs.questionTypes.numerical");

  return (
    <div className="tcs-general">
      <h3>{t(`${G}.clockTitle`)}</h3>
      <ol>
        <li>
          {timed
            ? t(`${G}.clockDuration`, { count: durationMinutes })
            : t(`${G}.clockUntimed`)}
        </li>
        {timed && <li>{t(`${G}.clockEnd`, labels)}</li>}
        {timed && submitLocked && <li>{t(`${G}.clockSubmitLocked`, labels)}</li>}
        {timed && !submitLocked && <li>{t(`${G}.clockSubmitEarly`, labels)}</li>}
        {timed && strict && partClock === "section" && <li>{t(`${G}.sectionClockStrict`)}</li>}
        {timed && strict && partClock === "question" && (
          <li>{t(`${G}.questionClockStrict`)}</li>
        )}
      </ol>

      <h3>{t(`${G}.paletteTitle`)}</h3>
      <p>
        {theme.palette.countsScope === "paper"
          ? t(`${G}.paletteIntroPaper`)
          : t(`${G}.paletteIntro`)}
      </p>
      {/* The layout attribute scopes the layout's chip colours (nta-mock.css) to the symbols. */}
      <table className="tcs-general__symbols" data-exam-layout={theme.layout.variant}>
        <tbody>
          {SYMBOL_ORDER.map((status, index) => (
            <tr key={status}>
              <td>
                <ChipShape status={status} size="legend">
                  {index + 1}
                </ChipShape>
              </td>
              <td>
                <strong>{t(LEGEND_LABEL_KEY[status])}</strong>
                {": "}
                {t(SYMBOL_HELP_KEY[status])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t(`${G}.paletteCollapse`)}</p>

      <h3>{t(`${G}.moveTitle`)}</h3>
      <ol>
        <li>{t(`${G}.moveJump`)}</li>
        <li>{t(`${G}.moveSections`)}</li>
        {strict && <li>{t(`${G}.moveNoSave`)}</li>}
        {layoutActions.has("back") && layoutActions.has("next") && (
          <li>{t(`${G}.moveBackNext`, labels)}</li>
        )}
      </ol>

      <h3>{t(`${G}.answerTitle`)}</h3>
      <ol>
        <li>{strict ? t(`${G}.answerPickStrict`) : t(`${G}.answerPickPractice`)}</li>
        <li>
          {strict ? t(`${G}.saveNextStrict`, labels) : t(`${G}.saveNextPractice`, labels)}
        </li>
        {layoutActions.has("save-mark-review") && (
          <li>{t(`${G}.saveMarkReview`, labels)}</li>
        )}
        <li>{t(`${G}.markReviewNext`, labels)}</li>
        <li>{t(`${G}.clearResponse`, labels)}</li>
        <li>{t(`${G}.sectionEnd`)}</li>
        {strict && <li>{t(`${G}.changeAnswer`, labels)}</li>}
        <li>
          {strict
            ? t(`${G}.numericStrict`, { label: numericLabel })
            : t(`${G}.numericPractice`, { label: numericLabel })}
        </li>
        <li>{t(`${G}.multiple`)}</li>
      </ol>

      <h3>{t(`${G}.readyTitle`)}</h3>
      <ol>
        <li>{t(`${G}.roughPaper`)}</li>
        {calculator && <li>{t(`${G}.calculator`)}</li>}
        <li>{t(`${G}.fullScreen`)}</li>
      </ol>

      <p className="tcs-general__disclaimer">{t(`${G}.disclaimer`)}</p>
    </div>
  );
}
