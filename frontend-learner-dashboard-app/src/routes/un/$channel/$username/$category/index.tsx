import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { useTheme } from "@/providers/theme/theme-provider";
import { InvalidLinkNotice } from "./-components/InvalidLinkNotice";
import { UnsubscribeSummaryCard } from "./-components/UnsubscribeSummaryCard";
import { useUnsubscribeFlow } from "./-hooks/useUnsubscribeFlow";

export const Route = createFileRoute(
  "/un/$channel/$username/$category/"
)({
  component: UnsubscribeCommunicationPage,
});

function UnsubscribeCommunicationPage() {
  const { t } = useTranslation("miscRoutesA");
  const params = Route.useParams();

  // Sometimes during SPA navigation, params might be undefined momentarily
  // In that case, fall back to parsing the URL directly
  let channel = params.channel || '';
  let username = params.username || '';
  let category = params.category || '';
  
  if (!channel || !username || !category) {
    // Fallback: Parse params from URL directly
    // URL structure: /un/$channel/$username/$category
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 4 && pathParts[0] === 'un') {
      channel = channel || pathParts[1] || '';
      username = username || pathParts[2] || '';
      category = category || pathParts[3] || '';
    }
  }

  const domainRouting = useDomainRouting();
  const { setPrimaryColor } = useTheme();
  const [fallbackThemeCode, setFallbackThemeCode] = useState<string | null>(null);

  const flow = useUnsubscribeFlow({
    channel,
    username,
    category,
    instituteId: domainRouting.instituteId,
  });

  useEffect(() => {
    const applyTheme = async () => {
      if (domainRouting.instituteThemeCode) {
        setPrimaryColor(domainRouting.instituteThemeCode);
        setFallbackThemeCode(domainRouting.instituteThemeCode);
        return;
      }

      const instituteIdParam =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("instituteId")
          : null;

      if (!instituteIdParam) return;

      try {
        const { getInstituteDetails } = await import("@/services/signup-api");
        const details = await getInstituteDetails(instituteIdParam);
        const themeCode = details?.institute_theme_code;
        if (themeCode) {
          setPrimaryColor(themeCode);
          setFallbackThemeCode(themeCode);
        }
      } catch (error) {
        console.warn("Failed to fetch institute theme for unsubscribe page:", error);
      }
    };

    applyTheme();
  }, [domainRouting.instituteThemeCode, setPrimaryColor]);

  if (!flow.channelInfo) {
    return <InvalidLinkNotice />;
  }

  const themeCode = domainRouting.instituteThemeCode || fallbackThemeCode;
  const pageBackgroundClass = themeCode ? "bg-primary-50" : "bg-slate-100";

  return (
    <main
      className={cn(
        "relative flex min-h-screen w-full overflow-hidden transition-colors duration-300",
        pageBackgroundClass
      )}
    >
      <BackgroundGlow hasTheme={Boolean(themeCode)} />
      <BackgroundPattern />
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center px-4 py-8 sm:px-8 lg:px-12 xl:px-16">
        <motion.header
          className="w-full max-w-3xl space-y-2 text-center sm:text-start"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-h2 font-semibold text-slate-900 sm:text-h1 sm:leading-9">
            {t("unsubscribe.header.title")}
          </h1>
          <p className="text-body text-slate-600 sm:text-sm">
            {t("unsubscribe.header.descriptionPrefix")}{" "}
            <span className="font-medium text-slate-800">{flow.channelLabel}</span>.
          </p>
        </motion.header>

        <motion.section
          className="mt-5 w-full max-w-3xl"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <UnsubscribeSummaryCard
            icon={flow.channelInfo.icon}
            channelLabel={flow.channelLabel}

            isError={flow.isError}
            isPending={flow.isPending}
            activeAction={flow.activeAction}
            onRetry={flow.retry}
            onResubscribe={flow.resubscribe}
            statusCardProps={{
              state: flow.status,
              recipient: flow.maskedRecipient,
              successMessage: flow.messages.success,
              errorMessage: flow.messages.error,

            }}
          />
        </motion.section>
      </div>
    </main>
  );
}

const BackgroundGlow = ({ hasTheme }: { hasTheme: boolean }) => (
  <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: hasTheme ? 0.35 : 0.2 }}
      transition={{ duration: 0.8 }}
      className={cn(
        "pointer-events-none absolute start-[-12%] top-[-25%] h-72 w-72 rounded-full blur-3xl sm:h-96 sm:w-96", // design-lint-ignore: decorative positioning
        hasTheme ? "bg-primary-300/70" : "bg-slate-200/80"
      )}
    />
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: hasTheme ? 0.3 : 0.15 }}
      transition={{ delay: 0.2, duration: 0.8 }}
      className={cn(
        "pointer-events-none absolute bottom-[-12%] end-[-15%] h-80 w-80 rounded-full blur-3xl sm:h-reg-420 sm:w-reg-420", // design-lint-ignore: decorative positioning
        hasTheme ? "bg-primary-100/80" : "bg-slate-200/70"
      )}
    />
  </>
);

const BackgroundPattern = () => (
  <div className="pointer-events-none absolute inset-0 opacity-40">
    <div className="absolute inset-0 bg-gradient-to-br from-white/50 via-transparent to-white/40" />
    <div className="absolute inset-y-0 end-[-30%] hidden h-[120%] w-[60%] rounded-full bg-white/20 blur-3xl sm:block" /> {/* design-lint-ignore: decorative positioning */}
    <div className="absolute inset-y-0 start-[-35%] hidden h-[120%] w-[55%] rounded-full bg-white/20 blur-3xl sm:block" /> {/* design-lint-ignore: decorative positioning */}
  </div>
);

