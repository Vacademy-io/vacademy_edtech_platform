import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import FilterPanel from "./FilterPanel.tsx";
import SearchAndSortBar from "./SearchAndSortBar.tsx";
import CourseCard from "./CourseCards.tsx";
import Pagination from "./Pagination.tsx";
import { useCatalogStore } from "../-store/catalogStore.ts";
import { toTitleCase } from "@/lib/utils";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface CoursesPageProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  sortOption: string;
  onSortChange: (value: string) => void;

  selectedLevels: string[];
  setSelectedLevels: (levels: string[]) => void;

  selectedTags: string[];
  setSelectedTags: (tags: string[]) => void;

  selectedInstructors: string[];
  setSelectedInstructors: (instructors: string[]) => void;

  clearAllFilters: () => void;
  onApplyFilters: () => void;
  instituteId: string;
}

const CoursesPage: React.FC<CoursesPageProps> = ({
  searchTerm,
  onSearchChange,
  sortOption,
  onSortChange,
  selectedLevels,
  setSelectedLevels,
  selectedTags,
  setSelectedTags,
  selectedInstructors,
  setSelectedInstructors,
  clearAllFilters,
  onApplyFilters,
  instituteId,
}) => {
  const { t } = useTranslation("coursesRouteA");
  const { courseData } = useCatalogStore();
  const fallbackDescription =
    "";
  const fallbackTags = "";

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const paginatedCourses = courseData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(courseData.length / itemsPerPage);

  // Smooth scroll on page change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [currentPage]);

  // Reset page to 1 on course data change
  useEffect(() => {
    setCurrentPage(1);
  }, [courseData]);

  // Helper function to toggle item in array
  const toggleItem = (
    itemId: string,
    list: string[],
    setter: (newList: string[]) => void
  ) => {
    if (list.includes(itemId)) {
      setter(list.filter((i) => i !== itemId));
    } else {
      setter([...list, itemId]);
    }
  };

  return (
    <div ref={scrollRef}>
      <div className="flex flex-col lg:flex-row p-2 sm:p-4 lg:p-8 bg-gray-50 min-h-screen">
        {/* Filter Panel - Full width on mobile, sidebar on desktop */}
        <div className="w-full lg:w-1/4 lg:pe-8 mb-6 lg:mb-0 order-1">
          <div className="lg:sticky lg:top-8">
            <FilterPanel
              selectedLevels={selectedLevels}
              onLevelChange={(id) =>
                toggleItem(id, selectedLevels, setSelectedLevels)
              }
              selectedTags={selectedTags}
              onTagChange={(id) =>
                toggleItem(id, selectedTags, setSelectedTags)
              }
              selectedInstructors={selectedInstructors}
              onInstructorChange={(id) =>
                toggleItem(id, selectedInstructors, setSelectedInstructors)
              }
              clearAllFilters={clearAllFilters}
              onApplyFilters={onApplyFilters}
            />
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full lg:w-3/4 order-2">
          <SearchAndSortBar
            searchTerm={searchTerm}
            onSearchChange={onSearchChange}
            sortOption={sortOption}
            onSortChange={onSortChange}
          />

          {courseData.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 sm:p-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 rounded-lg mx-auto mb-3 sm:mb-4 flex items-center justify-center">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-1.5 4.5-3.5 5.291" />
                </svg>
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">
                {t("coursesPage.empty.title", {
                  courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                })}
              </h3>
              <p className="text-gray-600 text-sm max-w-md mx-auto">
                {t("coursesPage.empty.description", {
                  courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase(),
                })}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-6 h-fit">
              {paginatedCourses.map((course, index) => {
                return (
                  <CourseCard
                    courseId={course.id}
                    key={index}
                    package_name={toTitleCase(
                      course.package_name || t("coursesPage.untitledPackage")
                    )}
                    level_name={toTitleCase(course.level_name || t("coursesPage.defaultLevelName"))}
                    instructors={
                      course.instructors?.length
                        ? course.instructors.map((instructor) => ({
                          id: instructor.id,
                          full_name:
                            instructor.full_name || t("common.unknownInstructor"),
                          image_url: instructor.image_url,
                          profile_pic_file_id: instructor.profile_pic_file_id,
                          author_subtitle: instructor.author_subtitle,
                          author_description: instructor.author_description,
                          role_label: instructor.role_label,
                        }))
                        : []
                    }
                    rating={course.rating || 5}
                    description={
                      course.course_html_description_html || fallbackDescription
                    }
                    tags={
                      course.comma_separeted_tags
                        ? course.comma_separeted_tags
                          .split(",")
                          .map((tag: string) => toTitleCase(tag.trim()))
                        : fallbackTags
                          .split(",")
                          .map((tag: string) => toTitleCase(tag.trim()))
                    }
                    previewImageUrl={course.course_preview_image_media_id}
                    instituteId={instituteId}
                    packageSessionId={course.package_session_id}
                  />
                );
              })}
            </div>
          )}

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={(page) => setCurrentPage(page)}
          />
        </div>
      </div>
    </div>
  );
};

export default CoursesPage;
