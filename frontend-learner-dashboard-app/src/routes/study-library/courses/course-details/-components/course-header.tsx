import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, toTitleCase } from "@/lib/utils";
import { VideoPlayer } from "../components/media/video-player";
import { Badge } from "@/components/ui/badge";
import { playIllustrations } from "@/assets/play-illustrations";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface CourseHeaderProps {
  courseData: {
    title: string;
    description: string;
    tags: string[];
    courseBannerMediaId: string;
    courseMediaId: string;
  };
  showConfetti?: boolean;
  /** "contentOnly" course-details layout: the header keeps the title so the
   *  learner still knows where they are, and drops everything that only
   *  matters to a shopper — tags, description and the banner/preview media. */
  minimal?: boolean;
  /** Student Display Settings → courseDetails.hideTags: no tag chips above the title. */
  hideTags?: boolean;
}

export const CourseHeader = ({
  courseData,
  showConfetti = false,
  minimal = false,
  hideTags = false,
}: CourseHeaderProps) => {
  const { t } = useTranslation("courseDetailsA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const isImageUrl = (url: string) =>
    /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(url);
  const hasVideo =
    !minimal &&
    !!courseData.courseMediaId &&
    !isImageUrl(courseData.courseMediaId);
  const hasMediaImage =
    !minimal &&
    !!courseData.courseMediaId &&
    isImageUrl(courseData.courseMediaId);
  // Banner image renders in the right column when no separate course media exists.
  // Mirrors the admin's clean 2-col layout (text-left, image-right) — no backdrop blur.
  const hasBannerImage =
    !minimal && !!courseData.courseBannerMediaId && !hasVideo && !hasMediaImage;
  const hasRightMedia = hasVideo || hasMediaImage || hasBannerImage;
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [isDescClamped, setIsDescClamped] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setIsDescClamped(el.scrollHeight > el.clientHeight);
  }, [courseData.description]);

  return (
    <div className="relative w-full bg-background">
      {/* Optional celebratory overlay */}
      {showConfetti && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div className="absolute inset-0 animate-pulse bg-primary-100/10" />
        </div>
      )}

      <div className="px-2 py-3 sm:px-0 lg:py-4">
        {!courseData.title ? (
          minimal ? (
            // Minimal mode renders the title alone, so its skeleton is one bar.
            // The two-column placeholder below would promise a tag, a
            // description and a banner that never arrive.
            <div className="animate-fade-in-up">
              <div className="h-10 w-3/4 max-w-lg animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-section lg:gap-10 items-center">
              <div className="space-y-3 animate-fade-in-up">
                <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-10 w-4/5 animate-pulse rounded bg-muted" />
                <div className="space-y-2">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                </div>
              </div>
              <div className="hidden lg:block h-48 w-full rounded-xl bg-muted animate-pulse" />
            </div>
          )
        ) : (
          <div
            className={cn(
              "grid grid-cols-1 items-center gap-6",
              hasRightMedia && "lg:grid-cols-2 lg:gap-10",
            )}
          >
            {/* Text Content */}
            <div className="animate-fade-in-up space-y-3 sm:space-y-4">
              {/* Tags */}
              {!minimal && !hideTags && courseData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {courseData.tags.map((tag, index) => (
                    <Badge
                      key={index}
                      variant="secondary"
                      className={cn(
                        "uppercase tracking-wide text-caption font-semibold px-2.5 py-1",
                        // Vibrant — primary-50 wash chips (tenant family)
                        "[.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:text-primary-500 dark:[.ui-vibrant_&]:bg-primary-500/10 dark:[.ui-vibrant_&]:text-primary-300",
                        "[.ui-vibrant_&]:border [.ui-vibrant_&]:border-primary-200 dark:[.ui-vibrant_&]:border-primary-500/30",
                        // Play Styles
                        "[.ui-play_&]:rounded-full [.ui-play_&]:font-bold [.ui-play_&]:border-2",
                      )}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Title */}
              <h1 className="text-h3 sm:text-h2 lg:text-h1 font-bold leading-tight tracking-tight text-foreground">
                {courseData.title}
              </h1>

              {/* Description */}
              {!minimal && courseData.description && (
                <div>
                  <div
                    ref={descRef}
                    className={cn(
                      "text-body sm:text-subtitle text-muted-foreground leading-relaxed",
                      !isDescExpanded && "line-clamp-4",
                    )}
                    dangerouslySetInnerHTML={{
                      __html: courseData.description,
                    }}
                  />
                  {(isDescClamped || isDescExpanded) && (
                    <button
                      onClick={() => setIsDescExpanded((prev) => !prev)}
                      className="mt-1 text-body font-medium text-primary hover:underline focus:outline-none"
                    >
                      {isDescExpanded ? t("header.viewLess") : t("header.viewMore")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right column — video > image-media > banner (priority order).
                Mirrors the admin's clean 2-col layout: media sits beside the
                text instead of behind it. */}
            {hasVideo ? (
              <div
                className="w-full animate-fade-in-up"
                style={{ animationDelay: "0.15s" }}
              >
                <div className="w-full overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-black/10">
                  <VideoPlayer src={courseData.courseMediaId} />
                </div>
              </div>
            ) : hasMediaImage ? (
              <div
                className="w-full animate-fade-in-up"
                style={{ animationDelay: "0.15s" }}
              >
                <div className="relative w-full mx-auto overflow-hidden rounded-2xl border border-border/50 bg-muted shadow-sm ring-1 ring-black/5">
                  <img
                    src={courseData.courseMediaId}
                    alt={toTitleCase(courseData.title || t("header.courseMediaAlt", { course }))}
                    className="w-full max-h-screen-60 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              </div>
            ) : hasBannerImage ? (
              <div
                className="w-full animate-fade-in-up"
                style={{ animationDelay: "0.15s" }}
              >
                <img
                  src={courseData.courseBannerMediaId}
                  alt={toTitleCase(courseData.title || t("header.courseBannerAlt", { course }))}
                  className="w-full max-h-reg-300 rounded-xl object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <playIllustrations.Learning className="pointer-events-none absolute bottom-2 end-2 z-20 hidden h-28 w-auto text-primary-300 opacity-30 [.ui-play_&]:!block" />
    </div>
  );
};
