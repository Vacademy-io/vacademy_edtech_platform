import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { cn } from "@/lib/utils";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useConsole } from "../layouts/console-context";
import { singleLanguageOption } from "./language-option";

/**
 * Orange band of the NTA mock layout: the exam's short name as plain text,
 * one button per section (subject), and a "Paper Language" select at the
 * right. The learner preview carries no language variants today, so the
 * select usually holds one language and is disabled. There is no paper
 * download: that space stays empty.
 *
 * A subject button opens that section's first question. Like a section tab
 * on the TCS console, it throws away an unsaved pick on the question being
 * left (store rule); a section that may not be entered is disabled.
 */
export function NtaBand({
  languages = [],
  language,
  onLanguageChange,
}: {
  languages?: { code: string; label: string }[];
  language?: string;
  onLanguageChange?: (code: string) => void;
}) {
  const { t, i18n } = useTranslation("questionTest");
  const { chrome } = useConsole();
  const multi = languages.length > 1;
  const options = multi ? languages : [singleLanguageOption(i18n.language)];
  const { navigation } = useLiveTestEngine();
  // Select the stored array itself (a fresh [] per call would re-render forever).
  const sectionList = useAssessmentStore((s) => s.assessment?.section_dtos);
  const sections = sectionList ?? [];
  const currentSection = useAssessmentStore((s) => s.currentSection);
  const isSubmitted = useAssessmentStore((s) => s.isSubmitted);

  return (
    <div className="nta-band">
      {chrome.examShortName && (
        <span className="nta-band__exam">{chrome.examShortName}</span>
      )}
      <div className="nta-band__subjects" role="group" aria-label={t("examThemes.tcs.subjects")}>
        {sections.map((section, index) => {
          const active = index === currentSection;
          return (
            <button
              key={section.id ?? index}
              type="button"
              className={cn("nta-subject", active && "nta-subject--active")}
              aria-pressed={active}
              disabled={isSubmitted || !navigation.isSectionTabAvailable(index)}
              onClick={() => {
                if (!active) navigation.goToSection(index);
              }}
            >
              {section.name}
            </button>
          );
        })}
      </div>
      <label className="nta-band__language">
        <span>{t("examThemes.tcs.paperLanguage")}:</span>
        <select
          value={multi ? language : options[0]?.code}
          disabled={!multi}
          onChange={(event) => onLanguageChange?.(event.target.value)}
        >
          {options.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
