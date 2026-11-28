import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { PaymentForm } from "./PaymentForm";
import { GET_PAYMENT_GATEWAY_DETAILS_URL } from "@/constants/urls";
import { cachedGet } from "@/lib/http/clientCache";
import { getCurrencySymbol } from "@/utils/currency";

interface DonationPaymentStepProps {
  amount: number;
  currency: string;
  email: string;
  instituteId: string;
  onSuccess: () => void;
  onError: (error: string) => void;
  onBack: () => void;
}

export const DonationPaymentStep = ({
  amount,
  currency,
  email,
  instituteId,
  onSuccess,
  onError,
  onBack,
}: DonationPaymentStepProps) => {
  const { t } = useTranslation("coursesRouteA");
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch Stripe publishable key
  useEffect(() => {
    const fetchStripeKey = async () => {
      try {
        setLoading(true);
        const data = await cachedGet<Record<string, any>>(
          `${GET_PAYMENT_GATEWAY_DETAILS_URL}?instituteId=${instituteId}&vendor=STRIPE`,
          {
            method: "GET",
            headers: {
              accept: "*/*",
            },
          }
        );

        let publishableKey: string | undefined;

        // Check if publishableKey is directly available in the response
        if (data.publishableKey) {
          publishableKey = data.publishableKey;
        } else if (data.config_json) {
          try {
            const config = JSON.parse(data.config_json);

            // Try different possible field names for publishable key
            publishableKey =
              config.publishableKey ||
              config.publishable_key ||
              config.stripe_publishable_key ||
              config.stripePublishableKey ||
              config.key ||
              config.public_key;
          } catch (error) {
            // Silent error handling
          }
        }

        if (publishableKey) {
          const stripeInstance = loadStripe(publishableKey);
          setStripePromise(stripeInstance);
        } else {
          onError(t("donation.paymentStep.errors.gatewayNotConfigured"));
        }
      } catch (error) {
        onError(t("donation.paymentStep.errors.failedToLoad"));
      } finally {
        setLoading(false);
      }
    };

    fetchStripeKey();
  }, [instituteId, onError]);

  if (loading) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
        <p className="text-sm text-gray-600">{t("donation.paymentStep.loadingGateway")}</p>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-600">{t("donation.paymentStep.gatewayUnavailable")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 bg-white border border-neutral-300 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-gray-700">{t("donation.summary.title")}</span>
        </div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{t("donation.summary.amountLabel")}</span>
          <span className="font-semibold text-gray-900">
            {getCurrencySymbol(currency)}
            {amount}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{t("donation.summary.emailLabel")}</span>
          <span className="font-semibold text-gray-900">{email}</span>
        </div>
        <button
          className="text-xs font-medium ms-auto block rounded border border-neutral-300 bg-white text-neutral-600 px-3 py-1 focus:outline-none transition-colors duration-200 hover:bg-blue-50/50 hover:border-blue-300"
          onClick={onBack}
          style={{ boxShadow: "none", textDecoration: "none" }}
        >
          {t("donation.summary.editButton")}
        </button>
      </div>

      <div className="mb-2 space-y-1">
        <div className="flex items-center justify-between">
          <label className="block text-xs text-gray-600">{t("donation.paymentStep.cardDetailsLabel")}</label>
        </div>

        <Elements stripe={stripePromise}>
          <PaymentForm
            amount={amount}
            currency={currency}
            email={email}
            instituteId={instituteId}
            onSuccess={onSuccess}
            onError={onError}
          />
        </Elements>
      </div>
    </>
  );
};
