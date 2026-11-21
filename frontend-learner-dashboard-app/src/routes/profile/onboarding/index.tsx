import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  ClipboardText,
  Hourglass,
  SpinnerGap,
  Warning,
} from "@phosphor-icons/react";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { ModernCard } from "@/components/design-system/modern-card";
import { getInstituteId } from "@/constants/helper";
import {
  getTerminology,
} from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import {
  ONBOARDING_INSTANCES_QUERY_KEY,
  OnboardingStepForm,
} from "./-components/onboarding-step-form";
import { OnboardingProgressList } from "./-components/onboarding-progress-list";
import { OnboardingDetailsCard } from "./-components/onboarding-details-card";
import {
  getCurrentStepInfo,
  getMyOnboardingInstances,
  type OnboardingInstanceDTO,
} from "./-services/onboarding-services";

export const Route = createFileRoute("/profile/onboarding/")({
  component: () => (
    <LayoutContainer>
      <OnboardingPage />
    </LayoutContainer>
  ),
});

function OnboardingPage() {
  const { t } = useTranslation("userProfileExtra");
  const { setNavHeading } = useNavHeadingStore();
  const [instituteId, setInstituteId] = useState<string | null>(null);
  const [isResolvingInstitute, setIsResolvingInstitute] = useState(true);

  useEffect(() => {
    setNavHeading(t("onboarding.title"));
  }, [setNavHeading, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await getInstituteId();
      if (!cancelled) {
        setInstituteId(id ?? null);
        setIsResolvingInstitute(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    data: instances,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [ONBOARDING_INSTANCES_QUERY_KEY, instituteId],
    queryFn: () => getMyOnboardingInstances(instituteId as string),
    enabled: Boolean(instituteId),
    staleTime: 30 * 1000,
  });

  const isLoadingAny = isResolvingInstitute || (Boolean(instituteId) && isLoading);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-section px-1 py-4">
      <div>
        <h1 className="text-h3 font-semibold text-neutral-700">{t("onboarding.title")}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("onboarding.subtitle")}
        </p>
      </div>

      {isLoadingAny ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-500">
          <SpinnerGap className="size-5 animate-spin" />
          {t("onboarding.loadingStatus")}
        </div>
      ) : isError ? (
        <ModernCard
          variant="outlined"
          padding="lg"
          rounded="lg"
          className="flex flex-col items-center gap-stack text-center"
        >
          <Warning className="size-8 text-danger-500" />
          <p className="text-sm text-neutral-600">
            {t("onboarding.loadError")}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm font-medium text-primary-500 hover:underline"
          >
            {t("onboarding.retry")}
          </button>
        </ModernCard>
      ) : !instances || instances.length === 0 ? (
        <ModernCard
          variant="subtle"
          padding="lg"
          rounded="lg"
          className="flex flex-col items-center gap-stack py-10 text-center"
        >
          <ClipboardText className="size-8 text-neutral-400" />
          <p className="text-sm text-neutral-600">
            {t("onboarding.empty")}
          </p>
        </ModernCard>
      ) : (
        instances.map((instance) => (
          <OnboardingInstanceCard key={instance.id} instance={instance} />
        ))
      )}
    </div>
  );
}

interface OnboardingInstanceCardProps {
  instance: OnboardingInstanceDTO;
}

function OnboardingInstanceCard({ instance }: OnboardingInstanceCardProps) {
  const { t } = useTranslation("userProfileExtra");
  const current = getCurrentStepInfo(instance);

  return (
    <div className="flex flex-col gap-4">
      {/* Only set when this is a linked child's instance, not the caller's own —
          lets a parent with multiple children tell their cards apart. */}
      {instance.subject_full_name && (
        <p className="text-sm font-medium text-neutral-600">
          {t("onboarding.onboardingFor", { name: instance.subject_full_name })}
        </p>
      )}
      {current?.isActionable ? (
        <OnboardingStepForm
          stepInstance={current.step}
          onSubmitted={() => {
            /* Query invalidation inside OnboardingStepForm refetches
               instances; the next active step (if any) renders from the
               refreshed data automatically. */
          }}
        />
      ) : instance.status === "COMPLETED" ? (
        <ModernCard
          variant="glass"
          padding="lg"
          rounded="lg"
          className="flex items-center gap-3 border border-white/40 bg-white/90"
        >
          <CheckCircle className="size-6 shrink-0 text-success-600" weight="fill" />
          <p className="text-sm text-neutral-600">
            {t("onboarding.flowComplete")}
          </p>
        </ModernCard>
      ) : current ? (
        <ModernCard
          variant="glass"
          padding="lg"
          rounded="lg"
          className="flex items-center gap-3 border border-warning-200 bg-warning-50"
        >
          <Hourglass className="size-6 shrink-0 text-warning-600" weight="fill" />
          <div>
            <p className="text-sm font-medium text-neutral-700">
              {t("onboarding.handledByAdmin", {
                stepName: current.step.step_name,
                admin: getTerminology(RoleTerms.Admin, SystemTerms.Admin).toLocaleLowerCase(),
              })}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {t("onboarding.handledByAdminHint")}
            </p>
          </div>
        </ModernCard>
      ) : (
        <ModernCard
          variant="glass"
          padding="lg"
          rounded="lg"
          className="flex items-center gap-3 border border-white/40 bg-white/90"
        >
          <CheckCircle className="size-6 shrink-0 text-neutral-400" />
          <p className="text-sm text-neutral-600">
            {t("onboarding.noActionNeeded")}
          </p>
        </ModernCard>
      )}

      <ModernCard className="space-y-2" variant="outlined" padding="md" rounded="lg">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t("onboarding.progress")}
        </p>
        <OnboardingProgressList stepInstances={instance.step_instances} />
      </ModernCard>

      {/* Everything already submitted, laid out in full. Rendered whatever the instance's
          status: mid-flow it shows the steps done so far, and once the flow is COMPLETED it
          becomes the reason to keep this page reachable at all. Renders nothing when there is
          nothing this learner may see. */}
      <OnboardingDetailsCard instanceId={instance.id} />
    </div>
  );
}
