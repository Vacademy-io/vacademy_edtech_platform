/**
 * DashboardHero — the inverted-fold hero band for DEFAULT and VIBRANT modes.
 *
 * Priority order inside the hero:
 *   1. Live/imminent class banner (session live now or starting within 60 min)
 *   2. First-run onboarding (no progress anywhere)
 *   3. Returning learner — point back at courses to pick up where they left off
 *   4. Loading skeleton while the study library hydrates
 *
 * The "Continue learning" resume band lives only on the courses page
 * (study-library/courses HeroSection); the dashboard no longer duplicates it.
 *
 * Play mode gets its own divergent hero elsewhere — this component is only
 * rendered for default/vibrant and must simply not break under .ui-play.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  VideoCamera,
  ClipboardText,
  UserCircle,
  CaretRight,
  Sparkle,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { playIllustrations } from "@/assets/play-illustrations";

export interface DashboardHeroProps {
  userName: string | null;
  /** Upcoming sessions, soonest first (live sessions may be included too). */
  liveSessions: SessionDetails[] | undefined;
  isLoadingLive: boolean;
  /** Any course percentage_completed > 0 — splits first-run from returning. */
  hasAnyProgress: boolean;
  studyLibraryLoaded: boolean;
  onJoinSession: (session: SessionDetails) => void;
  /**
   * The "gettingStarted" dashboard widget flag. When false the first-run
   * onboarding checklist is suppressed and a learner with no progress falls
   * through to the returning-learner branch — which still surfaces a live /
   * imminent class banner, so hiding the checklist never costs a learner the
   * Join button. Optional and defaults to true so existing callers behave
   * exactly as before.
   */
  showGettingStarted?: boolean;
}

// ── Timing helpers ───────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** A session starting within this window earns the imminent banner. */
const IMMINENT_WINDOW_MS = 60 * MINUTE_MS;

function toSessionDate(
  meetingDate: string,
  time: string,
  timezone?: string,
): Date {
  if (timezone) {
    return convertSessionTimeToUserTimezone(meetingDate, time, timezone);
  }
  return new Date(`${meetingDate}T${time}`);
}

interface BannerSession {
  session: SessionDetails;
  isLive: boolean;
  /** Whole minutes until start; 0 when live. */
  minutesUntilStart: number;
}

/** Pick the banner session: any live session wins, else the soonest one
 *  starting within the imminent window. */
function resolveBannerSession(
  sessions: SessionDetails[] | undefined,
  nowMs: number,
): BannerSession | null {
  if (!sessions || sessions.length === 0) return null;

  let imminent: BannerSession | null = null;
  let imminentStartMs = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    const start = toSessionDate(
      session.meeting_date,
      session.start_time,
      session.timezone,
    );
    const startMs = start.getTime();
    if (Number.isNaN(startMs)) continue;

    let end = toSessionDate(
      session.meeting_date,
      session.last_entry_time,
      session.timezone,
    );
    let endMs = end.getTime();
    if (Number.isNaN(endMs)) endMs = startMs + HOUR_MS;
    // last_entry_time can roll past midnight relative to start_time.
    if (endMs < startMs) endMs += DAY_MS;

    if (nowMs >= startMs && nowMs <= endMs) {
      return { session, isLive: true, minutesUntilStart: 0 };
    }
    if (
      startMs > nowMs &&
      startMs - nowMs <= IMMINENT_WINDOW_MS &&
      startMs < imminentStartMs
    ) {
      imminentStartMs = startMs;
      imminent = {
        session,
        isLive: false,
        minutesUntilStart: Math.max(
          1,
          Math.ceil((startMs - nowMs) / MINUTE_MS),
        ),
      };
    }
  }

  return imminent;
}

// ── Band shell (shared visual language across all hero states) ──────────────

/** Quiet borderless band on default; tenant-primary wash + 4px top rail on
 *  vibrant (primary tokens only — never fixed pastels). Used by the slim
 *  states (loading, live-only). */
const bandClassName = cn(
  "relative w-full overflow-hidden rounded-2xl bg-muted/40 p-5 sm:p-8",
  "[.ui-vibrant_&]:bg-primary-50 dark:[.ui-vibrant_&]:bg-primary-500/10",
  "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300",
);

/** First-run band: a soft tenant-primary gradient with real presence (the
 *  onboarding moment is the fold), still tasteful in default. */
const firstRunBand = cn(
  "relative w-full overflow-hidden rounded-2xl border border-primary/15 p-5 sm:p-8",
  "bg-gradient-to-br from-primary/5 via-background to-background",
  "[.ui-vibrant_&]:from-primary-50 [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300",
  // Corporate: a plain white card — no wash, no glow. Linear/Vercel-register
  // dashboards earn attention with hierarchy, not colour; the earlier
  // brand-wash version still read as a consumer onboarding banner.
  "[.ui-corporate_&]:bg-none [.ui-corporate_&]:bg-card [.ui-corporate_&]:border-border [.ui-corporate_&]:shadow-xs [.ui-corporate_&]:p-5 [.ui-corporate_&]:sm:p-6",
);

// ── Component ────────────────────────────────────────────────────────────────

export function DashboardHero({
  userName,
  liveSessions,
  isLoadingLive,
  hasAnyProgress,
  studyLibraryLoaded,
  onJoinSession,
  showGettingStarted = true,
}: DashboardHeroProps): JSX.Element | null {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Keep "Starts in Xm" current while sessions are on screen.
  useEffect(() => {
    if (!liveSessions || liveSessions.length === 0) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [liveSessions]);

  const banner = useMemo(
    () => (isLoadingLive ? null : resolveBannerSession(liveSessions, nowMs)),
    [liveSessions, isLoadingLive, nowMs],
  );

  const coursesPlural = getTerminologyPlural(
    ContentTerms.Course,
    SystemTerms.Course,
  );
  const liveClassLabel = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession,
  );

  // 4. LOADING — skeleton matching the band's shape.
  if (!studyLibraryLoaded) {
    return (
      <section aria-busy="true" aria-label={t("dashboardHero.loadingAria")} className={bandClassName}>
        <div className="flex flex-col gap-stack">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-2 h-9 w-full rounded-md sm:w-40" />
        </div>
      </section>
    );
  }

  const goToCourses = () => navigate({ to: "/study-library/courses" });

  // 1. LIVE/IMMINENT CLASS BANNER — slim row above the main band content.
  const liveBanner = banner ? (
    <div
      className={cn(
        "mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-background/80 px-3 py-2.5",
        "[.ui-vibrant_&]:bg-background/70",
      )}
    >
      {banner.isLive ? (
        <span aria-hidden="true" className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-danger-500" />
        </span>
      ) : (
        <VideoCamera
          size={16}
          weight="duotone"
          className="shrink-0 text-primary"
        />
      )}
      <p className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
        {banner.session.title || liveClassLabel}
      </p>
      <span
        className={cn(
          "whitespace-nowrap text-caption",
          banner.isLive
            ? "font-semibold text-danger-600"
            : "text-muted-foreground",
        )}
      >
        {banner.isLive
          ? t("dashboardHero.liveNow")
          : t("dashboardHero.startsInMinutes", { minutes: banner.minutesUntilStart })}
      </span>
      <Button
        size="sm"
        onClick={() => onJoinSession(banner.session)}
        aria-label={t("dashboardHero.joinAria", { title: banner.session.title || liveClassLabel })}
        className="gap-1.5"
      >
        <VideoCamera size={14} weight="fill" />
        {t("hero.join")}
      </Button>
    </div>
  ) : null;

  // 2. FIRST-RUN — no progress anywhere. An onboarding checklist so the
  // learner always has a clear next action instead of a barren empty state.
  // Institutes that don't want it turn off the "gettingStarted" widget; the
  // learner then falls through to (3), keeping any live-class banner.
  if (!hasAnyProgress && showGettingStarted) {
    const steps = [
      {
        icon: BookOpen,
        label: t("dashboardHero.browseCoursesLabel", { courses: coursesPlural.toLocaleLowerCase() }),
        hint: t("dashboardHero.browseCoursesHint", {
          slide: getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase(),
        }),
        onClick: goToCourses,
        primary: true,
      },
      {
        icon: ClipboardText,
        label: t("dashboardHero.tryAssessmentLabel"),
        hint: t("dashboardHero.tryAssessmentHint"),
        onClick: () => navigate({ to: "/assessment/examination" }),
        primary: false,
      },
      {
        icon: UserCircle,
        label: t("dashboardHero.completeProfileLabel"),
        hint: t("dashboardHero.completeProfileHint"),
        onClick: () => navigate({ to: "/user-profile" }),
        primary: false,
      },
    ];

    return (
      <section className={firstRunBand}>
        {/* Signature decorative mesh — tenant-primary, tasteful. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -end-16 -top-20 size-52 rounded-full bg-primary/10 blur-3xl [.ui-corporate_&]:hidden"
        />
        <div className="relative">
          {liveBanner}
          <div className="flex flex-col gap-section lg:flex-row lg:items-center lg:justify-between">
            {/* Left: greeting + checklist */}
            <div className="min-w-0 flex-1 space-y-5">
              <div className="flex items-start gap-3">
                <span className="hidden size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex [.ui-corporate_&]:hidden">
                  <Sparkle size={22} weight="fill" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-caption font-semibold uppercase tracking-wider text-primary [.ui-corporate_&]:normal-case [.ui-corporate_&]:tracking-normal [.ui-corporate_&]:font-medium [.ui-corporate_&]:text-muted-foreground">
                    {userName ? t("dashboardHero.welcomeWithName", { name: userName }) : t("dashboardHero.welcome")}
                  </p>
                  <h2 className="text-display-sm tracking-tight text-foreground [.ui-corporate_&]:text-h3 [.ui-corporate_&]:font-semibold">
                    {t("dashboardHero.getStartedTitle")}
                  </h2>
                  <p className="text-body text-muted-foreground">
                    {t("dashboardHero.getStartedSubtitle")}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 [.ui-corporate_&]:space-y-0 [.ui-corporate_&]:divide-y [.ui-corporate_&]:divide-border [.ui-corporate_&]:overflow-hidden [.ui-corporate_&]:rounded-lg [.ui-corporate_&]:border [.ui-corporate_&]:border-border">
                {steps.map((step, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={step.onClick}
                    className={cn(
                      "group/step flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-all duration-base ease-out-soft",
                      "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                      // Corporate: rows of one list — flat, hover tints the row.
                      "[.ui-corporate_&]:rounded-none [.ui-corporate_&]:border-0 [.ui-corporate_&]:bg-transparent [.ui-corporate_&]:py-2.5 [.ui-corporate_&]:hover:translate-y-0 [.ui-corporate_&]:hover:bg-muted/60 [.ui-corporate_&]:hover:shadow-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                      step.primary
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-background/70",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                        step.primary
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary/10 text-primary group-hover/step:bg-primary/20",
                        "[.ui-corporate_&]:size-8 [.ui-corporate_&]:border [.ui-corporate_&]:border-border [.ui-corporate_&]:bg-card [.ui-corporate_&]:text-muted-foreground [.ui-corporate_&]:group-hover/step:bg-card",
                      )}
                    >
                      <step.icon size={18} weight="duotone" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-foreground [.ui-corporate_&]:font-medium">
                        {step.label}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {step.hint}
                      </span>
                    </span>
                    <CaretRight
                      size={16}
                      className="shrink-0 text-muted-foreground transition-transform duration-300 group-hover/step:translate-x-0.5 group-hover/step:text-primary"
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Right: signature illustration fills the whitespace (currentColor
                follows the tenant primary). Desktop only. */}
            {/* Decorative only, so Corporate drops it rather than swapping in a
                different illustration — a restrained enterprise surface is
                typographic, and the honest corporate treatment of a spot
                illustration is none. */}
            <playIllustrations.OnlineLearning
              aria-hidden="true"
              className="hidden h-44 w-auto max-w-xs shrink-0 object-contain text-primary/70 lg:block [.ui-corporate_&]:lg:hidden"
            />
          </div>
        </div>
      </section>
    );
  }

  // 3. RETURNING LEARNER — has progress; the "Continue learning" resume band
  // now lives only on the courses page, so the dashboard hero stays empty here
  // (just surface a live/imminent class if there is one).
  return banner ? <section className={bandClassName}>{liveBanner}</section> : null;

  // Kept for reference — the old "Jump back in" returning-learner band.
  // return (
  //   <section className={bandClassName}>
  //     {liveBanner}
  //     <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
  //       <div className="min-w-0 flex-1 space-y-1.5">
  //         <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
  //           {userName ? `Welcome back, ${userName}` : "Welcome back"}
  //         </p>
  //         <h2 className="text-display-sm text-foreground">Jump back in</h2>
  //         <p className="text-body text-muted-foreground">
  //           Open your {coursesPlural.toLocaleLowerCase()} to pick up where you
  //           left off.
  //         </p>
  //       </div>
  //       <Button
  //         onClick={goToCourses}
  //         className="w-full gap-2 sm:w-auto md:shrink-0"
  //       >
  //         <BookOpen size={16} weight="fill" />
  //         Browse {coursesPlural}
  //       </Button>
  //     </div>
  //   </section>
  // );
}
