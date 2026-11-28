"use client";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { distribution_duration_types } from "@/types/assessment";
import { useLiveTestEngine } from "./engine/live-test-engine-context";
import { formatSectionClock } from "./engine/clock-logic";

const LOW_TIME_MS = 3 * 60 * 1000;

/**
 * Section tabs. Draws only: the section clocks tick in the engine
 * (engine/use-exam-clock.ts) and the switching rules live in
 * engine/use-question-navigation.ts.
 */
export function SectionTabs() {
  const { t } = useTranslation("questionTest");
  const { assessment, currentSection, sectionTimers } = useAssessmentStore();
  const { navigation } = useLiveTestEngine();

  const activeTabRef = useRef<HTMLButtonElement>(null);

  // The tab strip scrolls horizontally on a phone, so a section reached via the
  // footer's "next" (rather than a tap) would otherwise sit off-screen.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentSection]);

  if (!assessment || assessment.section_dtos.length <= 1) return null;

  const isSectionTimed =
    assessment.distribution_duration === distribution_duration_types.SECTION;

  return (
    <nav
      aria-label={t("sectionTabs.ariaLabel")}
      className="flex flex-none gap-5 overflow-x-auto border-b border-neutral-200 bg-white px-4 [scrollbar-width:none] md:px-6 [&::-webkit-scrollbar]:hidden"
    >
      {assessment?.section_dtos
        ?.map((section, originalIndex) => ({ section, originalIndex }))
        ?.sort((a, b) => a.section.section_order - b.section.section_order)
        ?.map(({ section, originalIndex }) => {
          const timer = sectionTimers[originalIndex];
          const isTimeUp = timer?.timeLeft === 0;
          const isActive = currentSection === originalIndex;
          const isAvailable = navigation.isSectionTabAvailable(originalIndex);
          const isLowOnTime =
            isSectionTimed && !isTimeUp && (timer?.timeLeft ?? 0) < LOW_TIME_MS;

          return (
            <button
              key={section.id}
              ref={isActive ? activeTabRef : undefined}
              type="button"
              onClick={() => navigation.goToSection(originalIndex)}
              disabled={!isAvailable || isTimeUp}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // Underline tabs, not pills: sections are a single-axis switch
                // and the underline survives a 3-across scroll on a phone.
                "-mb-px flex flex-none items-center gap-2 whitespace-nowrap border-b-2 py-3 transition-colors",
                isActive
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-700",
                (!isAvailable || isTimeUp) &&
                  "cursor-not-allowed opacity-40 hover:text-neutral-500",
              )}
            >
              <span className="text-caption font-semibold md:text-body">
                {section.name}
              </span>
              {isSectionTimed && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-3xs tabular-nums",
                    isLowOnTime
                      ? "bg-danger-50 text-danger-600"
                      : "bg-neutral-100 text-neutral-500",
                  )}
                >
                  {formatSectionClock(timer?.timeLeft || 0)}
                </span>
              )}
            </button>
          );
        })}
    </nav>
  );
}
