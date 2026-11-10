/**
 * Live-test view of a Spreadsheet & Written Response (CBE_RESPONSE) question.
 *
 * Desktop: a split screen — the scenario (the question's passage) on the left,
 * the requirements and the answer workspace on the right — with a draggable,
 * keyboard-operable divider; each pane scrolls on its own. Without a scenario
 * the view is a single wide column. Phones (< md): everything stacks, with a
 * note that the question is best attempted on a laptop or desktop.
 *
 * Contract: docs/CBE_RESPONSE_QUESTION.md §4, §6 (Learner, Proctoring).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DesktopTower, DotsSixVertical } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CbeWorkspace } from "@/components/cbe/CbeWorkspace";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { htmlToPlainText, parseCbeConfig, type CbeAnswer } from "@/components/cbe/types";
import { useCbeClipboardGuard } from "@/hooks/proctoring/useCbeClipboardGuard";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { useAssessmentStore } from "@/stores/assessment-store";
import type { QuestionDto } from "@/types/assessment";
import { cn } from "@/lib/utils";
import { QuestionHtmlContent } from "../question-html-content";
import { QuestionPassage } from "../question-passage";
import { useLiveTestUi } from "../live-test-ui-context";

/** Left (scenario) pane width, in % of the split, and its limits. */
const SPLIT_MIN = 22;
const SPLIT_MAX = 62;
/** Pixel floors the % limits must respect (min-w-reg-250 / min-w-reg-400, divider w-3). */
const SCENARIO_MIN_PX = 250;
const ANSWER_MIN_PX = 400;
const DIVIDER_PX = 12;
const SPLIT_DEFAULT = 40;
const SPLIT_STEP = 2;
const SPLIT_STEP_LARGE = 10;
const SPLIT_STORAGE_KEY = "cbe-live-split-pct";

const GRID_MIN_HEIGHT = 360;
const GRID_MAX_HEIGHT = 760;
const GRID_COMPACT_HEIGHT = 400;
/** Room kept above the grid (part tabs, toolbar), inside the pane's padding, when it fills the pane. */
const GRID_PANE_RESERVE = 92;

/** Scenario/answer tables (financial statements) stay readable: borders, padding. */
const SCENARIO_TABLE_CLASSES =
  "[&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-neutral-200 [&_th]:px-2 [&_th]:py-1";

type SplitBounds = { min: number; max: number };
const DEFAULT_BOUNDS: SplitBounds = { min: SPLIT_MIN, max: SPLIT_MAX };

const clampSplit = (value: number, bounds: SplitBounds = DEFAULT_BOUNDS) =>
  Math.min(bounds.max, Math.max(bounds.min, value));

/** % limits for a split of `width` px, so neither pane drops below its minimum width. */
const boundsForWidth = (width: number): SplitBounds => {
  if (width <= 0) return DEFAULT_BOUNDS;
  const max = Math.max(0, Math.min(SPLIT_MAX, ((width - DIVIDER_PX - ANSWER_MIN_PX) / width) * 100));
  const min = Math.max(SPLIT_MIN, (SCENARIO_MIN_PX / width) * 100);
  // Too narrow for both minimums: give the answer pane the room.
  return max < min ? { min: max, max } : { min, max };
};

const readStoredSplit = (): number => {
  try {
    const stored = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampSplit(stored) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
};

const storeSplit = (value: number) => {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(value)));
  } catch {
    /* private mode / blocked storage: the split just isn't remembered */
  }
};

/** A passage counts as a scenario when it has visible text, an image or a table. */
const hasVisibleHtml = (html: string | null | undefined): boolean =>
  !!html && (htmlToPlainText(html) !== "" || /<(img|table|svg)\b/i.test(html));

const isRtl = () => typeof document !== "undefined" && document.documentElement.dir === "rtl";

interface CbeQuestionDisplayProps {
  question: QuestionDto;
  /** Question number, type and marks chips (owned by QuestionDisplay). */
  header: ReactNode;
  /** The assessment-wide "about" text, shown above the requirements. */
  intro?: ReactNode;
}

export function CbeQuestionDisplay({ question, header, intro }: CbeQuestionDisplayProps) {
  const { t } = useTranslation("questionTest");
  const cbeStrings = useLearnerCbeStrings();
  const { isCompact, activeTool, settings } = useLiveTestUi();
  // An open calculator / scratchpad is docked over the bottom-end of this area.
  const toolDockOpen =
    (activeTool === "calculator" && settings.calculator.enabled) ||
    (activeTool === "scratchpad" && settings.scratchpad.enabled);
  const questionId = question.question_id;

  const config = useMemo(() => parseCbeConfig(question.evaluation_json), [question.evaluation_json]);
  const answer = useAssessmentStore((s) => s.cbeAnswers[questionId]);
  const setCbeAnswer = useAssessmentStore((s) => s.setCbeAnswer);
  const incrementPaste = useAssessmentStore((s) => s.incrementCbePasteAttempt);

  const handleChange = useCallback(
    (next: CbeAnswer) => setCbeAnswer(questionId, next),
    [setCbeAnswer, questionId],
  );

  const handleBlockedPaste = useCallback(() => {
    incrementPaste(questionId);
    toast.warning(t("cbe.pasteBlocked"), { id: "cbe-paste-blocked" });
  }, [incrementPaste, questionId, t]);
  useCbeClipboardGuard({ enabled: !!config, onBlockedPaste: handleBlockedPaste });

  const scenarioHtml = question.parent_rich_text?.content;
  const hasScenario = hasVisibleHtml(scenarioHtml);
  const requirementHtml = question.question?.content;
  const hasRequirement = hasVisibleHtml(requirementHtml);

  // --- split ---------------------------------------------------------------
  const [storedSplit, setSplit] = useState<number>(() => readStoredSplit());
  const [bounds, setBounds] = useState<SplitBounds>(DEFAULT_BOUNDS);
  // The stored % re-clamped to what fits the current width.
  const split = clampSplit(storedSplit, bounds);
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateSplit = useCallback(
    (value: number) => {
      const next = clampSplit(value, bounds);
      setSplit(next);
      storeSplit(next);
    },
    [bounds],
  );

  // Recompute the limits whenever the split container resizes.
  useEffect(() => {
    if (isCompact || !hasScenario) return;
    const container = splitRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = boundsForWidth(container.getBoundingClientRect().width);
      setBounds((prev) =>
        Math.abs(prev.min - next.min) < 0.1 && Math.abs(prev.max - next.max) < 0.1 ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isCompact, hasScenario]);

  const splitFromPointer = (clientX: number) => {
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fromStart = isRtl() ? rect.right - clientX : clientX - rect.left;
    updateSplit((fromStart / rect.width) * 100);
  };

  const onDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };
  const onDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) splitFromPointer(event.clientX);
  };
  const onDividerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SPLIT_STEP_LARGE : SPLIT_STEP;
    // Arrows move the divider the way they point, in either text direction.
    const towardEnd = isRtl() ? -step : step;
    switch (event.key) {
      case "ArrowRight":
        updateSplit(split + towardEnd);
        break;
      case "ArrowLeft":
        updateSplit(split - towardEnd);
        break;
      case "Home":
        updateSplit(bounds.min);
        break;
      case "End":
        updateSplit(bounds.max);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // --- grid height: fill the answer pane on desktop ---------------------------
  const answerPaneRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(isCompact ? GRID_COMPACT_HEIGHT : 480);
  useEffect(() => {
    if (isCompact) {
      setGridHeight(GRID_COMPACT_HEIGHT);
      return;
    }
    const pane = answerPaneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Padding includes the tool-dock room when a calculator / scratchpad is open.
      const style = window.getComputedStyle(pane);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const target = pane.clientHeight - padding - GRID_PANE_RESERVE;
      // Rounded so small layout shifts don't resize the grid every frame.
      const rounded = Math.round(target / 20) * 20;
      setGridHeight(Math.min(GRID_MAX_HEIGHT, Math.max(GRID_MIN_HEIGHT, rounded)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [isCompact, hasScenario, toolDockOpen]);

  if (!config) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-7">
        {header}
        <p className="text-body text-neutral-500">{t("cbe.missingConfig")}</p>
      </div>
    );
  }

  const requirements = (
    <div className="flex flex-col gap-4">
      {header}
      {intro}
      {hasRequirement && (
        <section aria-label={t("cbe.requirementsLabel")} className="flex flex-col gap-2">
          {hasScenario && (
            <h2 className="text-3xs font-bold uppercase tracking-wide text-neutral-500">
              {t("cbe.requirementsLabel")}
            </h2>
          )}
          {/* Accounting text is full of "$" amounts: never typeset them as LaTeX. */}
          <QuestionHtmlContent
            html={requirementHtml ?? ""}
            dollarMath={false}
            className="text-body leading-relaxed text-neutral-900 md:text-subtitle [&_img]:h-auto [&_img]:max-w-full [&_p:last-child]:mb-0 [&_p]:mb-3"
          />
        </section>
      )}
      <CbeWorkspace
        key={questionId}
        config={config}
        value={answer}
        onChange={handleChange}
        height={gridHeight}
      />
    </div>
  );

  if (isCompact) {
    return (
      <CbeStringsProvider value={cbeStrings}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Alert className="border-info-200 bg-info-50">
          <DesktopTower size={16} />
          <AlertDescription className="text-caption text-neutral-700">
            {t("cbe.desktopNotice")}
          </AlertDescription>
        </Alert>
        {hasScenario && (
          <QuestionPassage
            html={scenarioHtml}
            label={t("cbe.scenarioLabel")}
            dollarMath={false}
            className="mb-0 md:mb-0"
            contentClassName={SCENARIO_TABLE_CLASSES}
          />
        )}
        {requirements}
      </div>
      </CbeStringsProvider>
    );
  }

  if (!hasScenario) {
    return (
      <CbeStringsProvider value={cbeStrings}>
      <div
        ref={answerPaneRef}
        className={cn("h-full overflow-auto overscroll-contain px-6 py-6 lg:px-8", toolDockOpen && "pb-tool-dock")}
      >
        <div className="mx-auto w-full max-w-6xl">{requirements}</div>
      </div>
      </CbeStringsProvider>
    );
  }

  return (
    <CbeStringsProvider value={cbeStrings}>
    <div ref={splitRef} className="flex h-full min-h-0 w-full">
      <section
        aria-label={t("cbe.scenarioLabel")}
        // Shrinkable (down to its min width) so the answer pane always keeps its own minimum.
        className="min-w-reg-250 shrink grow-0 overflow-auto overscroll-contain bg-neutral-50 px-5 py-6 lg:px-6"
        style={{ flexBasis: `${split}%` }} /* design-lint-ignore: learner-resized split width */
      >
        <h2 className="mb-3 text-3xs font-bold uppercase tracking-wide text-neutral-500">
          {t("cbe.scenarioLabel")}
        </h2>
        <QuestionHtmlContent
          html={scenarioHtml ?? ""}
          dollarMath={false}
          className={cn(
            "text-body leading-relaxed text-neutral-800 [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full [&_p:last-child]:mb-0 [&_p]:mb-3",
            SCENARIO_TABLE_CLASSES,
          )}
        />
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("cbe.resizeLabel")}
        aria-valuenow={Math.round(split)}
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        aria-valuetext={t("cbe.resizeValue", { pct: Math.round(split) })}
        tabIndex={0}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onPointerCancel={onDividerPointerUp}
        onKeyDown={onDividerKeyDown}
        onDoubleClick={() => updateSplit(SPLIT_DEFAULT)}
        className={cn(
          "group flex w-3 flex-none cursor-col-resize touch-none items-center justify-center border-x border-neutral-200 bg-neutral-100 transition-colors",
          "hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300",
        )}
      >
        <DotsSixVertical size={14} className="text-neutral-400 group-hover:text-primary-500" aria-hidden />
      </div>

      <div
        ref={answerPaneRef}
        className={cn(
          "min-w-reg-400 flex-1 overflow-auto overscroll-contain px-5 py-6 lg:px-6",
          toolDockOpen && "pb-tool-dock",
        )}
      >
        {requirements}
      </div>
    </div>
    </CbeStringsProvider>
  );
}

export default CbeQuestionDisplay;
