import { MyButton } from "@/components/design-system/button";
import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SessionDetailsResponse } from "@/routes/study-library/live-class/-types/types";
import { SessionStreamingServiceType } from "@/routes/register/live-class/-types/enum";
import { useMarkAttendance } from "@/routes/live-class-guest/-hooks/useMarkAttendance";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import dayjs from "dayjs";
import {
  convertSessionTimeToUserTimezone,
  formatSessionTimeInUserTimezone,
} from "@/utils/timezone";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";

interface SessionStatusCardProps {
  sessionDetails: SessionDetailsResponse;
  registrationResponse: string;
  alreadyRegisteredEmail: string;
  earliestScheduleId: string;
}

export default function SessionStatusCard({
  sessionDetails,
  registrationResponse,
  alreadyRegisteredEmail,
  earliestScheduleId,
}: SessionStatusCardProps) {
  const { t } = useTranslation("registrationA");
  const [currentTime, setCurrentTime] = useState(new Date());
  const navigate = useNavigate();
  const { mutateAsync: markAttendance } = useMarkAttendance();
  const hasNavigated = useRef(false);

  const getSessionTimes = useCallback(() => {
    const sessionTimezone =
      "timezone" in sessionDetails
        ? (sessionDetails as SessionDetailsResponse & { timezone?: string })
            .timezone
        : undefined;

    if (sessionTimezone) {
      const sessionDate = convertSessionTimeToUserTimezone(
        sessionDetails.meetingDate,
        sessionDetails.scheduleStartTime,
        sessionTimezone
      );
      const waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - (sessionDetails.waitingRoomTime ?? 0)
      );
      return { sessionDate, waitingRoomStart };
    } else {
      const sessionDate = new Date(
        `${sessionDetails.meetingDate}T${sessionDetails.scheduleStartTime}`
      );
      const waitingRoomStart = new Date(sessionDate);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - (sessionDetails.waitingRoomTime ?? 0)
      );
      return { sessionDate, waitingRoomStart };
    }
  }, [sessionDetails]);

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (sessionDetails && registrationResponse) {
      const now = currentTime;
      const { sessionDate, waitingRoomStart } = getSessionTimes();
      const isInWaitingRoom = now >= waitingRoomStart && now < sessionDate;
      const isInMainSession = now >= sessionDate;

      const handleSessionNavigation = async () => {
        if (hasNavigated.current) return;
        const streamingType =
          sessionDetails.sessionStreamingServiceType?.toLowerCase();
        if (isInWaitingRoom) {
          hasNavigated.current = true;
          await navigate({
            to: "/live-class-guest/waiting-room",
            search: {
              sessionId: earliestScheduleId || "",
              guestId: registrationResponse || "",
            },
          });
        } else if (
          isInMainSession &&
          sessionDetails?.defaultMeetLink &&
          streamingType === SessionStreamingServiceType.EMBED.toLowerCase()
        ) {
          hasNavigated.current = true;
          try {
            await markAttendance({
              sessionId: sessionDetails.sessionId,
              scheduleId: earliestScheduleId || "",
              userSourceType: "EXTERNAL_USER",
              userSourceId: registrationResponse || "",
              details: "Guest joined live class from waiting room",
            });
          } catch (err) {
            console.error(
              "Attendance marking failed, but proceeding to embed:",
              err
            );
          }
          navigate({
            to: "/live-class-guest/embed",
            search: { sessionId: earliestScheduleId || "" },
          });
        }
        // Redirect-type sessions intentionally do NOT auto-open: window.open
        // outside a user gesture is popup-blocked, so the learner joins via the
        // one-click "Join Live" button below instead.
      };

      handleSessionNavigation();
    }
  }, [
    sessionDetails,
    currentTime,
    registrationResponse,
    earliestScheduleId,
    navigate,
    markAttendance,
    getSessionTimes,
  ]);

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) return "";
    return dayjs(dateStr).format("hh:mm A");
  };

  const getSessionTimezone = useCallback(() => {
    return "timezone" in sessionDetails
      ? (sessionDetails as SessionDetailsResponse & { timezone?: string })
          .timezone
      : undefined;
  }, [sessionDetails]);

  const formatStartTime = useCallback(() => {
    const sessionTimezone = getSessionTimezone();
    if (sessionTimezone) {
      return formatSessionTimeInUserTimezone(
        sessionDetails.meetingDate,
        sessionDetails.scheduleStartTime,
        sessionTimezone
      );
    } else {
      return formatDateTime(
        `${sessionDetails.meetingDate}T${sessionDetails.scheduleStartTime}`
      );
    }
  }, [
    getSessionTimezone,
    sessionDetails.meetingDate,
    sessionDetails.scheduleStartTime,
  ]);

  const formatWaitingRoomTime = useCallback(() => {
    const sessionTimezone = getSessionTimezone();
    if (sessionTimezone) {
      const sessionStartInUserTz = convertSessionTimeToUserTimezone(
        sessionDetails.meetingDate,
        sessionDetails.scheduleStartTime,
        sessionTimezone
      );
      const waitingRoomStartTime = new Date(
        sessionStartInUserTz.getTime() -
          sessionDetails.waitingRoomTime! * 60 * 1000
      );
      return format(waitingRoomStartTime, "h:mm aa");
    } else {
      return formatDateTime(
        new Date(
          new Date(
            `${sessionDetails.meetingDate}T${sessionDetails.scheduleStartTime}`
          ).getTime() -
            sessionDetails.waitingRoomTime! * 60 * 1000
        ).toISOString()
      );
    }
  }, [
    getSessionTimezone,
    sessionDetails.meetingDate,
    sessionDetails.scheduleStartTime,
    sessionDetails.waitingRoomTime,
  ]);

  const handleJoinLiveSession = async () => {
    const streamingType =
      sessionDetails.sessionStreamingServiceType?.toLowerCase();
    if (streamingType === SessionStreamingServiceType.EMBED.toLowerCase()) {
      await markAttendance({
        sessionId: sessionDetails.sessionId,
        scheduleId: earliestScheduleId || "",
        userSourceType: "EXTERNAL_USER",
        userSourceId: registrationResponse || "",
        details: "Guest joined live class",
      });
      navigate({
        to: "/live-class-guest/embed",
        search: { sessionId: earliestScheduleId || "" },
      });
    } else {
      const joinLink =
        sessionDetails.customMeetingLink || sessionDetails.defaultMeetLink;
      window.open(joinLink, "_blank", "noopener,noreferrer");
    }
  };

  const handleEnterWaitingRoom = () => {
    navigate({
      to: "/live-class-guest/waiting-room",
      search: {
        sessionId: earliestScheduleId || "",
        guestId: registrationResponse || "",
      },
    });
  };

  const now = currentTime;
  const { sessionDate, waitingRoomStart } = getSessionTimes();
  const isInWaitingRoom = now >= waitingRoomStart && now < sessionDate;
  const isInMainSession = now >= sessionDate;

  const renderSessionAction = () => {
    if (isInMainSession) {
      return (
        <div className="space-y-3">
          <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("common.liveNow")}
          </Badge>
          <MyButton
            buttonType="primary"
            className="w-full h-11 text-sm font-semibold rounded-lg"
            onClick={handleJoinLiveSession}
          >
            {t("liveClass.statusCard.joinLive", {
              session: getTerminology(ContentTerms.Session, SystemTerms.Session),
            })}
          </MyButton>
        </div>
      );
    } else if (isInWaitingRoom) {
      return (
        <div className="space-y-3">
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {t("liveClass.statusCard.waitingRoomOpenBadge")}
          </Badge>
          <MyButton
            buttonType="primary"
            className="w-full h-11 text-sm font-semibold rounded-lg"
            onClick={handleEnterWaitingRoom}
          >
            {t("liveClass.statusCard.enterWaitingRoom")}
          </MyButton>
        </div>
      );
    } else {
      return (
        <div className="space-y-3">
          <Badge
            variant="outline"
            className="text-gray-500 border-gray-200 bg-gray-50"
          >
            {t("liveClass.statusCard.notStarted", {
              session: getTerminology(ContentTerms.Session, SystemTerms.Session),
            })}
          </Badge>
          <MyButton
            buttonType="secondary"
            className="w-full h-11 text-sm font-medium rounded-lg"
            disable={true}
          >
            {t("liveClass.statusCard.willStartSoon", {
              session: getTerminology(ContentTerms.Session, SystemTerms.Session),
            })}
          </MyButton>
        </div>
      );
    }
  };

  return (
    <Card className="w-full border-primary-100/60 shadow-lg">
      <CardHeader className="pb-0 pt-6 px-6 items-center">
        {/* Success icon */}
        <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mb-2 border border-green-100">
          <svg
            className="w-7 h-7 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-green-700">
          {t("liveClass.statusCard.alreadyRegisteredTitle")}
        </h3>
        <p className="text-sm text-gray-500 text-center">
          {t("liveClass.statusCard.registeredWith", {
            session: getTerminology(ContentTerms.Session, SystemTerms.Session),
          })}
        </p>
        <div className="bg-primary-50 border border-primary-100 rounded-lg px-4 py-2 mt-1">
          <span className="text-sm font-medium text-primary-500 break-all">
            {alreadyRegisteredEmail}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-4 px-6 pb-6">
        <Separator className="mb-4" />

        {/* Time Details */}
        <div className="space-y-2.5 mb-5">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">{t("liveClass.statusCard.startTime")}</span>
            <span className="font-semibold text-gray-800">
              {formatStartTime()}
            </span>
          </div>
          {sessionDetails.waitingRoomTime !== 0 && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{t("liveClass.statusCard.waitingRoomOpens")}</span>
              <span className="font-semibold text-gray-800">
                {formatWaitingRoomTime()}
              </span>
            </div>
          )}
        </div>

        {/* Action */}
        <div className="flex flex-col items-center gap-stack">
          {renderSessionAction()}
        </div>
      </CardContent>
    </Card>
  );
}
