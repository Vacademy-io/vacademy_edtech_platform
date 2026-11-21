import React, { useState, useEffect } from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { RouteMatcher } from "../../-services/route-matcher";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CourseRecommendationsProps } from "../../-types/course-catalogue-types";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { urlCourseDetails } from "@/constants/urls";
import axios from "axios";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface CourseRecommendationsComponentProps extends CourseRecommendationsProps {
  instituteId: string;
  tagName: string;
  globalSettings?: any;
}

interface RecommendedCourse {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  price: number;
  instructor: string;
}

export const CourseRecommendationsComponent: React.FC<CourseRecommendationsComponentProps> = ({
  title,
  limit = 3,
  instituteId,
  tagName,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const navigate = useNavigate();
  const [recommendedCourses, setRecommendedCourses] = useState<RecommendedCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRecommendedCourses = async () => {
      setIsLoading(true);
      try {
        const response = await axios.post(urlCourseDetails, {
          status: [],
          level_ids: [],
          faculty_ids: [],
          search_by_name: "",
          tag: [],
          min_percentage_completed: 0,
          max_percentage_completed: 0,
        }, {
          params: {
            instituteId: instituteId,
            page: 0,
            size: limit,
            sort: "createdAt,desc"
          },
          headers: {
            "Content-Type": "application/json",
          },
        });

        const apiCourses = response.data?.content || response.data || [];
        const transformedCourses = await Promise.all(
          apiCourses.slice(0, limit).map(async (course: any) => {
            let thumbnailUrl = "";
            
            if (course.thumbnailFileId && !course.thumbnailFileId.includes('/api/placeholder/')) {
              try {
                thumbnailUrl = await getPublicUrlWithoutLogin(course.thumbnailFileId);
              } catch {
                thumbnailUrl = "";
              }
            }

            return {
              id: course.id || course.packageId,
              title:
                course.package_name ||
                course.title ||
                t("courseRecommendations.untitledCourse", {
                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                }),
              description: course.short_description || course.description || "",
              thumbnail: thumbnailUrl,
              price: course.package_price || course.price || 0,
              instructor: course.instructors?.[0]?.full_name || course.instructorName || "",
            };
          })
        );

        setRecommendedCourses(transformedCourses);
      } catch {
        setRecommendedCourses([]);
      } finally {
        setIsLoading(false);
      }
    };

    if (instituteId) {
      fetchRecommendedCourses();
    }
  }, [instituteId, limit]);

  const handleCourseClick = (courseId: string) => {
    navigate({ to: `${RouteMatcher.basePath(tagName)}/${courseId}` });
  };

  if (isLoading) {
    return (
      // NEUTRAL: Loading skeleton background
      <section className="py-6 bg-gray-50 w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8 space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(limit)].map((_, i) => (
              <div key={i} className="bg-gray-200 animate-pulse rounded-catalogue-md h-48" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (recommendedCourses.length === 0) {
    return null;
  }

  return (
    // NEUTRAL: Section background
    <section className="py-6 bg-gray-50 w-full">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        {/* Heading - dark neutral */}
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">{title}</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recommendedCourses.map((course) => (
            // NEUTRAL: Card with subtle border
            <div
              key={course.id}
              className="bg-white border border-gray-200 rounded-catalogue-md overflow-hidden hover:border-gray-300 transition-colors cursor-pointer"
              onClick={() => handleCourseClick(course.id)}
            >
              {/* Thumbnail */}
              {course.thumbnail && (
                <div className="aspect-video">
                  <FitImage
                    src={course.thumbnail}
                    alt={course.title}
                    className="w-full h-full"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
              
              {/* Content */}
              <div className="p-3">
                {/* Title - dark for emphasis */}
                <h3 className="text-base font-semibold text-gray-900 mb-1 line-clamp-2">
                  {course.title}
                </h3>
                {/* Description - NEUTRAL */}
                {course.description && (
                  <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                    {course.description}
                  </p>
                )}
                <div className="flex justify-between items-center">
                  {/* PRIMARY ACCENT: Price */}
                  {globalSettings?.payment?.enabled !== false && (
                    <span className="text-base font-bold text-primary-600">
                      {course.price === 0 ? t("courseRecommendations.free") : `₹${course.price}`}
                    </span>
                  )}
                  {/* NEUTRAL: Instructor */}
                  {course.instructor && (
                    <span className="text-xs text-gray-500">
                      {t("courseRecommendations.by", { instructor: course.instructor })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
