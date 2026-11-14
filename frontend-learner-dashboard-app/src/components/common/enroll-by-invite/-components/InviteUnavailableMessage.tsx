import { CalendarX, Clock } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn, sanitizeHtml } from "@/lib/utils";
import type { InviteAvailability } from "@/lib/invite-availability";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface InviteUnavailableMessageProps {
  availability: InviteAvailability;
  /** Admin-authored HTML from setting_json (authoritative when present). */
  messageHtml?: string | null;
  className?: string;
}

/**
 * Renders the admin's rich-text "unavailable" message (sanitized) for an expired / not-yet-started
 * / deactivated invite, falling back to a neutral line when no message was set. Presentational
 * only — callers wrap it (full-screen on the enroll page, inline in the enroll dialog).
 */
export function InviteUnavailableMessage({
  availability,
  messageHtml,
  className,
}: InviteUnavailableMessageProps) {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const html = (messageHtml ?? "").trim();
  const hasHtml = html.replace(/<[^>]*>/g, "").trim().length > 0;
  const Icon = availability === "NOT_STARTED" ? Clock : CalendarX;
  // Neutral fallback lines used ONLY when the admin left the message blank — never override an
  // admin-provided message, and intentionally generic so nothing course-specific is hardcoded.
  const FALLBACK: Record<Exclude<InviteAvailability, "AVAILABLE">, string> = {
    NOT_STARTED: t("inviteUnavailable.notStarted", { course }),
    EXPIRED: t("inviteUnavailable.closed", { course }),
    INACTIVE: t("inviteUnavailable.closed", { course }),
  };
  const fallback = availability === "AVAILABLE" ? "" : FALLBACK[availability];

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border-4 border-white bg-orange-100 shadow-sm">
        <Icon className="h-10 w-10 text-orange-500" aria-hidden="true" />
      </div>
      {hasHtml ? (
        <div
          className="invite-unavailable-message max-w-md text-base leading-relaxed text-gray-700 [&_a]:text-primary-500 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
        />
      ) : (
        <p className="max-w-sm text-base text-gray-500">{fallback}</p>
      )}
    </div>
  );
}
