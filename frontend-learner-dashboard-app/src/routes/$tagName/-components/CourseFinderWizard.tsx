import React, { useEffect, useMemo, useState } from "react";
import { X, CaretLeft, CaretRight, Compass, MagicWand } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useSiteT } from "../-utils/catalogue-locale";

export type CourseFinderStep = "level" | "session" | "tag";

export interface CourseFinderOption {
  id: string;
  name: string;
}

export interface CourseFinderOptions {
  levels: CourseFinderOption[];
  sessions: CourseFinderOption[];
  tags: CourseFinderOption[];
}

export interface CourseFinderSelection {
  levels: string[];
  sessions: string[];
  tags: string[];
  /**
   * The option labels exactly as the visitor saw them — group labels such as
   * "Class 6" rather than the raw level names they expand into. Course blocks
   * render these as removable "you picked" chips.
   */
  labels?: string[];
}

interface CourseFinderWizardProps {
  steps: CourseFinderStep[];
  mandatory: boolean;
  options: CourseFinderOptions;
  /** Per-catalogue text override for a step's title — see courseFinder.stepLabels. */
  stepLabels?: Partial<Record<CourseFinderStep, string>>;
  /** Institute-specific Level grouping — see courseFinder.levelGroups. */
  levelGroups?: Record<string, string[]>;
  onComplete: (selection: CourseFinderSelection) => void;
  onSkip: () => void;
}

const EMPTY_SELECTION: CourseFinderSelection = { levels: [], sessions: [], tags: [] };

/**
 * Step-by-step Level → Session → Tag picker, shown once over the public
 * catalogue page. Mirrors IntroPageComponent/LeadCollectionModal's plain
 * fixed-overlay convention (no Radix Dialog) and uses the catalogue-* design
 * tokens so it inherits the tenant's own theme instead of the app chrome's.
 */
export const CourseFinderWizard: React.FC<CourseFinderWizardProps> = ({
  steps,
  mandatory,
  options,
  stepLabels,
  levelGroups,
  onComplete,
  onSkip,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // Step titles and option names are shown in the visitor's language; the
  // selection (ids, group labels) handed to the course grid stays as authored.
  const siteT = useSiteT();
  const [stepIndex, setStepIndex] = useState(0);
  const [selection, setSelection] = useState<CourseFinderSelection>(EMPTY_SELECTION);

  const hasLevelGroups = !!levelGroups && Object.keys(levelGroups).length > 0;

  // When grouped, the step shows clean group labels ("Class 5") instead of
  // every raw level value ("Cyber Ai Class 5", "Mathematics Class 5", …) —
  // picks are expanded back to the raw values on complete, below. Displayed
  // in the exact order the keys appear in levelGroups (JSON string-key
  // order == insertion order == display order here) — no sorting, so the
  // catalogue JSON alone controls the order, e.g. LKG, UKG, Class 1, Class 2…
  const levelOptions = useMemo<CourseFinderOption[]>(
    () =>
      hasLevelGroups
        ? Object.keys(levelGroups!).map((label) => ({ id: label, name: label }))
        : options.levels,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasLevelGroups, levelGroups, options.levels]
  );

  const optionsByStep: Record<CourseFinderStep, CourseFinderOption[]> = {
    level: levelOptions,
    session: options.sessions,
    tag: options.tags,
  };

  // Drop any step the loaded courses have no options for — nothing to ask there.
  const activeSteps = useMemo(
    () => steps.filter((step) => optionsByStep[step].length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, levelOptions, options.sessions, options.tags]
  );

  useEffect(() => {
    if (activeSteps.length === 0) onSkip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSteps.length]);

  if (activeSteps.length === 0) return null;

  const currentStep = activeSteps[stepIndex]!;
  const isLastStep = stepIndex === activeSteps.length - 1;
  const currentOptions = optionsByStep[currentStep];
  const selectionKey: keyof CourseFinderSelection =
    currentStep === "level" ? "levels" : currentStep === "session" ? "sessions" : "tags";
  const currentSelected = selection[selectionKey];

  const courses = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

  const authoredStepLabel = stepLabels?.[currentStep];
  const stepTitle =
    (authoredStepLabel ? siteT(authoredStepLabel) : "") ||
    (currentStep === "tag"
      ? getTerminologyPlural(ContentTerms.PopularTag, SystemTerms.PopularTag)
      : currentStep === "level"
        ? getTerminology(ContentTerms.Level, SystemTerms.Level)
        : getTerminology(ContentTerms.Session, SystemTerms.Session));

  const toggleOption = (id: string) => {
    setSelection((prev) => {
      const list = prev[selectionKey];
      const next = list.includes(id) ? list.filter((i) => i !== id) : [...list, id];
      return { ...prev, [selectionKey]: next };
    });
  };

  const handleNext = () => {
    if (isLastStep) {
      const expandedLevels = hasLevelGroups
        ? selection.levels.flatMap((groupLabel) => levelGroups![groupLabel] ?? [groupLabel])
        : selection.levels;
      // Carry the pre-expansion picks through untouched: they are the only
      // record of what the visitor chose in their own words.
      const labels = [...selection.levels, ...selection.sessions, ...selection.tags];
      onComplete({ ...selection, levels: expandedLevels, labels });
    } else {
      setStepIndex((i) => i + 1);
    }
  };
  const handleBack = () => setStepIndex((i) => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="catalogue-card flex w-full max-w-md flex-col overflow-hidden p-0">
        {/* Header */}
        <div className="relative p-6 pb-4">
          {!mandatory && (
            <button
              onClick={onSkip}
              className="absolute end-4 top-4 rounded-full p-1.5 text-catalogue-text-muted transition-colors hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-catalogue-lg bg-primary-50">
            <MagicWand className="h-5 w-5 text-primary-500" weight="fill" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-catalogue-text-primary">
            {t("courseFinderWizard.chooseYour", { stepTitle })}
          </h2>
          <p className="mt-1 text-sm text-catalogue-text-secondary">
            {t("courseFinderWizard.pickOptionsHint", { courses })}
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1.5 px-6">
          {activeSteps.map((step, i) => (
            <span
              key={step}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-primary-500" : "bg-catalogue-border"
              }`}
            />
          ))}
        </div>
        <p className="px-6 pb-3 pt-2 text-xs text-catalogue-text-muted">
          {t("courseFinderWizard.stepProgress", { current: stepIndex + 1, total: activeSteps.length })}
        </p>

        {/* Options */}
        <div className="max-h-72 overflow-y-auto px-6">
          <div className="space-y-1 pb-2">
            {currentOptions.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center rounded-catalogue-sm px-2 py-2 text-catalogue-text-secondary transition-colors hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
              >
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 rounded-catalogue-xs border-catalogue-border text-primary-500 focus:ring-primary-400 me-2.5"
                  checked={currentSelected.includes(option.id)}
                  onChange={() => toggleOption(option.id)}
                />
                <span className="text-sm">{siteT(option.name)}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-catalogue-border p-4">
          {!mandatory ? (
            <button onClick={onSkip} className="catalogue-btn catalogue-btn-ghost">
              <Compass className="h-3.5 w-3.5" aria-hidden="true" />
              {t("courseFinderWizard.skipShowAll", { courses })}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button onClick={handleBack} className="catalogue-btn catalogue-btn-secondary">
                <CaretLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t("common.back")}
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={currentSelected.length === 0}
              className="catalogue-btn catalogue-btn-primary"
            >
              {isLastStep ? t("courseFinderWizard.showCourses", { courses }) : t("common.next")}
              {!isLastStep && <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseFinderWizard;
