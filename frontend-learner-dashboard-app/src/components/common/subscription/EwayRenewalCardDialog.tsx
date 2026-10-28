import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CreditCard, SpinnerGap, Warning } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MyButton } from "@/components/design-system/button";
import { PaymentGatewayWrapper } from "@/components/common/enroll-by-invite/-components/payment-gateway-wrapper";
import EwayCardForm from "@/components/common/enroll-by-invite/-components/eway-card-form";
import {
  initiateRenewalPayment,
  renewalResponseData,
  type EwayRenewalCard,
  type Subscription,
} from "@/components/common/user-profile/payment-billing/subscription-services";

interface EwayRenewalCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: Subscription | null;
  instituteId: string;
  priceLabel: string;
  /** The card was charged (the success toast is already shown). Refetch the memberships. */
  onPaid: () => void;
}

/**
 * "Pay to continue" on eWay with the same card form the invite, invoice and course checkouts
 * use. The card is encrypted in the browser (eCrypt) and charged in the one request, so the
 * learner gets the result here instead of being sent off to eWay's own page.
 */
export const EwayRenewalCardDialog = ({
  open,
  onOpenChange,
  subscription,
  instituteId,
  priceLabel,
  onPaid,
}: EwayRenewalCardDialogProps) => {
  const { t } = useTranslation("miscRoutesB");
  const [card, setCard] = useState<EwayRenewalCard | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    // Never drop the dialog mid-charge: the learner would lose sight of the result.
    if (paying) return;
    if (!next) {
      setCard(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const pay = async () => {
    if (!subscription || !card) return;
    setPaying(true);
    setError(null);
    try {
      const response = await initiateRenewalPayment(
        instituteId,
        subscription,
        false,
        undefined,
        card
      );
      const data = renewalResponseData(response);
      const status = String(data?.paymentStatus ?? "").toUpperCase();
      if (status === "PAID" || status === "PAYMENT_PENDING") {
        setCard(null);
        toast.success(t("subscriptions.manage.toast.paymentReceivedTitle"), {
          // PAYMENT_PENDING: eWay took the money but the renewal is still being confirmed.
          description:
            status === "PAYMENT_PENDING"
              ? t("subscriptions.manage.cardDialog.pending")
              : t("subscriptions.manage.toast.paymentReceivedDescription"),
        });
        onPaid();
        return;
      }
      const code = data?.responseMessage || data?.errors;
      setError(
        code
          ? t("subscriptions.manage.cardDialog.declinedWithCode", { code })
          : t("subscriptions.manage.cardDialog.declined")
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("subscriptions.manage.toast.genericRetry")
      );
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-5" />
            {t("subscriptions.manage.cardDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("subscriptions.manage.cardDialog.description", { amount: priceLabel })}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-6 text-sm text-gray-500">
                <SpinnerGap className="me-2 size-4 animate-spin" />
                {t("subscriptions.manage.cardDialog.loadingForm")}
              </div>
            }
          >
            <PaymentGatewayWrapper vendor="EWAY" instituteId={instituteId}>
              <EwayCardForm
                isProcessing={paying}
                onPaymentReady={setCard}
                onError={(message) => setError(message)}
              />
            </PaymentGatewayWrapper>
          </Suspense>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-danger-50 p-2 text-sm text-danger-600">
            <Warning className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <MyButton
            type="button"
            scale="small"
            buttonType="secondary"
            layoutVariant="default"
            onClick={() => close(false)}
            disable={paying}
          >
            {t("subscriptions.manage.cardDialog.cancel")}
          </MyButton>
          <MyButton
            type="button"
            scale="small"
            buttonType="primary"
            layoutVariant="default"
            onClick={pay}
            disable={paying || !card}
          >
            {paying
              ? t("subscriptions.manage.cardDialog.processing")
              : t("subscriptions.manage.cardDialog.pay", { amount: priceLabel })}
          </MyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
