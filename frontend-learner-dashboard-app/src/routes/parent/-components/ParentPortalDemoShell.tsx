// Demo shell — same layout as ParentPortalShell but modules receive mock data
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile } from "@/types/parent-portal";
import {
  MOCK_OVERVIEW,
  MOCK_TIMELINE,
  MOCK_REGISTRATION,
  MOCK_INTERVIEW,
  MOCK_ASSESSMENT,
  MOCK_PAYMENT_SUMMARY,
  MOCK_PAYMENT_HISTORY,
  MOCK_DOCUMENTS,
} from "./mock-data";
import {
  House, ClipboardText, CalendarCheck, CurrencyDollar,
  FileText, ArrowsClockwise, Bell, Users, List, X,
} from "@phosphor-icons/react";
import { ParentDashboardDemo } from "./demos/DashboardDemo";
import { RegistrationDemo } from "./demos/RegistrationDemo";
import { InterviewDemo } from "./demos/InterviewDemo";
import { PaymentsDemo } from "./demos/PaymentsDemo";
import { DocumentsDemo } from "./demos/DocumentsDemo";
import { TrackerDemo } from "./demos/TrackerDemo";

type TabId = "dashboard" | "registration" | "schedule" | "payments" | "documents" | "tracker";

interface Props { child: ChildProfile; allChildren: ChildProfile[]; onSwitchChild: () => void }

export function ParentPortalDemoShell({ child, allChildren, onSwitchChild }: Props) {
  const { t } = useTranslation("parent");
  const NAV_TABS: { id: TabId; label: string; icon: React.ElementType; mobileLabel: string }[] = [
    { id: "dashboard", label: t("admissionPortal.nav.dashboard"), icon: House, mobileLabel: t("admissionPortal.nav.home") },
    { id: "registration", label: t("admissionPortal.demo.nav.registration"), icon: ClipboardText, mobileLabel: t("admissionPortal.demo.nav.register") },
    { id: "schedule", label: t("admissionPortal.demo.nav.interviewAndAssessment"), icon: CalendarCheck, mobileLabel: t("admissionPortal.demo.nav.schedule") },
    { id: "payments", label: t("admissionPortal.nav.payment"), icon: CurrencyDollar, mobileLabel: t("admissionPortal.nav.pay") },
    { id: "documents", label: t("admissionPortal.demo.nav.documents"), icon: FileText, mobileLabel: t("admissionPortal.demo.nav.docs") },
    { id: "tracker", label: t("admissionPortal.tracker.heading"), icon: ArrowsClockwise, mobileLabel: t("admissionPortal.demo.nav.tracker") },
  ];
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const initials = child.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  const canSwitch = allChildren.length > 1;

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case "dashboard": return <ParentDashboardDemo child={child} overview={MOCK_OVERVIEW} onNavigate={setActiveTab} />;
      case "registration": return <RegistrationDemo child={child} formData={MOCK_REGISTRATION} />;
      case "schedule": return <InterviewDemo child={child} interview={MOCK_INTERVIEW} assessment={MOCK_ASSESSMENT} />;
      case "payments": return <PaymentsDemo child={child} summary={MOCK_PAYMENT_SUMMARY} history={MOCK_PAYMENT_HISTORY} />;
      case "documents": return <DocumentsDemo child={child} docData={MOCK_DOCUMENTS} />;
      case "tracker": return <TrackerDemo child={child} timeline={MOCK_TIMELINE} />;
      default: return <ParentDashboardDemo child={child} overview={MOCK_OVERVIEW} onNavigate={setActiveTab} />;
    }
  }, [activeTab, child]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Demo banner */}
      <div className="bg-amber-500 text-amber-950 text-center text-xs py-1 font-medium">
        {t("admissionPortal.demo.banner")}
      </div>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between px-4 h-14 sm:h-16 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="lg:hidden p-1.5 rounded-lg hover:bg-muted/50">
              {isMobileMenuOpen ? <X size={20} /> : <List size={20} />}
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-sm">{initials}</div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-foreground leading-tight">{child.full_name}</p>
                <p className="text-caption text-muted-foreground leading-tight">{child.grade_applying || t("admissionPortal.dashboard.inProgress")}</p>
              </div>
            </div>
          </div>
          <nav className="hidden lg:flex items-center gap-1 bg-muted/30 rounded-xl p-1">
            {NAV_TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`relative px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                  {isActive && <motion.div layoutId="demoActiveTab" className="absolute inset-0 bg-primary rounded-lg shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                  <span className="relative z-10 flex items-center gap-1.5"><tab.icon size={14} />{tab.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            {canSwitch && <button onClick={onSwitchChild} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg"><Users size={16} /><span className="hidden sm:inline">{t("admissionPortal.demo.switch")}</span></button>}
            <button className="relative p-2 rounded-lg hover:bg-muted/50"><Bell size={18} className="text-muted-foreground" /><span className="absolute top-1.5 end-1.5 w-2 h-2 bg-orange-500 rounded-full" /></button>
          </div>
        </div>
      </header>
      {/* Mobile menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (<>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMobileMenuOpen(false)} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
          <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="fixed inset-y-0 start-0 z-50 w-72 bg-card border-e shadow-2xl lg:hidden">
            <div className="p-4 border-b"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground text-sm font-bold">{initials}</div><div><p className="text-sm font-semibold">{child.full_name}</p><p className="text-xs text-muted-foreground">{child.grade_applying}</p></div></div></div>
            <nav className="p-2 space-y-0.5">{NAV_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${activeTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}><tab.icon size={18} />{tab.label}</button>))}</nav>
          </motion.div>
        </>)}
      </AnimatePresence>
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="w-full">{tabContent}</motion.div>
        </AnimatePresence>
      </main>
      {/* Bottom tabs mobile */}
      <nav className="lg:hidden fixed bottom-0 start-0 end-0 z-40 bg-card/90 backdrop-blur-xl border-t border-border/50">
        <div className="flex items-center justify-around px-2 h-16">
          {NAV_TABS.slice(0, 5).map(tab => (<button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex flex-col items-center gap-0.5 min-w-0 flex-1 py-1 rounded-lg relative ${activeTab === tab.id ? "text-primary" : "text-muted-foreground"}`}><tab.icon size={20} className="shrink-0" /><span className="text-caption font-medium truncate w-full text-center">{tab.mobileLabel}</span>{activeTab === tab.id && <motion.div layoutId="demoMobileTab" className="absolute top-0 start-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />}</button>))}
        </div>
      </nav>
      <div className="lg:hidden h-16" />
    </div>
  );
}
