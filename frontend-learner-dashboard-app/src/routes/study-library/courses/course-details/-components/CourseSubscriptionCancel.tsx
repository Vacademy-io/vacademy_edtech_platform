import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  SUBSCRIPTION_LIST_QUERY_KEY,
  fetchSubscriptions,
  cancelSubscription,
} from "@/components/common/user-profile/payment-billing/subscription-services";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";

interface CourseSubscriptionCancelProps {
  instituteId: string;
  packageSessionId?: string;
}

const formatDate = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

/**
 * Shows a "Cancel subscription" control on the course-details page when the
 * learner has an active autopay mandate for THIS course (package session).
 * Renders nothing otherwise, so it's safe to drop in unconditionally.
 */
export const CourseSubscriptionCancel = ({
  instituteId,
  packageSessionId,
}: CourseSubscriptionCancelProps) => {
  // Reader-mode (native iOS): "Cancel subscription" is a paid-subscription
  // surface Apple flags under Guideline 3.1.1. Constant per session.
  if (shouldHidePaidPurchaseUI()) return null;

  const { t } = useTranslation("courseDetailsA");
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: subscriptions } = useQuery({
    queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, instituteId],
    queryFn: () => fetchSubscriptions(instituteId),
    enabled: Boolean(instituteId && packageSessionId),
    staleTime: 60 * 1000,
  });

  const subscription = (subscriptions ?? []).find(
    (s) =>
      s.has_active_mandate &&
      Boolean(packageSessionId) &&
      (s.package_session_ids ?? []).includes(packageSessionId as string)
  );

  const cancelMutation = useMutation({
    mutationFn: (userPlanId: string) =>
      cancelSubscription(instituteId, userPlanId),
    onSuccess: () => {
      toast.success(t("subscriptionCancel.toast.successTitle"), {
        description: t("subscriptionCancel.toast.successDescription"),
      });
      setConfirmOpen(false);
      queryClient.invalidateQueries({
        queryKey: [SUBSCRIPTION_LIST_QUERY_KEY, instituteId],
      });
    },
    onError: () => {
      toast.error(t("subscriptionCancel.toast.errorTitle"), {
        description: t("subscriptionCancel.toast.errorDescription"),
      });
    },
  });

  if (!subscription) return null;

  return (
    <div className="rounded-xl border border-catalogue-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ArrowsClockwise
            className="mt-0.5 size-5 text-primary-500"
            weight="duotone"
          />
          <div>
            <p className="text-sm font-medium text-catalogue-text-primary">
              {t("subscriptionCancel.autoRenewing")}
            </p>
            <p className="text-xs text-catalogue-text-muted">
              {formatDate(subscription.next_charge_at)
                ? t("subscriptionCancel.renewsOn", {
                    date: formatDate(subscription.next_charge_at),
                  })
                : t("subscriptionCancel.recurringActive")}
            </p>
          </div>
        </div>
        <MyButton
          type="button"
          scale="small"
          buttonType="secondary"
          layoutVariant="default"
          onClick={() => setConfirmOpen(true)}
        >
          {t("subscriptionCancel.cancelButton")}
        </MyButton>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warning className="size-5 text-danger-500" weight="fill" />
              {t("subscriptionCancel.confirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("subscriptionCancel.confirmDescription", {
                endDate:
                  formatDate(subscription.end_date) ??
                  t("subscriptionCancel.endOfCurrentPeriod"),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <MyButton
              type="button"
              scale="small"
              buttonType="secondary"
              layoutVariant="default"
              onClick={() => setConfirmOpen(false)}
              disable={cancelMutation.isPending}
            >
              {t("subscriptionCancel.keepButton")}
            </MyButton>
            <MyButton
              type="button"
              scale="small"
              buttonType="primary"
              layoutVariant="default"
              onClick={() => cancelMutation.mutate(subscription.user_plan_id)}
              disable={cancelMutation.isPending}
            >
              {cancelMutation.isPending
                ? t("subscriptionCancel.cancelling")
                : t("subscriptionCancel.cancelButton")}
            </MyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
