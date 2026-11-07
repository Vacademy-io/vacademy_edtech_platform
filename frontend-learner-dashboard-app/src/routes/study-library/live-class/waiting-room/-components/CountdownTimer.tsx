import { getServerTime, useServerTime } from "@/hooks/use-server-time";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SessionDetailsResponse } from "../../-types/types";

interface CountdownTimerProps {
  sessionDetails: SessionDetailsResponse;
  waitingRoomTime: number;
  onExpire?: () => void;
}

export function CountdownTimer({
  sessionDetails,
  waitingRoomTime,
  onExpire,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const { t } = useTranslation("study");
  const { data: serverTimeData } = useServerTime();
  const sessionStartInUserTimezone = convertSessionTimeToUserTimezone(
    sessionDetails.meetingDate,
    sessionDetails.scheduleStartTime,
    sessionDetails.timezone
  );

  useEffect(() => {
    const calculateTimeLeft = () => {
      const serverTimestamp = getServerTime(serverTimeData);
      const now = new Date(serverTimestamp);

      const waitingRoomStart = new Date(sessionDetails.scheduleStartTime);
      waitingRoomStart.setMinutes(
        waitingRoomStart.getMinutes() - waitingRoomTime
      );

      // If we're before the waiting room starts
      if (now < waitingRoomStart) {
        return null;
      }

      // If we're past the session start
      if (now >= sessionStartInUserTimezone) {
        return null;
      }

      const difference = sessionStartInUserTimezone.getTime() - now.getTime();

      return {
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    // Initial calculation
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);

      // If time is up, clear the interval and notify parent
      if (!newTimeLeft) {
        clearInterval(timer);
        if (onExpire) onExpire();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [waitingRoomTime, sessionDetails.scheduleStartTime]);

  if (!timeLeft) {
    return null;
  }

  return (
    <div className="text-center">
      <div className="flex justify-center gap-4">
        <div className="flex flex-col items-center">
          <div className="text-3xl font-bold border-2 p-3 px-4 rounded">
            {String(timeLeft.hours).padStart(2, "0")}
          </div>
          <div className="text-sm text-gray-500 mt-2">{t("liveClass.countdown.hours")}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-3xl font-bold border-2 p-3 px-4 rounded">
            {String(timeLeft.minutes).padStart(2, "0")}
          </div>
          <div className="text-sm text-gray-500 mt-2">{t("liveClass.countdown.minutes")}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-3xl font-bold border-2 p-3 px-4 rounded">
            {String(timeLeft.seconds).padStart(2, "0")}
          </div>
          <div className="text-sm text-gray-500 mt-2">{t("liveClass.countdown.seconds")}</div>
        </div>
      </div>
    </div>
  );
}
