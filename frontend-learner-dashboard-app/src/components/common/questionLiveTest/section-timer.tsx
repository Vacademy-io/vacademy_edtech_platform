"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "@phosphor-icons/react";
import { useAssessmentStore } from "@/stores/assessment-store";
import { Preferences } from "@capacitor/preferences";
import { safeParse } from "@/lib/storage";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";

export function SectionTimer() {
  const { t } = useTranslation("questionTest");
  const {
    currentSection,
    sectionTimers,
    updateSectionTimer,
    moveToNextAvailableSection,
    findNextAvailableSection,
  } = useAssessmentStore();

  const currentTimer = sectionTimers[currentSection];
  const [playMode, setPlayMode] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlayMode = async () => {
      const storedMode = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const parsedData = safeParse<{ play_mode?: string } | null>(
        storedMode.value,
        null
      );
      if (parsedData) {
        setPlayMode(parsedData.play_mode ?? null);
      }
    };

    fetchPlayMode();
  }, []);
  useEffect(() => {
    if (!currentTimer?.isRunning) return;
    // Practice tests and surveys have no clock, section-wise or otherwise.
    if (isUntimedPlayMode(playMode)) return;

    const timer = setInterval(() => {
      const newTime = Math.max(0, currentTimer.timeLeft - 1000);
      updateSectionTimer(currentSection, newTime);

      // If time is up for current section, move to next available section
      if (newTime === 0) {
        const nextSection = findNextAvailableSection();
        if (nextSection !== null && nextSection !== currentSection) {
          moveToNextAvailableSection();
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [currentTimer?.isRunning, currentTimer?.timeLeft, currentSection, playMode]);

  if (!currentTimer) return null;

  const minutes = Math.floor(currentTimer.timeLeft / 60000);
  const seconds = Math.floor((currentTimer.timeLeft % 60000) / 1000);
  const isCritical = currentTimer.timeLeft < 60_000;
  const isWarning = !isCritical && currentTimer.timeLeft < 5 * 60_000;
  const colorClass = isCritical
    ? "text-red-600 animate-pulse"
    : isWarning
      ? "text-amber-600"
      : "text-gray-900";

  return (
    <div className="flex items-center gap-2 text-lg font-mono">
      <Clock className="h-5 w-5" />
      {playMode !== "PRACTICE" && playMode !== "SURVEY" && (
        <span
          className={`transition-colors ${colorClass}`}
          role="timer"
          aria-live={isCritical ? "assertive" : "off"}
          aria-label={t("sectionTimer.ariaLabel", { minutes, seconds })}
        >
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </span>
      )}
    </div>
  );
}
