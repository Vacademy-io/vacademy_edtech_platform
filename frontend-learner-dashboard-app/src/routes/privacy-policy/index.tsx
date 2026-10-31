import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Shield,
  ArrowLeft,
  Eye,
  Lock,
  Database,
  Users,
  Globe,
  Envelope,
  IdentificationCard,
  Clock,
  Baby,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Preferences } from "@capacitor/preferences";
import { z } from "zod";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { peekDomainRouting } from "@/services/domain-routing";
import {
  APP_PUBLISHER,
  PRIVACY_POLICY_LAST_UPDATED,
  resolveCurrentAppIdentity,
  urlPointsAtCurrentPage,
  type AppIdentity,
} from "@/utils/app-identity";

const privacyPolicySearchSchema = z.object({
  // Force a brand when the page is opened somewhere other than that brand's own
  // portal, e.g. /privacy-policy?app=com.dumbee.app before its domain is live.
  app: z.string().optional(),
});

export const Route = createFileRoute("/privacy-policy/")({
  validateSearch: privacyPolicySearchSchema,
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  const { t, i18n } = useTranslation("miscRoutesB");
  const navigate = useNavigate();
  const { app: appIdOverride } = Route.useSearch();
  const domainRouting = useDomainRouting();

  const [identity, setIdentity] = useState<AppIdentity | null>(null);
  // Institute behind an explicit ?app= — may differ from the host we are on.
  const [overrideInstituteName, setOverrideInstituteName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = await resolveCurrentAppIdentity(appIdOverride);
      if (cancelled) return;
      setIdentity(resolved);
      if (appIdOverride && resolved.domain) {
        const routing = await peekDomainRouting(resolved.domain, resolved.subdomain ?? "*");
        if (!cancelled && routing?.instituteName) {
          setOverrideInstituteName(routing.instituteName);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appIdOverride]);

  // Redirect to institute-specific privacy policy if configured — unless that
  // URL is this page (a portal pointing privacy_policy_url at its own
  // /privacy-policy) or the caller asked for a specific brand.
  useEffect(() => {
    if (appIdOverride) return;
    (async () => {
      try {
        const instituteId = (await Preferences.get({ key: "InstituteId" })).value || "";
        if (!instituteId) return;
        const stored = await Preferences.get({ key: `LEARNER_${instituteId}` });
        if (!stored?.value) return;
        const parsed = JSON.parse(stored.value);
        if (parsed?.privacyPolicyUrl && !urlPointsAtCurrentPage(parsed.privacyPolicyUrl)) {
          window.location.assign(parsed.privacyPolicyUrl);
        }
      } catch {
        // Ignore and show internal policy page
      }
    })();
  }, [appIdOverride]);

  const instituteName = overrideInstituteName ?? domainRouting.instituteName ?? null;
  const appName = identity?.appName ?? instituteName ?? "Vacademy";
  const portalHost = identity?.host ?? window.location.hostname;
  const vars = { appName, publisher: APP_PUBLISHER.name, institute: instituteName ?? appName };
  const lastUpdated = new Date(PRIVACY_POLICY_LAST_UPDATED).toLocaleDateString(i18n.language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Store reviewers check these four lines against the listing: app name,
  // package / bundle ids, developer name, developer address.
  const identityRows: { label: string; value: ReactNode }[] = [
    { label: t("privacyPolicy.identity.appNameLabel"), value: appName },
    {
      label: t("privacyPolicy.identity.appIdsLabel"),
      value: identity?.appIds.length ? (
        <ul className="space-y-0.5">
          {identity.appIds.map((id) => (
            <li key={id} className="font-mono text-sm">{id}</li>
          ))}
        </ul>
      ) : (
        t("privacyPolicy.identity.webOnly")
      ),
    },
    { label: t("privacyPolicy.identity.publisherLabel"), value: APP_PUBLISHER.name },
    {
      label: t("privacyPolicy.identity.publisherAddressLabel"),
      value: APP_PUBLISHER.addressLines.map((line) => (
        <span key={line} className="block">{line}</span>
      )),
    },
    ...(instituteName && instituteName !== appName
      ? [{ label: t("privacyPolicy.identity.operatedForLabel"), value: instituteName }]
      : []),
    { label: t("privacyPolicy.identity.portalLabel"), value: portalHost },
    { label: t("privacyPolicy.identity.contactLabel"), value: APP_PUBLISHER.email },
  ];

  const sections = [
    {
      id: "information-we-collect",
      title: t("privacyPolicy.sections.informationWeCollect.title"),
      icon: Database,
      content: [
        {
          subtitle: t("privacyPolicy.sections.informationWeCollect.personalInformation.subtitle"),
          text: t("privacyPolicy.sections.informationWeCollect.personalInformation.text")
        },
        {
          subtitle: t("privacyPolicy.sections.informationWeCollect.learningData.subtitle"),
          text: t("privacyPolicy.sections.informationWeCollect.learningData.text")
        },
        {
          subtitle: t("privacyPolicy.sections.informationWeCollect.technicalInformation.subtitle"),
          text: t("privacyPolicy.sections.informationWeCollect.technicalInformation.text")
        },
        {
          subtitle: t("privacyPolicy.sections.informationWeCollect.devicePermissions.subtitle"),
          text: t("privacyPolicy.sections.informationWeCollect.devicePermissions.text", vars)
        }
      ]
    },
    {
      id: "how-we-use-information",
      title: t("privacyPolicy.sections.howWeUse.title"),
      icon: Eye,
      content: [
        {
          subtitle: t("privacyPolicy.sections.howWeUse.educationalServices.subtitle"),
          text: t("privacyPolicy.sections.howWeUse.educationalServices.text")
        },
        {
          subtitle: t("privacyPolicy.sections.howWeUse.personalization.subtitle"),
          text: t("privacyPolicy.sections.howWeUse.personalization.text")
        },
        {
          subtitle: t("privacyPolicy.sections.howWeUse.communication.subtitle"),
          text: t("privacyPolicy.sections.howWeUse.communication.text")
        }
      ]
    },
    {
      id: "information-sharing",
      title: t("privacyPolicy.sections.informationSharing.title"),
      icon: Users,
      content: [
        {
          subtitle: t("privacyPolicy.sections.informationSharing.educationalPartners.subtitle"),
          text: t("privacyPolicy.sections.informationSharing.educationalPartners.text", vars)
        },
        {
          subtitle: t("privacyPolicy.sections.informationSharing.serviceProviders.subtitle"),
          text: t("privacyPolicy.sections.informationSharing.serviceProviders.text")
        },
        {
          subtitle: t("privacyPolicy.sections.informationSharing.thirdPartyServices.subtitle"),
          text: t("privacyPolicy.sections.informationSharing.thirdPartyServices.text", vars)
        },
        {
          subtitle: t("privacyPolicy.sections.informationSharing.legalRequirements.subtitle"),
          text: t("privacyPolicy.sections.informationSharing.legalRequirements.text", vars)
        }
      ]
    },
    {
      id: "data-security",
      title: t("privacyPolicy.sections.dataSecurity.title"),
      icon: Lock,
      content: [
        {
          subtitle: t("privacyPolicy.sections.dataSecurity.securityMeasures.subtitle"),
          text: t("privacyPolicy.sections.dataSecurity.securityMeasures.text")
        },
        {
          subtitle: t("privacyPolicy.sections.dataSecurity.encryption.subtitle"),
          text: t("privacyPolicy.sections.dataSecurity.encryption.text")
        },
        {
          subtitle: t("privacyPolicy.sections.dataSecurity.accessControls.subtitle"),
          text: t("privacyPolicy.sections.dataSecurity.accessControls.text")
        }
      ]
    },
    {
      id: "your-rights",
      title: t("privacyPolicy.sections.yourRights.title"),
      icon: Shield,
      content: [
        {
          subtitle: t("privacyPolicy.sections.yourRights.accessAndCorrection.subtitle"),
          text: t("privacyPolicy.sections.yourRights.accessAndCorrection.text")
        },
        {
          subtitle: t("privacyPolicy.sections.yourRights.dataPortability.subtitle"),
          text: t("privacyPolicy.sections.yourRights.dataPortability.text")
        },
        {
          subtitle: t("privacyPolicy.sections.yourRights.deletion.subtitle"),
          text: t("privacyPolicy.sections.yourRights.deletion.text")
        }
      ]
    },
    {
      id: "data-retention",
      title: t("privacyPolicy.sections.dataRetention.title"),
      icon: Clock,
      content: [
        {
          subtitle: t("privacyPolicy.sections.dataRetention.retentionPeriod.subtitle"),
          text: t("privacyPolicy.sections.dataRetention.retentionPeriod.text", vars)
        },
        {
          subtitle: t("privacyPolicy.sections.dataRetention.accountDeletion.subtitle"),
          text: t("privacyPolicy.sections.dataRetention.accountDeletion.text", {
            ...vars,
            email: APP_PUBLISHER.email,
          })
        }
      ]
    },
    {
      id: "childrens-privacy",
      title: t("privacyPolicy.sections.childrensPrivacy.title"),
      icon: Baby,
      content: [
        {
          subtitle: t("privacyPolicy.sections.childrensPrivacy.learnersUnder18.subtitle"),
          text: t("privacyPolicy.sections.childrensPrivacy.learnersUnder18.text", vars)
        }
      ]
    },
    {
      id: "international-transfers",
      title: t("privacyPolicy.sections.internationalTransfers.title"),
      icon: Globe,
      content: [
        {
          subtitle: t("privacyPolicy.sections.internationalTransfers.globalOperations.subtitle"),
          text: t("privacyPolicy.sections.internationalTransfers.globalOperations.text", vars)
        },
        {
          subtitle: t("privacyPolicy.sections.internationalTransfers.safeguards.subtitle"),
          text: t("privacyPolicy.sections.internationalTransfers.safeguards.text")
        }
      ]
    },
    {
      id: "changes",
      title: t("privacyPolicy.sections.changes.title"),
      icon: ArrowsClockwise,
      content: [
        {
          subtitle: t("privacyPolicy.sections.changes.notification.subtitle"),
          text: t("privacyPolicy.sections.changes.notification.text", vars)
        }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle Background Pattern (gradients removed) */}
      <div className="absolute inset-0 -z-10" />

      {/* Subtle Floating Background Elements */}
      <motion.div
        animate={{
          x: [0, 20, 0],
          y: [0, -10, 0],
          rotate: [0, 2, 0]
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute top-20 start-20 w-48 h-48 bg-muted/10 rounded-full blur-3xl"
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          {/* Back Button */}
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            onClick={() => navigate({ to: "/login" })}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors duration-200 mb-6 group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
            <span className="text-sm font-medium">{t("privacyPolicy.backToLogin")}</span>
          </motion.button>

          {/* Page Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gray-900 rounded-xl mx-auto flex items-center justify-center mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              {t("privacyPolicy.header.title")}
            </h1>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              {t("privacyPolicy.header.description", vars)}
            </p>
            <p className="text-sm text-gray-500 mt-4">
              {t("privacyPolicy.header.lastUpdated", { date: lastUpdated })}
            </p>
          </div>
        </motion.div>

        {/* Who this policy covers — app / developer identity for store reviews */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          aria-labelledby="privacy-identity-title"
          className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 mb-8 space-y-4"
        >
          <div className="flex items-center gap-x-3">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <IdentificationCard className="w-5 h-5 text-white" />
            </div>
            <h2 id="privacy-identity-title" className="text-xl font-bold text-gray-900">
              {t("privacyPolicy.identity.title")}
            </h2>
          </div>
          <p className="text-gray-700 leading-relaxed">
            {t(identity?.appIds.length ? "privacyPolicy.identity.intro" : "privacyPolicy.identity.introWeb", vars)}
          </p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
            {identityRows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="font-semibold text-gray-800">{row.label}</dt>
                <dd className="text-gray-700 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-gray-700 leading-relaxed">
            {t("privacyPolicy.identity.controller", vars)}
          </p>
        </motion.section>

        {/* Introduction */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 mb-8 space-y-4"
        >
          <h2 className="text-xl font-bold text-gray-900">{t("privacyPolicy.introduction.title")}</h2>
          <p className="text-gray-700 leading-relaxed">
            {t("privacyPolicy.introduction.text", vars)}
          </p>
        </motion.div>

        {/* Sections */}
        <div className="space-y-6">
          {sections.map((section, index) => (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.1 }}
              className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 space-y-section"
            >
              <div className="flex items-center gap-x-3">
                <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
                  <section.icon className="w-5 h-5 text-white" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">{section.title}</h2>
              </div>

              <div className="space-y-4">
                {section.content.map((item, itemIndex) => (
                  <div className="space-y-2" key={itemIndex}>
                    <h3 className="text-lg font-semibold text-gray-800">{item.subtitle}</h3>
                    <p className="text-gray-700 leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Contact Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-gray-200/50 p-6 lg:p-8 mt-8"
        >
          <div className="flex items-center space-x-3 mb-6">
            <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
              <Envelope className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">{t("privacyPolicy.contact.title")}</h2>
          </div>

          <p className="text-gray-700 leading-relaxed mb-4">
            {t("privacyPolicy.contact.intro")}
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800">{t("privacyPolicy.contact.emailLabel")}</h3>
              <p className="text-gray-600">
                <a href={`mailto:${APP_PUBLISHER.email}`} className="underline">
                  {APP_PUBLISHER.email}
                </a>
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800">{t("privacyPolicy.contact.addressLabel")}</h3>
              <p className="text-gray-600">
                {APP_PUBLISHER.name}<br />
                {APP_PUBLISHER.addressLines.map((line) => (
                  <span key={line}>{line}<br /></span>
                ))}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="text-center mt-12 mb-8"
        >
          <p className="text-sm text-gray-500">
            {t("privacyPolicy.footer", { date: lastUpdated })}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
