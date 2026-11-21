import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { useFileUpload } from "@/hooks/use-file-upload";
import AssignmentSlide from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/assignment-slide";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { BASE_URL } from "@/constants/urls";
import { useTranslation } from "react-i18next";

const GET_SLIDE_BY_ID = `${BASE_URL}/admin-core-service/slide/v1/slide`;

export const Route = createFileRoute("/assignment/$slideId")({
  component: AssignmentPage,
});

function AssignmentPage() {
  const { t } = useTranslation("assessment");
  const { slideId } = Route.useParams();
  const [isUploading, setIsUploading] = useState(false);
  const { uploadFile } = useFileUpload();
  const { setActiveItem } = useContentStore();

  const { data: slideData, isLoading, error } = useQuery({
    queryKey: ["SLIDE_BY_ID", slideId],
    queryFn: async () => {
      const response = await authenticatedAxiosInstance.get(GET_SLIDE_BY_ID, {
        params: { slideId },
      });
      return response.data;
    },
    enabled: !!slideId,
  });

  // Set activeItem in the content store so AssignmentSlide component can read it
  // (it uses activeItem for submission payload and grading results fetch)
  useEffect(() => {
    if (slideData) {
      setActiveItem(slideData);
    }
    return () => setActiveItem(null);
  }, [slideData, setActiveItem]);

  const handleAssignmentUpload = async (file: File) => {
    try {
      setIsUploading(true);
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId: "assignment-upload",
        source: "ASSIGNMENT",
        sourceId: slideData?.source_id || "",
        publicUrl: true,
      });
      if (fileId) {
        return { success: true, fileId };
      }
      return { success: false, error: t("assignment.uploadFailed") };
    } catch (error) {
      console.error("Assignment upload error:", error);
      return { success: false, error: t("assignment.uploadFailed") };
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <DashboardLoader />
      </div>
    );
  }

  if (error || !slideData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">{t("assignment.notFound")}</p>
      </div>
    );
  }

  if (slideData.source_type !== "ASSIGNMENT" || !slideData.assignment_slide) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">{t("assignment.notAssignmentSlide")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-section">
        <h1 className="px-4 text-xl font-semibold text-gray-900 sm:text-2xl">
          {slideData.title || t("assignment.defaultTitle")}
        </h1>
        <AssignmentSlide
          assignmentData={slideData.assignment_slide}
          onUpload={handleAssignmentUpload}
          isUploading={isUploading}
        />
      </div>
    </div>
  );
}
