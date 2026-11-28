import { useId } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { CourseShelfConfig } from "@/types/learner-home";
import { useHomeBuilder } from "../home-context";
import { navigationHref, toNavigation } from "../link-target";
import { priceLabel } from "../block-helpers";


/**
 * A row of courses (spec 7.4.3). The server picks and orders the courses and
 * marks which ones the learner owns; reader mode (iOS / Mac App Store) has
 * already removed the ones not owned, and here never shows a price.
 */
export function CourseShelfBlock({ blockKey, config }: { blockKey: string; config: CourseShelfConfig }) {
  const { t, i18n } = useTranslation("learnerHome");
  const { openLink, linkContext } = useHomeBuilder();
  const headingId = useId();
  const seeAllNav = config.see_all ? toNavigation(config.see_all, linkContext) : null;
  const showPrice = config.show_price !== false && !linkContext.readerMode;

  return (
    <section aria-labelledby={headingId} className="fun-block-shelf">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2
          id={headingId}
          className="min-w-0 truncate text-subtitle font-semibold text-foreground [.ui-play_&]:font-black cp-heading fun-block-title"
        >
          {config.title}
        </h2>
        {config.see_all && seeAllNav && (
          <a
            href={navigationHref(seeAllNav)}
            onClick={(e) => {
              e.preventDefault();
              if (config.see_all) openLink(config.see_all, blockKey, "see_all");
            }}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-md fun-block-link"
          >
            {t("shelf.seeAll")}
            <CaretRight size={14} weight="bold" aria-hidden className="rtl:rotate-180" />
            <span className="sr-only">{config.title}</span>
          </a>
        )}
      </div>
      <ul className="-mx-1 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {config.courses.map((course) => {
          const nav = toNavigation(course.link, linkContext);
          const chip = course.owned
            ? t("shelf.enrolled")
            : showPrice
              ? priceLabel(course, i18n.language, t("shelf.free"))
              : null;
          return (
            <li key={course.package_id} className="w-40 shrink-0 snap-start lg:w-56">
              <a
                href={nav ? navigationHref(nav) : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  openLink(course.link, blockKey, course.package_id);
                }}
                className={cn(
                  "group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
                  "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-transparent [.ui-play_&]:shadow-play-soft-card",
                  "cp-card fun-block-card"
                )}
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-primary-50">
                  {course.thumbnail_url ? (
                    <img
                      src={course.thumbnail_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-primary-300" aria-hidden>
                      <BookOpen size={32} weight="duotone" />
                    </span>
                  )}
                </span>
                <span className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground fun-block-card__name">
                    {course.name}
                  </span>
                  {chip && (
                    <span
                      className={cn(
                        "mt-auto inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                        course.owned
                          ? "bg-success-50 text-success-700"
                          : "bg-primary-50 text-primary-500"
                      )}
                    >
                      {chip}
                    </span>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
