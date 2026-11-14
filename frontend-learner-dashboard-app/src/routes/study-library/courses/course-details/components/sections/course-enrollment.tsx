import { GraduationCap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { MyButton } from "@/components/design-system/button";
import {
    getTerminology,
    getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { cn } from "@/lib/utils";

interface SessionOption {
    _id: string;
    value: string;
    label: string;
}

interface LevelOption {
    _id: string;
    value: string;
    label: string;
}

interface EnrolledSession {
    id: string;
    session: {
        id: string;
        session_name: string;
        status: string;
        start_date: string;
    };
    level: {
        id: string;
        level_name: string;
        duration_in_days: number | null;
        thumbnail_id: string | null;
    };
    start_time: string | null;
    status: string;
    package_dto: {
        id: string;
        package_name: string;
        thumbnail_id?: string | null;
    };
}

interface CourseEnrollmentProps {
    showCourseConfiguration: boolean;
    selectedTab: string;
    sessionOptions: SessionOption[];
    levelOptions: LevelOption[];
    selectedSession: string;
    selectedLevel: string;
    enrolledSessions: EnrolledSession[];
    courseId: string;
    hasRightSidebar: boolean;
    paymentType?: string | null;
    certificateUrl?: string | null;
    onSessionChange: (value: string) => void;
    onLevelChange: (value: string) => void;
    onEnrollmentClick: () => void;
}

export const CourseEnrollment = ({
    showCourseConfiguration,
    selectedTab,
    sessionOptions,
    levelOptions,
    selectedSession,
    selectedLevel,
    enrolledSessions,
    courseId,
    hasRightSidebar,
    // paymentType,
    certificateUrl,
    onSessionChange,
    onLevelChange,
    onEnrollmentClick,
}: CourseEnrollmentProps) => {
    const { t } = useTranslation("courseDetailsC");
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const session = getTerminology(ContentTerms.Session, SystemTerms.Session);

    if (!showCourseConfiguration) return null;

    const safeEnrolledSessions = enrolledSessions || [];
    const isEnrolledInCourse = safeEnrolledSessions.some(
        (enrolledSession) => enrolledSession.package_dto.id === courseId
    );

    return (
        <div
            className={cn(
                "relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-200 p-3 sm:p-4 group animate-fade-in-up",
                // Vibrant Styles - Flat Pastel
                "[.ui-vibrant_&]:bg-indigo-50/50 dark:[.ui-vibrant_&]:bg-indigo-950/20",
                "[.ui-vibrant_&]:border-indigo-200/50 dark:[.ui-vibrant_&]:border-indigo-800/30 [.ui-vibrant_&]:shadow-md"
            )}
            style={{ animationDelay: "0.1s" }}
        >
            {/* Background gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>

            {/* Floating orb effect */}
            <div className="absolute top-0 end-0 w-12 h-12 bg-primary-100/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 -translate-y-1 translate-x-3"></div>

            <div className="relative">
                <div className="flex items-center space-x-2 mb-3">
                    <div className={cn(
                        "p-1.5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-md shadow-sm",
                        "[.ui-vibrant_&]:bg-primary/20 [.ui-vibrant_&]:text-primary"
                    )}>
                        <GraduationCap
                            size={18}
                            className={cn(
                                "text-primary-600",
                                "[.ui-vibrant_&]:text-primary"
                            )}
                            weight="duotone"
                        />
                    </div>
                    <h3 className={cn(
                        "text-base font-bold text-gray-900",
                        "[.ui-vibrant_&]:text-foreground"
                    )}>
                        {t("enrollment.configTitle", { course })}
                    </h3>
                </div>

                {sessionOptions && sessionOptions.length > 0 ? (
                    <div>
                        {/* Preview notice for ALL tab - only show if user is not enrolled */}
                        {selectedTab === "ALL" && !isEnrolledInCourse && (
                            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-sm"></div>
                                    <span className="text-sm font-medium text-blue-800">
                                        {t("enrollment.previewModeLabel", { course })}
                                    </span>
                                </div>
                                <p className="text-xs text-blue-700 mt-1">
                                    {t("enrollment.previewModeDescription", {
                                        course: course.toLocaleLowerCase(),
                                        slides: getTerminologyPlural(
                                            ContentTerms.Slides,
                                            SystemTerms.Slides
                                        ).toLocaleLowerCase(),
                                    })}
                                </p>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack lg:gap-4">
                            {/* Session Selector */}
                            {sessionOptions &&
                                sessionOptions.length > 0 &&
                                (sessionOptions.length === 1 &&
                                    sessionOptions[0].label === "default" ? null : sessionOptions.length === 1 ? (
                                        <div className="p-2.5 bg-gray-50/80 rounded-lg border border-gray-200">
                                            <span className="text-sm font-medium text-gray-900">
                                                {sessionOptions[0]?.label}
                                            </span>
                                        </div>
                                    ) : sessionOptions.length > 1 ? (
                                        <div className="flex flex-col gap-2">
                                            <Select
                                                value={selectedSession}
                                                onValueChange={onSessionChange}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={t(
                                                            "enrollment.selectSessionPlaceholder",
                                                            { session }
                                                        )}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sessionOptions.map((option) => (
                                                        <SelectItem
                                                            key={option._id}
                                                            value={option.value}
                                                        >
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null)}

                            {/* Level Selector */}
                            {levelOptions &&
                                levelOptions.length > 0 &&
                                (levelOptions.length === 1 &&
                                    levelOptions[0].label === "default" ? null : levelOptions.length === 1 ? (
                                        <div className="p-2.5 bg-gray-50/80 rounded-lg border border-gray-200">
                                            <span className="text-sm font-medium text-gray-900">
                                                {levelOptions[0]?.label}
                                            </span>
                                        </div>
                                    ) : levelOptions.length > 1 ? (
                                        <div className="flex flex-col gap-2">
                                            <Select
                                                value={selectedLevel}
                                                onValueChange={onLevelChange}
                                                disabled={!selectedSession}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={t(
                                                            "enrollment.selectLevelPlaceholder",
                                                            {
                                                                level: getTerminology(
                                                                    ContentTerms.Level,
                                                                    SystemTerms.Level
                                                                ),
                                                            }
                                                        )}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {levelOptions.map((option) => (
                                                        <SelectItem
                                                            key={option._id}
                                                            value={option.value}
                                                        >
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null)}
                        </div>
                    </div>
                ) : (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-yellow-500 rounded-sm"></div>
                            <span className="text-sm font-medium text-yellow-800">
                                {selectedTab === "ALL"
                                    ? t("enrollment.noSessionForCourse", {
                                        session: session.toLocaleLowerCase(),
                                        course: course.toLocaleLowerCase(),
                                    })
                                    : t("enrollment.notEnrolledInSession", {
                                        session: session.toLocaleLowerCase(),
                                        course: course.toLocaleLowerCase(),
                                    })}
                            </span>
                        </div>
                        <p className="text-xs text-yellow-700 mt-1">
                            {selectedTab === "ALL"
                                ? t("enrollment.noActiveSessionsConfigured", {
                                    course: course.toLocaleLowerCase(),
                                    session: getTerminologyPlural(
                                        ContentTerms.Session,
                                        SystemTerms.Session
                                    ).toLocaleLowerCase(),
                                })
                                : t("enrollment.contactToEnroll", {
                                    teacher: getTerminology(
                                        RoleTerms.Teacher,
                                        SystemTerms.Teacher
                                    ).toLocaleLowerCase(),
                                    admin: getTerminology(
                                        RoleTerms.Admin,
                                        SystemTerms.Admin
                                    ).toLocaleLowerCase(),
                                })}
                        </p>
                    </div>
                )}
            </div>

            {/* Certificate Section */}
            {certificateUrl && (
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-200 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.05s" }}
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-success-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
                    <div className="relative flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-gradient-to-br from-success-100 to-success-200 rounded-md shadow-sm">
                                <GraduationCap
                                    size={18}
                                    className="text-emerald-600"
                                    weight="duotone"
                                />
                            </div>
                            <div>
                                <div className="text-sm font-bold text-gray-900">
                                    {t("enrollment.certificateAvailable")}
                                </div>
                                <div className="text-xs text-gray-600">
                                    {t("enrollment.certificateDescription")}
                                </div>
                            </div>
                        </div>
                        <a
                            href={certificateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 rounded-md text-xs font-medium shadow"
                        >
                            {t("common.viewCertificate")}
                        </a>
                    </div>
                </div>
            )}

            {/* Inline Enroll card when sidebar is hidden */}
            {!hasRightSidebar &&
                selectedTab === "ALL" &&
                (() => {
                    if (!selectedSession || !selectedLevel)
                        return null;
                    const safeEnrolledSessions = enrolledSessions || [];
                    const isAlreadyEnrolled =
                        safeEnrolledSessions.some(
                            (enrolledSession) =>
                                enrolledSession.package_dto.id === courseId &&
                                enrolledSession.session.id === selectedSession &&
                                enrolledSession.level.id === selectedLevel
                        );
                    if (isAlreadyEnrolled) return null;
                    return (
                        <div className="relative bg-white border border-gray-200 rounded-md shadow-sm p-2 sm:p-3">
                            <MyButton
                                type="button"
                                scale="large"
                                buttonType="primary"
                                layoutVariant="default"
                                className="!min-w-full !w-full text-xs h-8"
                                onClick={onEnrollmentClick}
                            >
                                {t("enrollment.enrollButton")}
                            </MyButton>
                        </div>
                    );
                })()}
        </div>
    );
};
