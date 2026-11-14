import { createFileRoute, ErrorComponentProps } from "@tanstack/react-router";
import { z } from "zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import { LinkBreak } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ModernCard } from "@/components/design-system/modern-card";
import {
  handleGetSubOrgRegistrationTemplate,
  getSubOrgApiErrorMessage,
} from "./-services/sub-org-registration-services";
import RegistrationWizard from "./-components/registration-wizard";

const registrationParamsSchema = z.object({
  instituteId: z.string().min(1),
  code: z.string().min(1),
});

/**
 * Friendly page for invalid/closed registration links (the template endpoint
 * returns 4xx/5xx for inactive links or ones that hit their registration cap).
 */
function RegistrationLinkError({ error }: ErrorComponentProps) {
  const { t } = useTranslation("registrationB");
  const message = getSubOrgApiErrorMessage(
    error,
    t("subOrgRegistration.linkError.defaultMessage")
  );

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-neutral-50 to-primary-50 px-4 py-8">
      <ModernCard
        variant="glass"
        padding="lg"
        rounded="lg"
        className="w-full max-w-md border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
      >
        <div className="space-y-4 py-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-neutral-100">
            <LinkBreak className="size-8 text-neutral-500" />
          </div>
          <h1 className="text-xl font-semibold text-neutral-700">
            {t("subOrgRegistration.linkError.title")}
          </h1>
          <p className="text-sm text-neutral-500">{message}</p>
          <p className="text-caption text-neutral-400">
            {t("subOrgRegistration.linkError.contactHint")}
          </p>
        </div>
      </ModernCard>
    </div>
  );
}

export const Route = createFileRoute("/sub-org-registration/")({
  validateSearch: registrationParamsSchema,
  component: RouteComponent,
  errorComponent: RegistrationLinkError,
});

function RouteComponent() {
  const { instituteId, code } = Route.useSearch();

  const { data: template } = useSuspenseQuery(
    handleGetSubOrgRegistrationTemplate({ instituteId, code })
  );

  return (
    <RegistrationWizard
      template={template}
      instituteId={instituteId}
      code={code}
    />
  );
}
