import { H1 } from "@/components/design-system/typography";
import { cn } from "@/lib/utils";
import { BookOpen, Play } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { MyButton } from "@/components/design-system/button";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { handleFetchUserRoleDetails } from "../-services/institute-details";
import { useEffect, useMemo, useState } from "react";
import {
    getLatestResume,
    resumeSearchParams,
    RESUME_ROUTE,
    useResumeScope,
} from "@/services/resume-thread";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { Preferences } from "@capacitor/preferences";
import { TokenKey } from "@/constants/auth/tokens";
import {
    setAuthorizationCookie,
} from "@/lib/auth/sessionUtility";
import { handleGetPublicInstituteDetails } from "@/components/common/layout-container/services/navbar-services";

interface UserRole {
    id: string;
    institute_id: string;
    role_name: string;
    status: string;
    role_id: string;
}

const HeroSection = ({
    allowLeanersToCreateCourses,
}: {
    allowLeanersToCreateCourses: boolean;
}) => {
    const { t } = useTranslation("study");
    // useQuery (NOT useSuspenseQuery): a failed fetch here must not throw to
    // the router error boundary and replace the whole courses page — the hero
    // only loses its optional "Create Course" button.
    const { data: instituteDetails } = useQuery(
        handleGetPublicInstituteDetails()
    );

    const { data: userRoleDetails, isLoading } = useQuery(
        handleFetchUserRoleDetails()
    );

    const [hasTeacherAndStudentRole, setHasTeacherAndStudentRole] =
        useState(false);

    const navigate = useNavigate();
    // Resume thread is written by the slides viewer; read once the signed-in
    // learner is known — the catalog remounts on every visit, so that is fresh enough.
    const resumeScope = useResumeScope();
    const resume = useMemo(() => getLatestResume(resumeScope), [resumeScope]);

    const roleNames = userRoleDetails?.roles?.map(
        (role: UserRole) => role.role_name
    );

    const handleResume = () => {
        if (!resume) return;
        navigate({
            to: RESUME_ROUTE,
            search: resumeSearchParams(resume) as {
                courseId: string;
                levelId?: string;
                subjectId: string;
                moduleId: string;
                chapterId: string;
                slideId: string;
                sessionId: string;
            },
        });
    };

    const handleNavigate = () => {
        if (!instituteDetails?.teacher_portal_base_url) return;
        const accessToken = localStorage.getItem(TokenKey.accessToken);
        const refreshToken = localStorage.getItem(TokenKey.refreshToken);
        window.location.href = `https://${instituteDetails.teacher_portal_base_url}/auth-transfer?accessToken=${accessToken}&refreshToken=${refreshToken}`;
    };

    useEffect(() => {
        setHasTeacherAndStudentRole(
            (roleNames?.includes("STUDENT") ?? false) &&
                (roleNames?.includes("TEACHER") ?? false)
        );
    }, [userRoleDetails]);

    // Auto-set cookies when component mounts
    useEffect(() => {
        const setTokensInCookies = async () => {
            try {
                // Get tokens from storage
                const accessToken = await Preferences.get({
                    key: "accessToken",
                });
                const refreshToken = await Preferences.get({
                    key: "refreshToken",
                });

                // Set cookies if tokens exist
                if (accessToken?.value) {
                    setAuthorizationCookie(
                        TokenKey.accessToken,
                        accessToken.value
                    );
                }
                if (refreshToken?.value) {
                    setAuthorizationCookie(
                        TokenKey.refreshToken,
                        refreshToken.value
                    );
                }
            } catch (error) {
                console.error("Error auto-setting cookies", error);
            }
        };

        setTokensInCookies();
    }, []); // Run only once when component mounts

    if (isLoading) return <DashboardLoader />;

    return (
        <div className={cn(
            "relative bg-background dark:bg-background overflow-hidden w-full max-w-full",
            // Vibrant Styles
            "[.ui-vibrant_&]:bg-gradient-to-b [.ui-vibrant_&]:from-primary/5 [.ui-vibrant_&]:to-transparent"
        )}>
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 start-1/4 w-12 h-12 sm:w-16 sm:h-4 md:w-32 md:h-8 bg-primary-100/20 rounded-full blur-3xl animate-gentle-pulse"></div>
                <div
                    className="absolute bottom-1/3 end-1/3 w-16 h-16 sm:w-20 sm:h-20 md:w-40 md:h-40 bg-primary-50/30 rounded-full blur-3xl animate-gentle-pulse"
                    style={{ animationDelay: "2s" }}
                ></div>
            </div>

            <div className="relative z-10 flex flex-col lg:flex-row mx-auto p-1 sm:p-2 lg:p-3 min-h-20 sm:min-h-8">
                {/* Content Section — leads with the resume thread when one exists */}
                {resume ? (
                    <div className="w-full lg:w-2/3 flex items-center justify-center lg:justify-start">
                        <div className="animate-fade-in-up w-full max-w-2xl min-w-0 text-center lg:text-start">
                            <p
                                className={cn(
                                    "mb-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground",
                                    "[.ui-vibrant_&]:text-primary"
                                )}
                            >
                                {t("hero.resume.eyebrow")}
                            </p>
                            <h1 className="line-clamp-2 break-words text-display-sm text-foreground">
                                {resume.slideTitle}
                            </h1>
                            {(resume.courseName || resume.chapterName) && (
                                <p className="mt-1 truncate text-sm text-muted-foreground">
                                    {resume.courseName ?? resume.chapterName}
                                </p>
                            )}
                            <div className="mt-3">
                                <MyButton
                                    onClick={handleResume}
                                    className="w-full gap-2 sm:w-auto"
                                >
                                    <Play size={16} weight="fill" />
                                    {t("hero.resume.continue")}
                                </MyButton>
                            </div>
                        </div>
                    </div>
                ) : (
                <div className="w-full lg:w-2/3 flex items-center justify-center lg:justify-start">
                    <div className="animate-fade-in-up max-w-2xl text-center lg:text-start">
                        {/* Header with Icon */}
                        <div className="flex items-center justify-center lg:justify-start space-x-1.0 mb-1 sm:mb-2">
                            <div className={cn(
                                "p-0.5 sm:p-1 bg-primary-100 rounded-lg shadow-sm",
                                "[.ui-vibrant_&]:bg-primary/20 [.ui-vibrant_&]:shadow-md [.ui-vibrant_&]:text-primary"
                            )}>
                                <BookOpen
                                    size={16}
                                    className={cn(
                                        "text-primary-600 sm:size-5",
                                        "[.ui-vibrant_&]:text-primary"
                                    )}
                                    weight="duotone"
                                />
                            </div>
                            <div className="flex items-center space-x-0.5 sm:space-x-1">
                                <div className="w-1 h-1 sm:w-1.5 bg-primary-500 rounded-full animate-pulse"></div>
                                <span className={cn(
                                    "text-xs font-semibold text-primary-600 uppercase tracking-wider",
                                    "[.ui-vibrant_&]:text-primary"
                                )}>
                                    {t("hero.catalogEyebrow", {
                                        course: getTerminology(
                                            ContentTerms.Course,
                                            SystemTerms.Course
                                        ),
                                    })}
                                </span>
                            </div>
                        </div>

                        {/* Main Heading */}
                        <H1 className="mb-1 sm:mb-1">{t("hero.title")}</H1>

                        {/* Single Description */}
                        <div className="mb-0.5 sm:mb-1">
                            <p className="text-sm sm:text-base text-gray-600 font-medium leading-relaxed">
                                {t("hero.description")}
                            </p>
                        </div>
                    </div>
                </div>
                )}

                {/* Actions Section (image removed) */}
                <div
                    className={`w-full lg:w-1/3 flex items-right justify-end lg:items-end lg:ms-auto p-0.5 sm:p-1 animate-fade-in-up ${allowLeanersToCreateCourses
                        ? "gap-2 sm:gap-3 flex-col"
                        : ""
                        }`}
                    style={{ animationDelay: "0.4s" }}
                >
                    {hasTeacherAndStudentRole && (
                        <>
                            <MyButton
                                onClick={handleNavigate}
                                className="w-full sm:w-auto"
                            >
                                {t("hero.createCourse", {
                                    course: getTerminology(
                                        ContentTerms.Course,
                                        SystemTerms.Course
                                    ),
                                })}
                            </MyButton>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HeroSection;
