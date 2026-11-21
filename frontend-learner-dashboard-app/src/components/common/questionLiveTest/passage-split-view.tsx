import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { QuestionHtmlContent } from "./question-html-content";
import { useLiveTestUi } from "./live-test-ui-context";
import { useResizableSplit } from "./split/use-resizable-split";
import { SplitDivider } from "./split/SplitDivider";
import { splitFits } from "./split/split-math";

/** Default passage-pane width, in % of the split (limits: split/split-math.ts). */
const PASSAGE_SPLIT_DEFAULT = 50;
const PASSAGE_SPLIT_STORAGE_KEY = "passage-live-split-pct";

/**
 * "Show passage beside the question" (desktop and tablet, md and wider): the
 * passage on the left, the question and its answer area on the right, each
 * scrolling on its own, with the same draggable divider as the Spreadsheet &
 * Written Response view. page.tsx drops its padding and scroller for it.
 * Phones never get here: they keep the passage above the question.
 *
 * When the question area is too narrow for both panes (a portrait tablet with
 * the question rail open), it shows `stacked` instead: today's layout, with
 * page.tsx's padding and its own scroller, so no pane is ever cut off.
 */
export function PassageSplitView({
  passageHtml,
  questionId,
  stacked,
  children,
}: {
  passageHtml: string;
  questionId: string;
  /** The question column with the passage above it (narrow fallback). */
  stacked: ReactNode;
  /** Question header, stem and answer area. */
  children: ReactNode;
}) {
  const { t } = useTranslation("questionTest");
  const { activeTool, settings } = useLiveTestUi();
  // An open calculator / scratchpad is docked over the bottom-end of this area.
  const toolDockOpen =
    (activeTool === "calculator" && settings.calculator.enabled) ||
    (activeTool === "scratchpad" && settings.scratchpad.enabled);

  // Does the question area hold both panes at their minimum widths?
  const areaRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === "undefined") return;
    const measure = () => setFits(splitFits(area.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const splitState = useResizableSplit({
    storageKey: PASSAGE_SPLIT_STORAGE_KEY,
    defaultPct: PASSAGE_SPLIT_DEFAULT,
    active: fits,
  });
  const { splitRef, split } = splitState;

  // Each pane keeps its offset across re-renders; the question starts at the
  // top on every question, the passage only when the passage changes (sibling
  // questions of one passage keep the learner's place in it).
  const passagePaneRef = useRef<HTMLElement>(null);
  const questionPaneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (questionPaneRef.current) questionPaneRef.current.scrollTop = 0;
  }, [questionId]);
  useEffect(() => {
    if (passagePaneRef.current) passagePaneRef.current.scrollTop = 0;
  }, [passageHtml]);

  return (
    <div ref={areaRef} className="h-full w-full">
      {fits ? (
        <div ref={splitRef} className="flex h-full min-h-0 w-full">
          <section
            ref={passagePaneRef}
            aria-label={t("questionPassage.label")}
            // Shrinkable (down to its min width) so the question pane always keeps its own minimum.
            className="min-w-reg-250 shrink grow-0 overflow-auto overscroll-contain bg-neutral-50 px-5 py-6 lg:px-6"
            style={{ flexBasis: `${split}%` }} /* design-lint-ignore: learner-resized split width */
          >
            <h2 className="mb-3 text-3xs font-bold uppercase tracking-wide text-neutral-500">
              {t("questionPassage.label")}
            </h2>
            {/* Same text treatment as the stacked passage (question-passage.tsx). */}
            <QuestionHtmlContent
              html={passageHtml}
              className="text-body leading-relaxed text-neutral-700 [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full [&_p:last-child]:mb-0 [&_p]:mb-3"
            />
          </section>

          <SplitDivider
            split={splitState}
            label={t("questionPassage.resizeLabel")}
            valueText={t("questionPassage.resizeValue", { pct: Math.round(split) })}
          />

          <div
            ref={questionPaneRef}
            className={cn(
              "min-w-reg-400 flex-1 overflow-auto overscroll-contain px-5 py-6 lg:px-8",
              toolDockOpen && "pb-tool-dock",
            )}
          >
            {children}
          </div>
        </div>
      ) : (
        // Same padding and scroller as page.tsx gives the stacked layout.
        <div
          ref={questionPaneRef}
          className={cn(
            "h-full overflow-auto overscroll-contain px-4 py-5 md:px-8 md:py-7",
            toolDockOpen && "pb-tool-dock",
          )}
        >
          {stacked}
        </div>
      )}
    </div>
  );
}
