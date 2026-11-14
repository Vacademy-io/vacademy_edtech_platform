import { SessionDetails } from "@/routes/study-library/live-class/-types/types";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { formatDate } from "@/lib/formatters";

export const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.error("Error detecting user timezone:", error);
    return "Asia/Kolkata";
  }
};

const normalizeTime = (time: string): string => {
  if (time.includes("T")) {
    const afterT = time.split("T")[1] || time;
    return afterT.replace(/[+-]\d{2}:\d{2}$|Z$/, "");
  }
  return time.replace(/[+-]\d{2}:\d{2}$|Z$/, "");
};

export const convertSessionTimeToUserTimezone = (
  sessionDate: string,
  sessionTime: string,
  sessionTimezone: string
): Date => {
  try {
    if (!sessionDate || !sessionTime || !sessionTimezone) {
      throw new Error("Missing required parameters");
    }

    const timeOnly = normalizeTime(sessionTime);
    const utcDate = fromZonedTime(`${sessionDate}T${timeOnly}`, sessionTimezone);

    if (isNaN(utcDate.getTime())) {
      throw new Error(`Invalid date from: ${sessionDate}T${timeOnly}`);
    }

    return utcDate;
  } catch (error) {
    console.error("Error in timezone conversion:", error);
    const timeOnly = normalizeTime(sessionTime);
    return new Date(`${sessionDate}T${timeOnly}`);
  }
};

export const isSessionLiveTimezoneAware = (
  session: SessionDetails
): boolean => {
  const now = new Date();

  if (!session.timezone) {
    const sessionStart = new Date(
      `${session.meeting_date}T${session.start_time}`
    );
    let sessionEnd = new Date(
      `${session.meeting_date}T${session.last_entry_time}`
    );

    if (sessionEnd < sessionStart) {
      sessionEnd = new Date(sessionEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    const waitingRoomStart = new Date(
      sessionStart.getTime() - session.waiting_room_time * 60000
    );
    return now >= waitingRoomStart && now <= sessionEnd;
  }

  const startTimeOnly = normalizeTime(session.start_time);
  const endTimeOnly = normalizeTime(session.last_entry_time);

  const sessionStart = fromZonedTime(
    `${session.meeting_date}T${startTimeOnly}`,
    session.timezone
  );

  let sessionEnd = fromZonedTime(
    `${session.meeting_date}T${endTimeOnly}`,
    session.timezone
  );

  if (sessionEnd < sessionStart) {
    sessionEnd = new Date(sessionEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  const waitingRoomStart = new Date(
    sessionStart.getTime() - session.waiting_room_time * 60000
  );

  return now >= waitingRoomStart && now <= sessionEnd;
};

export const isSessionUpcomingTimezoneAware = (
  session: SessionDetails
): boolean => {
  const now = new Date();

  if (!session.timezone) {
    const sessionStart = new Date(
      `${session.meeting_date}T${session.start_time}`
    );
    const waitingRoomStart = new Date(
      sessionStart.getTime() - session.waiting_room_time * 60000
    );
    return now < waitingRoomStart;
  }

  const startTimeOnly = normalizeTime(session.start_time);

  const sessionStart = fromZonedTime(
    `${session.meeting_date}T${startTimeOnly}`,
    session.timezone
  );

  const waitingRoomStart = new Date(
    sessionStart.getTime() - session.waiting_room_time * 60000
  );

  return now < waitingRoomStart;
};

export const formatSessionTimeInUserTimezone = (
  sessionDate: string,
  sessionTime: string,
  sessionTimezone: string
): string => {
  if (!sessionTimezone) {
    const timeOnly = normalizeTime(sessionTime);
    const datetime = new Date(`${sessionDate}T${timeOnly}`);
    return formatInTimeZone(datetime, getUserTimezone(), "h:mm aa");
  }

  const timeOnly = normalizeTime(sessionTime);
  const utcDate = fromZonedTime(`${sessionDate}T${timeOnly}`, sessionTimezone);
  return formatInTimeZone(utcDate, getUserTimezone(), "h:mm aa");
};

export const getTimezoneDisplayInfo = (sessionTimezone: string) => {
  const now = new Date();
  const userTimezone = getUserTimezone();

  const sessionTzName =
    formatDate(now, {
      timeZone: sessionTimezone,
      timeZoneName: "short",
    })
      .split(", ")[1] || sessionTimezone;

  const userTzName =
    formatDate(now, {
      timeZone: userTimezone,
      timeZoneName: "short",
    })
      .split(", ")[1] || userTimezone;

  return {
    sessionTz: sessionTzName,
    userTz: userTzName,
    isSameTimezone: sessionTimezone === userTimezone,
  };
};
