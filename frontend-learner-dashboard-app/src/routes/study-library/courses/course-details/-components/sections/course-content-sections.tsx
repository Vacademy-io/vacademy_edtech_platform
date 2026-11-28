import {
    BookOpen,
    File,
    GraduationCap,
    ChalkboardTeacher,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { extractTextFromHTML } from "@/components/common/helper";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

interface Instructor {
    name: string;
    email: string;
}

interface CourseData {
    whatYoullLearn: string;
    aboutTheCourse: string;
    whoShouldLearn: string;
    instructors: Instructor[];
}

interface CourseContentSectionsProps {
    courseData: CourseData;
}

const getInitials = (email: string) => {
    return email
        .split("@")[0]
        .split(".")
        .map((part) => part.charAt(0).toUpperCase())
        .join("")
        .slice(0, 2);
};

export const CourseContentSections = ({ courseData }: CourseContentSectionsProps) => {
    const { t } = useTranslation("courseDetailsB");
    const courseLower = getTerminology(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const teacherLower = getTerminology(
        RoleTerms.Teacher,
        SystemTerms.Teacher
    ).toLocaleLowerCase();

    return (
        <div className="space-y-4">
            {/* What You'll Learn Section */}
            {extractTextFromHTML(courseData.whatYoullLearn) && (
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.3s" }}
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-success-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
                    <div className="relative space-y-stack">
                        <div className="flex items-center gap-x-2">
                            <div className="p-1.5 bg-gradient-to-br from-success-100 to-success-200 rounded-lg shadow-sm">
                                <BookOpen
                                    size={18}
                                    className="text-success-600"
                                    weight="duotone"
                                />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">
                                {t("courseContent.whatYoullLearn")}
                            </h2>
                        </div>
                        <div
                            className="text-sm text-gray-600 leading-relaxed"
                            dangerouslySetInnerHTML={{
                                __html: courseData.whatYoullLearn || "",
                            }}
                        />
                    </div>
                </div>
            )}

            {/* About Course Section */}
            {extractTextFromHTML(courseData.aboutTheCourse) && (
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.4s" }}
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-info-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
                    <div className="relative space-y-stack">
                        <div className="flex items-center gap-x-2">
                            <div className="p-1.5 bg-gradient-to-br from-info-100 to-info-200 rounded-lg shadow-sm">
                                <File
                                    size={18}
                                    className="text-blue-600"
                                    weight="duotone"
                                />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">
                                {t("courseContent.aboutThisCourse", {
                                    course: courseLower,
                                })}
                            </h2>
                        </div>
                        <div
                            className="text-sm text-gray-600 leading-relaxed"
                            dangerouslySetInnerHTML={{
                                __html: courseData.aboutTheCourse || "",
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Who Should Join Section */}
            {extractTextFromHTML(courseData.whoShouldLearn) && (
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.5s" }}
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
                    <div className="relative space-y-stack">
                        <div className="flex items-center gap-x-2">
                            <div className="p-1.5 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg shadow-sm">
                                <GraduationCap
                                    size={18}
                                    className="text-purple-600"
                                    weight="duotone"
                                />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">
                                {t("courseContent.whoShouldJoin")}
                            </h2>
                        </div>
                        <div
                            className="text-sm text-gray-600 leading-relaxed"
                            dangerouslySetInnerHTML={{
                                __html: courseData.whoShouldLearn || "",
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Instructors Section */}
            {courseData.instructors && courseData.instructors.length > 0 && (
                <div
                    className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group animate-fade-in-up"
                    style={{ animationDelay: "0.6s" }}
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md"></div>
                    <div className="relative space-y-stack">
                        <div className="flex items-center gap-x-2">
                            <div className="p-1.5 bg-gradient-to-br from-primary-100 to-primary-200 rounded-lg shadow-sm">
                                <ChalkboardTeacher
                                    size={18}
                                    className="text-orange-600"
                                    weight="duotone"
                                />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">
                                {t("courseContent.instructorsHeading", {
                                    teacher: teacherLower,
                                })}
                            </h2>
                        </div>
                        <div className="space-y-2">
                            {courseData.instructors.map((instructor, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-3 p-2.5 bg-gray-50/80 rounded-lg hover:bg-gray-100/80 transition-all duration-300"
                                >
                                    <Avatar className="w-8 h-8 border-2 border-white shadow-sm">
                                        <AvatarImage
                                            src=""
                                            alt={instructor.email}
                                        />
                                        <AvatarFallback className="bg-gradient-to-br from-primary-500 to-primary-600 text-white text-xs font-semibold">
                                            {getInitials(instructor.email)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-900">
                                            {instructor.name}
                                        </h3>
                                        <p className="text-xs text-gray-600">
                                            {instructor.email}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
