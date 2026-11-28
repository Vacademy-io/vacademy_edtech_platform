import React, { useEffect, useState } from "react";
import { Star, BookOpen } from "@phosphor-icons/react";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { toTitleCase } from "@/lib/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { Button } from "@/components/ui/button";
import { authorRole, sharedAuthorRole } from "@/lib/course-author-role";

interface Instructor {
    id: string;
    full_name: string;
    image_url?: string;
    profile_pic_file_id?: string | null;
    author_subtitle?: string;
    author_description?: string;
    /** Display role in this course (Author / Instructor / Acharya …). */
    role_label?: string | null;
}

interface CourseCardProps {
    courseId: string;
    packageSessionId?: string;
    package_name: string;
    level_name: string;
    instructors: Instructor[];
    rating: number;
    description: string;
    tags: string[];
    studentCount?: number;
    previewImageUrl: string;
    instituteId: string;
}

const fallbackInstructorImage =
    "https://api.dicebear.com/7.x/thumbs/svg?seed=anon";

const CourseCard: React.FC<CourseCardProps> = ({
    courseId,
    packageSessionId,
    package_name,
    level_name,
    instructors,
    rating,
    description,
    tags,
    studentCount,
    previewImageUrl,
}) => {
    const router = useRouter();
    const { t } = useTranslation("coursesRouteA");
    const [courseImageUrl, setCourseImageUrl] = useState("");
    const [loadingImage, setLoadingImage] = useState(true);
    const [instructorImageUrl, setInstructorImageUrl] = useState("");

    const instructor = instructors[0];
    const instructorName = instructor?.full_name || t("common.unknownInstructor");
    const instructorImage = instructorImageUrl || fallbackInstructorImage;

    const ratingValue = rating || 0;

    const handleViewCoureseDetails = () => {
        router.navigate({
            to: "/courses/course-details",
            search: {
                courseId: courseId,
                packageSessionId: packageSessionId,
            },
        });
    };

    const loadImage = async () => {
        setLoadingImage(true);
        try {
            const url = await getPublicUrlWithoutLogin(previewImageUrl);
            setCourseImageUrl(url);
        } catch (error) {
            console.error("Error fetching institute details:", error);
        } finally {
            setLoadingImage(false);
        }
    };

    useEffect(() => {
        loadImage();
    }, [courseImageUrl]);

    useEffect(() => {
        let isMounted = true;

        const loadInstructorImage = async () => {
            if (instructor?.image_url) {
                if (isMounted) setInstructorImageUrl(instructor.image_url);
                return;
            }
            if (!instructor?.profile_pic_file_id) {
                if (isMounted) setInstructorImageUrl("");
                return;
            }

            try {
                const url = await getPublicUrlWithoutLogin(instructor.profile_pic_file_id);
                if (isMounted) setInstructorImageUrl(url || "");
            } catch {
                if (isMounted) setInstructorImageUrl("");
            }
        };

        void loadInstructorImage();
        return () => {
            isMounted = false;
        };
    }, [instructor?.image_url, instructor?.profile_pic_file_id]);

    const getLevelColor = () => {
        switch (level_name.toLowerCase()) {
            case "beginner":
                return "bg-green-100 text-green-600";
            case "intermediate":
                return "bg-yellow-100 text-yellow-600";
            case "advanced":
                return "bg-red-100 text-red-600";
            default:
                return "bg-blue-100 text-blue-600";
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col h-fit hover:shadow-xl transition-shadow duration-300">
            <div className="w-full h-40 sm:h-48 relative overflow-hidden bg-gray-100 flex items-center justify-center">
                {loadingImage ? (
                    <div className="absolute inset-0 animate-pulse bg-gray-200" />
                ) : courseImageUrl ? (
                    <img
                        src={courseImageUrl}
                        alt={toTitleCase(package_name)}
                        loading="lazy"
                        className="w-full h-full object-cover transition-opacity duration-300 opacity-100"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
                        <BookOpen
                            size={40}
                            className="text-primary/60"
                        />
                        <span className="text-xs font-medium text-primary/70 px-3 text-center line-clamp-1">
                            {toTitleCase(package_name)}
                        </span>
                    </div>
                )}
            </div>

            <div className="p-3 sm:p-4 flex flex-col flex-grow">
                <div className="flex justify-between items-start mb-2 sm:mb-3 gap-2">
                    <h3
                        className="text-base sm:text-lg font-semibold text-gray-800 line-clamp-2 flex-1 min-w-0"
                        title={toTitleCase(package_name)}
                    >
                        {toTitleCase(package_name)}
                    </h3>
                    <span
                        className={`text-xs sm:text-sm font-semibold px-2 py-1 rounded-sm ${getLevelColor()} flex-shrink-0`}
                    >
                        {toTitleCase(level_name)}
                    </span>
                </div>

                <p
                    className="text-sm text-gray-600 mb-3 flex-grow line-clamp-3"
                    dangerouslySetInnerHTML={{
                        __html: description || "",
                    }}
                />

                {instructors.length > 0 && (
                    <div className="flex items-center mb-3 p-2 sm:p-3 bg-gray-50 rounded-lg">
                        <img
                            src={instructorImage}
                            alt={instructorName}
                            className="w-6 h-6 sm:w-8 sm:h-8 rounded-full me-2 object-cover"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                                {sharedAuthorRole(
                                    instructors.map(authorRole),
                                    getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)
                                )}
                            </p>
                            <div className="text-xs sm:text-sm font-semibold text-gray-800 truncate">
                                {instructors.map((instructor, index) => (
                                    <span key={instructor.id}>
                                        {instructor.full_name}
                                        {index !== instructors.length - 1
                                            ? ", "
                                            : ""}
                                    </span>
                                ))}
                            </div>
                            {instructor?.author_subtitle && (
                                <p className="text-[11px] sm:text-xs text-gray-500 truncate">
                                    {instructor.author_subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="mb-3 min-h-6">
                    {tags && tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 sm:gap-2">
                            {tags.slice(0, 3).map((tag) => (
                                <span
                                    key={tag}
                                    className="text-xs bg-violet-200 text-violet-700 px-2 py-1 rounded-sm inline-block"
                                >
                                    {tag}
                                </span>
                            ))}
                            {tags && tags.length > 3 && (
                                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full inline-block">
                                    {t("courseCard.moreTags", { count: tags.length - 3 })}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400 italic">
                            {t("courseCard.noTagsAvailable")}
                        </span>
                    )}
                </div>

                <div className="flex items-center text-sm text-gray-600 mb-4">
                    <div className="flex items-center space-x-1">
                        {[...Array(5)].map((_, i) => (
                            <Star
                                key={i}
                                className={`w-4 h-4 sm:w-5 sm:h-5 ${
                                    i < Math.floor(ratingValue)
                                        ? "text-yellow-400"
                                        : "text-gray-300"
                                }`}
                            />
                        ))}
                        <span className="ms-1 font-medium">
                            {ratingValue.toFixed(1)}
                        </span>
                    </div>
                    {studentCount !== undefined && (
                        <span className="ms-2 text-gray-500 text-xs sm:text-sm">
                            ({studentCount}{" "}
                            {getTerminology(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLocaleLowerCase()}
                            s)
                        </span>
                    )}
                </div>

                <Button
                    onClick={handleViewCoureseDetails}
                    className="w-full py-2 sm:py-2.5 text-sm sm:text-base"
                >
                    {t("courseCard.viewButton", {
                        course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                    })}
                </Button>
            </div>
        </div>
    );
};

export default CourseCard;
