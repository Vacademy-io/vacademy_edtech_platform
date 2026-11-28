import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";
import { useParentPortalStore } from "@/stores/parent-portal-store";
import { ParentPortalShell } from "@/routes/parent/-components/ParentPortalShell";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useParentData } from "@/hooks/use-parent-portal";
import { getTokenDecodedData } from "@/lib/auth/sessionUtility";
import type { ChildProfile } from "@/types/parent-portal";
import { useQuery } from "@tanstack/react-query";
import { useStudyLibraryQuery } from "@/services/study-library/getStudyLibraryDetails";
import { getInstituteId } from "@/constants/helper";

export const Route = createFileRoute("/parent/")({
  component: ParentPortalIndex,
});

export default ParentPortalIndex;

function ParentPortalIndex() {
  const { t } = useTranslation("parent");
  const { selectedChild, selectChild, setChildren, setLoadingChildren, children: storeChildren } =
    useParentPortalStore();

  // Get parent user ID from token
  const parentUserId = (() => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return undefined;
      const decoded = getTokenDecodedData(token);
      return decoded?.user;
    } catch {
      return undefined;
    }
  })();

  // Fetch parent data (children, applications, enrollments)
  const { data: parentData, isLoading, error } = useParentData(parentUserId);

  const { isLoading: isLoadingInitStudyLibrary } = useQuery({
    ...useStudyLibraryQuery(selectedChild?.destinationPackageSessionId ?? ""),
    enabled: !!selectedChild?.destinationPackageSessionId, // Only run when packageSessionId is available
  });

  // Initialize store and auto-select single child
  useEffect(() => {
    if (isLoading) {
      setLoadingChildren(true);
      return;
    }

    if (error) {
      console.error("Failed to load parent data:", error);
      toast.error(t("admissionPortal.index.loadChildrenFailed"));
      setLoadingChildren(false);
      return;
    }

    if (parentData?.children) {
      let cancelled = false;

      (async () => {
        let resolvedInstituteId = await getInstituteId() ?? "";
        if (!resolvedInstituteId) {
          const prefInstitute = await Preferences.get({
            key: "InstituteDetails",
          });
          resolvedInstituteId = prefInstitute.value
            ? JSON.parse(prefInstitute.value)?.id ?? ""
            : "";
        }

        if (cancelled) return;

        const childProfiles: ChildProfile[] = parentData.children.map(
          (child) => ({
            id: child.childInfo.id,
            student_id: child.childInfo.id,
            parent_id: parentUserId || "",
            full_name: child.childInfo.full_name,
            email: child.childInfo.email,
            date_of_birth: child.childInfo.date_of_birth,
            gender: child.childInfo.gender,
            grade_applying: child.enrollments?.[0]?.applyingForClass,
            academic_year: child.enrollments?.[0]?.academicYear,
            admission_status: (child.applications?.[0]?.overallStatus ||
              "ENQUIRY") as any,
            institute_id: resolvedInstituteId,
            applicant_id:
              child.applications?.[0]?.applicantId || child.childInfo.id,
            destinationPackageSessionId:
              child.applications?.[0]?.destinationPackageSessionId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        );

        if (cancelled) return;

        setChildren(childProfiles);

        if (childProfiles.length === 1 && !selectedChild) {
          selectChild(childProfiles[0]);
        } else if (selectedChild) {
          const updated = childProfiles.find((c) => c.id === selectedChild.id);
          if (updated) {
            const hasChanged =
              updated.destinationPackageSessionId !==
                selectedChild.destinationPackageSessionId ||
              updated.applicant_id !== selectedChild.applicant_id ||
              updated.full_name !== selectedChild.full_name ||
              updated.institute_id !== selectedChild.institute_id;

            if (hasChanged) {
              selectChild(updated);
            }
          }
        }

        setLoadingChildren(false);
      })();

      return () => {
        cancelled = true;
      };
    }
  }, [
    parentData,
    parentUserId,
    isLoading,
    error,
    selectedChild,
    selectChild,
    setChildren,
    setLoadingChildren,
  ]);

  // Show loading state
  if (isLoading) {
    return <ParentPortalLoading />;
  }

  // Show error state if no data
  if (!parentData?.children || parentData.children.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="text-center max-w-md"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-3">
            {t("admissionPortal.index.noChildrenFound")}
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            {t("admissionPortal.index.noChildrenFoundBody")}
          </p>
        </motion.div>
      </div>
    );
  }

  // If no child selected, show selection screen
  if (!selectedChild) {
    const childProfiles: ChildProfile[] =
      storeChildren.length === parentData.children.length
        ? storeChildren
        : parentData.children.map((child) => ({
            id: child.childInfo.id,
            student_id: child.childInfo.id,
            parent_id: parentUserId || "",
            full_name: child.childInfo.full_name,
            email: child.childInfo.email,
            date_of_birth: child.childInfo.date_of_birth,
            gender: child.childInfo.gender,
            grade_applying: child.enrollments?.[0]?.applyingForClass ?? t("admissionPortal.notAvailable"),
            academic_year: child.enrollments?.[0]?.academicYear ?? t("admissionPortal.notAvailable"),
            admission_status: (child.applications?.[0]?.overallStatus ||
              "ENQUIRY") as any,
            institute_id: "",
            applicant_id: child.applications?.[0]?.applicantId ?? child.childInfo.id,
            destinationPackageSessionId:
              child.applications?.[0]?.destinationPackageSessionId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }));

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="text-center max-w-md"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-3">
            {t("admissionPortal.index.selectAChild")}
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6">
            {t("admissionPortal.index.selectAChildBody")}
          </p>
          <div className="space-y-2">
            {childProfiles.map((child) => (
              <button
                key={child.id}
                onClick={() => selectChild(child)}
                className="w-full px-4 py-3 text-start bg-card border border-border rounded-lg hover:border-primary hover:bg-accent transition-colors"
              >
                <p className="font-semibold text-foreground">
                  {child.full_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {child.grade_applying} • {child.academic_year}
                </p>
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  const parentName = t("admissionPortal.parentFallbackName");
  const childProfiles: ChildProfile[] =
    storeChildren.length === parentData.children.length
      ? storeChildren
      : parentData.children.map((child) => ({
          id: child.childInfo.id,
          student_id: child.childInfo.id,
          parent_id: parentUserId || "",
          full_name: child.childInfo.full_name,
          email: child.childInfo.email,
          date_of_birth: child.childInfo.date_of_birth,
          gender: child.childInfo.gender,
          grade_applying: child.enrollments?.[0]?.applyingForClass ?? t("admissionPortal.notAvailable"),
          academic_year: child.enrollments?.[0]?.academicYear ?? t("admissionPortal.notAvailable"),
          admission_status: (child.applications?.[0]?.overallStatus ||
            "ENQUIRY") as any,
          institute_id: "",
          applicant_id: child.applications?.[0]?.applicantId ?? child.childInfo.id,
          destinationPackageSessionId:
            child.applications?.[0]?.destinationPackageSessionId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

  // Child selected — render the parent dashboard shell
  return (
    <ParentPortalShell
      child={selectedChild}
      allChildren={childProfiles}
      parentName={parentName}
      onSwitchChild={() => {
        selectChild(null);
      }}
    />
  );
}

// ── Loading Skeleton ─────────────────────────────────────────

function ParentPortalLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center"
      >
        <div className="relative mb-6">
          <div className="w-16 h-16 mx-auto rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        </div>
        <Skeleton className="h-6 w-48 mx-auto mb-2" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </motion.div>
    </div>
  );
}
