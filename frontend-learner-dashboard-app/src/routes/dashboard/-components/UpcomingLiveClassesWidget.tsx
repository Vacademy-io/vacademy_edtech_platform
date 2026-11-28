import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock } from "@phosphor-icons/react";
import { CaretRight, VideoCamera } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import {
  convertSessionTimeToUserTimezone,
  formatSessionTimeInUserTimezone,
} from "@/utils/timezone";
import { cn } from "@/lib/utils";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconLiveSessions from "@/assets/cleaner-play/icon-live-sessions.webp";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useFunTheme } from "@/hooks/use-fun-theme";

interface UpcomingLiveClassesWidgetProps {
  liveSessions: SessionDetails[];
  upcomingSessions: SessionDetails[];
  isLoading: boolean;
  onJoinSession: (session: SessionDetails) => void;
}

/**
 * Filter upcoming sessions to only those within the next 24 hours.
 * Also includes any currently-live sessions.
 */
function getSessionsWithin24Hours(
  liveSessions: SessionDetails[],
  upcomingSessions: SessionDetails[]
): { live: SessionDetails[]; upcoming: SessionDetails[] } {
  const now = new Date();
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = upcomingSessions.filter((s) => {
    try {
      const sessionTime = s.timezone
        ? convertSessionTimeToUserTimezone(
            s.meeting_date,
            s.start_time,
            s.timezone
          )
        : new Date(`${s.meeting_date}T${s.start_time}`);
      return sessionTime <= oneDayFromNow;
    } catch {
      // Fallback: try raw date parse
      const fallback = new Date(`${s.meeting_date}T${s.start_time}`);
      return fallback <= oneDayFromNow;
    }
  });

  return { live: liveSessions, upcoming };
}

function formatRelativeTime(
  meetingDate: string,
  startTime: string,
  timezone: string,
  t: TFunction<"dashboard">
): string {
  try {
    const sessionTime = timezone
      ? convertSessionTimeToUserTimezone(meetingDate, startTime, timezone)
      : new Date(`${meetingDate}T${startTime}`);
    const now = new Date();
    const diffMs = sessionTime.getTime() - now.getTime();

    if (diffMs < 0) return t("liveClasses.relativeNow");
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return t("liveClasses.relativeInMinutes", { minutes: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24)
      return t("liveClasses.relativeInHoursMinutes", {
        hours: diffHours,
        minutes: diffMins % 60,
      });
    return t("liveClasses.relativeInHours", { hours: diffHours });
  } catch {
    return "";
  }
}

export function UpcomingLiveClassesWidget({
  liveSessions,
  upcomingSessions,
  isLoading,
  onJoinSession,
}: UpcomingLiveClassesWidgetProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const isCleanerPlay = useCleanerPlayTheme();
  // Fun: the next class is a Today card (and a live one sits above the hero), so
  // this list would only repeat it.
  const isFun = useFunTheme();
  if (isFun) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-5 w-40" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 border rounded-lg"
            >
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const { live, upcoming } = getSessionsWithin24Hours(
    liveSessions || [],
    upcomingSessions || []
  );

  // Don't render the widget if no sessions within 24 hours
  if (live.length === 0 && upcoming.length === 0) {
    return null;
  }

  const totalCount = live.length + upcoming.length;

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow hover:shadow-md",
        // Vibrant: white card with a tenant-primary top rail (no fixed hues)
        "[.ui-vibrant_&]:border-primary-100",
        "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300",
        // Play: pastel navy-soft card, quiet chrome (matches the reskin)
        "[.ui-play_&]:bg-play-navy-soft [.ui-play_&]:rounded-play-card-sm",
        "[.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:shadow-play-soft-card",
        "[.ui-play_&]:hover:shadow-play-soft-card",
        "[.ui-play_&]:flex [.ui-play_&]:flex-row [.ui-play_&]:items-stretch",
        // Cleaner Play: the shared cp-card shell (rule is scoped to
        // .ui-cleaner-play, so this class is inert on other skins)
        "cp-card"
      )}
    >
      <div className="[.ui-play_&]:flex-1 [.ui-play_&]:min-w-0">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          {isCleanerPlay ? (
            <img
              src={iconLiveSessions}
              alt=""
              aria-hidden="true"
              className="h-11 w-11 object-contain"
            />
          ) : (
            <div
              className={cn(
                "p-2 bg-secondary-100 dark:bg-secondary-100 rounded-lg text-secondary-500 dark:text-secondary-500",
                // Vibrant: primary icon chip (dark-prefixed too so the default
                // dark: secondary classes can't out-rank it in dark mode)
                "[.ui-vibrant_&]:bg-primary-100 [.ui-vibrant_&]:text-primary-500",
                "dark:[.ui-vibrant_&]:bg-primary-100 dark:[.ui-vibrant_&]:text-primary-500",
                // Play icon: white chip with navy ink on the pastel surface
                "[.ui-play_&]:bg-white/70 [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:rounded-xl"
              )}
            >
              <VideoCamera size={18} />
            </div>
          )}
          <div>
            <CardTitle
              className={cn(
                "text-base font-semibold",
                "[.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:font-black",
                "cp-heading"
              )}
            >
              {t("liveClasses.title", {
                liveClasses: getTerminologyPlural(
                  ContentTerms.LiveSession,
                  SystemTerms.LiveSession
                ),
              })}
            </CardTitle>
            <p
              className={cn(
                "text-xs text-muted-foreground mt-0.5",
                "[.ui-play_&]:text-play-ink/60 [.ui-play_&]:font-bold",
                "cp-muted"
              )}
            >
              {t("liveClasses.countInNext24h", { count: totalCount })}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-xs",
            "[.ui-play_&]:text-play-ink/60 [.ui-play_&]:hover:text-play-ink",
            "[.ui-play_&]:hover:bg-white/60",
            "[.ui-play_&]:focus-visible:ring-2 [.ui-play_&]:focus-visible:ring-play-ink/30"
          )}
          onClick={() => navigate({ to: "/study-library/live-class" })}
        >
          {t("liveClasses.viewAll")} <CaretRight size={14} className="ms-1" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Live sessions */}
        {live.map((session, index) => (
          <div
            key={`live-${session.session_id}-${index}`}
            className={cn(
              "flex flex-col items-start gap-2 p-3 border rounded-lg bg-green-50/60 dark:bg-green-900/10 border-green-200 dark:border-green-900/50",
              "[.ui-play_&]:bg-white/60 [.ui-play_&]:border-transparent [.ui-play_&]:rounded-xl",
              "[.ui-cleaner-play_&]:border-cp-border"
            )}
          >
            <div className="flex w-full items-center gap-3 min-w-0">
              <div
                className={cn(
                  "p-2 bg-green-100 dark:bg-green-900/30 rounded-lg text-green-700 dark:text-green-400 shrink-0",
                  "[.ui-play_&]:bg-white [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:rounded-xl"
                )}
              >
                <VideoCamera size={16} />
              </div>
              <div className="min-w-0">
                <h4
                  className={cn(
                    "font-medium text-sm truncate",
                    "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold"
                  )}
                >
                  {session.title}
                </h4>
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    "[.ui-play_&]:text-play-ink/60"
                  )}
                >
                  {formatSessionTimeInUserTimezone(
                    session.meeting_date,
                    session.start_time,
                    session.timezone
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="default"
                className={cn(
                  "bg-green-600 hover:bg-green-700 text-xs",
                  "[.ui-play_&]:bg-play-danger [.ui-play_&]:hover:bg-play-danger",
                  "[.ui-play_&]:text-white [.ui-play_&]:border-0",
                  "[.ui-play_&]:shadow-play-2d-danger"
                )}
              >
                <span
                  aria-hidden="true"
                  className="hidden [.ui-play_&]:inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse me-1"
                />
                {t("liveClasses.liveNowBadge")}
              </Badge>
              <Button
                size="sm"
                onClick={() => onJoinSession(session)}
                className={cn(
                  "[.ui-play_&]:bg-play-navy [.ui-play_&]:text-white",
                  "[.ui-play_&]:hover:bg-play-navy [.ui-play_&]:font-black",
                  "[.ui-play_&]:rounded-xl [.ui-play_&]:shadow-play-2d-navy",
                  "[.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:shadow-none",
                  "[.ui-play_&]:focus-visible:ring-2 [.ui-play_&]:focus-visible:ring-play-ink/30"
                )}
              >
                {t("liveClasses.join")}
              </Button>
            </div>
          </div>
        ))}

        {/* Upcoming sessions (next 24h) */}
        {upcoming.slice(0, 4).map((session, index) => {
          const relTime = formatRelativeTime(
            session.meeting_date,
            session.start_time,
            session.timezone,
            t
          );

          return (
            <div
              key={`upcoming-${session.session_id}-${index}`}
              className={cn(
                "flex flex-col items-start gap-2 p-3 border rounded-lg",
                "[.ui-play_&]:bg-white/60 [.ui-play_&]:border-transparent [.ui-play_&]:rounded-xl",
                "[.ui-cleaner-play_&]:border-cp-border"
              )}
            >
              <div className="flex w-full items-center gap-3 min-w-0">
                <div
                  className={cn(
                    "p-2 bg-secondary-100 dark:bg-secondary-100 rounded-lg text-secondary-500 dark:text-secondary-500 shrink-0",
                    "[.ui-play_&]:bg-white [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:rounded-xl"
                  )}
                >
                  <Calendar weight="duotone" size={16} />
                </div>
                <div className="min-w-0">
                  <h4
                    className={cn(
                      "font-medium text-sm truncate",
                      "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold"
                    )}
                  >
                    {session.title}
                  </h4>
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground min-w-0",
                      "[.ui-play_&]:text-play-ink/60"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                      <Clock weight="duotone" size={12} className="shrink-0" />
                      <span className="truncate">
                        {formatSessionTimeInUserTimezone(
                          session.meeting_date,
                          session.start_time,
                          session.timezone
                        )}
                      </span>
                    </span>
                    {relTime && (
                      <span
                        className={cn(
                          "whitespace-nowrap text-secondary-500 dark:text-secondary-500 font-medium",
                          "[.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:font-bold"
                        )}
                      >
                        ({relTime})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Badge
                variant="secondary"
                className={cn(
                  "bg-secondary-100 text-secondary-500 border-secondary-200 dark:bg-secondary-100 dark:text-secondary-500 dark:border-secondary-200 text-xs shrink-0",
                  "[.ui-play_&]:bg-white [.ui-play_&]:text-play-navy-soft-ink [.ui-play_&]:border-transparent"
                )}
              >
                {t("liveClasses.upcomingBadge")}
              </Badge>
            </div>
          );
        })}
      </CardContent>
      </div>
    </Card>
  );
}
