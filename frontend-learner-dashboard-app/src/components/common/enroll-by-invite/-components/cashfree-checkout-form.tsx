/**
 * Cashfree Checkout Form - Hosted Payment Page (Redirect)
 *
 * Uses paymentSessionId to open Cashfree's hosted payment page via checkout().
 * User enters card details on Cashfree's secure page, then is redirected back.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { load as loadCashfree } from "@cashfreepayments/cashfree-js";

interface CashfreeCheckoutFormProps {
  error: string | null;
  amount: number;
  currency: string;
  paymentSessionId?: string | null;
  returnUrl?: string;
  orderId?: string;
  instituteId?: string;
  /**
   * "sandbox" | "production" from the backend's response_data. The SDK mode
   * MUST match the environment the session was minted in — a sandbox-mode SDK
   * rejects prod sessions with Cashfree's "Broken Link!" page (and vice versa).
   */
  environment?: string | null;
  onPayClick?: () => void;
  onPayError?: () => void;
  isProcessing?: boolean;
}

export const CashfreeCheckoutForm = ({
  error: _error,
  amount,
  currency,
  paymentSessionId,
  returnUrl,
  orderId,
  instituteId,
  environment,
  onPayClick,
  onPayError,
  isProcessing = false,
}: CashfreeCheckoutFormProps) => {
  const { t } = useTranslation("enrollmentA");
  const [cardError, setCardError] = useState<string | null>(null);

  const handleProceedToPayment = async () => {
    if (!paymentSessionId || !returnUrl || !orderId) {
      setCardError(t("cashfreeCheckout.notReady"));
      return;
    }

    onPayClick?.();
    setCardError(null);

    try {
      // Backend-reported environment wins (it matches the session's keys);
      // VITE_CASHFREE_SANDBOX=true forces sandbox for local testing against
      // older backends that don't send it. Default: production.
      const mode =
        environment === "sandbox" || environment === "production"
          ? environment
          : import.meta.env.VITE_CASHFREE_SANDBOX === "true"
            ? "sandbox"
            : "production";
      const cashfree = await loadCashfree({ mode });

      if (!cashfree) {
        setCardError(t("cashfreeCheckout.gatewayUnavailable"));
        onPayError?.();
        return;
      }

      // The returnUrl may already carry a query string (e.g. the sub-org
      // registration result page) — append with "&" then, "?" otherwise.
      const separator = returnUrl.includes("?") ? "&" : "?";
      const fullReturnUrl = instituteId
        ? `${returnUrl}${separator}orderId=${orderId}&instituteId=${instituteId}`
        : `${returnUrl}${separator}orderId=${orderId}`;

      const result = await cashfree.checkout({
        paymentSessionId,
        returnUrl: fullReturnUrl,
      });

      if (result?.error) {
        setCardError(result.error.message || t("cashfreeCheckout.initFailed"));
        onPayError?.();
      }
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : t("cashfreeCheckout.processFailed")
      );
      onPayError?.();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="text-center mb-6 space-y-2">
          <h2 className="text-2xl font-bold text-gray-800">
            💳 {t("cashfreeCheckout.title")}
          </h2>
          <p className="text-gray-600">
            {t("cashfreeCheckout.description")}
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-gray-700 font-medium">{t("common.amountToPay")}</span>
            <span className="text-2xl font-bold text-blue-600">
              {currency?.toUpperCase() || "INR"} {amount.toFixed(2)}
            </span>
          </div>
        </div>

        {paymentSessionId ? (
          <button
            type="button"
            onClick={handleProceedToPayment}
            disabled={isProcessing}
            className="w-full py-3 px-4 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isProcessing ? t("cashfreeCheckout.redirecting") : t("cashfreeCheckout.proceed")}
          </button>
        ) : (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-gray-600">
            {isProcessing ? t("cashfreeCheckout.preparing") : t("cashfreeCheckout.loading")}
          </div>
        )}

        {cardError && (
          <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-lg">
            <strong className="text-red-800 flex items-center gap-2">
              <span>❌</span> {t("common.error")}
            </strong>
            <p className="text-red-700 text-sm mt-1">{cardError}</p>
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            🔒 {t("cashfreeCheckout.securedBy")}
            <br />
            {t("cashfreeCheckout.methods")}
          </p>
        </div>
      </div>
    </div>
  );
};
