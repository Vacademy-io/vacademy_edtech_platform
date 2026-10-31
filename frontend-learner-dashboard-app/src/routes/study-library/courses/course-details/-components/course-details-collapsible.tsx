import { useState } from "react";
import { CaretDown, Info } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { extractTextFromHTML } from "@/components/common/helper";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { CourseContentSections } from "./course-content-sections";

export type CourseDetailsForSections = {
  whatYoullLearn: string;
  aboutTheCourse: string;
  whoShouldLearn: string;
  instructors: Array<{ name: string; email: string }>;
};

// Collapsible "Course details" panel rendered between the banner/enrollment
// area and the course content list. Follows the Material Design expansion
// panel pattern (https://m3.material.io): a full-width trigger row with a
// rotating caret, aria-expanded for a11y, and an animated content region.
// Hidden entirely when there's no admin-provided copy to show, so it never
// appears as an empty control.
export const CourseDetailsCollapsible = ({
  courseData,
  showInstructors = false,
}: {
  courseData: CourseDetailsForSections;
  showInstructors?: boolean;
}) => {
  const { t } = useTranslation("courseDetailsA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const [open, setOpen] = useState<boolean>(false);
  const hasWhatYoullLearn = !!extractTextFromHTML(courseData?.whatYoullLearn);
  const hasAboutTheCourse = !!extractTextFromHTML(courseData?.aboutTheCourse);
  const hasWhoShouldLearn = !!extractTextFromHTML(courseData?.whoShouldLearn);
  const hasAnyDetails =
    hasWhatYoullLearn || hasAboutTheCourse || hasWhoShouldLearn;

  if (!hasAnyDetails) return null;

  const contentId = "course-details-panel";

  return (
    <section
      className="rounded-lg border border-border/60 bg-card shadow-sm overflow-hidden animate-fade-in-up"
      style={{ animationDelay: "0.15s" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Info className="w-4 h-4 text-primary flex-shrink-0" weight="bold" />
          <span className="text-sm font-semibold truncate">
            {t("detailsCollapsible.highlights", { course })}
          </span>
        </span>
        <CaretDown
          className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : "rotate-0"
          }`}
          weight="bold"
        />
      </button>
      {open && (
        <div id={contentId} className="px-4 pb-4 pt-1">
          <CourseContentSections
            courseData={courseData}
            showInstructors={showInstructors}
          />
        </div>
      )}
    </section>
  );
};
