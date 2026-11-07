import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AdmissionTracker } from "../-components/AdmissionTracker";
import { ParentPageLayout } from "../-components/ParentPageLayout";
import { useParentPortalStore } from "@/stores/parent-portal-store";

export const Route = createFileRoute("/parent/tracker/")({
  component: Page,
});

export default function Page() {
  const { t } = useTranslation("parent");
  const selectedChild = useParentPortalStore((state) => state.selectedChild);

  if (!selectedChild) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          {t("admissionPortal.noChildSelected")}
        </p>
      </div>
    );
  }

  return (
    <ParentPageLayout>
      <AdmissionTracker child={selectedChild} />
    </ParentPageLayout>
  );
}
