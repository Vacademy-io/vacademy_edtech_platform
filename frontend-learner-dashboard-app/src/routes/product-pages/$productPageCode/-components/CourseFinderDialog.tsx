import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass, MagicWand, X } from "@phosphor-icons/react";
import type {
  ProductPageCourseFinder,
  ProductPageFinderGroup,
  ProductPageMappingResponse,
} from "../-types/product-page-types";
import { finderCtaLabel, usableGroups, mappingInGroup } from "../-utils/course-finder";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";

interface CourseFinderDialogProps {
  finder: ProductPageCourseFinder;
  mappings: ProductPageMappingResponse[];
  /**
   * The page's own brand colour from page_json. A product page opened
   * directly carries no catalogue theme, so `--primary-*` is the app default
   * and every `primary-500` class here would render grey next to the orange
   * Add-to-Cart buttons the grid draws from this same value.
   */
  primaryColor: string;
  onPick: (group: ProductPageFinderGroup) => void;
  onSkip: () => void;
}

/**
 * "Choose your class", as a dialog over the course grid.
 *
 * Deliberately the same shell as the catalogue's CourseFinderWizard — plain
 * fixed overlay (no Radix Dialog), `catalogue-*` tokens so it wears the
 * tenant's theme rather than the app chrome's, MagicWand header, footer with
 * skip on the left and the CTA on the right. A visitor who has met the finder
 * on a catalogue site meets the same thing here.
 *
 * Single-select, unlike the catalogue's: a class picks out one course, and
 * checkboxes would invite a parent to tick Class 6 AND Class 9 and land in a
 * basket holding two different children's tests.
 */
export const CourseFinderDialog = ({
  finder,
  mappings,
  primaryColor,
  onPick,
  onSkip,
}: CourseFinderDialogProps) => {
  const { t } = useTranslation("productPages");
  const courses = useCourseTerms().courses;
  const [chosen, setChosen] = useState<string | null>(null);

  const active = mappings.filter((m) => m.status === "ACTIVE");
  const groups = usableGroups(finder, mappings);
  const chosenGroup = groups.find((g) => g.id === chosen) ?? null;

  /**
   * What the confirm button says.
   *
   * The default has to follow what the button DOES: with GO_TO_FORM it opens a
   * registration form, and "Show my courses" would be a promise the click does
   * not keep. An admin-set label wins, and `{{class}}` in it becomes the pick
   * so the button can name the class the visitor just chose.
   */
  const ctaLabel = finderCtaLabel(
    finder.ctaLabel,
    chosenGroup?.label ?? null,
    finder.onPick === "GO_TO_FORM"
      ? t("courseFinder.continueToRegister")
      : t("courseFinder.showCourses", { courses: courses.toLocaleLowerCase() }),
  );

  /**
   * Escape closes the dialog ONLY where skipping is allowed. Where it is not,
   * this is a required step rather than an overlay laid on usable content, and
   * a keypress that dismissed it would leave the visitor on a catalogue the
   * page never meant to show them.
   */
  useEffect(() => {
    if (!finder.allowSkip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finder.allowSkip, onSkip]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-finder-title"
        className="catalogue-card flex w-full max-w-md flex-col overflow-hidden p-0"
      >
        {/* Header */}
        <div className="relative p-6 pb-4">
          {finder.allowSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="absolute end-4 top-4 rounded-full p-1.5 text-catalogue-text-muted transition-colors hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          )}
          {/* Brand colour as a hex from page_json, so it cannot come from a
              palette class. `18` is a 9% alpha tint for the icon's backing. */}
          <div
            className="mb-3 flex size-10 items-center justify-center rounded-catalogue-lg"
            style={{ backgroundColor: `${primaryColor}18` }}
          >
            <MagicWand
              className="size-5"
              style={{ color: primaryColor }}
              weight="fill"
              aria-hidden="true"
            />
          </div>
          <h2 id="course-finder-title" className="text-lg font-semibold text-catalogue-text-primary">
            {finder.heading?.trim() || t("courseFinder.dialogHeading")}
          </h2>
          <p className="mt-1 text-sm text-catalogue-text-secondary">
            {finder.subheading?.trim() ||
              t("courseFinder.defaultSubheading", { courses: courses.toLocaleLowerCase() })}
          </p>
        </div>

        {/* Options */}
        <div className="max-h-72 overflow-y-auto px-6">
          <div className="space-y-1 pb-2">
            {groups.map((group) => {
              const count = active.filter((m) => mappingInGroup(m, group)).length;
              return (
                <label
                  key={group.id}
                  className="flex cursor-pointer items-center rounded-catalogue-sm px-2 py-2 text-catalogue-text-secondary transition-colors hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
                >
                  <input
                    type="radio"
                    /* One radio group per page instance — a shared name would
                       merge every finder on the page into one control. */
                    name="product-page-course-finder"
                    className="form-radio size-4 border-catalogue-border me-2.5"
                    style={{ accentColor: primaryColor }}
                    checked={chosen === group.id}
                    onChange={() => setChosen(group.id)}
                  />
                  <span className="flex-1 text-sm">
                    {group.label}
                    {group.description?.trim() ? (
                      <span className="block text-xs text-catalogue-text-muted">
                        {group.description}
                      </span>
                    ) : null}
                  </span>
                  {count > 1 && (
                    <span className="ms-2 shrink-0 text-xs text-catalogue-text-muted">
                      {t("courseFinder.courseCount", {
                        count,
                        courses: courses.toLocaleLowerCase(),
                      })}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-catalogue-border p-4">
          {finder.allowSkip ? (
            <button type="button" onClick={onSkip} className="catalogue-btn catalogue-btn-ghost">
              <Compass className="size-3.5" aria-hidden="true" />
              {finder.skipLabel?.trim() ||
                t("courseFinder.skip", { courses: courses.toLocaleLowerCase() })}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!chosenGroup}
            onClick={() => chosenGroup && onPick(chosenGroup)}
            className="catalogue-btn catalogue-btn-primary disabled:cursor-not-allowed disabled:opacity-40"
            style={chosenGroup ? { backgroundColor: primaryColor, borderColor: primaryColor } : undefined}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
