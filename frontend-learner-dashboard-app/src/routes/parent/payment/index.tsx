import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PaymentsModule } from "../-components/PaymentsModule";
import { ParentFeesAccordion } from "../-components/ParentFeesAccordion";
import { ParentPageLayout } from "../-components/ParentPageLayout";
import { useParentPortalStore } from "@/stores/parent-portal-store";

export const Route = createFileRoute("/parent/payment/")({
  component: Page,
});

export default function Page() {
  const { t } = useTranslation("parent");
  const selectedChild = useParentPortalStore((state) => state.selectedChild);
  const children = useParentPortalStore((state) => state.children);
  const child = selectedChild ?? children[0] ?? null;

  if (!child) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">
          {t("admissionPortal.noChildSelectedGoToDashboard")}
        </p>
      </div>
    );
  }

  return (
    <ParentPageLayout>
      {/* New accordion-based layout for parent payments. 
          Keeping PaymentsModule mounted but not rendered so it can be restored later if needed. */}
      <ParentFeesAccordion child={child} />
    </ParentPageLayout>
  );
}
