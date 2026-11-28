import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ChildProfile } from "@/types/parent-portal";
import { ParentDashboard } from "./ParentDashboard";
import { ParentApplicationForm } from "./ParentApplicationForm";
import { InterviewAssessmentModule } from "./InterviewAssessmentModule";
import { PaymentsModule } from "./PaymentsModule";
import { DocumentsModule } from "./DocumentsModule";
import { AdmissionTracker } from "./AdmissionTracker";
import { ParentPortalLayout } from "./ParentPortalLayout";
import { useNavTabs, type TabId } from "./navigation-config";

interface ParentPortalShellProps {
  child: ChildProfile;
  allChildren: ChildProfile[];
  parentName: string;
  onSwitchChild: () => void;
}

export function ParentPortalShell({
  child,
  allChildren,
  parentName,
  onSwitchChild,
}: ParentPortalShellProps) {
  const { t } = useTranslation("parent");
  const navTabs = useNavTabs();
  const location = useLocation();
  console.log("sheel", child);
  // Derive active tab from URL path so routes map to tabs.
  const activeTabFromPath = useMemo((): TabId => {
    const p = location.pathname || "";
    if (p.includes("/application")) return "application";
    if (p.includes("/payment")) return "payments";
    if (p.includes("/schedule")) return "schedule";
    if (p.includes("/admission")) return "admission";
    if (p.includes("/documents")) return "documents";
    if (p.includes("/tracker")) return "tracker";
    return "dashboard";
  }, [location.pathname]);

  const [activeTab, setActiveTab] = useState<TabId>(activeTabFromPath);

  // Sync state when location changes (render-time, no effect needed).
  if (activeTab !== activeTabFromPath) {
    setActiveTab(activeTabFromPath);
  }

  // Tab content mapped from active tab.
  const tabContent = useMemo(() => {
    switch (activeTab) {
      case "dashboard":
        return <ParentDashboard child={child} onNavigate={setActiveTab} />;
      case "application":
        return (
          <ParentApplicationForm
            onComplete={() => setActiveTab("payments")}
            destinationPackageSessionId={
              child.destinationPackageSessionId ?? ""
            }
            child={child}
          />
        );
      case "schedule":
        return <InterviewAssessmentModule child={child} />;
      case "admission":
        return (
          <ParentApplicationForm
            onComplete={() => setActiveTab("payments")}
            destinationPackageSessionId={
              child.destinationPackageSessionId ?? ""
            }
            child={child}
          />
        );
      case "payments":
        return <PaymentsModule child={child} />;
      case "documents":
        return <DocumentsModule child={child} />;
      case "tracker":
        return <AdmissionTracker child={child} />;
      default:
        return <ParentDashboard child={child} onNavigate={setActiveTab} />;
    }
  }, [activeTab, child]);

  const currentTabLabel =
    navTabs.find((tab) => tab.id === activeTab)?.label ??
    t("admissionPortal.nav.dashboard");

  return (
    <ParentPortalLayout
      child={child}
      allChildren={allChildren}
      parentName={parentName}
      activeTab={activeTab}
      currentTabLabel={currentTabLabel}
      onSwitchChild={onSwitchChild}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-7xl mx-auto"
        >
          {tabContent}
        </motion.div>
      </AnimatePresence>
    </ParentPortalLayout>
  );
}
