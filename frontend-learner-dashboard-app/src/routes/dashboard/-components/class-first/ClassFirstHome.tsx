import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  CalendarBlank,
  CaretRight,
  PlayCircle,
  VideoCamera,
  WarningCircle,
} from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import type { LearnerHomeSummary } from "@/services/learner-home-summary";
import type {
  LearnerRecording,
  PastSessionDetails,
  SessionDetails,
} from "@/routes/study-library/live-class/-types/types";
import { RecordingPlayerDialog } from "@/routes/study-library/live-class/-components/RecordingPlayerDialog";
import { SyllabusProgressWidget } from "@/routes/syllabus-progress/-components/SyllabusProgressWidget";
import {
  formatTime,
  formatWeekdayDate,
  isJoinOpen,
  joinOpensAt,
  pickNextClass,
  relativeDay,
  sessionStart,
  teacherName,
  weeklyPattern,
  type SessionWithBatch,
} from "./class-schedule";

export interface ClassFirstHomeProps {
  /** Live + upcoming classes, as the dashboard loads them for its join flow. */
  sessions: SessionDetails[];
  sessionsLoading: boolean;
  sessionsError: boolean;
  summary: LearnerHomeSummary;
  summaryLoading: boolean;
  /** The dashboard's own join flow (waiting room, attendance mark, BBB / embed / link). */
  onJoin: (session: SessionDetails) => void | Promise<void>;
  /** The institute tracks a syllabus and the learner has one (the syllabus card shows). */
  syllabusOn: boolean;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "Today, 8:00 PM", "Tomorrow, 8:00 PM" or "Mon 30 Nov, 8:00 PM". */
function useWhen() {
  const { t } = useTranslation("dashboard");
  return (date: Date, now: number) => {
    const rel = relativeDay(date, new Date(now));
    const day = rel === "today" ? t("classFirst.today") : rel === "tomorrow" ? t("classFirst.tomorrow") : formatWeekdayDate(date);
    return t("classFirst.dayAtTime", { day, time: formatTime(date) });
  };
}

/** The first recording that can still be played. */
const playableRecording = (session: PastSessionDetails | null | undefined): LearnerRecording | null =>
  session?.recordings?.find((r) => !r.expired) ?? null;

/** Opens a recording the way the Live Class page's past-class card does. */
function useRecordingPlayer() {
  const [active, setActive] = useState<{ recording: LearnerRecording; title: string } | null>(null);
  const play = (recording: LearnerRecording, title: string) => {
    if (recording.playback_type === "BBB") {
      if (recording.url) window.open(recording.url, "_blank", "noopener,noreferrer");
      return;
    }
    setActive({ recording, title });
  };
  const dialog = (
    <RecordingPlayerDialog
      recording={active?.recording ?? null}
      title={active?.title ?? ""}
      open={active !== null}
      onOpenChange={(open) => {
        if (!open) setActive(null);
      }}
    />
  );
  return { play, dialog };
}

function CardEyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-primary-500">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

function NextClassCard(props: ClassFirstHomeProps & { onWatchLast: () => void }) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const now = useNow();
  const when = useWhen();
  const liveClassPlural = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const [joining, setJoining] = useState(false);

  const lastRecorded = props.summary.last_recorded_class ?? null;
  const canWatchLast = playableRecording(lastRecorded) !== null;
  const watchLast = canWatchLast && lastRecorded ? (
    <button
      type="button"
      onClick={props.onWatchLast}
      className="flex min-h-11 items-center gap-2 self-start rounded-md text-body font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
    >
      <PlayCircle size={20} weight="fill" aria-hidden />
      {t("classFirst.watchLast", { date: formatWeekdayDate(new Date(`${lastRecorded.meeting_date}T00:00:00`)) })}
    </button>
  ) : null;

  if (props.sessionsLoading || (props.summaryLoading && props.sessions.length === 0)) {
    return (
      <Card className="h-full" aria-busy="true" aria-label={t("classFirst.loading")}>
        <CardContent className="flex flex-col gap-3 p-card sm:p-card-lg">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-10 w-36" />
        </CardContent>
      </Card>
    );
  }

  const session: SessionWithBatch | null = pickNextClass(props.sessions, props.summary.next_class);

  if (!session) {
    return (
      <Card className="h-full">
        <CardContent className="flex flex-col gap-3 p-card sm:p-card-lg">
          <CardEyebrow icon={<CalendarBlank size={16} weight="bold" aria-hidden />}>{t("classFirst.nextClass")}</CardEyebrow>
          {props.sessionsError ? (
            <p className="flex items-center gap-2 text-body text-muted-foreground" role="alert">
              <WarningCircle size={18} className="shrink-0 text-danger-500" aria-hidden />
              {t("classFirst.loadError")}
            </p>
          ) : (
            <>
              <h2 className="text-h3 font-semibold text-foreground">{t("classFirst.noClassTitle")}</h2>
              <p className="text-body text-muted-foreground">{t("classFirst.noClassBody")}</p>
            </>
          )}
          <MyButton
            type="button"
            buttonType="secondary"
            scale="medium"
            className="self-start"
            onClick={() => navigate({ to: "/study-library/live-class" })}
          >
            {t("classFirst.viewClasses", { liveClasses: liveClassPlural.toLowerCase() })}
            <CaretRight size={16} className="rtl:rotate-180" aria-hidden />
          </MyButton>
          {watchLast}
        </CardContent>
      </Card>
    );
  }

  const start = sessionStart(session);
  const open = isJoinOpen(session, now);
  const opens = joinOpensAt(session);
  const batch = session.package_session_details?.find((d) => d?.package_name || d?.level_name);
  const subject = session.subject && session.subject.toLowerCase() !== "none" ? session.subject : null;
  const title =
    [batch?.package_name, batch?.level_name].filter(Boolean).join(" · ") ||
    subject ||
    getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const teacher = teacherName(session);
  const pattern = weeklyPattern(props.sessions, session.session_id);
  const patternText = pattern
    ? t("classFirst.pattern", {
        days: pattern.days.join(t("classFirst.daysJoiner")),
        time: pattern.time,
      })
    : null;
  const metaLine = [teacher ? t("classFirst.withTeacher", { name: teacher }) : null, patternText]
    .filter(Boolean)
    .join(" · ");
  const opensLabel =
    relativeDay(opens, new Date(now)) === "today" ? formatTime(opens) : when(opens, now);

  const join = async () => {
    setJoining(true);
    try {
      await props.onJoin(session);
    } finally {
      setJoining(false);
    }
  };

  return (
    <Card className="h-full border-primary-100">
      <CardContent className="flex flex-col gap-3 p-card sm:p-card-lg">
        <CardEyebrow icon={<VideoCamera size={16} weight="bold" aria-hidden />}>
          {t("classFirst.nextClass")} · {when(start, now)}
        </CardEyebrow>
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-foreground">
            <bdi>{title}</bdi>
          </h2>
          {metaLine && <p className="text-body text-muted-foreground">{metaLine}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            disable={!open || joining}
            onClick={join}
            aria-describedby={open ? undefined : "class-first-join-opens"}
          >
            <VideoCamera size={18} weight="fill" aria-hidden />
            {t("classFirst.join")}
          </MyButton>
          {!open && (
            <span id="class-first-join-opens" className="text-caption text-muted-foreground">
              {t("classFirst.opensAt", { time: opensLabel })}
            </span>
          )}
        </div>
        {watchLast}
      </CardContent>
    </Card>
  );
}

function StatLinkCard({
  icon,
  title,
  value,
  loading,
  onOpen,
  openLabel,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  loading: boolean;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <Card className="h-full">
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        className="flex h-full w-full items-center gap-3 rounded-xl p-card text-start transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          {loading ? (
            <Skeleton className="h-5 w-28" />
          ) : (
            <span className="text-body font-semibold text-foreground">{value}</span>
          )}
        </span>
        <CaretRight size={16} className="shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
      </button>
    </Card>
  );
}

/**
 * The class-first home top: the next class (hero) beside the syllabus card on a
 * laptop, stacked on a phone (hero first), with attendance and recordings cards
 * under the hero. For learners whose courses are live classes, not lessons.
 */
export function ClassFirstHome(props: ClassFirstHomeProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { play, dialog } = useRecordingPlayer();
  const liveClassPlural = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession).toLowerCase();

  const attendance = props.summary.attendance_month;
  const attendanceValue = attendance
    ? attendance.held > 0
      ? t("classFirst.attendanceValue", { attended: attendance.attended, count: attendance.held })
      : t("classFirst.attendanceNone", { liveClasses: liveClassPlural })
    : t("classFirst.unavailable");
  const showRecordings = props.summary.recordings_shown === true;
  const newRecordings = props.summary.new_recordings ?? 0;

  const watchLast = () => {
    const last = props.summary.last_recorded_class;
    const recording = playableRecording(last);
    if (last && recording) play(recording, last.title);
  };

  return (
    <div className={cn("grid grid-cols-1 items-start gap-4 lg:gap-6", props.syllabusOn && "lg:grid-cols-3")}>
      <div className={cn("flex flex-col gap-4 lg:gap-6", props.syllabusOn && "lg:col-span-2")}>
        <NextClassCard {...props} onWatchLast={watchLast} />
        <div className={cn("grid grid-cols-1 gap-4", showRecordings && "xs:grid-cols-2")}>
          <StatLinkCard
            icon={<CalendarCheck size={20} weight="duotone" aria-hidden />}
            title={t("classFirst.attendanceTitle")}
            value={attendanceValue}
            loading={props.summaryLoading && !attendance}
            onOpen={() => navigate({ to: "/learning-centre/attendance" })}
            openLabel={t("classFirst.attendanceOpen", { value: attendanceValue })}
          />
          {showRecordings && (
            <StatLinkCard
              icon={<PlayCircle size={20} weight="duotone" aria-hidden />}
              title={t("classFirst.recordingsTitle")}
              value={
                newRecordings > 0
                  ? t("classFirst.recordingsNew", { count: newRecordings })
                  : t("classFirst.recordingsNone")
              }
              loading={props.summaryLoading}
              onOpen={() => navigate({ to: "/study-library/live-class", hash: "past-sessions" })}
              openLabel={t("classFirst.recordingsOpen")}
            />
          )}
        </div>
      </div>
      {props.syllabusOn && (
        <div className="empty:hidden">
          <SyllabusProgressWidget />
        </div>
      )}
      {dialog}
    </div>
  );
}
