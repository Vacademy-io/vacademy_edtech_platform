import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { SiStripe } from "react-icons/si"; // design-lint-ignore: Stripe brand logo (no Phosphor equivalent)
import { SpinnerGap, Lock } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { processDonationPayment, createDonationRequest } from "../../-services/donation-api";

interface PaymentFormProps {
  amount: number;
  currency: string;
  email: string;
  instituteId: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export const PaymentForm = ({
  amount,
  currency,
  email,
  instituteId,
  onSuccess,
  onError
}: PaymentFormProps) => {
  const { t } = useTranslation("coursesRouteA");
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardComplete, setCardComplete] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      onError(t("donation.paymentForm.errors.stripeNotLoaded"));
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      onError(t("donation.paymentForm.errors.cardElementNotFound"));
      return;
    }

    setIsProcessing(true);
    setCardError("");

    try {
      // Create payment method
      const { error: paymentMethodError, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
        billing_details: {
          email: email,
        },
      });

      if (paymentMethodError) {
        setCardError(paymentMethodError.message || t("donation.paymentForm.errors.paymentMethodCreationFailed"));
        setIsProcessing(false);
        return;
      }

      // Create donation request data
      const donationData = createDonationRequest(
        amount,
        email,
        paymentMethod.id,
        paymentMethod.card?.last4 || "",
        "", // customerId - you might need to create/retrieve this
        window.location.origin + "/courses", // returnUrl
        currency // Pass the currency
      );

      // Process donation payment
      const result = await processDonationPayment(instituteId, donationData);
      
      // Check for successful payment based on actual API response format
      if (result.status === null && result.response_data && result.response_data.paymentStatus === "PAID") {
        // Payment was successful - API returns status: null and paymentStatus: "PAID" for successful payments
        onSuccess();
      } else if (result.success || result.status === "succeeded") {
        // Fallback for other success indicators
        onSuccess();
      } else if (result.status === "FAILED" && result.message) {
        // Payment failed with specific error message from API
        onError(result.message);
      } else {
        // Generic error fallback
        onError(result.message || t("donation.paymentForm.errors.paymentProcessingFailed"));
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : t("donation.paymentForm.errors.paymentFailedRetry"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Card Element Container */}
      <div className="min-h-12 border border-gray-300 rounded-md p-3 bg-white">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#374151", // design-lint-ignore: payment SDK style
                fontFamily: "system-ui, -apple-system, sans-serif",
                "::placeholder": {
                  color: "#9CA3AF", // design-lint-ignore: payment SDK style
                },
              },
              invalid: {
                color: "#DC2626", // design-lint-ignore: payment SDK style
              },
            },
          }}
          onChange={(event) => {
            setCardComplete(event.complete);
            if (event.error) {
              setCardError(event.error.message);
            } else {
              setCardError("");
            }
          }}
        />
      </div>
      
      {/* Error Message */}
      {cardError && (
        <div className="text-red-600 text-xs">
          {cardError}
        </div>
      )}
      
      {/* Donate Button */}
      <div className="pt-2">
        <MyButton
          buttonType="primary"
          scale="medium"
          layoutVariant="default"
          className="w-full h-11 text-base flex items-center justify-center gap-2"
          onClick={handleSubmit}
          disabled={!stripe || isProcessing}
        >
          {isProcessing ? (
            <>
              <SpinnerGap size={18} className="animate-spin" />
              {t("donation.paymentForm.processing")}
            </>
          ) : (
            <>
              <Lock size={18} />
              {t("donation.paymentForm.donateNow")}
            </>
          )}
        </MyButton>
      </div>

      {/* Security Message */}
      <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
        <Lock size={14} className="inline-block me-1" />
        {t("donation.paymentForm.securePaymentBy")}
        <span className="font-semibold flex items-center gap-1 ms-1">
          <SiStripe size={16} className="text-indigo-600" />
          {t("donation.paymentForm.stripeBrand")}
        </span>
      </div>
    </div>
  );
};
