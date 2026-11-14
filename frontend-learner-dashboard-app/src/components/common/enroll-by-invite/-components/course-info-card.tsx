import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Medal, Target, Info } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";

interface FinalCourseData {
  aboutCourse: string;
  course: string;
  courseBanner: string;
  courseMediaId: {
    type: string;
    id: string;
  };
  courseMedia: string;
  coursePreview: string;
  customHtml: string;
  description: string;
  includeInstituteLogo: boolean;
  instituteLogo: string;
  learningOutcome: string;
  restrictToSameBatch: boolean;
  showRelatedCourses: boolean;
  tags: string[];
  targetAudience: string;
}

interface CourseInfoCardProps {
  courseData: FinalCourseData;
  levelName: string;
}

const stripUrlQueryString = (htmlString: string) => {
  if (!htmlString) return "";
  // Regex to find src or href attributes with query parameters and strip them
  return htmlString.replace(
    /(src|href)=(["'])([^"']*?)(\?[^"']*)\2/gi,
    "$1=$2$3$2"
  );
};

// Helper function to check if HTML content has actual visible text
// Returns false for empty HTML like "<p></p>", "<p> </p>", or just whitespace
const hasContent = (htmlString: string | undefined | null): boolean => {
  if (!htmlString) return false;
  // Strip HTML tags and decode HTML entities
  const textContent = htmlString
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/gi, ' ') // Replace &nbsp; with space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  return textContent.length > 0;
};

const CourseInfoCard = ({ courseData, levelName }: CourseInfoCardProps) => {
  const { t } = useTranslation("enrollmentA");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
  // Check if level should be shown
  const normalizedLevel = (levelName || "").trim().toLowerCase();
  const hasLevel = normalizedLevel && normalizedLevel !== "default" && normalizedLevel !== "-";

  // Check if there's any content to show
  const hasLearningOutcome = hasContent(courseData?.learningOutcome);
  const hasAboutCourse = hasContent(courseData?.aboutCourse);

  // If there's no content at all, don't render the card
  if (!hasLevel && !hasLearningOutcome && !hasAboutCourse) {
    return null;
  }

  return (
    <Card className="overflow-hidden shadow-lg border bg-white w-full">
      <CardContent className="p-5 sm:p-card-lg">
        {/* Course Name, Tags, and Description Removed as they duplicate the header info */}

        {/* Level Wedge - hidden when level is 'default' (case-insensitive) or empty */}
        {hasLevel && (
          <div className="flex items-start gap-2 mb-8">
            <Medal className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <Badge
              variant="outline"
              className="h-7 rounded-full px-3 text-xs font-medium uppercase tracking-wide border-amber-200 text-amber-700 bg-amber-50"
            >
              {levelName}
            </Badge>
          </div>
        )}



        {/* What Learners Will Gain Section */}
        {hasLearningOutcome && (
          <div className="mb-8 space-y-4">
            <div className="flex items-start gap-2 sm:gap-3">
              <Target className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 flex-shrink-0 mt-0.5" />
              <h2 className="text-lg sm:text-xl md:text-2xl font-semibold text-gray-900 leading-tight">
                {t("courseInfoCard.learnersWillGain", { learners })}
              </h2>
            </div>
            <div className="grid gap-3">
              <p
                className="text-gray-700 text-sm sm:text-base"
                dangerouslySetInnerHTML={{
                  __html: stripUrlQueryString(courseData?.learningOutcome || ""),
                }}
              />
            </div>
          </div>
        )}

        {/* Separator - only show if both sections have content */}
        {hasLearningOutcome && hasAboutCourse && (
          <Separator className="my-8" />
        )}

        {/* About the Course Section */}
        {hasAboutCourse && (
          <div className="mb-8 space-y-4">
            <div className="flex items-start gap-2 sm:gap-3">
              <Info className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 flex-shrink-0 mt-0.5" />
              <h2 className="text-lg sm:text-xl md:text-2xl font-semibold text-gray-900 leading-tight">
                {t("courseInfoCard.aboutCourse", { course })}
              </h2>
            </div>
            <p
              className="text-gray-700 text-sm sm:text-base leading-relaxed"
              dangerouslySetInnerHTML={{
                __html: stripUrlQueryString(courseData?.aboutCourse || ""),
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CourseInfoCard;
