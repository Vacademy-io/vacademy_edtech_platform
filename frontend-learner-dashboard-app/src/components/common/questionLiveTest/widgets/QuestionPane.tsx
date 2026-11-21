import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useLiveTestUi } from "../live-test-ui-context";
import { useConsole } from "../layouts/console-context";
import { ExamCalculator } from "../tools/exam-calculator";
import { ConsoleQuestionBody } from "./ConsoleQuestionBody";
import { QuestionNoRow } from "./QuestionNoRow";
import { useCandidate } from "./use-console-data";

const WATERMARK_REPEAT = 60;

/** Faint repeated candidate name behind the question (presets that show it). */
function Watermark() {
  const { name } = useCandidate();
  if (!name) return null;
  return (
    <div className="tcs-watermark" aria-hidden="true">
      {Array.from({ length: WATERMARK_REPEAT }, (_, index) => (
        <span key={index}>{name}</span>
      ))}
    </div>
  );
}

/**
 * The question area: the "Question No. N" row, then the scrolling question.
 * The round arrow jumps to the bottom of a long question and back to the
 * top. The scroll position resets on every question change. The calculator
 * (presets that have one) floats over the bottom right of this pane.
 */
export function QuestionPane({ trailing }: { trailing?: ReactNode }) {
  const { chrome, zoomStep } = useConsole();
  const { settings, activeTool, closeTool } = useLiveTestUi();
  const questionId = useAssessmentStore((s) => s.currentQuestion?.question_id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const overflow = element.scrollHeight - element.clientHeight > 4;
    setScrollable(overflow);
    setAtBottom(
      overflow && element.scrollTop + element.clientHeight >= element.scrollHeight - 4,
    );
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    measure();
    // Images and formulas can change the height after the first paint.
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [questionId, zoomStep, measure]);

  const jump = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: atBottom ? 0 : element.scrollHeight, behavior: "smooth" });
  };

  const showCalculator =
    chrome.calculatorSlot && activeTool === "calculator" && settings.calculator.enabled;

  return (
    <div className="tcs-qpane">
      <QuestionNoRow
        atBottom={atBottom}
        scrollable={scrollable}
        onScrollJump={jump}
        trailing={trailing}
      />
      <div className="tcs-qpane__body">
        <div
          ref={scrollRef}
          className="tcs-qpane__scroll"
          onScroll={measure}
          style={{ // design-lint-ignore: zoom step is a runtime value
            ["--tcs-zoom" as string]: String(1 + zoomStep / 10),
          }}
        >
          <div className="tcs-qpane__content">
            <ConsoleQuestionBody />
          </div>
        </div>
        {chrome.watermark && <Watermark />}
        {showCalculator && (
          <div className="tcs-calculator-dock">
            <ExamCalculator mode={settings.calculator.mode} onClose={closeTool} />
          </div>
        )}
      </div>
    </div>
  );
}
