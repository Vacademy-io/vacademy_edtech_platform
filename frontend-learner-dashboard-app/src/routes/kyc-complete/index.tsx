import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";

export const Route = createFileRoute("/kyc-complete/")({
  component: KycCompletePage,
});

/**
 * Public DigiLocker redirect landing page. The consent flow (opened in a new
 * tab by the sub-org registration KYC step) sends the user here after they
 * finish; the original wizard tab polls /kyc/status and picks the result up
 * automatically, so this page only needs to say "go back".
 */
function KycCompletePage() {
  const { t } = useTranslation("miscRoutesB");
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-neutral-50 to-primary-50 px-4 py-8">
      <ModernCard
        variant="glass"
        padding="lg"
        rounded="lg"
        className="w-full max-w-md border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
      >
        <div className="space-y-4 py-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-50">
            <CheckCircle weight="fill" className="size-8 text-success-600" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-700">
            {t("kycComplete.title")}
          </h1>
          <p className="text-sm text-neutral-500">
            {t("kycComplete.description")}
          </p>
        </div>
      </ModernCard>
    </div>
  );
}
