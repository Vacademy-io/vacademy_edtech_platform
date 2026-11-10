import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CalendarChip, LiveChip } from "@/components/design-system/fun/chips";
import { formatSessionTimeInUserTimezone } from "@/utils/timezone";
import type { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import type { BannerClass } from "./live-timing";
import { VideoIcon } from "./fun-icons";
import { useClassWhen } from "./FunTodayCards";

/**
 * The class card above the hero (board A-LiveNow). Live: the rose card with the
 * white LIVE NOW chip, "Join by" the last entry time and a white Join button.
 * Starting within the hour: the rose tint with a calendar chip, "Starts in" and a
 * solid Join; never the word "live" before it is. Join runs the dashboard's own
 * join flow (waiting room, attendance, the class's link).
 */
export function FunLiveCard({
  banner,
  nowMs,
  onJoin,
}: {
  banner: BannerClass;
  nowMs: number;
  onJoin: (session: SessionDetails) => void;
}) {
  const { t } = useTranslation("funHome");
  const classWhen = useClassWhen();
  const { session, isLive } = banner;
  let joinBy: string | null = null;
  try {
    joinBy = session.last_entry_time
      ? formatSessionTimeInUserTimezone(session.meeting_date, session.last_entry_time, session.timezone)
      : null;
  } catch {
    joinBy = null;
  }
  const titleId = `fun-live-${session.schedule_id || session.session_id}`;

  return (
    <section
      aria-labelledby={titleId}
      className={cn("fun-live", isLive ? "fun-live--now fun-on-colour" : "fun-live--soon")}
    >
      {isLive && <span className="fun-live__deco" aria-hidden="true" />}
      <div className="fun-live__words">
        {isLive ? <LiveChip tone="onLive" className="fun-live__chip" /> : <CalendarChip>{classWhen(session, nowMs)}</CalendarChip>}
        <h2 id={titleId} className="fun-live__title fun-clamp-2">
          {session.title}
        </h2>
        <p className="fun-live__when">
          {isLive
            ? joinBy
              ? t("live.joinBy", { time: joinBy })
              : null
            : t("live.startsIn", { count: banner.minutesUntilStart })}
        </p>
      </div>
      <button type="button" className="fun-btn fun-live__join" onClick={() => onJoin(session)}>
        <VideoIcon />
        {isLive ? t("live.join") : t("live.joinShort")}
      </button>
    </section>
  );
}
