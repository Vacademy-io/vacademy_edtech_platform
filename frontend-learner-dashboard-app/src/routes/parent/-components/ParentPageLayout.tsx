import { useParentPortalStore } from "@/stores/parent-portal-store";
import { ParentPortalLayout } from "./ParentPortalLayout";
import { useNavTabs, type TabId } from "./navigation-config";
import { useLocation } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface ParentPageLayoutProps {
  children: React.ReactNode;
}

export function ParentPageLayout({ children }: ParentPageLayoutProps) {
  const { t } = useTranslation("parent");
  const location = useLocation();
  const {
    selectedChild,
    selectChild,
    children: allChildren,
  } = useParentPortalStore();
  const [parentName] = useState(t("admissionPortal.parentFallbackName"));
  const navTabs = useNavTabs();

  // Derive active tab from URL path
  const activeTab = useMemo((): TabId => {
    const p = location.pathname || "";
    if (p.includes("/application")) return "dashboard";
    if (p.includes("/payment")) return "payments";
    if (p.includes("/schedule")) return "schedule";
    if (p.includes("/admission")) return "admission";
    if (p.includes("/documents")) return "documents";
    if (p.includes("/tracker")) return "tracker";
    return "dashboard";
  }, [location.pathname]);

  const currentTabLabel =
    navTabs.find((tab) => tab.id === activeTab)?.label ??
    t("admissionPortal.nav.dashboard");

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
    <ParentPortalLayout
      child={selectedChild}
      allChildren={allChildren}
      parentName={parentName}
      activeTab={activeTab}
      currentTabLabel={currentTabLabel}
      onSwitchChild={() => selectChild(null)}
    >
      {children}
    </ParentPortalLayout>
  );
}
