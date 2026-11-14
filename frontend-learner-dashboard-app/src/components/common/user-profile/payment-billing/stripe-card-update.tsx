import { useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { SpinnerGap } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import {
  createStripeSetupIntent,
  confirmStripeCardUpdate,
} from "./payment-method-services";

interface StripeCardUpdateProps {
  instituteId: string;
  onUpdated: () => void;
  onCancel: () => void;
}

/**
 * Collects a new card with Stripe Elements and saves it as the default
 * payment method via the SetupIntent flow (no charge, 3DS handled by
 * confirmCardSetup). Must be rendered inside a Stripe <Elements> provider.
 */
export const StripeCardUpdate = ({
  instituteId,
  onUpdated,
  onCancel,
}: StripeCardUpdateProps) => {
  const { t } = useTranslation("userProfileExtra");
  const stripe = useStripe();
  const elements = useElements();
  const [isSaving, setIsSaving] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);

  const handleSave = async () => {
    if (!stripe || !elements) {
      toast.error(t("cardUpdate.stripe.formNotReady"));
      return;
    }
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      toast.error(t("cardUpdate.stripe.cardFormNotFound"));
      return;
    }

    setIsSaving(true);
    try {
      const setupIntent = await createStripeSetupIntent(instituteId);
      const result = await stripe.confirmCardSetup(setupIntent.client_secret, {
        payment_method: { card: cardElement },
      });

      if (result.error) {
        toast.error(result.error.message || t("cardUpdate.stripe.verificationFailed"));
        return;
      }
      const paymentMethodId =
        typeof result.setupIntent.payment_method === "string"
          ? result.setupIntent.payment_method
          : result.setupIntent.payment_method?.id;
      if (result.setupIntent.status !== "succeeded" || !paymentMethodId) {
        toast.error(t("cardUpdate.stripe.verificationRetry"));
        return;
      }

      await confirmStripeCardUpdate(instituteId, paymentMethodId);
      toast.success(t("cardUpdate.success"));
      onUpdated();
    } catch (error) {
      console.error("Stripe card update failed:", error);
      toast.error(t("cardUpdate.genericError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <CardElement
          onChange={(e) => setCardComplete(e.complete)}
          options={{
            hidePostalCode: true,
            style: {
              base: {
                fontSize: "16px",
              },
            },
          }}
        />
      </div>
      <p className="text-xs text-gray-500">
        {t("cardUpdate.stripe.note")}
      </p>
      <div className="flex items-center justify-end gap-3">
        <MyButton
          type="button"
          scale="medium"
          buttonType="secondary"
          layoutVariant="default"
          onClick={onCancel}
          disabled={isSaving}
        >
          {t("common.cancel")}
        </MyButton>
        <MyButton
          type="button"
          scale="medium"
          buttonType="primary"
          layoutVariant="default"
          onClick={handleSave}
          disabled={isSaving || !cardComplete}
        >
          {isSaving ? (
            <>
              <SpinnerGap className="me-2 size-4 animate-spin" />
              {t("common.saving")}
            </>
          ) : (
            t("common.saveCard")
          )}
        </MyButton>
      </div>
    </div>
  );
};
