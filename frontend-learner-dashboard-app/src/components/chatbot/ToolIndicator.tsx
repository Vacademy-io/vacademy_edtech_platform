import React from "react";
import {
  CalendarBlank,
  ChalkboardTeacher,
  ChartBar,
  MagnifyingGlass,
  Sparkle,
  SpinnerGap,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { getAppTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface ToolIndicatorProps {
  toolName: string;
}

/** Which mini animation tells the learner what the tutor is doing. */
type ToolMotion = "calendar" | "ring" | "highlight" | "sparkles" | "teacher" | "search" | "spinner";

const LOOP = { repeat: Infinity, ease: "easeInOut" as const };

/** A calendar whose top page keeps flipping over: looking up dates. */
const CalendarFlip: React.FC = () => (
  <span className="relative flex size-5 items-center justify-center text-primary [perspective:120px]">
    <CalendarBlank className="size-5" aria-hidden="true" />
    <motion.span
      className="absolute inset-x-1 top-1.5 h-1.5 origin-top rounded-sm bg-primary/60"
      animate={{ rotateX: [0, -180, -180, 0] }}
      transition={{ duration: 1.6, times: [0, 0.35, 0.8, 1], ...LOOP }}
    />
  </span>
);

/** A progress ring filling up: reading progress / results. */
const ProgressRing: React.FC = () => (
  <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden="true">
    <circle cx="10" cy="10" r="7" fill="none" strokeWidth="2.5" className="stroke-primary/15" />
    <motion.circle
      cx="10"
      cy="10"
      r="7"
      fill="none"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="stroke-primary"
      initial={{ pathLength: 0.05 }}
      animate={{ pathLength: [0.05, 0.85, 0.85] }}
      transition={{ duration: 1.8, times: [0, 0.7, 1], ...LOOP }}
    />
  </svg>
);

/** A highlighter sweeping over lines of text: searching content. */
const HighlighterSweep: React.FC = () => (
  <span className="flex w-6 flex-col gap-1" aria-hidden="true">
    {[1, 0.75, 0.9].map((width, i) => (
      <span key={i} className="relative h-1 overflow-hidden rounded-full bg-muted-foreground/20">
        <motion.span
          className="absolute inset-y-0 start-0 rounded-full bg-primary/70"
          initial={{ width: "0%" }}
          animate={{ width: ["0%", `${width * 100}%`, `${width * 100}%`, "0%"] }}
          transition={{ duration: 1.8, delay: i * 0.25, times: [0, 0.4, 0.85, 1], ...LOOP }}
        />
      </span>
    ))}
  </span>
);

/** Sparkles twinkling: making something new (quiz, steps, flashcards). */
const Sparkles: React.FC = () => (
  <span className="relative block size-5 text-primary" aria-hidden="true">
    {[
      { className: "absolute start-0 top-0 size-3.5", delay: 0 },
      { className: "absolute end-0 top-1 size-2.5", delay: 0.35 },
      { className: "absolute bottom-0 start-2 size-2.5", delay: 0.7 },
    ].map(({ className, delay }, i) => (
      <motion.span
        key={i}
        className={className}
        animate={{ scale: [0.4, 1, 0.4], opacity: [0.3, 1, 0.3], rotate: [0, 20, 0] }}
        transition={{ duration: 1.2, delay, ...LOOP }}
      >
        <Sparkle className="size-full" weight="fill" />
      </motion.span>
    ))}
  </span>
);

/** A teacher icon with a gentle pulse: handing the doubt to a teacher. */
const TeacherPulse: React.FC = () => (
  <span className="relative flex size-5 items-center justify-center text-primary" aria-hidden="true">
    <motion.span
      className="absolute inset-0 rounded-full bg-primary/25"
      animate={{ scale: [0.8, 1.6], opacity: [0.6, 0] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
    />
    <ChalkboardTeacher className="relative size-4" />
  </span>
);

const Searching: React.FC = () => (
  <motion.span
    className="flex size-5 items-center justify-center text-primary"
    animate={{ x: [0, 2, 0, -2, 0], y: [0, -1, 0, -1, 0] }}
    transition={{ duration: 1.6, ...LOOP }}
    aria-hidden="true"
  >
    <MagnifyingGlass className="size-4" />
  </motion.span>
);

const STATIC_ICONS: Record<ToolMotion, React.ElementType> = {
  calendar: CalendarBlank,
  ring: ChartBar,
  highlight: MagnifyingGlass,
  sparkles: Sparkle,
  teacher: ChalkboardTeacher,
  search: MagnifyingGlass,
  spinner: SpinnerGap,
};

const ANIMATIONS: Partial<Record<ToolMotion, React.FC>> = {
  calendar: CalendarFlip,
  ring: ProgressRing,
  highlight: HighlighterSweep,
  sparkles: Sparkles,
  teacher: TeacherPulse,
  search: Searching,
};

export const ToolIndicator: React.FC<ToolIndicatorProps> = ({ toolName }) => {
  const { t } = useTranslation("chatFeatureB");
  const reduceMotion = useReducedMotion();
  // The chatbot speaks the app's language, also over a public site in another.
  const course = getAppTerminology(ContentTerms.Course, SystemTerms.Course);

  const TOOL_DISPLAY_MAP: Record<string, { label: string; motion: ToolMotion }> = {
    get_learning_progress: { label: t("toolIndicator.checkingProgress"), motion: "ring" },
    get_student_feedback: { label: t("toolIndicator.reviewingPerformance"), motion: "ring" },
    search_related_resources: { label: t("toolIndicator.searchingResources"), motion: "highlight" },
    semantic_search_content: {
      label: t("toolIndicator.searchingCourseMaterials", { course }),
      motion: "highlight",
    },
    create_practice_quiz: { label: t("toolIndicator.preparingQuiz"), motion: "sparkles" },
    make_flashcards: { label: t("toolIndicator.makingFlashcards"), motion: "sparkles" },
    show_steps: { label: t("toolIndicator.writingSteps"), motion: "sparkles" },
    get_my_courses: { label: t("toolIndicator.checkingCourses", { course }), motion: "ring" },
    get_my_daily_tasks: { label: t("toolIndicator.checkingDailyTasks"), motion: "calendar" },
    get_my_live_classes: { label: t("toolIndicator.checkingLiveClasses"), motion: "calendar" },
    get_my_tests: { label: t("toolIndicator.checkingTests"), motion: "calendar" },
    get_my_results: { label: t("toolIndicator.checkingResults"), motion: "ring" },
    get_my_performance: { label: t("toolIndicator.reviewingPerformance"), motion: "ring" },
    ask_teacher: { label: t("toolIndicator.askingTeacher"), motion: "teacher" },
    get_learning_analytics: { label: t("toolIndicator.reviewingPerformance"), motion: "ring" },
  };

  const display = TOOL_DISPLAY_MAP[toolName] || {
    label: t("toolIndicator.workingOnIt"),
    motion: "spinner" as const,
  };
  const Animation = reduceMotion ? undefined : ANIMATIONS[display.motion];
  const StaticIcon = STATIC_ICONS[display.motion];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
      className="ms-7 flex w-fit items-center gap-2 rounded-full bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-primary/15"
      role="status"
    >
      {/* The label comes first in the DOM (screen readers, tests); the
          animation is shown before it with `order`. */}
      <span className="order-2">{display.label}</span>
      <span className="order-1 flex h-5 min-w-5 items-center justify-center">
        {Animation ? (
          <Animation />
        ) : (
          <StaticIcon
            className={display.motion === "spinner" ? "size-4 text-primary motion-safe:animate-spin" : "size-4 text-primary"}
            aria-hidden="true"
          />
        )}
      </span>
    </motion.div>
  );
};
