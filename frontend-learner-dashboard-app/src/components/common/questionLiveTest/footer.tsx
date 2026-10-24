import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CaretLeft,
  CaretRight,
  Eraser,
  Flag,
  GridFour,
  Stack,
  Calculator as CalculatorIcon,
  PencilSimple,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useLiveTestStore } from "@/stores/live-test-store";
import { bottomSafeAreaInset } from "@/utils/safe-area";
import { useLiveTestUi, type ExamTool } from "./live-test-ui-context";

interface FooterProps {
  onToggleSidebar: () => void;
  /** MANUAL attempts are answered by uploading a paper — no per-question actions. */
  evaluationType?: string;
}

function IconAction({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        // 40px square — the minimum comfortable touch target, and the reason
        // these actions moved out of the question body on mobile.
        "grid size-10 flex-none place-items-center rounded-lg border transition-colors",
        active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white",
      )}
    >
      {children}
    </button>
  );
}

/** Tools menu shown in the footer on phones, where the header has no room. */
function MobileToolsMenu() {
  const { t } = useTranslation("questionTest");
  const { settings, activeTool, toggleTool } = useLiveTestUi();
  const [open, setOpen] = useState(false);

  const items: Array<{ tool: ExamTool; label: string; Icon: typeof Stack }> = [];
  if (settings.calculator.enabled) {
    items.push({
      tool: "calculator",
      label: t("common.tools.calculator"),
      Icon: CalculatorIcon,
    });
  }
  if (settings.scratchpad.enabled) {
    items.push({
      tool: "scratchpad",
      label: t("common.tools.scratchpad"),
      Icon: PencilSimple,
    });
  }
  if (items.length === 0) return null;

  // A single tool needs no menu — one tap should open it.
  if (items.length === 1) {
    const { tool, label, Icon } = items[0];
    return (
      <IconAction
        label={label}
        active={activeTool === tool}
        onClick={() => toggleTool(tool)}
      >
        <Icon size={18} />
      </IconAction>
    );
  }

  return (
    <div className="relative flex-none">
      <IconAction
        label={t("footer.actions.tools")}
        active={open || activeTool !== null}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Stack size={18} />
      </IconAction>
      {open && (
        <>
          <button
            type="button"
            aria-label={t("footer.actions.closeToolsMenu")}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-12 start-0 z-20 flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
            {items.map(({ tool, label, Icon }) => (
              <button
                key={tool}
                type="button"
                onClick={() => {
                  toggleTool(tool);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-start text-caption font-medium text-neutral-800",
                  activeTool === tool ? "bg-neutral-100" : "hover:bg-neutral-50",
                )}
              >
                <Icon size={16} className="text-neutral-500" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function Footer({ onToggleSidebar, evaluationType }: FooterProps) {
  const { t } = useTranslation("questionTest");
  const { settings, isCompact } = useLiveTestUi();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const {
    assessment,
    currentQuestion,
    currentSection,
    setCurrentQuestion,
    setCurrentSection,
    sectionTimers,
    questionStates,
    answers,
    markForReview,
    clearResponse,
  } = useAssessmentStore();

  if (
    !assessment ||
    !assessment.section_dtos ||
    !assessment.section_dtos[currentSection]
  )
    return null;

  const currentSectionQuestions =
    assessment.section_dtos[currentSection]?.question_preview_dto_list || [];

  const currentIndex = currentSectionQuestions.findIndex(
    (q) => q.question_id === currentQuestion?.question_id,
  );

  const isTimeUp = sectionTimers[currentSection]?.timeLeft === 0;
  const questionId = currentQuestion?.question_id;
  const isMarked = questionId
    ? Boolean(questionStates[questionId]?.isMarkedForReview)
    : false;
  const hasAnswer = questionId
    ? (answers[questionId] ?? []).some(
        (value) =>
          value !== null && value !== undefined && String(value).trim() !== "",
      )
    : false;

  const isLastOfTest =
    currentIndex === currentSectionQuestions.length - 1 &&
    currentSection === assessment.section_dtos.length - 1;
  const showQuestionActions = evaluationType !== "MANUAL";

  const handlePrevQuestion = () => {
    if (currentIndex > 0) {
      setCurrentQuestion(currentSectionQuestions[currentIndex - 1]);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex < currentSectionQuestions.length - 1) {
      setCurrentQuestion(currentSectionQuestions[currentIndex + 1]);
    } else {
      const nextSection = currentSection + 1;
      if (
        nextSection < assessment.section_dtos.length &&
        (sectionTimers[nextSection]?.timeLeft ?? -1) !== 0
      ) {
        setCurrentSection(nextSection);
        setCurrentQuestion(
          assessment.section_dtos[nextSection].question_preview_dto_list[0],
        );
      }
    }
  };

  return (
    // MainActivity runs setDecorFitsSystemWindows(false), so the WebView draws
    // behind the system nav bar — see `bottomSafeAreaInset` for why an
    // inset-only padding left this pager untappable on Android.
    //
    // The two groups below are both `flex-none` inside a `flex-wrap` row, which is
    // what keeps "Save & Next" reachable on a phone. At 360dp the row has 336px of
    // content width, while the actions (4 × 40px) and the pager (counter +
    // Previous + "Save & Next" ≈ 215px) want ~416px together. Everything used to
    // sit in one unwrappable row of `flex-none` children, so the overflow ran off
    // the right edge and `page.tsx`'s `overflow-hidden` clipped the primary action
    // — and it got ~50px worse the moment an answer switched the label from
    // "Next" to "Save & Next". Letting the pager drop to its own line keeps it
    // whole; on md+ everything still fits one line and `ms-auto` right-aligns it.
    <div
      className="flex flex-none flex-wrap items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2.5 md:gap-3 md:px-6 md:py-3"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingBottom: bottomSafeAreaInset(immersiveActive),
      }}
    >
      <div className="flex flex-none items-center gap-2 md:gap-3">
        {isCompact && settings.questionPalette.enabled && (
          <IconAction
            label={t("footer.actions.questionPalette")}
            onClick={onToggleSidebar}
          >
            <GridFour size={18} />
          </IconAction>
        )}
        {isCompact && <MobileToolsMenu />}

        {showQuestionActions && isCompact && (
          <>
            <IconAction
              label={
                isMarked
                  ? t("footer.markForReview.unmark")
                  : t("footer.markForReview.mark")
              }
              active={isMarked}
              disabled={!questionId}
              onClick={() => questionId && markForReview(questionId)}
            >
              <Flag size={18} weight={isMarked ? "fill" : "regular"} />
            </IconAction>
            <IconAction
              label={t("footer.clearResponse.ariaLabel")}
              disabled={!questionId || !hasAnswer}
              onClick={() => questionId && clearResponse(questionId)}
            >
              <Eraser size={18} />
            </IconAction>
          </>
        )}
        {showQuestionActions && !isCompact && (
          <>
            <button
              type="button"
              disabled={!questionId}
              onClick={() => questionId && markForReview(questionId)}
              className={cn(
                "flex h-10 items-center gap-2 rounded-lg border px-4 text-body font-semibold transition-colors",
                isMarked
                  ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                  : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                !questionId && "cursor-not-allowed opacity-40",
              )}
            >
              <Flag size={17} weight={isMarked ? "fill" : "regular"} />
              {isMarked
                ? t("footer.markForReview.marked")
                : t("footer.markForReview.mark")}
            </button>
            <button
              type="button"
              disabled={!questionId || !hasAnswer}
              onClick={() => questionId && clearResponse(questionId)}
              className="flex h-10 items-center gap-2 rounded-lg px-3 text-body font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Eraser size={17} />
              {t("footer.clearResponse.label")}
            </button>
          </>
        )}
      </div>

      <div className="ms-auto flex flex-none items-center gap-2 md:gap-3">
        <span className="flex-none whitespace-nowrap text-caption font-medium tabular-nums text-neutral-500">
          {currentQuestion
            ? `${currentIndex + 1} / ${currentSectionQuestions.length}`
            : "-"}
        </span>

        <button
          type="button"
          onClick={handlePrevQuestion}
          disabled={currentIndex <= 0 || isTimeUp}
          aria-label={t("footer.nav.previousAriaLabel")}
          className="flex h-10 flex-none items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-body font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 md:px-4"
        >
          <CaretLeft size={17} />
          <span className="hidden md:inline">{t("footer.nav.previous")}</span>
        </button>

        <button
          type="button"
          onClick={handleNextQuestion}
          disabled={isLastOfTest || isTimeUp}
          className="flex h-10 flex-none items-center gap-1.5 rounded-lg bg-primary-500 px-3 text-body font-semibold text-white transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:bg-primary-200 md:px-5"
        >
          {hasAnswer ? t("footer.nav.saveAndNext") : t("footer.nav.next")}
          <CaretRight size={17} />
        </button>
      </div>
    </div>
  );
}
