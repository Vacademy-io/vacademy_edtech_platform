"use client";
import { cn } from "@/lib/utils";
import { useAssessmentStore } from "@/stores/assessment-store";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { distribution_duration_types } from "@/types/assessment";
import { useStoredPlayMode } from "@/hooks/use-stored-play-mode";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";

const LOW_TIME_MS = 3 * 60 * 1000;

export function SectionTabs() {
  const { t } = useTranslation("questionTest");
  const {
    assessment,
    currentSection,
    setCurrentSection,
    sectionTimers,
    setCurrentQuestion,
    updateSectionTimer,
    moveToNextAvailableSection,
  } = useAssessmentStore();

  const activeTabRef = useRef<HTMLButtonElement>(null);
  const playMode = useStoredPlayMode();

  useEffect(() => {
    if (
      assessment?.distribution_duration !== distribution_duration_types.SECTION
    )
      return;
    // Practice tests and surveys have no clock, section-wise or otherwise.
    if (isUntimedPlayMode(playMode)) return;

    const timer = setInterval(() => {
      const currentTimer = sectionTimers[currentSection];

      if (currentTimer && currentTimer.timeLeft > 0) {
        updateSectionTimer(currentSection, currentTimer.timeLeft - 1000);
      } else if (!assessment?.can_switch_section) {
        // Automatically move to next section when time ends if switching is disabled
        moveToNextAvailableSection();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [
    playMode,
    assessment,
    currentSection,
    sectionTimers,
    updateSectionTimer,
    moveToNextAvailableSection,
  ]);

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

  const handleSectionChange = (index: number) => {
    // If switching is disabled, only allow changing to the first non-completed section
    if (!assessment.can_switch_section) {
      const isFirstAvailableSection = assessment.section_dtos
        .slice(0, index)
        .every((_, i) => sectionTimers[i]?.timeLeft === 0);

      if (!isFirstAvailableSection) return;
    }

    if (sectionTimers[index]?.timeLeft === 0) return;

    setCurrentSection(index);
    const firstQuestion =
      assessment.section_dtos[index].question_preview_dto_list[0];
    setCurrentQuestion(firstQuestion);
  };

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

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
          const isAvailable =
            assessment.can_switch_section ||
            assessment.section_dtos
              .slice(0, originalIndex)
              .every((_, i) => sectionTimers[i]?.timeLeft === 0);
          const isLowOnTime =
            isSectionTimed && !isTimeUp && (timer?.timeLeft ?? 0) < LOW_TIME_MS;

          return (
            <button
              key={section.id}
              ref={isActive ? activeTabRef : undefined}
              type="button"
              onClick={() => handleSectionChange(originalIndex)}
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
                  {formatTime(timer?.timeLeft || 0)}
                </span>
              )}
            </button>
          );
        })}
    </nav>
  );
}
