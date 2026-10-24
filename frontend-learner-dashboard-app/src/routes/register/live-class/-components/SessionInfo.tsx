import dayjs from "dayjs";
import CountdownTimer from "./CountDown";
import RegistrationLogo from "@/svgs/registration-logo.svg?url";
import { cn } from "@/lib/utils";
import { SessionDetailsResponse } from "@/routes/study-library/live-class/-types/types";
import { convertSessionTimeToUserTimezone } from "@/utils/timezone";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";

interface SessionInfoProps {
  sessionTitle?: string;
  startTime?: string;
  lastEntryTime?: string;
  sessionDetails?: SessionDetailsResponse | null;
  instituteName?: string | null;
  instituteLogoUrl?: string | null;
  /** institute_domain_routing logo box. When set, overrides the default h-9/h-10. */
  logoWidthPx?: number | null;
  logoHeightPx?: number | null;
  /** institute_domain_routing.hide_institute_name — logos that embed the name. */
  hideInstituteName?: boolean | null;
  /** Frosted panel styling for when the page renders a hero background. */
  glass?: boolean;
}

export default function SessionInfo({
  sessionTitle,
  startTime,
  lastEntryTime,
  sessionDetails,
  instituteName,
  instituteLogoUrl,
  logoWidthPx,
  logoHeightPx,
  hideInstituteName,
  glass,
}: SessionInfoProps) {
  const { t } = useTranslation("registrationA");
  // Mirrors InstituteBrandingComponent: an explicit width/height from
  // institute_domain_routing replaces the default box entirely, rather than
  // fighting the h-9/h-10 utilities.
  const hasCustomLogoDims =
    typeof logoWidthPx === "number" || typeof logoHeightPx === "number";
  const customLogoStyle = hasCustomLogoDims
    ? {
        width: typeof logoWidthPx === "number" ? logoWidthPx : undefined,
        height: typeof logoHeightPx === "number" ? logoHeightPx : undefined,
      }
    : undefined;
  const showInstituteName = hideInstituteName === true ? false : true;
  const getSessionTimezone = () => {
    return "timezone" in (sessionDetails || {})
      ? (sessionDetails as SessionDetailsResponse & { timezone?: string })
          .timezone
      : undefined;
  };

  const convertTimeForDisplay = (timeStr: string | undefined) => {
    if (!timeStr || !sessionDetails?.meetingDate) return timeStr;
    const sessionTimezone = getSessionTimezone();
    if (sessionTimezone) {
      try {
        const convertedTime = convertSessionTimeToUserTimezone(
          sessionDetails.meetingDate,
          timeStr,
          sessionTimezone
        );
        return convertedTime.toISOString();
      } catch (error) {
        console.error("Error converting time for display:", error);
        return timeStr;
      }
    }
    return timeStr;
  };

  const formatDateTime = (dateStr: string | undefined) => {
    if (!dateStr) return "";
    const convertedTime = convertTimeForDisplay(dateStr);
    return dayjs(convertedTime).format("hh:mm A");
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "";
    const convertedTime = convertTimeForDisplay(dateStr);
    return dayjs(convertedTime).format("ddd, MMM D, YYYY");
  };

  const getConvertedStartTime = () => {
    const convertedTime = convertTimeForDisplay(startTime);
    return convertedTime || startTime;
  };

  const convertedStartTime = getConvertedStartTime();

  return (
    <div
      className={cn(
        "flex flex-col gap-6 h-full w-full lg:w-1/2 lg:max-w-reg-560 items-center",
        glass && "rounded-2xl bg-white/90 backdrop-blur-md shadow-xl p-5 sm:p-8"
      )}
    >
      {/* Institute Branding */}
      <div className="flex items-center gap-3">
        {instituteLogoUrl ? (
          <img
            src={instituteLogoUrl}
            alt={instituteName || t("liveClass.sessionInfo.instituteFallback")}
            className={cn(
              "object-contain",
              hasCustomLogoDims ? "" : "h-9 sm:h-10 w-auto"
            )}
            style={customLogoStyle}
          />
        ) : (
          <div
            className={cn(
              "bg-primary-100 rounded-lg flex items-center justify-center",
              hasCustomLogoDims ? "" : "h-9 sm:h-10 w-9 sm:w-10"
            )}
            style={customLogoStyle}
          >
            <span className="text-primary-500 font-bold text-base">
              {instituteName ? instituteName.charAt(0).toUpperCase() : "V"}
            </span>
          </div>
        )}
        {instituteName && showInstituteName && (
          <span className="text-sm sm:text-base font-semibold text-gray-700">
            {instituteName}
          </span>
        )}
      </div>

      {/* Session Title */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight tracking-tight">
          {sessionTitle}
        </h1>
      </div>

      {/* Countdown */}
      {convertedStartTime && (
        <CountdownTimer startTime={convertedStartTime} />
      )}

      {/* Description Card or Illustration */}
      {sessionDetails?.descriptionHtml &&
      sessionDetails.descriptionHtml.trim() !== "" ? (
        <Card className="w-full border-primary-100/60 shadow-sm">
          <CardContent className="p-card sm:p-5">
            <div
              className="max-h-screen-28 sm:max-h-screen-35 overflow-auto prose prose-sm max-w-none text-gray-600 leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: sessionDetails.descriptionHtml,
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="w-full flex items-center justify-center py-2">
          <img
            src={RegistrationLogo}
            alt={t("liveClass.sessionInfo.registrationAlt")}
            className="max-w-reg-280 max-h-52 object-contain opacity-70"
          />
        </div>
      )}

      {/* Session Details Bar */}
      <Card className="w-full border-primary-100/60 shadow-sm">
        <CardContent className="p-card">
          <div className="flex items-center justify-center gap-3 sm:gap-5 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-primary-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6l4 2"
                />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span className="text-gray-500">{t("liveClass.sessionInfo.start")}</span>
              <span className="font-semibold text-gray-800">
                {formatDateTime(startTime)}
              </span>
            </div>

            <Separator orientation="vertical" className="h-4" />

            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-primary-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6l4 2"
                />
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span className="text-gray-500">{t("liveClass.sessionInfo.end")}</span>
              <span className="font-semibold text-gray-800">
                {formatDateTime(lastEntryTime)}
              </span>
            </div>

            {startTime && (
              <>
                <Separator orientation="vertical" className="h-4 hidden sm:block" />
                <div className="flex items-center gap-2 hidden sm:flex">
                  <svg
                    className="w-4 h-4 text-primary-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  <span className="font-medium text-gray-700">
                    {formatDate(startTime)}
                  </span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
