import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Footer from "./Footer.tsx";
import CoursesPage from "./CoursesPage.tsx";
import { useCatalogStore } from "../-store/catalogStore.ts";
import axios from "axios";
import {
    urlInstituteDetails,
    urlCourseDetails,
    urlInstructor,
} from "@/constants/urls.ts";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance.ts";
import CourseListHeader from "./CourseListHeader.tsx";
import { getPublicUrl } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/excalidrawUtils.ts";
import { useTheme } from "@/providers/theme/theme-provider.tsx";
import { DashboardLoader } from "@/components/core/dashboard-loader";
// Auth modal is controlled within CourseListHeader via URL params
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { toTitleCase } from "@/lib/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";

/** Merge unique instructors from course list into existing list (by id). Ensures instructors attached to courses appear in the filter. */
function mergeInstructorsFromCourses(
    current: { id: string; full_name?: string; username?: string }[],
    courses: { instructors?: { id: string; full_name?: string; username?: string }[] }[]
): { id: string; full_name?: string; username?: string }[] {
    const byId = new Map(current.map((i) => [i.id, i]));
    for (const course of courses) {
        for (const inst of course.instructors || []) {
            if (inst?.id && typeof inst.id === "string" && !byId.has(inst.id)) {
                byId.set(inst.id, {
                    id: inst.id,
                    full_name: inst.full_name ?? inst.username,
                    username: inst.username,
                });
            }
        }
    }
    return Array.from(byId.values());
}

interface CourseCatalougePageProps {
    instituteId: string;
}

const CourseCatalougePage: React.FC<CourseCatalougePageProps> = ({ instituteId }) => {
    const { t } = useTranslation("coursesRouteA");
    const { setCourseData, instituteData, setInstituteData, setInstructors } =
        useCatalogStore();
    const { setPrimaryColor } = useTheme();
    const domainRouting = useDomainRouting();
    const [bannerImage, setBannerImage] = useState("");
    const [bannerText, setBannerText] = useState({
        heading: "",
        description: "",
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [sortOption, setSortOption] = useState("Newest");

    const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedInstructors, setSelectedInstructors] = useState<string[]>(
        []
    );

    // Parse URL params for auto-open behaviors
    const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : "");
    const autoOpenLogin = urlParams.get('login') === 'true';
    const autoOpenDonation = urlParams.get('donation') === 'true';

    const getSortPayload = (sort: string) => {
        switch (sort) {
            case "Newest":
                return { createdAt: "DESC" };
            case "Oldest":
                return { createdAt: "ASC" };
            // case "Popularity":
            //     return { minPlanActualPrice: "ASC" };
            // case "Rating":
            //     return { rating: "DESC" };
            default:
                return { createdAt: "DESC" };
        }
    };

    //api call to store the courses details

    const fetchPackages = async (search = "") => {
        try {
            console.log("[CourseCatalougePage] Fetching packages for instituteId:", instituteId);
            const body = {
                status: [] as string[],
                level_ids: [] as string[],
                faculty_ids: [] as string[],
                created_by_user_id: null as string | null,
                search_by_name: search,
                tag: [] as string[],
                min_percentage_completed: 0,
                max_percentage_completed: 0,
                type: "ALL" as const,
                sort_columns: getSortPayload(sortOption),
            };
            const response = await authenticatedAxiosInstance.post(
                urlCourseDetails,
                body,
                {
                    params: {
                        instituteId: instituteId,
                        page: 0,
                        size: 95,
                    },
                    headers: {
                        accept: "*/*",
                        "Content-Type": "application/json",
                    },
                }
            );
            console.log("[CourseCatalougePage] Successfully fetched packages:", response.data.content?.length || 0);
            const content = response.data.content || [];
            setCourseData(content);
            if (content.length) {
                const current = useCatalogStore.getState().instructor;
                const merged = mergeInstructorsFromCourses(current, content);
                setInstructors(merged);
            }
        } catch (error) {
            console.error("[CourseCatalougePage] Error fetching packages:", error);
        }
    };

    useEffect(() => {
        // Only fetch packages when instituteId is available
        if (instituteId) {
            console.log("[CourseCatalougePage] Starting package fetch");
            fetchPackages(searchTerm);
        } else {
            console.log("[CourseCatalougePage] Waiting for instituteId before fetching packages");
        }
    }, [searchTerm, sortOption, instituteId]);

    // Apply domain routing theme if available
    useEffect(() => {
        if (domainRouting.instituteThemeCode) {
            setPrimaryColor(domainRouting.instituteThemeCode);
        }
    }, [domainRouting.instituteThemeCode, setPrimaryColor]);

    const handleApplyFilters = async () => {
        try {
            const allOriginalTags = instituteData?.tags || [];
            const expandedTags = (selectedTags || []).flatMap(selectedNormalized =>
                allOriginalTags.filter(og => toTitleCase(og.trim()) === selectedNormalized)
            );
            const finalTags = Array.from(new Set(expandedTags));

            const body = {
                status: [] as string[],
                level_ids: selectedLevels ?? [],
                faculty_ids: [] as string[],
                created_by_user_id: (selectedInstructors?.length ? selectedInstructors[0] : null) as string | null,
                search_by_name: searchTerm ?? "",
                tag: finalTags,
                min_percentage_completed: 0,
                max_percentage_completed: 0,
                type: "ALL" as const,
                sort_columns: getSortPayload(sortOption),
            };
            const response = await authenticatedAxiosInstance.post(
                urlCourseDetails,
                body,
                {
                    params: {
                        instituteId: instituteId,
                        page: 0,
                        size: 95,
                    },
                    headers: {
                        accept: "*/*",
                        "Content-Type": "application/json",
                    },
                }
            );
            const content = response.data.content || [];
            setCourseData(content);
            if (content.length) {
                const current = useCatalogStore.getState().instructor;
                const merged = mergeInstructorsFromCourses(current, content);
                setInstructors(merged);
            }
        } catch (error) {
            console.error("Error applying filters:", error);
        }
    };

    // ✅ Fetch institute details - only when instituteId is available
    useEffect(() => {
        if (!instituteId) return; // 🚫 Prevent calling API without instituteId

        const fetchInstituteDetails = async () => {
            try {
                const response = await axios.get(
                    `${urlInstituteDetails}/${instituteId}`,
                    {
                        params: {
                            instituteId,
                        },
                    }
                );
                const bannerImagePublicUrl = await getPublicUrl(
                    response.data.cover_image_file_id
                );
                const parsedBannerText = JSON.parse(
                    response.data.cover_text_json
                );
                setBannerText(parsedBannerText);
                setInstituteData(response.data);
                setBannerImage(bannerImagePublicUrl);
                setPrimaryColor(response.data.institute_theme_code);
            } catch (error) {
                console.log(error);
            }
        };

        fetchInstituteDetails();
    }, [instituteId]);

    // ✅ Fetch instructor - only when instituteId is available
    useEffect(() => {
        if (!instituteId) return; // 🚫 Prevent calling API without instituteId

        const fetchInstructor = async () => {
            try {
                const response = await axios.get(
                    `${urlInstructor}/${instituteId}`,
                    {
                        params: {
                            instituteId,
                        },
                        headers: {
                            accept: "*/*",
                        },
                    }
                );
                setInstructors(response.data);
            } catch (error) {
                console.log(error);
            }
        };

        fetchInstructor();
    }, [instituteId]); // ✅ Add dependency


    // Removed legacy auto-open login timer in favor of URL param based control

    // Show loading state if instituteId is not available yet
    if (!instituteId) {
        return <DashboardLoader />;
    }

    return (
        <div>
            <CourseListHeader
                fileId={instituteData?.institute_logo_file_id || ""}
                instituteId={instituteId}
                type="coursesPage"
                autoOpenLogin={autoOpenLogin}
                autoOpenDonation={autoOpenDonation}
            />

            <div className="relative h-64 sm:h-72 lg:h-96">
                {/* Transparent blue overlay */}
                {instituteData?.cover_image_file_id ? (
                    <div className="pointer-events-none absolute inset-0 z-10 bg-blue-900/50" />
                ) : (
                    <div className="pointer-events-none absolute inset-0 z-10 bg-blue-900/10" />
                )}
                {!instituteData?.cover_image_file_id ? (
                    <div className="absolute inset-0 z-0 bg-transparent" />
                ) : (
                    <div className="absolute inset-0 z-0 opacity-70">
                        {bannerImage && (
                            <img
                                src={bannerImage}
                                alt={t("catalogPage.bannerAlt", {
                                    course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                                })}
                                className="size-full object-cover"
                                onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                    e.currentTarget.parentElement?.classList.add(
                                        "bg-primary-500"
                                    );
                                }}
                            />
                        )}
                    </div>
                )}
                <div className="w-full px-4 sm:px-6 lg:px-8 relative z-20 h-full flex">
                    <div className="flex items-start justify-between gap-4 sm:gap-6 lg:gap-8 w-full">
                        {/* Left side - Title and Description */}
                        <div className="max-w-2xl my-auto flex flex-col justify-center text-white">
                            {!instituteData?.cover_text_json ? (
                                <div className="space-y-3 sm:space-y-4">
                                    <div className="h-6 sm:h-8 w-24 sm:w-32 animate-pulse rounded bg-white/20" />
                                    <div className="h-8 sm:h-12 w-3/4 animate-pulse rounded bg-white/20" />
                                    <div className="h-3 sm:h-4 w-full animate-pulse rounded bg-white/20" />
                                    <div className="h-3 sm:h-4 w-2/3 animate-pulse rounded bg-white/20" />
                                </div>
                            ) : (
                                <>
                                    <h1 className="mb-3 sm:mb-4 text-2xl sm:text-3xl lg:text-4xl font-bold">
                                        {bannerText.heading}
                                    </h1>
                                    <p
                                        className="text-base sm:text-lg opacity-90"
                                        dangerouslySetInnerHTML={{
                                            __html: bannerText.description,
                                        }}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <CoursesPage
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                sortOption={sortOption}
                onSortChange={setSortOption}
                selectedLevels={selectedLevels}
                setSelectedLevels={setSelectedLevels}
                selectedTags={selectedTags}
                setSelectedTags={setSelectedTags}
                selectedInstructors={selectedInstructors}
                setSelectedInstructors={setSelectedInstructors}
                onApplyFilters={handleApplyFilters}
                clearAllFilters={() => {
                    setSelectedLevels([]);
                    setSelectedTags([]);
                    setSelectedInstructors([]);
                    fetchPackages();
                }}
                instituteId={instituteId}
            />
            <Footer />
        </div>
    );
};

export default CourseCatalougePage;
