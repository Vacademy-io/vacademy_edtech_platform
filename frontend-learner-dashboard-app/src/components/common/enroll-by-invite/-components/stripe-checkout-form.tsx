import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface StripeCheckoutFormProps {
  error: string | null;
  onPaymentMethodReady?: (
    processPayment: () => Promise<{
      success: boolean;
      paymentMethodId?: string;
      error?: string;
    }>
  ) => void;
}

/**
 * Stripe Checkout Form
 * Renders Stripe's CardElement for collecting card details
 *
 * NOTE: This component MUST be wrapped in Stripe's <Elements> provider
 * It is separated into its own file to avoid importing CardElement
 * when using other payment gateways (like Eway)
 */
export const StripeCheckoutForm = ({
  error,
  onPaymentMethodReady,
}: StripeCheckoutFormProps) => {
  const { t } = useTranslation("enrollmentA");
  const stripe = useStripe();
  const elements = useElements();
  const callbackRef = useRef(onPaymentMethodReady);

  // Update callback ref when it changes
  useEffect(() => {
    callbackRef.current = onPaymentMethodReady;
  }, [onPaymentMethodReady]);

  // Store refs to stripe and elements to access current values
  const stripeRef = useRef(stripe);
  const elementsRef = useRef(elements);

  useEffect(() => {
    stripeRef.current = stripe;
    elementsRef.current = elements;
  }, [stripe, elements]);

  // Expose payment processing function to parent
  useEffect(() => {
    const processPayment = async (): Promise<{
      success: boolean;
      paymentMethodId?: string;
      error?: string;
    }> => {
      // Get current stripe and elements at time of execution
      const currentStripe = stripeRef.current;
      const currentElements = elementsRef.current;

      if (!currentStripe || !currentElements) {
        console.error("Stripe or Elements not available");
        return {
          success: false,
          error: t("stripeCheckout.notLoaded"),
        };
      }

      const cardElement = currentElements.getElement(CardElement);
      if (!cardElement) {
        return {
          success: false,
          error: t("stripeCheckout.cardElementNotFound"),
        };
      }

      try {
        const { error, paymentMethod } =
          await currentStripe.createPaymentMethod({
            type: "card",
            card: cardElement,
          });

        if (error) {
          return {
            success: false,
            error:
              error.message || t("stripeCheckout.processingError"),
          };
        }

        if (!paymentMethod) {
          return {
            success: false,
            error: t("stripeCheckout.createMethodFailed"),
          };
        }

        return {
          success: true,
          paymentMethodId: paymentMethod.id,
        };
      } catch (err) {
        console.error("Stripe payment error:", err);
        return {
          success: false,
          error: t("common.unexpectedError"),
        };
      }
    };

    // Notify parent that payment processor is ready
    if (stripe && elements && callbackRef.current) {
      // Pass the function to parent
      callbackRef.current(processPayment);
    }
  }, [stripe, elements]);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-md border border-gray-200 p-6 text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          💳 {t("stripeCheckout.title")}
        </h2>
        <p className="text-gray-600 mb-6">{t("stripeCheckout.description")}</p>
        <div className="p-4 border border-gray-300 rounded-lg mb-6 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  color: "#32325d", // design-lint-ignore: Stripe SDK element style
                  fontFamily: "Arial, sans-serif",
                  fontSmoothing: "antialiased",
                  fontSize: "16px",
                  "::placeholder": {
                    color: "#aab7c4", // design-lint-ignore: Stripe SDK element style
                  },
                },
                invalid: {
                  color: "#fa755a", // design-lint-ignore: Stripe SDK element style
                  iconColor: "#fa755a", // design-lint-ignore: Stripe SDK element style
                },
              },
              hidePostalCode: true,
            }}
          />
        </div>
        {error && (
          <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-lg text-start">
            <strong className="text-red-800">❌ {t("common.error")}</strong>
            <p className="text-red-700 text-sm mt-1">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};
