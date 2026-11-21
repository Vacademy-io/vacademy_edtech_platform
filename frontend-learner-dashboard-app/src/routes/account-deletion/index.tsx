import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Trash,
  Envelope,
  ListChecks,
  Database,
  Archive,
  Clock,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCurrentDomainInfo,
  getCachedInstituteBranding,
  resolveDomainRouting,
} from "@/services/domain-routing";

export const Route = createFileRoute("/account-deletion/")({
  component: AccountDeletion,
});

const SUPPORT_EMAIL = "support@vacademy.io";

/**
 * Public, logged-OUT account-deletion page.
 *
 * Google Play requires the "Delete account URL" on a store listing to be
 * reachable without signing in, to name the app, to spell out the steps to
 * request deletion, and to state what is deleted, what is kept, and for how
 * long. The in-app flow at /delete-user cannot serve that purpose: it is
 * permission-gated and bounces anonymous visitors to /dashboard.
 */
function AccountDeletion() {
  const { t } = useTranslation("miscRoutesB");
  const [appName, setAppName] = useState<string>("");

  // The learner app is multi-tenant, and Google Play requires this page to name
  // the entity on the store listing. Resolve the institute from the HOSTNAME,
  // not from app state: the reviewer opens this link in a plain browser where
  // there is no Capacitor storage and no bootstrap cache, so anything read from
  // device state comes back empty and the page renders unbranded — which is
  // exactly what gets the Data safety form rejected.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Cheap first pass: branding the app bootstrap may already have cached.
      const cached = getCachedInstituteBranding();
      if (cached?.instituteName && !cancelled) setAppName(cached.instituteName);

      // Authoritative pass. On web getCurrentDomainInfo() derives domain and
      // subdomain from window.location; on native it comes from flavor.config.
      try {
        const { domain, subdomain } = await getCurrentDomainInfo();
        if (!domain) return;
        // Apex white-label domains (two-part hosts) yield an empty subdomain,
        // but those rows are stored with subdomain '*'.
        let resolved = await resolveDomainRouting(domain, subdomain || "*");
        if (!resolved && subdomain) {
          resolved = await resolveDomainRouting(domain, "*");
        }
        if (resolved?.instituteName && !cancelled) {
          setAppName(resolved.instituteName);
        }
      } catch {
        // Leave whatever name we already have; the page still renders.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Name the app in the tab title too — reviewers screenshot this.
  useEffect(() => {
    document.title = appName
      ? t("accountDeletion.pageTitleWithApp", { appName })
      : t("accountDeletion.pageTitle");
  }, [appName, t]);

  const subject = encodeURIComponent("Account deletion request");

  const sections = [
    {
      id: "how-to-request",
      title: t("accountDeletion.sections.howToRequest.title"),
      icon: ListChecks,
      content: [
        {
          subtitle: t("accountDeletion.sections.howToRequest.fromApp.subtitle"),
          text: t("accountDeletion.sections.howToRequest.fromApp.text"),
        },
        {
          subtitle: t("accountDeletion.sections.howToRequest.byEmail.subtitle"),
          text: t("accountDeletion.sections.howToRequest.byEmail.text", {
            email: SUPPORT_EMAIL,
          }),
        },
      ],
    },
    {
      id: "data-deleted",
      title: t("accountDeletion.sections.dataDeleted.title"),
      icon: Database,
      content: [
        {
          subtitle: t("accountDeletion.sections.dataDeleted.within30Days.subtitle"),
          text: t("accountDeletion.sections.dataDeleted.within30Days.text"),
        },
      ],
    },
    {
      id: "data-kept",
      title: t("accountDeletion.sections.dataKept.title"),
      icon: Archive,
      content: [
        {
          subtitle: t("accountDeletion.sections.dataKept.paymentRecords.subtitle"),
          text: t("accountDeletion.sections.dataKept.paymentRecords.text"),
        },
        {
          subtitle: t("accountDeletion.sections.dataKept.anonymisedStats.subtitle"),
          text: t("accountDeletion.sections.dataKept.anonymisedStats.text"),
        },
      ],
    },
    {
      id: "timeline",
      title: t("accountDeletion.sections.timeline.title"),
      icon: Clock,
      content: [
        {
          subtitle: t("accountDeletion.sections.timeline.whatHappens.subtitle"),
          text: t("accountDeletion.sections.timeline.whatHappens.text"),
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 lg:py-14">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8 space-y-4"
        >
          <div className="w-16 h-16 bg-gray-900 rounded-xl mx-auto flex items-center justify-center">
            <Trash className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900">
            {appName
              ? t("accountDeletion.pageTitleWithApp", { appName })
              : t("accountDeletion.pageTitle")}
          </h1>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            {appName
              ? t("accountDeletion.pageDescriptionWithApp", { appName })
              : t("accountDeletion.pageDescription")}
          </p>
        </motion.div>

        {/* Sections */}
        <div className="space-y-6">
          {sections.map((section, index) => (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.1 }}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:p-8 space-y-section"
            >
              <div className="flex items-center gap-x-3">
                <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                  <section.icon className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">
                  {section.title}
                </h2>
              </div>

              <div className="space-y-4">
                {section.content.map((item) => (
                  <div className="space-y-2" key={item.subtitle}>
                    <h3 className="text-lg font-semibold text-gray-800">
                      {item.subtitle}
                    </h3>
                    <p className="text-gray-700 leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Contact */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 lg:p-8 mt-6 space-y-4"
        >
          <div className="flex items-center gap-x-3">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <Envelope className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              {t("accountDeletion.contact.title")}
            </h2>
          </div>
          <p className="text-gray-700 leading-relaxed">
            {t("accountDeletion.contact.text")}{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}
              className="font-medium text-gray-900 underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </motion.div>
      </div>
    </div>
  );
}
