import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretRight, Compass } from "@phosphor-icons/react";
import type {
  ProductPageCourseFinder,
  ProductPageFinderGroup,
  ProductPageMappingResponse,
} from "../-types/product-page-types";
import { usableGroups, mappingInGroup } from "../-utils/course-finder";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";

interface CourseFinderStepProps {
  finder: ProductPageCourseFinder;
  mappings: ProductPageMappingResponse[];
  primaryColor: string;
  pageName: string;
  onPick: (group: ProductPageFinderGroup) => void;
  onSkip: () => void;
}

/**
 * "Choose your class" — the first thing a visitor sees on a page configured
 * with a Course Finder.
 *
 * A full screen rather than the catalogue's modal: this is step one of the
 * purchase, not an optional aid laid over a catalogue the visitor can already
 * use. Nothing else is on the page to dismiss it in favour of.
 */
export const CourseFinderStep = ({
  finder,
  mappings,
  primaryColor,
  pageName,
  onPick,
  onSkip,
}: CourseFinderStepProps) => {
  const { t } = useTranslation("productPages");
  const courses = useCourseTerms().courses;
  const [hovered, setHovered] = useState<string | null>(null);

  const active = mappings.filter((m) => m.status === "ACTIVE");
  const groups = usableGroups(finder, mappings);

  return (
    <div className="flex min-h-screen flex-col bg-catalogue-bg">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-12 sm:py-16">
        <div className="text-center">
          <h1 className="text-2xl font-bold leading-tight text-catalogue-text-primary sm:text-3xl">
            {finder.heading?.trim() || pageName}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-catalogue-text-secondary sm:text-base">
            {finder.subheading?.trim() ||
              t("courseFinder.defaultSubheading", { courses: courses.toLocaleLowerCase() })}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:grid-cols-3">
          {groups.map((group) => {
            const count = active.filter((m) => mappingInGroup(m, group)).length;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onPick(group)}
                onMouseEnter={() => setHovered(group.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(group.id)}
                onBlur={() => setHovered(null)}
                /* group/ prefix: the caret reacts to the whole tile, and an
                   unnamed `group` would also be claimed by any ancestor. */
                className="group/tile flex min-h-24 flex-col justify-between rounded-catalogue-lg border-2 border-catalogue-border bg-catalogue-bg-elevated p-4 text-start transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none"
                /* The page's own colour, which is a hex from page_json rather
                   than a palette step, so it cannot come from a class. */
                style={hovered === group.id ? { borderColor: primaryColor } : undefined}
              >
                <span className="text-base font-semibold text-catalogue-text-primary sm:text-lg">
                  {group.label}
                </span>
                {group.description?.trim() ? (
                  <span className="mt-1 text-xs text-catalogue-text-secondary">
                    {group.description}
                  </span>
                ) : null}
                <span className="mt-2 flex items-center gap-1 text-xs font-medium text-catalogue-text-muted">
                  {/* A count of one restates the button — every tile would read
                      "1 course" on a page selling one test per class. */}
                  {count > 1
                    ? t("courseFinder.courseCount", { count, courses: courses.toLocaleLowerCase() })
                    : t("courseFinder.view")}
                  <CaretRight
                    className="size-3 transition-transform group-hover/tile:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </button>
            );
          })}
        </div>

        {finder.allowSkip && (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-catalogue-text-muted underline-offset-4 transition-colors hover:text-catalogue-text-primary hover:underline"
            >
              <Compass className="size-4" aria-hidden="true" />
              {finder.skipLabel?.trim() ||
                t("courseFinder.skip", { courses: courses.toLocaleLowerCase() })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
