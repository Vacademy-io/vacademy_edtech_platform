import {
    TreeStructure,
    FileText,
    PresentationChart,
    Folder,
    ChalkboardTeacher,
    PlayCircle,
    Code,
    FilePdf,
    FileDoc,
    Question,
    ClipboardText,
    Presentation,
    Notebook,
    GameController,
    Exam,
    Terminal,
    File,
} from "@phosphor-icons/react";
import { Steps } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import {
    getTerminology,
    getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { CourseDetailsRatingsComponent } from "../../ui/course-details-ratings-page";

interface LevelOption {
    _id: string;
    value: string;
    label: string;
}

interface SlideCount {
    source_type: string;
    slide_count: number;
    display_name: string;
}

interface ModuleStats {
    totalModules: number;
    totalChapters: number;
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

interface CourseSidebarProps {
    hasRightSidebar: boolean;
    levelOptions: LevelOption[];
    selectedLevel: string;
    slideCountQuery: {
        isLoading: boolean;
        error: any;
    };
    overviewVisible: boolean;
    processedSlideCounts: SlideCount[];
    moduleStats: ModuleStats;
    currentSubjects: any[];
    courseStructure: number;
    instructorsCount: number;
    selectedTab: string;
    selectedSession: string;
    enrolledSessions: EnrolledSession[];
    courseId: string;
    paymentType?: string | null;
    packageSessionIdForCurrentLevel?: string | null;
    onEnrollmentClick: () => void;
    onRatingsLoadingChange: (loading: boolean) => void;
}

const getSlideTypeIcon = (sourceType: string) => {
    switch (sourceType.toLowerCase()) {
        case "video":
            return (
                <PlayCircle
                    size={16}
                    className="text-blue-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "code":
            return (
                <Code
                    size={16}
                    className="text-green-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "pdf":
            return (
                <FilePdf
                    size={16}
                    className="text-red-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "document":
            return (
                <FileDoc
                    size={16}
                    className="text-purple-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "question":
            return (
                <Question
                    size={16}
                    className="text-orange-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "assignment":
            return (
                <ClipboardText
                    size={16}
                    className="text-indigo-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "presentation":
            return (
                <Presentation
                    size={16}
                    className="text-cyan-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "notes":
            return (
                <Notebook
                    size={16}
                    className="text-yellow-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "game":
            return (
                <GameController
                    size={16}
                    className="text-pink-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "exam":
            return (
                <Exam
                    size={16}
                    className="text-teal-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        case "terminal":
            return (
                <Terminal
                    size={16}
                    className="text-gray-600 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
        default:
            return (
                <File
                    size={16}
                    className="text-gray-500 group-hover/item:scale-110 transition-transform duration-300"
                    weight="duotone"
                />
            );
    }
};

export const CourseSidebar = ({
    hasRightSidebar,
    levelOptions,
    selectedLevel,
    slideCountQuery,
    overviewVisible,
    processedSlideCounts,
    moduleStats,
    currentSubjects,
    courseStructure,
    instructorsCount,
    selectedTab,
    selectedSession,
    enrolledSessions,
    courseId,
    paymentType,
    packageSessionIdForCurrentLevel,
    onEnrollmentClick,
    onRatingsLoadingChange,
}: CourseSidebarProps) => {
    const { t } = useTranslation("courseDetailsB");
    const courseLower = getTerminology(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const slidesLower = getTerminology(
        ContentTerms.Slides,
        SystemTerms.Slides
    ).toLocaleLowerCase();
    const instructorsLabel = getTerminologyPlural(
        RoleTerms.Teacher,
        SystemTerms.Teacher
    );

    if (!hasRightSidebar) return null;

    const safeEnrolledSessions = enrolledSessions || [];
    const isAlreadyEnrolled = safeEnrolledSessions.some(
        (enrolledSession) =>
            enrolledSession.package_dto.id === courseId &&
            enrolledSession.session.id === selectedSession &&
            enrolledSession.level.id === selectedLevel
    );

    return (
        <div className="lg:col-span-1">
            <div className="sticky top-4 space-y-4">
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.7s" }}
                >
                    {/* Background gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>

                    {/* Floating orb effect */}
                    <div className="absolute top-0 end-0 w-12 h-12 bg-primary-100/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 -translate-y-1 translate-x-3"></div>

                    <div className="relative">
                        {/* Header */}
                        <div className="flex items-center space-x-2 mb-4">
                            <div className="p-1.5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg shadow-sm">
                                <Steps
                                    size={18}
                                    className="text-primary-600"
                                    weight="duotone"
                                />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">
                                {t("courseSidebar.overviewTitle", {
                                    course: courseLower,
                                })}
                            </h2>
                        </div>

                        {/* Course Stats */}
                        <div className="space-y-3">
                            {/* Level Badge */}
                            {levelOptions.length > 0 &&
                                selectedLevel &&
                                levelOptions.find(
                                    (option) => option.value === selectedLevel
                                )?.label !== "default" && (
                                    <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-primary-50 to-primary-100 rounded-lg border border-primary-200">
                                        <div className="flex items-center space-x-2">
                                            <Steps
                                                size={16}
                                                className="text-primary-600"
                                                weight="duotone"
                                            />
                                            <span className="text-xs font-medium text-primary-700">
                                                {getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                ).toLocaleLowerCase()}
                                            </span>
                                        </div>
                                        <span className="text-xs font-bold text-primary-800">
                                            {
                                                levelOptions.find(
                                                    (option) =>
                                                        option.value === selectedLevel
                                                )?.label
                                            }
                                        </span>
                                    </div>
                                )}

                            {/* Slide Counts */}
                            {slideCountQuery.isLoading ? (
                                <div className="space-y-2">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <div
                                            key={i}
                                            className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg animate-pulse"
                                        >
                                            <div className="h-3 w-16 bg-gray-200 rounded"></div>
                                            <div className="h-3 w-6 bg-gray-200 rounded"></div>
                                        </div>
                                    ))}
                                </div>
                            ) : slideCountQuery.error ? (
                                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
                                    <p className="text-xs text-red-600 font-medium">
                                        {t("courseSidebar.errorLoadingCounts", {
                                            slides: slidesLower,
                                        })}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {overviewVisible &&
                                        processedSlideCounts.map((count) => (
                                            <div
                                                key={count.source_type}
                                                className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300 group/item"
                                            >
                                                <div className="flex items-center space-x-2">
                                                    {getSlideTypeIcon(count.source_type)}
                                                    <span className="text-xs font-medium text-gray-700">
                                                        {count.display_name}
                                                    </span>
                                                </div>
                                                <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                    {count.slide_count}
                                                </span>
                                            </div>
                                        ))}

                                    {/* Module Statistics */}
                                    {overviewVisible && (
                                        <>
                                            {/* Total Modules */}
                                            {moduleStats.totalModules > 0 && (
                                                <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300 group/item">
                                                    <div className="flex items-center space-x-2">
                                                        <FileText
                                                            size={16}
                                                            className="text-blue-600 group-hover/item:scale-110 transition-transform duration-300"
                                                            weight="duotone"
                                                        />
                                                        <span className="text-xs font-medium text-gray-700">
                                                            {getTerminology(
                                                                ContentTerms.Modules,
                                                                SystemTerms.Modules
                                                            )}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                        {moduleStats.totalModules}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Total Chapters */}
                                            {moduleStats.totalChapters > 0 && (
                                                <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300 group/item">
                                                    <div className="flex items-center space-x-2">
                                                        <PresentationChart
                                                            size={16}
                                                            className="text-green-600 group-hover/item:scale-110 transition-transform duration-300"
                                                            weight="duotone"
                                                        />
                                                        <span className="text-xs font-medium text-gray-700">
                                                            {getTerminology(
                                                                ContentTerms.Chapters,
                                                                SystemTerms.Chapters
                                                            )}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                        {moduleStats.totalChapters}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Total Subjects (for depth 5) */}
                                            {courseStructure === 5 && currentSubjects.length > 0 && (
                                                <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300 group/item">
                                                    <div className="flex items-center space-x-2">
                                                        <Folder
                                                            size={16}
                                                            className="text-purple-600 group-hover/item:scale-110 transition-transform duration-300"
                                                            weight="duotone"
                                                        />
                                                        <span className="text-xs font-medium text-gray-700">
                                                            {getTerminology(
                                                                ContentTerms.Subjects,
                                                                SystemTerms.Subjects
                                                            )}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                        {currentSubjects.length}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Instructors Count */}
                                            {instructorsCount > 0 && (
                                                <div className="flex items-center justify-between p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300 group/item">
                                                    <div className="flex items-center space-x-2">
                                                        <ChalkboardTeacher
                                                            size={16}
                                                            className="text-orange-600 group-hover/item:scale-110 transition-transform duration-300"
                                                            weight="duotone"
                                                        />
                                                        <span className="text-xs font-medium text-gray-700">
                                                            {instructorsLabel}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-900 bg-white px-2 py-0.5 rounded-md shadow-sm">
                                                        {instructorsCount}
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Only show enroll button for ALL tab when user is not enrolled */}
                        {selectedTab === "ALL" &&
                            selectedSession &&
                            selectedLevel &&
                            !isAlreadyEnrolled && (
                                <MyButton
                                    type="button"
                                    scale="large"
                                    buttonType="primary"
                                    layoutVariant="default"
                                    className="mt-2 !min-w-full !w-full text-xs h-8"
                                    onClick={onEnrollmentClick}
                                >
                                    {t("courseEnrollment.enrollButton")}
                                </MyButton>
                            )}
                    </div>
                </div>

                {/* Ratings & Reviews */}
                {packageSessionIdForCurrentLevel && (
                    <div
                        className="animate-fade-in-up"
                        style={{ animationDelay: "1.0s" }}
                    >
                        <CourseDetailsRatingsComponent
                            packageSessionId={packageSessionIdForCurrentLevel}
                            onLoadingChange={onRatingsLoadingChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
