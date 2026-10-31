import {
  House,
  ClipboardText,
  CalendarCheck,
  GraduationCap,
  ShieldCheck,
  CurrencyDollar,
  Gauge,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export type TabId =
  | "dashboard"
  | "application"
  | "schedule"
  | "admission"
  | "documents"
  | "payments"
  | "tracker";

export interface NavTab {
  id: TabId;
  label: string;
  icon: React.ElementType;
  mobileLabel: string;
  /** Canonical URL for this tab. */
  route: string;
}

export const NAV_TABS: NavTab[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: House,
    mobileLabel: "Home",
    route: "/parent/",
  },
  {
    id: "application",
    label: "Application",
    icon: ClipboardText,
    mobileLabel: "Apply",
    route: "/parent/application/",
  },
  {
    id: "schedule",
    label: "Interview & Tests",
    icon: CalendarCheck,
    mobileLabel: "Tests",
    route: "/parent/schedule/",
  },
  {
    id: "admission",
    label: "Admissions",
    icon: GraduationCap,
    mobileLabel: "Admission",
    route: "/parent/admission/",
  },
  {
    id: "documents",
    label: "Verification",
    icon: ShieldCheck,
    mobileLabel: "Verify",
    route: "/parent/documents/",
  },
  {
    id: "payments",
    label: "Payment",
    icon: CurrencyDollar,
    mobileLabel: "Pay",
    route: "/parent/payment/",
  },
  {
    id: "tracker",
    label: "Status",
    icon: Gauge,
    mobileLabel: "Status",
    route: "/parent/tracker/",
  },
];

/** Same tab list as {@link NAV_TABS}, with labels translated for the active locale. */
export function useNavTabs(): NavTab[] {
  const { t } = useTranslation("parent");
  return [
    {
      id: "dashboard",
      label: t("admissionPortal.nav.dashboard"),
      icon: House,
      mobileLabel: t("admissionPortal.nav.home"),
      route: "/parent/",
    },
    {
      id: "application",
      label: t("admissionPortal.nav.application"),
      icon: ClipboardText,
      mobileLabel: t("admissionPortal.nav.apply"),
      route: "/parent/application/",
    },
    {
      id: "schedule",
      label: t("admissionPortal.nav.interviewAndTests"),
      icon: CalendarCheck,
      mobileLabel: t("admissionPortal.nav.tests"),
      route: "/parent/schedule/",
    },
    {
      id: "admission",
      label: t("admissionPortal.nav.admissions"),
      icon: GraduationCap,
      mobileLabel: t("admissionPortal.nav.admission"),
      route: "/parent/admission/",
    },
    {
      id: "documents",
      label: t("admissionPortal.nav.verification"),
      icon: ShieldCheck,
      mobileLabel: t("admissionPortal.nav.verify"),
      route: "/parent/documents/",
    },
    {
      id: "payments",
      label: t("admissionPortal.nav.payment"),
      icon: CurrencyDollar,
      mobileLabel: t("admissionPortal.nav.pay"),
      route: "/parent/payment/",
    },
    {
      id: "tracker",
      label: t("admissionPortal.nav.status"),
      icon: Gauge,
      mobileLabel: t("admissionPortal.nav.status"),
      route: "/parent/tracker/",
    },
  ];
}
