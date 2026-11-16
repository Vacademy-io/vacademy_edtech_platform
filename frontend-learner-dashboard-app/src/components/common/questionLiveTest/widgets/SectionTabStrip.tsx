import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { cn } from "@/lib/utils";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { SectionSummaryPopover } from "./SectionSummaryPopover";
import { statusCounts } from "./palette-logic";

/**
 * Section tabs. The open section is filled with a pointer; the others are
 * white with blue text. Changing section throws away an unsaved pick on the
 * question being left (store rule) and opens the section's first question.
 */
export function SectionTabStrip({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("questionTest");
  const { navigation } = useLiveTestEngine();
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentSection = useAssessmentStore((s) => s.currentSection);
  const questionStates = useAssessmentStore((s) => s.questionStates);
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>("[data-active='true']");
    if (!strip || !active) return;
    const left = active.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 8), behavior: "auto" });
    }
  }, [currentSection]);

  const sections = assessment?.section_dtos ?? [];
  if (sections.length === 0) return null;

  const scrollBy = (direction: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: direction * strip.clientWidth * 0.6, behavior: "smooth" });
  };

  return (
    <div className={cn("tcs-tabs-row", compact && "tcs-tabs-row--compact")}>
      {!compact && (
        <button
          type="button"
          className="tcs-arrow tcs-arrow--box"
          aria-label={t("examThemes.tcs.scrollTabsBack")}
          onClick={() => scrollBy(-1)}
        >
          ◀
        </button>
      )}
      <div className="tcs-tabs" ref={stripRef} role="tablist">
        {sections.map((section, index) => {
          const active = index === currentSection;
          const available = navigation.isSectionTabAvailable(index);
          return (
            <div
              key={section.id ?? index}
              role="presentation"
              className={cn("tcs-tab", active && "tcs-tab--active", !available && "tcs-tab--locked")}
              data-active={active ? "true" : "false"}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                disabled={!available || isSubmitted}
                className="tcs-tab__name"
                onClick={() => {
                  if (!active) navigation.goToSection(index);
                }}
              >
                {section.name}
              </button>
              {!compact && (
                <SectionSummaryPopover
                  title={section.name}
                  counts={statusCounts(section.question_preview_dto_list, questionStates)}
                />
              )}
            </div>
          );
        })}
      </div>
      {!compact && (
        <button
          type="button"
          className="tcs-arrow tcs-arrow--box"
          aria-label={t("examThemes.tcs.scrollTabsForward")}
          onClick={() => scrollBy(1)}
        >
          ▶
        </button>
      )}
    </div>
  );
}
