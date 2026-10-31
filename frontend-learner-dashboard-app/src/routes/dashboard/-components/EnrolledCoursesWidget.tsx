import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  CaretRight,
  CheckCircle,
  Clock,
  GraduationCap,
  Play,
  Sparkle,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { getInstituteId } from "@/constants/helper";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import {
  fetchEnrolledCourses,
  type EnrolledCourse,
} from "@/services/enrolled-courses";
import {
  getResumeForCourse,
  resumeSearchParams,
  RESUME_ROUTE,
} from "@/services/resume-thread";
import { formatMinutesHuman } from "@/utils/courseTime";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import LocalStorageUtils from "@/utils/localstorage";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import emptyLearning from "@/assets/cleaner-play/empty-learning.webp";

/**
 * How many courses get their own widget before the rest go behind "View all".
 * Each course is a full-width dashboard widget now, so this is a vertical-space
 * budget: a learner enrolled in twenty courses must not push every other widget
 * off the page.
 */
const MAX_WIDGETS = 4;

/**
 * The dashboard's own inter-widget rhythm. These course widgets are siblings of
 * the real dashboard widgets, so they have to breathe exactly like them —
 * see the main column in routes/dashboard/index.tsx.
 */
const COLUMN_RHYTHM = "space-y-4 lg:space-y-6";

type Skin = "play" | "cleanerPlay" | "default";

/**
 * Per-course colour. `thumbBg`/`thumbInk` are stated separately from `fill`
 * because the progress colour is not always legible as a tile background — the
 * gold roles in both play skins wash out a white initial.
 */
interface Tint {
  surface: string;
  ink: string;
  fill: string;
  thumbBg: string;
  thumbInk: string;
}

interface SkinTokens {
  /**
   * Outer chrome of a STANDALONE widget — matched to AttendanceWidget, which is
   * the house reference for a hand-built dashboard widget in each skin.
   */
  shell: string;
  /**
   * Whether `surface` may be applied to the shell. Cleaner Play's `.cp-card`
   * rule sets `background` at specificity 0-2-0, which beats any Tailwind
   * `bg-*` utility (0-1-0) whatever the layer order — a tint there would be
   * silently dropped, so that skin carries colour on the cover tile and
   * progress bar instead.
   */
  tintShell: boolean;
  name: string;
  chip: string;
  divider: string;
  track: string;
  percent: string;
  cta: string;
  cover: string;
  coverText: string;
  emptyText: string;
  viewAll: string;
  /** Neutral block colour for the loading placeholder. */
  skeletonFill: string;
  palette: ReadonlyArray<Tint>;
  completed: Tint;
}

const SKINS: Record<Skin, SkinTokens> = {
  play: {
    shell:
      "rounded-play-card-sm border border-border p-4 shadow-play-soft-card",
    tintShell: true,
    name: "line-clamp-2 break-words text-h3 font-black leading-snug text-play-ink",
    chip: "inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-3xs font-bold uppercase tracking-wide text-play-ink/70",
    divider: "border-white/70",
    track: "h-2.5 overflow-hidden rounded-full bg-white/70",
    percent: "text-caption font-black tabular-nums",
    cta: "inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-3xs font-black uppercase tracking-wide shadow-sm",
    cover: "rounded-xl",
    coverText: "text-h1",
    emptyText: "text-body font-black leading-tight text-play-ink",
    viewAll:
      "inline-flex items-center gap-1 text-3xs font-black uppercase tracking-wide text-play-ink/60 transition-colors hover:text-play-ink",
    skeletonFill: "bg-play-ink/5",
    palette: [
      { surface: "bg-play-info-soft", ink: "text-play-info-soft-ink", fill: "bg-play-info", thumbBg: "bg-play-info-soft-ink", thumbInk: "text-white" },
      { surface: "bg-play-accent-soft", ink: "text-play-accent-soft-ink", fill: "bg-play-accent", thumbBg: "bg-play-accent-soft-ink", thumbInk: "text-white" },
      { surface: "bg-play-gold-soft", ink: "text-play-gold-soft-ink", fill: "bg-play-gold", thumbBg: "bg-play-gold-soft-ink", thumbInk: "text-white" },
      { surface: "bg-play-navy-soft", ink: "text-play-navy-soft-ink", fill: "bg-play-navy", thumbBg: "bg-play-navy-soft-ink", thumbInk: "text-white" },
    ],
    completed: {
      surface: "bg-play-success-soft",
      ink: "text-play-success-soft-ink",
      fill: "bg-play-success",
      thumbBg: "bg-play-success-soft-ink",
      thumbInk: "text-white",
    },
  },
  cleanerPlay: {
    shell: "cp-card p-4",
    tintShell: false,
    name: "line-clamp-2 break-words text-h3 font-semibold leading-snug text-cp-ink",
    chip: "inline-flex items-center gap-1 rounded-full bg-cp-bg-deep px-2.5 py-1 text-3xs font-medium text-cp-muted",
    divider: "border-cp-border",
    track: "h-2 overflow-hidden rounded-full bg-cp-bg-deep",
    percent: "text-caption font-semibold tabular-nums",
    cta: "inline-flex items-center justify-center gap-1.5 rounded-full border border-cp-border px-3 py-1.5 text-3xs font-semibold uppercase tracking-wide",
    cover: "rounded-xl",
    coverText: "text-h1",
    emptyText: "text-body font-semibold text-cp-ink",
    viewAll:
      "inline-flex items-center gap-1 text-3xs font-semibold uppercase tracking-wide text-cp-terracotta",
    skeletonFill: "bg-cp-bg-deep",
    palette: [
      { surface: "", ink: "text-cp-sage", fill: "bg-cp-sage", thumbBg: "bg-cp-sage", thumbInk: "text-white" },
      { surface: "", ink: "text-cp-terracotta", fill: "bg-cp-terracotta", thumbBg: "bg-cp-terracotta", thumbInk: "text-white" },
      // cp-gold (#D9A441) is too light to carry a white initial — dark letter. design-lint-ignore: documents the token value, not a used colour.
      { surface: "", ink: "text-cp-gold", fill: "bg-cp-gold", thumbBg: "bg-cp-gold", thumbInk: "text-cp-ink" },
      { surface: "", ink: "text-cp-sage", fill: "bg-cp-sage", thumbBg: "bg-cp-sage", thumbInk: "text-white" },
    ],
    completed: {
      surface: "",
      ink: "text-cp-sage",
      fill: "bg-cp-sage",
      thumbBg: "bg-cp-sage",
      thumbInk: "text-white",
    },
  },
  default: {
    // The shadcn <Card> class list, inlined: keeping the chrome on the shell
    // (rather than wrapping in <Card>) means the hover lift moves the card.
    shell: "rounded-xl border bg-card text-card-foreground shadow p-4",
    tintShell: false,
    name: "line-clamp-2 break-words text-base font-semibold leading-snug text-neutral-700",
    chip: "inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500",
    divider: "border-neutral-100",
    track: "h-2 overflow-hidden rounded-full bg-neutral-100",
    percent: "text-sm font-semibold tabular-nums",
    cta: "inline-flex items-center justify-center gap-1.5 text-xs font-medium",
    cover: "rounded-lg",
    coverText: "text-h1",
    emptyText: "text-caption text-neutral-500",
    viewAll:
      "inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700",
    skeletonFill: "bg-neutral-100",
    palette: [
      { surface: "", ink: "text-primary-600", fill: "bg-primary-500", thumbBg: "bg-primary-500", thumbInk: "text-white" },
    ],
    completed: {
      surface: "",
      ink: "text-success-600",
      fill: "bg-success-500",
      thumbBg: "bg-success-500",
      thumbInk: "text-white",
    },
  },
};

/** Loads and caches the signed preview-image URLs for the listed courses. */
function useCourseThumbnails(courses: EnrolledCourse[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Joined into a primitive so the effect doesn't re-run on every render of a
  // freshly-mapped (but identical) array.
  const idKey = courses.map((c) => c.previewImageId).join(",");

  useEffect(() => {
    let alive = true;
    const ids = Array.from(
      new Set(courses.map((c) => c.previewImageId).filter(Boolean)),
    );
    if (ids.length === 0) return;

    Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getPublicUrlWithoutLogin(id)] as const;
        } catch {
          // A missing/expired media id just means "render the fallback tile".
          return [id, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of pairs) if (url) next[id] = url;
        return next;
      });
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return urls;
}

/**
 * Learner dashboard: ONE STANDALONE WIDGET PER ENROLLED COURSE.
 *
 * There is deliberately no container card around these — four enrolled courses
 * render as four separate widgets sitting directly in the dashboard flow,
 * spaced on the column's own rhythm so they are indistinguishable from the
 * other first-class widgets around them. The only wrapper is an unstyled
 * spacing div, which paints nothing.
 */
export const EnrolledCoursesWidget: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();
  const skin: Skin = isPlay ? "play" : isCleanerPlay ? "cleanerPlay" : "default";
  const s = SKINS[skin];

  const [courses, setCourses] = useState<EnrolledCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Student Display Settings → allCourses.showAllEnrolledOnDashboard: every
  // enrolled course instead of the first MAX_WIDGETS. Off by default.
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    (async () => {
      try {
        const instituteId = await getInstituteId();
        if (!instituteId) throw new Error("no institute");
        const settings = await getStudentDisplaySettings(false).catch(() => null);
        const all = settings?.allCourses?.showAllEnrolledOnDashboard === true;
        const rows = await fetchEnrolledCourses(instituteId, controller.signal, { all });
        if (alive) {
          setShowAll(all);
          setCourses(rows);
        }
      } catch {
        // Widget-level failure is silent: the dashboard keeps rendering and
        // these cards take themselves off the page rather than showing an
        // error box.
        if (alive) setFailed(true);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const visible = showAll ? courses : courses.slice(0, MAX_WIDGETS);
  const thumbnails = useCourseThumbnails(visible);

  const coursesLabel = getTerminologyPlural(
    ContentTerms.Course,
    SystemTerms.Course,
  );

  const openCourse = useCallback(
    (course: EnrolledCourse) => {
      // Resume straight into the last-visited slide when this device has a
      // thread for the course; otherwise the course-details page.
      const resume = getResumeForCourse(course.id);
      if (resume && course.state !== "COMPLETED") {
        navigate({
          to: RESUME_ROUTE,
          search: resumeSearchParams(resume) as {
            courseId: string;
            levelId?: string;
            subjectId: string;
            moduleId: string;
            chapterId: string;
            slideId: string;
            sessionId: string;
          },
        });
        return;
      }

      try {
        // Course details reads this as a fallback when its own percentage
        // fetch hasn't landed yet — same handoff the catalogue cards use.
        LocalStorageUtils.set(`COURSE_PCT_${course.id}`, {
          value: course.percentComplete,
          ts: Date.now(),
        });
      } catch {
        // Storage full / private mode: the details page falls back to its own
        // fetch.
      }

      navigate({
        to: "/study-library/courses/course-details",
        search: {
          courseId: course.id,
          packageSessionId: course.packageSessionId,
          selectedTab: course.state === "COMPLETED" ? "COMPLETED" : "PROGRESS",
          percentageCompleted: course.percentComplete,
        },
      });
    },
    [navigate],
  );

  const viewAll = useCallback(() => {
    navigate({ to: "/study-library/courses" });
  }, [navigate]);

  /** One course = one standalone dashboard widget. */
  const renderCourseWidget = (course: EnrolledCourse, i: number) => {
    const tint =
      course.state === "COMPLETED"
        ? s.completed
        : s.palette[i % s.palette.length];
    const url = thumbnails[course.previewImageId];
    const ctaLabel =
      course.state === "COMPLETED"
        ? t("enrolledCourses.cta.review")
        : course.state === "IN_PROGRESS"
          ? t("enrolledCourses.cta.continue")
          : t("enrolledCourses.cta.start");
    const CtaIcon =
      course.state === "COMPLETED"
        ? CheckCircle
        : course.state === "NOT_STARTED"
          ? Sparkle
          : Play;

    // Detail chips: only the ones this course actually has. The level is
    // already stripped of the platform's "DEFAULT" scaffold name upstream, so
    // an empty string here means "this course has no meaningful level".
    // Deliberately no instructor chip — the user asked for the author name out.
    const chips: Array<{ key: string; icon: typeof Clock; label: string }> = [];
    if (course.levelName)
      chips.push({ key: "level", icon: GraduationCap, label: course.levelName });
    if (course.readTimeInMinutes > 0)
      chips.push({
        key: "time",
        icon: Clock,
        label: formatMinutesHuman(course.readTimeInMinutes),
      });

    const body = (
      <>
        {/* Cover: the institute's uploaded artwork, shown whole. 16:9 box +
            object-contain so nothing is cropped no matter what ratio was
            uploaded; a full-width banner on phones, a media panel on desktop. */}
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className={cn(
              "aspect-video w-full shrink-0 bg-white object-contain ring-1 ring-black/5 sm:w-44",
              s.cover,
            )}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              "flex aspect-video w-full shrink-0 items-center justify-center font-black uppercase sm:w-44",
              s.cover,
              s.coverText,
              tint.thumbBg,
              tint.thumbInk,
            )}
          >
            {course.name.trim().charAt(0) || "?"}
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className={s.name}>{course.name}</span>
          {chips.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5">
              {chips.map(({ key, icon: Icon, label }) => (
                <span key={key} className={cn(s.chip, "max-w-full")}>
                  <Icon size={12} weight="bold" className="shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
              ))}
            </span>
          )}
        </span>

        {/* Progress + action rail: under the text on phones, a fixed column on
            desktop so the bar never stretches into a hairline across the full
            width of the main column. */}
        <span
          className={cn(
            "flex flex-col gap-2 border-t pt-3 sm:w-52 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0",
            s.divider,
          )}
        >
          <span className="flex items-center gap-2">
            <span className={cn("flex-1", s.track)}>
              <span
                className={cn("block h-full rounded-full", tint.fill)}
                /* design-lint-ignore: dynamic progress percentage */
                style={{ width: `${course.percentComplete}%` }}
              />
            </span>
            <span className={cn(s.percent, tint.ink)}>
              {course.percentComplete}%
            </span>
          </span>
          <span className={cn(s.cta, tint.ink)}>
            <CtaIcon size={13} weight="fill" />
            {ctaLabel}
            <ArrowRight size={13} weight="bold" />
          </span>
        </span>
      </>
    );

    const ariaLabel = t("enrolledCourses.cardAria", {
      course: course.name,
      percent: course.percentComplete,
      action: ctaLabel,
    });

    const shellClass = cn(
      "flex w-full flex-col items-stretch gap-3 text-start transition-transform duration-200 hover:-translate-y-0.5 sm:flex-row sm:items-center sm:gap-4",
      s.shell,
      s.tintShell && tint.surface,
    );

    // The whole widget is the control. Any CTA inside stays a <span> — a
    // <button> nested in a <button> is invalid and hides from screen readers.
    return (
      <button
        key={course.packageSessionId || course.id}
        type="button"
        onClick={() => openCourse(course)}
        aria-label={ariaLabel}
        className={shellClass}
      >
        {body}
      </button>
    );
  };

  // Nothing loaded and nothing to say — stay off the page entirely.
  if (failed && courses.length === 0) return null;

  if (isLoading) {
    // Content-shaped placeholder rather than one pulsing slab. It also keeps
    // `animate-pulse` OFF the card shell on purpose: play-theme.css forces
    // `.ui-play .animate-pulse` to the 14px BUTTON radius with !important, so a
    // pulsing shell would round differently from the card that replaces it.
    const block = cn("animate-pulse rounded-full", s.skeletonFill);
    return (
      <div className={cn(COLUMN_RHYTHM, className)}>
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4",
              s.shell,
            )}
          >
            <div
              className={cn(
                "aspect-video w-full shrink-0 animate-pulse sm:w-44",
                s.cover,
                s.skeletonFill,
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className={cn(block, "h-5 w-2/3")} />
              <div className={cn(block, "h-4 w-1/3")} />
            </div>
            <div className="flex flex-col gap-2 sm:w-52 sm:shrink-0">
              <div className={cn(block, "h-2.5 w-full")} />
              <div className={cn(block, "h-7 w-full")} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (courses.length === 0) {
    const empty = (
      <div className="flex flex-col items-center gap-stack py-2 text-center">
        {skin !== "default" && (
          <img
            src={emptyLearning}
            alt=""
            aria-hidden="true"
            className="h-24 w-24 object-contain"
          />
        )}
        <p className={s.emptyText}>
          {t("enrolledCourses.emptyTitle", { courses: coursesLabel })}
        </p>
        {skin === "play" ? (
          <button
            type="button"
            onClick={viewAll}
            className="inline-flex items-center gap-1.5 rounded-full bg-play-success px-4 py-2 text-caption font-black uppercase tracking-wide text-white shadow-play-2d-success transition-transform active:translate-y-0.5 active:shadow-none"
          >
            <BookOpen size={16} weight="bold" />
            {t("enrolledCourses.browse", { courses: coursesLabel })}
          </button>
        ) : (
          <MyButton
            type="button"
            buttonType="primary"
            scale="small"
            onClick={viewAll}
          >
            <BookOpen size={16} />
            {t("enrolledCourses.browse", { courses: coursesLabel })}
          </MyButton>
        )}
      </div>
    );

    return <section className={cn(s.shell, className)}>{empty}</section>;
  }

  return (
    <div className={cn(COLUMN_RHYTHM, className)}>
      {visible.map(renderCourseWidget)}
      {courses.length > visible.length && (
        // Bare link, not a card: adding a box here would re-introduce exactly
        // the container the widgets were pulled out of.
        <div className="flex justify-end">
          <button type="button" onClick={viewAll} className={s.viewAll}>
            {t("enrolledCourses.viewAll", {
              courses: coursesLabel.toLocaleLowerCase(),
            })}
            <CaretRight size={12} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
};
