"use client";

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";

import { Student } from "@/types/user/user-detail";
import { MyButton } from "@/components/design-system/button";
import { getPublicUrl } from "@/services/upload_file";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import SessionExpiry from "./sessionExpiery";
import { User } from "@phosphor-icons/react";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { HOLISTIC_INSTITUTE_ID, GET_DASHBOARD_DATA } from "@/constants/urls";
import { getTerminology } from "../layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { cn, toTitleCase } from "@/lib/utils";
import { useStudentPermissions } from "@/hooks/use-student-permissions";
import { useSystemFieldVisibility } from "@/hooks/use-system-field-visibility";
import ProgressStats from "./progress-stats";
import { BadgesRankCard } from "./badges-rank-card";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { formatDate } from "@/lib/format-date";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { FileText } from "@phosphor-icons/react";
import { playIllustrations } from "@/assets/play-illustrations";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { useQuery } from "@tanstack/react-query";
import { SubscriptionMandateList } from "./payment-billing/subscription-mandate-list";
import {
  SUBSCRIPTION_LIST_QUERY_KEY,
  fetchSubscriptions,
} from "./payment-billing/subscription-services";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguageStore } from "@/stores/localization/useLanguageStore";
import { useSyncLanguage } from "@/hooks/useSyncLanguage";
import { LOCALE_LABELS } from "@/i18n/locales";
import { getEnabledLocales } from "@/services/language-settings";
// import { SessionExpiry } from "./sessionExpiery";
interface CourseDetails {
  packageName: string;
  sessionName: string;
  levelName: string;
  startDate: string;
  status: string;
}

// Treats empty strings and legacy "N/A" placeholders as missing so detail rows
// are hidden instead of printing a bold "N/A".
const hasValue = (value: string | null | undefined): value is string => {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.toUpperCase() !== "N/A";
};

// Initials for the avatar: first letters of the first and last words.
const getInitials = (name: string | null | undefined): string => {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
};

// Token class pairs for the initials avatar, picked by a stable name hash so a
// given user always sees the same tone.
const AVATAR_TONE_CLASSES = [
  "bg-primary-100 text-primary-500",
  "bg-secondary-100 text-secondary-500",
  "bg-tertiary-100 text-tertiary-500",
];

const getAvatarToneClass = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % 997;
  }
  return (
    AVATAR_TONE_CLASSES[hash % AVATAR_TONE_CLASSES.length] ??
    AVATAR_TONE_CLASSES[0]!
  );
};

export default function ProfilePage() {
  const navigate = useNavigate();
  // Keeps i18next + <html lang/dir> in sync with the persisted locale.
  useSyncLanguage();
  const { t } = useTranslation();
  const locale = useLanguageStore((state) => state.locale);
  const setLocale = useLanguageStore((state) => state.setLocale);
  const [studentData, setStudentData] = useState<Student | null>(null);
  const [courseDetails, setCourseDetails] = useState<CourseDetails | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [tncAccepted, setTncAccepted] = useState(false);
  const [tncAcceptedDate, setTncAcceptedDate] = useState<string | number | null>(null);
  const [tncFileUrl, setTncFileUrl] = useState<string | null>(null);
  const { showForInstitutes } = useInstituteFeatureStore();
  const {
    permissions,
    isLoading: permissionsLoading,
    settings: displaySettings,
  } = useStudentPermissions();
  // Honor the admin's system-field toggles (Settings → Custom Fields). Fails open.
  const { isFieldVisible } = useSystemFieldVisibility();
  const { setNavHeading } = useNavHeadingStore();

  // Standard navbar heading; replaces the old bespoke sticky header.
  useEffect(() => {
    setNavHeading("My Profile");
  }, [setNavHeading]);

  // Redirect if user doesn't have permission to view profile
  useEffect(() => {
    if (!permissionsLoading && !permissions.canViewProfile) {
      navigate({ to: "/dashboard" });
    }
  }, [permissions.canViewProfile, permissionsLoading, navigate]);

  // Fetch student data from Preferences
  useEffect(() => {
    const fetchStudentData = async () => {
      try {
        const { value } = await Preferences.get({ key: "sessionList" });

        if (value) {
          try {
            // Parse the JSON data
            const parsedData = JSON.parse(value);

            // Initialize course details with defaults
            let courseDetails = {
              packageName: "N/A",
              sessionName: "N/A",
              levelName: "N/A",
              startDate: "N/A",
              status: "N/A",
            };

            // Check if parsedData is an array or object
            if (Array.isArray(parsedData) && parsedData.length > 0) {
              const course = parsedData[0]; // Take the first course if it's an array

              courseDetails = {
                packageName: toTitleCase(
                  course.package_dto?.package_name || "N/A"
                ),
                sessionName: toTitleCase(course.session?.session_name || "N/A"),
                levelName: toTitleCase(course.level?.level_name || "N/A"),
                startDate: course.session?.start_date || "N/A",
                status: course.status || "N/A",
              };
            } else if (typeof parsedData === "object" && parsedData !== null) {
              // Handle if parsedData is a single course object
              const course = parsedData;

              courseDetails = {
                packageName: toTitleCase(
                  course.package_dto?.package_name || "N/A"
                ),
                sessionName: toTitleCase(course.session?.session_name || "N/A"),
                levelName: toTitleCase(course.level?.level_name || "N/A"),
                startDate: course.session?.start_date || "N/A",
                status: course.status || "N/A",
              };
            }

            // Set the course details to state
            setCourseDetails(courseDetails);
          } catch (parseError) {
            console.error("Error parsing JSON from Preferences:", parseError);
            // Set default course details if parsing fails
            setCourseDetails({
              packageName: "N/A",
              sessionName: "N/A",
              levelName: "N/A",
              startDate: "N/A",
              status: "N/A",
            });
          }
        } else {
          // Try to get fallback data from institute batches
          try {
            const { value: fallbackValue } = await Preferences.get({
              key: "instituteBatchesForSessions",
            });

            if (fallbackValue) {
              const fallbackData = JSON.parse(fallbackValue);

              if (Array.isArray(fallbackData) && fallbackData.length > 0) {
                const fallbackCourse = fallbackData[0];
                const fallbackCourseDetails = {
                  packageName: toTitleCase(
                    fallbackCourse.package_dto?.package_name || "N/A"
                  ),
                  sessionName: toTitleCase(
                    fallbackCourse.session?.session_name || "N/A"
                  ),
                  levelName: toTitleCase(
                    fallbackCourse.level?.level_name || "N/A"
                  ),
                  startDate: fallbackCourse.session?.start_date || "N/A",
                  status: fallbackCourse.status || "N/A",
                };
                setCourseDetails(fallbackCourseDetails);
              } else {
                // Set default course details if no fallback data
                setCourseDetails({
                  packageName: "N/A",
                  sessionName: "N/A",
                  levelName: "N/A",
                  startDate: "N/A",
                  status: "N/A",
                });
              }
            } else {
              // Set default course details if no fallback data
              setCourseDetails({
                packageName: "N/A",
                sessionName: "N/A",
                levelName: "N/A",
                startDate: "N/A",
                status: "N/A",
              });
            }
          } catch (fallbackError) {
            console.error("Error getting fallback data:", fallbackError);
            // Set default course details if fallback fails
            setCourseDetails({
              packageName: "N/A",
              sessionName: "N/A",
              levelName: "N/A",
              startDate: "N/A",
              status: "N/A",
            });
          }
        }
      } catch (error) {
        console.error("Error fetching course data from Preferences:", error);
        // Set default course details if error occurs
        setCourseDetails({
          packageName: "N/A",
          sessionName: "N/A",
          levelName: "N/A",
          startDate: "N/A",
          status: "N/A",
        });
      }

      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });

        if (!value) {
          setIsLoading(false);
          return;
        }

        try {
          // Parse the JSON data
          const parsedData = JSON.parse(value);

          // Handle both array and object formats
          let studentDetails: Student;
          if (Array.isArray(parsedData)) {
            if (parsedData.length === 0) {
              setIsLoading(false);
              return;
            }
            studentDetails = parsedData[0];
          } else if (typeof parsedData === "object" && parsedData !== null) {
            studentDetails = parsedData;
          } else {
            console.error("Unexpected data format:", parsedData);
            setIsLoading(false);
            return;
          }

          setStudentData(studentDetails);

          if (studentDetails.face_file_id) {
            try {
              const institute_logo = await getPublicUrl(
                studentDetails.face_file_id
              );
              setImageUrl(institute_logo);
            } catch (error) {
              console.error("Error fetching institute logo:", error);
            }
          }
        } catch (parseError) {
          console.error("Error parsing JSON from Preferences:", parseError);
        }
      } catch (error) {
        console.error("Error fetching student data from Preferences:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStudentData();
  }, []);

  // Fetch TnC status from dashboard API
  useEffect(() => {
    const fetchTncStatus = async () => {
      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });
        if (!value) return;
        const parsed = JSON.parse(value);
        const students = Array.isArray(parsed) ? parsed : [parsed];
        if (students.length === 0) return;

        const instituteId = students[0]?.institute_id;
        const packageSessionId = students[0]?.package_session_id;
        if (!instituteId || !packageSessionId) return;

        const packageSessionIds = students
          .map((s: { package_session_id?: string | null }) => s.package_session_id)
          .filter((id): id is string => !!id);

        const response = await authenticatedAxiosInstance({
          method: "POST",
          url: GET_DASHBOARD_DATA,
          params: { instituteId, packageSessionId },
          data: packageSessionIds,
        });
        const data = response.data;
        if (data?.tnc_accepted_date) {
          setTncAccepted(true);
          setTncAcceptedDate(data.tnc_accepted_date);
          setTncFileUrl(data.tnc_file_url || null);
        }
      } catch {
        // silently ignore — TnC section just won't show
      }
    };
    fetchTncStatus();
  }, []);

  const handleEditProfile = () => {
    navigate({ to: "/user-profile/edit" });
  };

  // Same query key as SubscriptionMandateList, so this is a cache hit rather than a
  // second request — it only decides whether the card is worth rendering at all.
  // Hooks must run unconditionally on every render, so this has to sit above the
  // isLoading early return below — it previously came after it, which meant the
  // loading render called one fewer hook than the loaded render ("Rendered more
  // hooks than during the previous render").
  const { data: subscriptions } = useQuery({
    queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, studentData?.institute_id],
    queryFn: () => fetchSubscriptions(studentData?.institute_id as string),
    enabled: Boolean(studentData?.institute_id),
    staleTime: 60 * 1000,
  });
  const hasAutopaySubscription = (subscriptions ?? []).some(
    (s) => s.has_active_mandate || s.auto_renewal_enabled
  );

  if (isLoading || permissionsLoading) {
    return <DashboardLoader />;
  }

  // Row-level visibility: a detail row only renders when it has a real value.
  // When every row in a section is empty, the whole section card is hidden.
  const isHolistic = showForInstitutes([HOLISTIC_INSTITUTE_ID]);

  const showCourse = hasValue(courseDetails?.packageName);
  const showSession = hasValue(courseDetails?.sessionName);
  const showLevel = hasValue(courseDetails?.levelName);
  const showEnrollment =
    isFieldVisible("INSTITUTE_ENROLLMENT_ID") &&
    hasValue(studentData?.institute_enrollment_id);
  const showCollege =
    !isHolistic &&
    isFieldVisible("LINKED_INSTITUTE_NAME") &&
    hasValue(studentData?.linked_institute_name);
  const showAcademicSection =
    showCourse || showSession || showLevel || showEnrollment || showCollege;

  const showMobile =
    isFieldVisible("MOBILE_NUMBER") && hasValue(studentData?.mobile_number);
  const showEmail = isFieldVisible("EMAIL") && hasValue(studentData?.email);
  const showCountry = isHolistic && hasValue(studentData?.country);
  const showAddress = !isHolistic && hasValue(studentData?.address_line);
  const showCity =
    !isHolistic && isFieldVisible("CITY") && hasValue(studentData?.city);
  const showRegion =
    !isHolistic && isFieldVisible("REGION") && hasValue(studentData?.region);
  const showPincode = !isHolistic && hasValue(studentData?.pin_code);
  const showContactSection =
    showMobile ||
    showEmail ||
    showCountry ||
    showAddress ||
    showCity ||
    showRegion ||
    showPincode;
  // The location block only needs its top divider when contact rows render above it.
  const showLocationDivider = showMobile || showEmail;

  const showFather =
    isFieldVisible("FATHER_NAME") && hasValue(studentData?.father_name);
  const showMother =
    isFieldVisible("MOTHER_NAME") && hasValue(studentData?.mother_name);
  const showParentsEmail =
    isFieldVisible("PARENTS_EMAIL") && hasValue(studentData?.parents_email);
  const showParentsMobile =
    isFieldVisible("PARENTS_MOBILE_NUMBER") &&
    hasValue(studentData?.parents_mobile_number);
  const showGuardianSection =
    !isHolistic &&
    (showFather || showMother || showParentsEmail || showParentsMobile);

  return (
    <div className="min-h-screen bg-gray-50/50 pb-24 md:pb-8">
      {/* Main Content. The page heading lives in the standard navbar
          (useNavHeadingStore), so content starts with the identity band.
          The inner wrapper mirrors the LayoutContainer content contract
          because the route opts out of it to keep this full-bleed
          background. */}
      <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        <div className="w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            {/* Left Column - Profile Summary */}
            <div className="lg:col-span-4 xl:col-span-3 space-y-4 md:space-y-6">
              {/* Profile Card. Play mode turns the identity band into a gold
                  celebration surface (highlight band, gold avatar ring,
                  mascot in the corner); vibrant gets the primary-50 wash +
                  top rail. Default rendering is unchanged. */}
              <div
                className={cn(
                  "bg-card rounded-xl border shadow overflow-hidden relative",
                  "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:bg-play-gold-soft [.ui-play_&]:shadow-play-soft-card",
                  "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300 [.ui-vibrant_&]:bg-primary-50"
                )}
              >
                <playIllustrations.FeelingHappy
                  className="pointer-events-none absolute end-3 top-3 hidden h-16 w-auto text-play-accent [.ui-play_&]:!block"
                  aria-hidden="true"
                />
                <div className="p-6 flex flex-col items-center">
                  {/* Profile Image */}
                  <div className="mb-4">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Profile"
                        className="h-32 w-32 rounded-full object-cover shadow-lg border-4 border-border [.ui-play_&]:ring-4 [.ui-play_&]:ring-play-gold"
                      />
                    ) : getInitials(studentData?.full_name) ? (
                      <div
                        className={cn(
                          "h-32 w-32 rounded-full flex items-center justify-center shadow-lg border-4 border-border text-4xl font-semibold",
                          "[.ui-play_&]:ring-4 [.ui-play_&]:ring-play-gold",
                          getAvatarToneClass(studentData?.full_name ?? "")
                        )}
                        aria-label="Profile initials"
                      >
                        {getInitials(studentData?.full_name)}
                      </div>
                    ) : (
                      <div className="h-32 w-32 rounded-full bg-muted flex items-center justify-center shadow-lg border-4 border-gray-200 text-muted-foreground [.ui-play_&]:ring-4 [.ui-play_&]:ring-play-gold">
                        <User size={48} />
                      </div>
                    )}
                  </div>

                  {/* User Info */}
                  <div className="text-center w-full">
                    <h2 className="text-xl font-bold text-foreground [.ui-play_&]:text-h2 [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">
                      {studentData?.full_name || "Student Name"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1 [.ui-play_&]:font-medium [.ui-play_&]:text-play-ink/70">
                      @{studentData?.username || "username"}
                    </p>

                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <div className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-medium border border-primary-200 [.ui-play_&]:border-transparent [.ui-play_&]:bg-white [.ui-play_&]:font-bold [.ui-play_&]:text-play-ink">
                        Student
                      </div>
                      {studentData?.gender && isFieldVisible("GENDER") && (
                        <div className="px-3 py-1 bg-gray-50 text-muted-foreground rounded-full text-xs font-medium border border-gray-200 [.ui-play_&]:border-transparent [.ui-play_&]:bg-white [.ui-play_&]:font-bold [.ui-play_&]:text-play-ink">
                          {studentData.gender}
                        </div>
                      )}
                    </div>

                    {/* Edit action — shown inline on all breakpoints. */}
                    {permissions.canEditProfile && (
                      <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        layoutVariant="default"
                        className="mt-5 inline-flex"
                        onClick={handleEditProfile}
                      >
                        Edit Profile
                      </MyButton>
                    )}
                  </div>
                </div>
              </div>

              {/* Session Expiry / Membership Status — opt-in via the admin's
                  Student Display settings (Profile Page → Show Membership
                  Status); hidden by default. Also hidden in reader mode
                  (iOS / reader-mode institutes): "Access Days" + expiry reads
                  as a paid subscription to App Review (Apple 3.1.1). */}
              {displaySettings?.profile?.showMembershipStatus &&
                !shouldHidePaidPurchaseUI() && (
                <div className="bg-card rounded-xl border shadow p-6">
                  <h3 className="text-sm font-semibold text-foreground mb-4">
                    Membership Status
                  </h3>
                  {studentData && SessionExpiry({ studentData })}
                </div>
              )}
              {studentData && <ProgressStats userId={studentData.user_id} />}
              <BadgesRankCard />

              {/* Language preference — bound to the persisted locale store.
                  Options are the institute's enabled locales (English plus
                  the current selection until an institute enables more). */}
              <div className="bg-card rounded-xl border shadow p-6">
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  {t("profile.language", "Language")}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {t(
                    "profile.languageHint",
                    "Choose the language for menus and buttons."
                  )}
                </p>
                <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger aria-label={t("profile.language", "Language")}>
                    <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {getEnabledLocales(locale).map((option) => (
                      <SelectItem key={option} value={option}>
                        <span lang={option}>{LOCALE_LABELS[option]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Column - Details */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-4 md:space-y-6">
              {/* Academic Journey Card */}
              {showAcademicSection && (
                <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
                    Academic Journey
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-section">
                    {showCourse && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {getTerminology(
                            ContentTerms.Course,
                            SystemTerms.Course
                          )}
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {toTitleCase(courseDetails?.packageName ?? "")}
                        </p>
                      </div>
                    )}
                    {showSession && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {getTerminology(
                            ContentTerms.Session,
                            SystemTerms.Session
                          )}
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {toTitleCase(courseDetails?.sessionName ?? "")}
                        </p>
                      </div>
                    )}
                    {showLevel && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {toTitleCase(courseDetails?.levelName ?? "")}
                        </p>
                      </div>
                    )}
                    {showEnrollment && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Enrollment No.
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.institute_enrollment_id}
                        </p>
                      </div>
                    )}
                    {showCollege && (
                      <div className="sm:col-span-2 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          College/School Name
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.linked_institute_name}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Contact & Location Card */}
              {showContactSection && (
                <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span className="w-1 h-6 bg-secondary-500 rounded-full"></span>
                    Contact & Location
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-section">
                    {showMobile && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Mobile Number
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.mobile_number}
                        </p>
                      </div>
                    )}
                    {showEmail && (
                      <div className="sm:col-span-2 xl:col-span-1 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Email Address
                        </p>
                        <p className="text-base font-medium text-foreground break-words">
                          {studentData?.email}
                        </p>
                      </div>
                    )}

                    {showCountry && (
                      <div
                        className={cn(
                          "sm:col-span-2",
                          showLocationDivider && "pt-6 border-t border-border"
                        )}
                      >
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          Country
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.country}
                        </p>
                      </div>
                    )}
                    {showAddress && (
                      <div
                        className={cn(
                          "sm:col-span-2 xl:col-span-3",
                          showLocationDivider && "pt-6 border-t border-border"
                        )}
                      >
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          Address
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.address_line}
                        </p>
                      </div>
                    )}
                    {showCity && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          City/Village
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.city}
                        </p>
                      </div>
                    )}
                    {showRegion && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          State
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.region}
                        </p>
                      </div>
                    )}
                    {showPincode && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Pincode
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.pin_code}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subscriptions & Autopay — a learner looking to stop a recurring charge
                  looks at their profile, not at an edit form. Only rendered when the
                  learner actually has one, so free learners don't get an empty card.
                  Hidden on native iOS (reader-mode): a recurring-subscription /
                  autopay surface is exactly the paid-subscription content Apple
                  flags under Guideline 3.1.1 (App Review 2026-07-19, io.shikshanation.learner). */}
              {studentData?.institute_id && hasAutopaySubscription && !shouldHidePaidPurchaseUI() && (
                <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
                    Subscriptions &amp; Autopay
                  </h3>
                  <SubscriptionMandateList
                    instituteId={studentData.institute_id}
                  />
                </div>
              )}

              {/* Guardian Info Card — hidden entirely when every guardian field is toggled off or empty */}
              {showGuardianSection && (
                <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span className="w-1 h-6 bg-tertiary-500 rounded-full"></span>
                    Guardian Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-section">
                    {showFather && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Father/Male Guardian
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.father_name}
                        </p>
                      </div>
                    )}
                    {showMother && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Mother/Female Guardian
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.mother_name}
                        </p>
                      </div>
                    )}
                    {showParentsEmail && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Guardian's Email
                        </p>
                        <p className="text-base font-medium text-foreground break-words">
                          {studentData?.parents_email}
                        </p>
                      </div>
                    )}
                    {showParentsMobile && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Guardian's Mobile
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {studentData?.parents_mobile_number}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Terms & Conditions Card — only shown when TnC is enabled for the institute */}
              {(tncAccepted || tncFileUrl) && (
                <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <span className="w-1 h-6 bg-teal-500 rounded-full"></span>
                    <FileText className="size-5 text-teal-600" />
                    Terms &amp; Conditions
                  </h3>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                        Status
                      </p>
                      {tncAccepted ? (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200">
                          Signed
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-700 ring-1 ring-yellow-200">
                          Pending
                        </span>
                      )}
                    </div>

                    {tncAccepted && tncAcceptedDate && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Signed On
                        </p>
                        <p className="text-base font-medium text-foreground">
                          {formatDate(tncAcceptedDate)}
                        </p>
                      </div>
                    )}

                    {tncAccepted && tncFileUrl && (
                      <a
                        href={tncFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 w-fit rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                      >
                        <FileText className="size-4" />
                        Download Signed Agreement
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
