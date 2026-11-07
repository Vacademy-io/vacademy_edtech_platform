import { Steps } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
// Removed unused icon imports to improve modularity and avoid linter warnings
import { sanitizeHtml, toTitleCase } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useState, useEffect, useMemo, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
    CourseDetailsFormValues,
    courseDetailsSchema,
} from "./course-details-schema";
import {
    VideoSlide,
    DocumentSlide,
    QuestionSlide,
    AssignmentSlide,
} from "../../-services/getAllSlides";
import { useQuery } from "@tanstack/react-query";
import { CourseDetailsRatingsComponent } from "./course-details-ratings-page";
import {
    getIdByLevelAndSession,
    transformApiDataToCourseData,
} from "../-utils/helper";
import { VideoPlayer } from "./course-details-video-player";
import { handleGetCourseInit } from "../-services/get-course-details";
import axios from "axios";
import { urlInstituteDetails } from "@/constants/urls";
import CourseListHeader from "../../-component/CourseListHeader";
import { MyButton } from "@/components/design-system/button";
import { CourseStructureDetails } from "./course-structure-details";
import { handleGetSlideCountDetails } from "../-services/get-slides-count";
import {
    BatchForSessionType,
    InstituteDetailsType,
} from "@/types/institute-details/institute-details-interface";
// CourseStructureResponse no longer needed - using single course fetch
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { AuthModal } from "@/components/common/auth/modal/AuthModal";
// import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
// import { TokenKey } from "@/constants/auth/tokens";
// import { Preferences } from "@capacitor/preferences";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { extractTextFromHTML } from "@/components/common/helper";
import { SlideCountEntry } from "@/utils/courseTime";
import { CourseStatsSidebar } from "@/routes/study-library/courses/course-details/-components/course-stats-sidebar";
import { useCatalogStore } from "@/routes/courses/-store/catalogStore";
import { formatTotalCourseDuration, getBackendCourseDuration } from "@/utils/courseTime";
import { useCourseDisplaySettings } from "@/routes/study-library/courses/course-details/-hooks/use-course-display-settings";
import { authorRoleTag, sharedAuthorRole } from "@/lib/course-author-role";

type SlideType = {
    id: string;
    name: string;
    type: string;
    description: string;
    status: string;
    order: number;
    videoSlide?: VideoSlide;
    documentSlide?: DocumentSlide;
    questionSlide?: QuestionSlide;
    assignmentSlide?: AssignmentSlide;
};

export type ChapterType = {
    id: string;
    name: string;
    status: string;
    file_id: string;
    description: string;
    chapter_order: number;
    slides: SlideType[];
    isOpen?: boolean;
};

export type ModuleType = {
    id: string;
    name: string;
    description: string;
    status: string;
    thumbnail_id: string;
    chapters: ChapterType[];
    isOpen?: boolean;
};

export type SubjectType = {
    id: string;
    subject_name: string;
    subject_code: string;
    credit: number;
    thumbnail_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    modules: ModuleType[];
};

type Course = {
    id: string;
    title: string;
    level: 1 | 2 | 3 | 4 | 5;
    structure: {
        courseName: string;
        items: SubjectType[] | ModuleType[] | ChapterType[] | SlideType[];
    };
};

// Using SlideCountEntry from courseTime util instead

const mockCourses: Course[] = [
    {
        id: "1",
        title: `2-Level ${getTerminology(
            ContentTerms.Course,
            SystemTerms.Course
        )} Structure`,
        level: 2,
        structure: {
            courseName: "Introduction to Web Development",
            items: [] as SlideType[],
        },
    },
    {
        id: "2",
        title: `3-Level ${getTerminology(
            ContentTerms.Course,
            SystemTerms.Course
        )} Structure`,
        level: 3,
        structure: {
            courseName: "Frontend Fundamentals",
            items: [] as SlideType[],
        },
    },
    {
        id: "3",
        title: `4-Level ${getTerminology(
            ContentTerms.Course,
            SystemTerms.Course
        )} Structure`,
        level: 4,
        structure: {
            courseName: "Full-Stack JavaScript Development Mastery",
            items: [] as ModuleType[],
        },
    },
    {
        id: "4",
        title: `5-Level ${getTerminology(
            ContentTerms.Course,
            SystemTerms.Course
        )} Structure`,
        level: 5,
        structure: {
            courseName: "Advanced Software Engineering Principles",
            items: [] as SubjectType[],
        },
    },
];

export const CourseDetailsPage = () => {
    const { showInstructors } = useCourseDisplaySettings();
    const { t } = useTranslation("coursesRouteB");
    const [selectedSession, setSelectedSession] = useState<string>("");
    const [selectedLevel, setSelectedLevel] = useState<string>("");
    const router = useRouter();
    const searchParams = router.state.location.search;
    const domainRouting = useDomainRouting();
    
    // Get catalog store for fallback instructor data
    const { courseData } = useCatalogStore();

    // Loading state management
    const [isLoading, setIsLoading] = useState(true);
    const [loadingStates, setLoadingStates] = useState({
        instituteDetails: false,
        courseDetails: false,
        slideCount: false,
        modulesData: false,
        ratingsData: false,
        userData: false,
    });

    // Function to update loading states
    const updateLoadingState = useCallback(
        (key: keyof typeof loadingStates, value: boolean) => {
            setLoadingStates((prev) => ({ ...prev, [key]: value }));
        },
        []
    );

    // Check if all loading states are complete
    const isAllLoadingComplete = useMemo(() => {
        return Object.values(loadingStates).every((state) => !state);
    }, [loadingStates]);

    // Update main loading state when all individual states are complete
    useEffect(() => {
        if (isAllLoadingComplete) {
            setIsLoading(false);
        }
    }, [isAllLoadingComplete]);



    // Memoized callback functions for child components
    const handleModulesLoadingChange = useCallback(
        (loading: boolean) => {
            updateLoadingState("modulesData", loading);
        },
        [updateLoadingState]
    );

    const handleRatingsLoadingChange = useCallback(
        (loading: boolean) => {
            updateLoadingState("ratingsData", loading);
        },
        [updateLoadingState]
    );

    // Use domain routing resolved instituteId
    const instituteId = domainRouting.instituteId;
    const isLoadingInstituteId = domainRouting.isLoading;

    // Update institute ID loading state
    useEffect(() => {
        updateLoadingState("userData", isLoadingInstituteId);
    }, [isLoadingInstituteId, updateLoadingState]);

    const [
        packageSessionIdForCurrentLevel,
        setPackageSessionIdForCurrentLevel,
    ] = useState<string | null>(null);
    // NEW: Backend course timing data
    const [backendReadTimeMinutes, setBackendReadTimeMinutes] = useState<number | null>(null);

    const findIdByPackageId = useCallback((data: BatchForSessionType[]) => {
        const result = data?.find(
            (item) => item.package_dto?.id === searchParams.courseId
        );
        return result?.id || "";
    }, [searchParams.courseId]);

    const [packageSessionIds, setPackageSessionIds] = useState<string | null>(
        null
    );
    const [fetchedBatches, setFetchedBatches] = useState<BatchForSessionType[]>([]);

    const [instituteDetails, setInstituteDetails] =
        useState<InstituteDetailsType | null>(null);

    // ✅ Fetch institute details
    useEffect(() => {
        if (!instituteId) return; // Don't fetch if instituteId is not available

        const fetchInstituteDetails = async () => {
            updateLoadingState("instituteDetails", true);
            try {
                // Fetch institute details
                const response = await axios.get(
                    `${urlInstituteDetails}/${instituteId}`
                );
                setInstituteDetails(response?.data);

                // Fetch batches for specific course
                if (searchParams?.courseId) {
                    const { fetchBatchesForCourse } = await import("@/services/courseBatches");
                    const batches = await fetchBatchesForCourse(searchParams.courseId);
                    
                    if (batches && batches.length > 0) {
                        setFetchedBatches(batches);
                        setPackageSessionIds(
                            findIdByPackageId(batches)
                        );
                        
                        setPackageSessionIdForCurrentLevel(
                            getIdByLevelAndSession(
                                batches,
                                selectedSession,
                                selectedLevel,
                                searchParams?.courseId || ""
                            )
                        );

                        // NEW: Extract backend read_time_in_minutes from matching batch
                        const matchingBatch = batches.find((batch: unknown) => {
                            const typedBatch = batch as { level?: { id?: string }; session?: { id?: string }; package_dto?: { id?: string }; read_time_in_minutes?: number };
                            return typedBatch.level?.id === selectedLevel &&
                                   typedBatch.session?.id === selectedSession &&
                                   typedBatch.package_dto?.id === (searchParams?.courseId || "");
                        });
                        const typedMatchingBatch = matchingBatch as { read_time_in_minutes?: number } | undefined;
                        if (typedMatchingBatch?.read_time_in_minutes) {
                            setBackendReadTimeMinutes(typedMatchingBatch.read_time_in_minutes);
                        } else {
                            setBackendReadTimeMinutes(null); // Reset if no backend data
                        }
                    }
                }
            } catch (error) {
                console.log(error);
            } finally {
                updateLoadingState("instituteDetails", false);
            }
        };

        fetchInstituteDetails();
    }, [instituteId, selectedSession, selectedLevel, searchParams?.courseId, updateLoadingState, findIdByPackageId]);

    // Fetch single course details using scalable endpoint
    const { data: courseDetailsData, isLoading: isCourseDetailsLoading } =
        useQuery({
            ...handleGetCourseInit({
                courseId: searchParams?.courseId || "",
                instituteId: instituteId || "",
            }),
        });

    // Update course details loading state
    useEffect(() => {
        updateLoadingState("courseDetails", isCourseDetailsLoading);
    }, [isCourseDetailsLoading, updateLoadingState]);

    const form = useForm<CourseDetailsFormValues>({
        resolver: zodResolver(courseDetailsSchema),
        defaultValues: {
            courseData: {
                id: "",
                title: "",
                description: "",
                tags: [],
                imageUrl: "",
                courseStructure: 1,
                whatYoullLearn: "",
                whyLearn: "",
                whoShouldLearn: "",
                aboutTheCourse: "",
                packageName: "",
                status: "",
                isCoursePublishedToCatalaouge: false,
                coursePreviewImageMediaId: "",
                courseBannerMediaId: "",
                courseMediaId: "",
                courseHtmlDescription: "",
                instructors: [],
                sessions: [],
            },
            mockCourses: [],
        },
        mode: "onChange",
    });

    // Function to get author name with fallback logic
    const getAuthorName = useCallback(() => {
        // First try to get from form data (API response)
        const formInstructors = form.getValues("courseData")?.instructors;
        if (formInstructors && formInstructors.length > 0 && formInstructors[0]?.name) {
            return formInstructors[0].name;
        }

        // Fallback to catalog data
        const catalogCourse = courseData.find(course => course.id === searchParams.courseId);
        if (catalogCourse?.instructors && catalogCourse.instructors.length > 0) {
            const instructor = catalogCourse.instructors[0];
            return instructor.full_name || instructor.username || t("courseDetailsPage.unknownInstructor", {
                instructor: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
            });
        }

        return undefined; // Change null to undefined to match the expected type
    }, [form, courseData, searchParams.courseId]);

    // Initials from the author's NAME. This used to take the email's local
    // part, and the avatar's alt text was the email itself -- a staff address
    // must not reach the learner's DOM at all.
    const getInitials = (name: string) => {
        const parts = name.trim().split(/\s+/).filter(Boolean);
        const initials =
            parts.length >= 2
                ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
                : (parts[0] ?? "").slice(0, 2);
        return initials.toUpperCase() || "?";
    };

    const [levelOptions, setLevelOptions] = useState<
        { _id: string; value: string; label: string }[]
    >([]);

    // Convert sessions to select options format
    const watchedSessions = form.watch("courseData.sessions");
    const sessionOptions = useMemo(() => {
        const sessions = watchedSessions || [];
        return sessions.map((session) => ({
            _id: session.sessionDetails.id,
            value: session.sessionDetails.id,
            label: toTitleCase(session.sessionDetails.session_name),
        }));
    }, [watchedSessions]);

    // Determine if selectors should be hidden when names are 'default'
    const isSessionDefault = useMemo(() => {
        return (
            sessionOptions.length === 1 &&
            (sessionOptions[0]?.label || "").toLowerCase() === "default"
        );
    }, [sessionOptions]);

    const isLevelDefault = useMemo(() => {
        return (
            levelOptions.length === 1 &&
            (levelOptions[0]?.label || "").toLowerCase() === "default"
        );
    }, [levelOptions]);

    // Update level options when session changes
    const handleSessionChange = useCallback((sessionId: string) => {
        setSelectedSession(sessionId);
        const sessions = form.getValues("courseData")?.sessions || [];
        const selectedSessionData = sessions.find(
            (session) => session.sessionDetails.id === sessionId
        );

        if (selectedSessionData) {
            const newLevelOptions = selectedSessionData.levelDetails.map(
                (level) => ({
                    _id: level.id,
                    value: level.id,
                    label: level.name,
                })
            );
            setLevelOptions(newLevelOptions);

            // Select the first level when session changes
            if (newLevelOptions.length > 0 && newLevelOptions[0]?.value) {
                setSelectedLevel(newLevelOptions[0].value);
            } else {
                setSelectedLevel("");
            }
        }
    }, [form]);

    // Handle level change - clear expanded items and reset state
    const handleLevelChange = (levelId: string) => {
        setSelectedLevel(levelId);
    };

    // Set initial session and its levels
    // Set initial session and its levels
    useEffect(() => {

        // Validation: Verify if the requested packageSessionId exists in the fetched batches
        if (searchParams.packageSessionId && fetchedBatches.length > 0) {
            const targetBatch = fetchedBatches.find(b => b.id === searchParams.packageSessionId);
            
            // If found, attempt to set it
            if (targetBatch?.session?.id && targetBatch?.level?.id) {
                 // Ensure form data is loaded so handleSessionChange (which relies on it) works
                 const sessions = form.getValues("courseData")?.sessions;
                 if (sessions && sessions.length > 0) {
                     if (selectedSession !== targetBatch.session.id) {
                        handleSessionChange(targetBatch.session.id);
                        // We must set level AFTER simple logic in handleSessionChange might have set a default
                        setTimeout(() => {
                            setSelectedLevel(targetBatch.level.id);
                        }, 0);
                     } else if (selectedLevel !== targetBatch.level.id) {
                        setSelectedLevel(targetBatch.level.id);
                     }
                     return; 
                 }
            }
        }

        // Fallback: Default logic (only if we are NOT trying to resolve a specific ID, or if we gave up?)
        const conversionFailed = searchParams.packageSessionId && fetchedBatches.length > 0 && !fetchedBatches.find(b => b.id === searchParams.packageSessionId);
        
        if (
            sessionOptions.length > 0 &&
            !selectedSession &&
            sessionOptions[0]?.value &&
            (!searchParams.packageSessionId || conversionFailed)
        ) {
            const initialSessionId = sessionOptions[0].value;
            handleSessionChange(initialSessionId);
        }
    }, [sessionOptions, handleSessionChange, selectedSession, selectedLevel, searchParams.packageSessionId, fetchedBatches, form]);

    // Initialize session and level from course-init data when batches are not available (for unauthenticated users)
    useEffect(() => {
        // Only run if we don't have a selected session yet and we have course data
        if (selectedSession || !courseDetailsData?.sessions) return;

        // Get the first session from course-init data
        const firstSession = courseDetailsData.sessions[0];
        if (firstSession?.session_dto?.id) {
            const sessionId = firstSession.session_dto.id;
            setSelectedSession(sessionId);

            // Get the first level from that session
            const firstLevel = firstSession.level_with_details?.[0];
            if (firstLevel?.id) {
                setSelectedLevel(firstLevel.id);

                // Look up package_session_id from package_sessions array
                const packageSessions = courseDetailsData.package_sessions;
                if (Array.isArray(packageSessions)) {
                    const match = packageSessions.find(
                        (ps: { level?: { id?: string }; session?: { id?: string } }) =>
                            ps.level?.id === firstLevel.id && ps.session?.id === sessionId
                    );
                    if (match?.id) {
                        setPackageSessionIdForCurrentLevel(match.id);
                    }
                }

                // Set the read_time_in_minutes from the level
                if (firstLevel.read_time_in_minutes) {
                    setBackendReadTimeMinutes(firstLevel.read_time_in_minutes);
                }
            }
        }
    }, [courseDetailsData, selectedSession]);

    // Sync packageSessionIdForCurrentLevel from course-init data whenever session/level changes
    useEffect(() => {
        if (!selectedSession || !selectedLevel || !courseDetailsData) return;

        // Look up package_session_id from package_sessions array by matching level + session
        const packageSessions = courseDetailsData.package_sessions;
        if (Array.isArray(packageSessions)) {
            const match = packageSessions.find(
                (ps: { level?: { id?: string }; session?: { id?: string } }) =>
                    ps.level?.id === selectedLevel && ps.session?.id === selectedSession
            );
            if (match?.id) {
                setPackageSessionIdForCurrentLevel(match.id);
            }
        }

        // Update read_time_in_minutes from level_with_details
        const session = courseDetailsData.sessions?.find(
            (s: { session_dto: { id: string } }) => s.session_dto.id === selectedSession
        );
        const level = session?.level_with_details?.find(
            (l: { id: string }) => l.id === selectedLevel
        );
        if (level?.read_time_in_minutes) {
            setBackendReadTimeMinutes(level.read_time_in_minutes);
        } else {
            setBackendReadTimeMinutes(null);
        }
    }, [selectedSession, selectedLevel, courseDetailsData]);

    useEffect(() => {
        const loadCourseData = async () => {
            if (courseDetailsData?.course) {
                try {
                    const transformedData =
                        await transformApiDataToCourseData(courseDetailsData, t);
                    if (transformedData) {
                        form.reset({
                            courseData: transformedData,
                            mockCourses: mockCourses,
                        });
                    }
                } catch (error) {
                    console.error("Error transforming course data:", error);
                }
            }
        };

        loadCourseData();
    }, [courseDetailsData, form]);

    // Add this with other queries at the top level of the component
    const slideCountQuery = useQuery({
        ...handleGetSlideCountDetails(packageSessionIds || ""),
        enabled: !!packageSessionIds,
    });

    // Update slide count loading state
    useEffect(() => {
        updateLoadingState("slideCount", slideCountQuery.isLoading);
    }, [slideCountQuery.isLoading, updateLoadingState]);

    // Total duration is computed via utility where needed

    // Temporarily disabled automatic redirect to prevent redirect loops
    // useEffect(() => {
    //     const redirectToDashboardIfAuthenticated = async () => {
    //         const token = await getTokenFromStorage(TokenKey.accessToken);
    //         const studentDetails = await Preferences.get({
    //             key: "StudentDetails",
    //         });
    //         const instituteDetails = await Preferences.get({
    //             key: "InstituteDetails",
    //         });

    //         // Only redirect if the user is authenticated and we're not already on a course details page
    //         // This prevents redirect loops and allows users to stay on the public course details page
    //         if (
    //             !isNullOrEmptyOrUndefined(token) &&
    //             !isNullOrEmptyOrUndefined(studentDetails) &&
    //             !isNullOrEmptyOrUndefined(instituteDetails) &&
    //             !window.location.pathname.includes('/study-library/') &&
    //             !window.location.pathname.includes('/course-details')
    //         ) {
    //             // Only redirect if we're coming from a different page, not if we're already on course details
    //             const referrer = document.referrer;
    //             const isComingFromCoursesPage = referrer.includes('/courses') && !referrer.includes('/course-details');
                
    //             if (isComingFromCoursesPage) {
    //             navigate({
    //                 to: "/study-library/courses/course-details",
    //                 search: {
    //                     courseId: searchParams.courseId || "",
    //                 },
    //                 replace: true,
    //             });
    //         }
    //     }
    //     };

    //     redirectToDashboardIfAuthenticated();
    // }, [navigate]);

    // Show loading until essential APIs are complete
    // Note: packageSessionIdForCurrentLevel is not required for initial render
    if (isLoading || isLoadingInstituteId || !instituteId || !courseDetailsData) {
        return <DashboardLoader />;
    }

    // "Acharya" when every author is one; otherwise the institute term + a role line each.
    const instructorsHeading = sharedAuthorRole(
        (form.getValues("courseData")?.instructors ?? []).map((i) => i.roleLabel),
        getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher)
    );

    return (
        <>
            <div className="flex min-h-screen flex-col bg-white w-full">
                <CourseListHeader
                    fileId={instituteDetails?.institute_logo_file_id || ""}
                    instituteId={instituteDetails?.id}
                    type="courseDetailsPage"
                    courseId={searchParams.courseId || ""}
                />
                {/* Top Banner */}
                <div className="relative min-h-48 sm:min-h-64 md:min-h-72">
                    {/* Transparent black overlay */}
                    {form.watch("courseData").courseBannerMediaId ? (
                        <div className="pointer-events-none absolute inset-0 z-10 bg-black/50" />
                    ) : (
                        <div className="pointer-events-none absolute inset-0 z-10 bg-black/10" />
                    )}
                    {!form.watch("courseData").courseBannerMediaId ? (
                        <div className="absolute inset-0 z-0 bg-transparent" />
                    ) : (
                        <div className="absolute inset-0 z-0 opacity-70">
                            <img
                                src={
                                    form.watch("courseData").courseBannerMediaId
                                }
                                alt={t("courseDetailsPage.courseBannerAlt", {
                                    course: getTerminology(
                                        ContentTerms.Course,
                                        SystemTerms.Course
                                    ),
                                })}
                                className="size-full object-cover"
                                onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                    e.currentTarget.parentElement?.classList.add(
                                        "bg-primary-500"
                                    );
                                }}
                            />
                        </div>
                    )}
                    {/* Primary color overlay with 70% opacity */}
                    <div
                        className={`relative z-20 px-8 py-6 sm:py-8 md:py-12 ${
                            !form.watch("courseData").courseBannerMediaId
                                ? "text-black"
                                : "text-white"
                        }`}
                    >
                        <div className="flex flex-col lg:flex-row items-start justify-between gap-4 lg:gap-8">
                            {/* Left side - Title and Description */}
                            <div className="w-full lg:max-w-2xl">
                                {!form.watch("courseData").title ? (
                                    <div className="space-y-4">
                                        <div className="h-6 sm:h-8 w-24 sm:w-32 animate-pulse rounded bg-white/20" />
                                        <div className="h-8 sm:h-12 w-full sm:w-3/4 animate-pulse rounded bg-white/20" />
                                        <div className="h-3 sm:h-4 w-full animate-pulse rounded bg-white/20" />
                                        <div className="h-3 sm:h-4 w-2/3 animate-pulse rounded bg-white/20" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="mb-3 sm:mb-4 flex flex-wrap gap-2">
                                            {form
                                                .getValues("courseData")
                                                .tags.map((tag, index) => (
                                                    <span
                                                        key={index}
                                                        className={`rounded-full px-2 sm:px-3 py-1 text-xs sm:text-sm ${
                                                            !form.watch(
                                                                "courseData"
                                                            )
                                                                .courseBannerMediaId
                                                                ? "text-black bg-white"
                                                                : "text-white bg-blue-500"
                                                        }`}
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                        </div>
                                        <h1 className="mb-3 sm:mb-4 text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">
                                            {form.getValues("courseData").title}
                                        </h1>
                                        <p
                                            className="text-base sm:text-lg opacity-90 leading-relaxed"
                                            dangerouslySetInnerHTML={{
                                                __html:
                                                    form.getValues("courseData")
                                                        .description || "",
                                            }}
                                        />
                                    </>
                                )}
                            </div>

                            {/* Right side - Video Player */}
                            {form.watch("courseData").courseMediaId && (
                                <div className="hidden lg:block w-full lg:w-auto mt-4 lg:mt-0">
                                    <VideoPlayer
                                        src={
                                            form.watch("courseData")
                                                .courseMediaId
                                        }
                                        className="!w-full sm:!w-80 md:!w-96 lg:!w-96"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Main Content */}
                <div className="px-12 py-6 sm:py-8">
                    <div className="flex flex-col lg:flex-row gap-section lg:gap-8">
                        {/* Left Column - Full width on mobile, 2/3 on larger screens */}
                        <div className="w-full lg:w-2/3 lg:grow">
                            {/* Session and Level Selectors */}
                            {!(isSessionDefault || isLevelDefault) && (
                            <div className=" px-0 pb-4 sm:pb-6">
                                {/* Video Player for smaller screens - positioned above levels */}
                                {form.watch("courseData").courseMediaId && (
                                    <div className="mb-6 lg:hidden flex items-start">
                                        <VideoPlayer
                                            src={
                                                form.watch("courseData")
                                                    .courseMediaId
                                            }
                                            className="!w-full max-w-sm"
                                        />
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
                                    {/* Session Dropdown Logic */}
                                    {sessionOptions.length === 1 &&
                                    sessionOptions[0].label ===
                                        "default" ? null : sessionOptions.length ===
                                      1 ? (
                                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                                            <label className="text-sm font-medium">
                                                {sessionOptions[0]?.label}
                                            </label>
                                        </div>
                                    ) : sessionOptions.length > 1 ? (
                                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                                            <label className="text-sm font-medium">
                                                {getTerminology(ContentTerms.Session, SystemTerms.Session)}
                                            </label>
                                            <Select
                                                value={selectedSession}
                                                onValueChange={
                                                    handleSessionChange
                                                }
                                            >
                                                <SelectTrigger className="w-full sm:w-48">
                                                    <SelectValue placeholder={t("courseDetailsPage.selectors.sessionPlaceholder", { session: getTerminology(ContentTerms.Session, SystemTerms.Session) })} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sessionOptions.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={option._id}
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null}

                                    {/* Level Dropdown Logic */}
                                    {levelOptions.length === 1 &&
                                    levelOptions[0].label ===
                                        "default" ? null : levelOptions.length ===
                                      1 ? (
                                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                                            <label className="text-sm font-medium">
                                                {/* {levelOptions[0]?.label} */}
                                            </label>
                                        </div>
                                    ) : levelOptions.length > 1 ? (
                                        <div className="flex flex-col gap-2 w-full sm:w-auto">
                                            <label className="text-sm font-medium">
                                                {getTerminology(ContentTerms.Level, SystemTerms.Level)}
                                            </label>
                                            <Select
                                                value={selectedLevel}
                                                onValueChange={
                                                    handleLevelChange
                                                }
                                                disabled={!selectedSession}
                                            >
                                                <SelectTrigger className="w-full sm:w-48">
                                                    <SelectValue placeholder={t("courseDetailsPage.selectors.levelPlaceholder", { level: getTerminology(ContentTerms.Level, SystemTerms.Level) })} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {levelOptions.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={option._id}
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            )}
                            {/* Enroll Button Card - shown above CourseStructureDetails for smaller screens */}
                            <div className="lg:hidden mb-6">
                                <div className="w-full max-w-reg-350 rounded-lg border bg-white p-4 sm:p-6 shadow-lg">
                                    {/* Course Stats */}
                                    <h2 className="mb-3 sm:mb-4 text-base sm:text-lg font-bold line-clamp-2">
                                        {form.getValues("courseData").title}
                                    </h2>

                                    <div className="relative">
                                        {/* Header */}
                                        <div className="flex items-center space-x-2 mb-3 sm:mb-4">
                                            <div className="p-1.5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg shadow-sm">
                                                <Steps
                                                    size={16}
                                                    className="text-primary-600"
                                                    weight="duotone"
                                                />
                                            </div>
                                            <h2 className="text-sm sm:text-base font-bold text-gray-900">
                                                {t("courseDetailsPage.mobileCard.overview", {
                                                    course: toTitleCase(
                                                        getTerminology(
                                                            ContentTerms.Course,
                                                            SystemTerms.Course
                                                        )
                                                    ),
                                                })}
                                            </h2>
                                        </div>

                                        {/* Course Stats */}
                                        <div className="space-y-2 sm:space-y-3">
                                            {/* Author */}
                                            {getAuthorName() && (
                                                <div className="flex items-center justify-between p-2 sm:p-2.5 bg-gray-50/80 rounded-lg">
                                                    <span className="text-xs font-medium text-gray-700">{t("courseDetailsPage.mobileCard.author")}</span>
                                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                        {getAuthorName()}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Level Badge */}
                                            {levelOptions.length > 0 &&
                                                selectedLevel &&
                                                levelOptions.find(
                                                    (option) =>
                                                        option.value ===
                                                        selectedLevel
                                                )?.label !== "default" && (
                                                    <div className="flex items-center justify-between p-2 sm:p-2.5 bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg border border-primary-200">
                                                        <div className="flex items-center space-x-2">
                                                            <Steps
                                                                size={14}
                                                                className="text-primary-600"
                                                                weight="duotone"
                                                            />
                                                            <span className="text-xs font-medium text-primary-700">
                                                                {toTitleCase(
                                                                    getTerminology(
                                                                        ContentTerms.Level,
                                                                        SystemTerms.Level
                                                                    )
                                                                )}
                                                            </span>
                                                        </div>
                                                        <span className="text-xs font-bold text-primary-800">
                                                            {
                                                                levelOptions.find(
                                                                    (option) =>
                                                                        option.value ===
                                                                        selectedLevel
                                                                )?.label
                                                            }
                                                        </span>
                                                    </div>
                                                )}

                                            {/* Total Duration */}
                                            <div className="flex items-center justify-between p-2 sm:p-2.5 bg-gray-50/80 rounded-lg">
                                                <span className="text-xs font-medium text-gray-700">{t("courseDetailsPage.mobileCard.courseTime", { course: getTerminology(ContentTerms.Course, SystemTerms.Course) })}</span>
                                                <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                    {(() => {
                                                        // Priority 1: Backend read_time_in_minutes
                                                        if (typeof backendReadTimeMinutes === 'number' && !Number.isNaN(backendReadTimeMinutes)) {
                                                            return getBackendCourseDuration(backendReadTimeMinutes);
                                                        }
                                                        // Priority 2: Fallback to slide count calculation
                                                        return formatTotalCourseDuration(slideCountQuery.data as SlideCountEntry[] || []);
                                                    })()}
                                                </span>
                                            </div>
                                        </div>
                                        {packageSessionIdForCurrentLevel && (
                                            <div className="mt-4">
                                                <CourseDetailsRatingsComponent
                                                    packageSessionId={packageSessionIdForCurrentLevel}
                                                    onRatingsLoadingChange={handleRatingsLoadingChange}
                                                />
                                            </div>
                                        )}

                                        {/* Enroll Button */}
                                        <div className="mt-4">
                                            <AuthModal
                                                type="courseDetailsPage"
                                                courseId={searchParams.courseId}
                                                trigger={
                                                    <MyButton
                                                        type="button"
                                                        scale="large"
                                                        buttonType="primary"
                                                        layoutVariant="default"
                                                        className="!min-w-full !w-full"
                                                    >
                                                        {t("courseDetailsPage.enroll")}
                                                    </MyButton>
                                                }
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <CourseStructureDetails
                                selectedSession={selectedSession}
                                selectedLevel={selectedLevel}
                                courseStructure={form.getValues(
                                    "courseData.courseStructure"
                                )}
                                courseData={form.getValues()}
                                packageSessionId={
                                    packageSessionIdForCurrentLevel || ""
                                }
                                onModulesLoadingChange={
                                    handleModulesLoadingChange
                                }
                            />

                            {/* What You'll Learn Section */}
                            {extractTextFromHTML(
                                form.getValues("courseData").whatYoullLearn
                            ) && (
                                <div className="mb-6 sm:mb-8 space-y-stack">
                                    <h2 className="sm:mb-4 text-xl sm:text-2xl font-bold">
                                        {t("courseDetailsPage.sections.whatYoullLearn")}
                                    </h2>
                                    <div className="rounded-lg">
                                        <p
                                            className="text-sm sm:text-base leading-relaxed"
                                            dangerouslySetInnerHTML={{
                                                __html:
                                                    form.getValues("courseData")
                                                        .whatYoullLearn || "",
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* About Content Section */}
                            {extractTextFromHTML(
                                form.getValues("courseData").aboutTheCourse
                            ) && (
                                <div className="mb-6 sm:mb-8 space-y-stack">
                                    <h2 className="sm:mb-4 text-xl sm:text-2xl font-bold">
                                        {t("courseDetailsPage.sections.aboutThisCourse", {
                                            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                                        })}
                                    </h2>
                                    <div className="rounded-lg">
                                        <p
                                            className="text-sm sm:text-base leading-relaxed"
                                            dangerouslySetInnerHTML={{
                                                __html:
                                                    form.getValues("courseData")
                                                        .aboutTheCourse || "",
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Who Should Join Section */}
                            {extractTextFromHTML(
                                form.getValues("courseData").whoShouldLearn
                            ) && (
                                <div className="mb-6 sm:mb-8 space-y-stack">
                                    <h2 className="sm:mb-4 text-xl sm:text-2xl font-bold">
                                        {t("courseDetailsPage.sections.whoShouldJoin")}
                                    </h2>
                                    <div className="rounded-lg">
                                        <p
                                            className="text-sm sm:text-base leading-relaxed"
                                            dangerouslySetInnerHTML={{
                                                __html:
                                                    form.getValues("courseData")
                                                        .whoShouldLearn || "",
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Instructors Section */}
                            {showInstructors &&
                                form.getValues("courseData").instructors &&
                                form.getValues("courseData").instructors
                                    .length > 0 && (
                                    <div className="mb-6 sm:mb-8 space-y-stack">
                                        <h2 className="sm:mb-4 text-xl sm:text-2xl font-bold">
                                            {instructorsHeading}
                                        </h2>
                                        <div className="space-y-3 sm:space-y-4">
                                            {form
                                                .getValues("courseData")
                                                .instructors.map(
                                                    (instructor, index) => (
                                                        <div
                                                            key={index}
                                                            className="flex gap-3 sm:gap-4 rounded-lg bg-gray-50 p-3 sm:p-4"
                                                        >
                                                            <Avatar className="size-6 sm:size-8 flex-shrink-0">
                                                                <AvatarImage
                                                                    src={instructor.profilePicUrl || ""}
                                                                    alt={
                                                                        instructor.name
                                                                    }
                                                                />
                                                                <AvatarFallback className="bg-info-500 text-xs font-medium text-white">
                                                                    {getInitials(
                                                                        instructor.name
                                                                    )}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="min-w-0 flex-1">
                                                                <h3 className="text-base sm:text-lg font-medium">
                                                                    {
                                                                        instructor.name
                                                                    }
                                                                </h3>
                                                                {authorRoleTag(instructor.roleLabel, instructorsHeading) && (
                                                                    <p className="text-xs sm:text-sm font-medium text-gray-500">
                                                                        {authorRoleTag(instructor.roleLabel, instructorsHeading)}
                                                                    </p>
                                                                )}
                                                                {instructor.authorSubtitle && (
                                                                    <p className="text-xs sm:text-sm text-gray-500">
                                                                        {
                                                                            instructor.authorSubtitle
                                                                        }
                                                                    </p>
                                                                )}
                                                                {instructor.authorDescription && (
                                                                    <div
                                                                        className="text-xs sm:text-sm leading-relaxed text-gray-600 mt-1"
                                                                        dangerouslySetInnerHTML={{
                                                                            __html: sanitizeHtml(
                                                                                instructor.authorDescription
                                                                            ),
                                                                        }}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                )}
                                        </div>
                                    </div>
                                )}
                        </div>

                        {/* Right Column - Full width on mobile, 1/3 on larger screens */}
                        <div className="hidden lg:block max-w-reg-350 lg:w-1/3 lg:max-w-sm mb-12">
                            <CourseStatsSidebar
                                title={form.getValues("courseData").title}
                                levelOptions={levelOptions}
                                selectedLevel={selectedLevel}
                                slideCounts={slideCountQuery.data as SlideCountEntry[]}
                                backendReadTimeMinutes={backendReadTimeMinutes || undefined}
                                authorName={getAuthorName()}
                                ctaSlot={
                                    <AuthModal
                                        type="courseDetailsPage"
                                        courseId={searchParams.courseId}
                                        trigger={
                                            <MyButton
                                                type="button"
                                                scale="large"
                                                buttonType="primary"
                                                layoutVariant="default"
                                                className="!min-w-full !w-full"
                                            >
                                                {t("courseDetailsPage.enroll")}
                                            </MyButton>
                                        }
                                    />
                                }
                                ratingsSlot={
                                    packageSessionIdForCurrentLevel ? (
                                        <CourseDetailsRatingsComponent
                                            packageSessionId={packageSessionIdForCurrentLevel}
                                            onRatingsLoadingChange={handleRatingsLoadingChange}
                                        />
                                     ) : null
                                }
                            />
                        </div>
                    </div>
                    {/* Ratings moved to sidebar below overview */}
                </div>
            </div>
        </>
    );
};
