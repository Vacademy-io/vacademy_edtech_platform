import { useQuery } from "@tanstack/react-query";
import { format, differenceInCalendarDays } from "date-fns";
import { CalendarBlank, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { fetchStudentDetails } from "@/services/studentDetails";
import type { Student } from "@/types/user/user-detail";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface EnrollmentExpiryListProps {
  instituteId: string;
  userId: string;
}

interface EnrollmentRow {
  packageSessionId: string;
  title: string;
  subtitle: string;
  expiryDate: string | null;
  remainingDays: number | null;
}

/**
 * The "Invited" placeholder batch every course carries (level and session ids
 * both INVITED). A learner sits in it while an invite is pending; it is not
 * access, so it has no place in a list of memberships. The details API returns
 * names only, so match the seeded names, both of them, so a real batch that
 * happens to be called "Invited" still shows.
 */
const isInvitedPlaceholder = (s: Student): boolean =>
  s.level_name?.trim().toLowerCase() === "invited level" &&
  s.session_name?.trim().toLowerCase() === "invited";

const buildRows = (students: Student[]): EnrollmentRow[] => {
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  return students
    .filter((s) => s.package_session_id && !isInvitedPlaceholder(s))
    .map((s) => {
      const expiry = s.expiry_date ? new Date(s.expiry_date) : null;
      const validExpiry = expiry && !isNaN(expiry.getTime()) ? expiry : null;
      return {
        packageSessionId: s.package_session_id,
        title:
          s.package_name ||
          i18n.t("userProfileExtra:enrollmentExpiry.enrolledFallbackTitle", { course }),
        subtitle: [s.level_name, s.session_name].filter(Boolean).join(" - "),
        expiryDate: validExpiry ? format(validExpiry, "dd MMM yyyy") : null,
        remainingDays: validExpiry
          ? differenceInCalendarDays(validExpiry, new Date())
          : null,
      };
    });
};

/**
 * Lists every package session the learner is enrolled in with its access
 * expiry, sourced live from /learner/info/v1/details (one row per
 * enrollment, each carrying its own expiry_date).
 */
export const EnrollmentExpiryList = ({
  instituteId,
  userId,
}: EnrollmentExpiryListProps) => {
  const { t } = useTranslation("userProfileExtra");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["LEARNER_ENROLLMENT_EXPIRY", instituteId, userId],
    queryFn: async () => {
      const response = await fetchStudentDetails(instituteId, userId);
      const students: Student[] = Array.isArray(response?.data)
        ? response.data
        : [];
      return buildRows(students);
    },
    enabled: Boolean(instituteId && userId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <SpinnerGap className="size-4 animate-spin" />
        {t("enrollmentExpiry.loading")}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-danger-600">
        <WarningCircle className="size-4" />
        {t("enrollmentExpiry.error")}
      </div>
    );
  }

  if (!data || data.length === 0) {
    const courses = getTerminologyPlural(
      ContentTerms.Course,
      SystemTerms.Course
    ).toLocaleLowerCase();
    return (
      <p className="py-4 text-sm text-gray-500">
        {t("enrollmentExpiry.empty", { courses })}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {data.map((row) => {
        const expired = row.remainingDays !== null && row.remainingDays < 0;
        const expiringSoon =
          row.remainingDays !== null &&
          row.remainingDays >= 0 &&
          row.remainingDays <= 14;
        return (
          <li
            key={row.packageSessionId}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-700">
                {row.title}
              </p>
              {row.subtitle && (
                <p className="truncate text-xs text-gray-500">
                  {row.subtitle}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-end">
              <CalendarBlank className="size-4 text-gray-400" />
              {row.expiryDate ? (
                <div>
                  <p
                    className={cn(
                      "text-sm font-medium",
                      expired
                        ? "text-danger-600"
                        : expiringSoon
                          ? "text-warning-600"
                          : "text-gray-700"
                    )}
                  >
                    {row.expiryDate}
                  </p>
                  <p className="text-xs text-gray-500">
                    {expired
                      ? t("enrollmentExpiry.expired")
                      : row.remainingDays === 0
                        ? t("enrollmentExpiry.expiresToday")
                        : t("enrollmentExpiry.daysLeft", { count: row.remainingDays ?? 0 })}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">{t("enrollmentExpiry.noExpiry")}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
