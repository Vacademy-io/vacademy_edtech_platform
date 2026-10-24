import { useElements, useStripe, CardElement } from "@stripe/react-stripe-js";
import i18n from "@/i18n";

/**
 * Stripe Payment Handler Hook
 * Encapsulates Stripe-specific payment processing logic
 * Should only be used within Stripe Elements provider
 */
export const useStripePayment = () => {
  const stripe = useStripe();
  const elements = useElements();

  /**
   * Process Stripe payment
   * Creates payment method and returns the ID
   */
  const processStripePayment = async (): Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: string;
  }> => {
    if (!stripe || !elements) {
      return {
        success: false,
        error: i18n.t("enrollmentB:useStripePayment.notInitialized"),
      };
    }

    const cardElement = elements.getElement(CardElement);

    if (!cardElement) {
      return {
        success: false,
        error: i18n.t("enrollmentB:useStripePayment.cardElementNotFound"),
      };
    }

    try {
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
      });

      if (error) {
        return {
          success: false,
          error: error.message || i18n.t("enrollmentB:useStripePayment.processingFailed"),
        };
      }

      return {
        success: true,
        paymentMethodId: paymentMethod?.id,
      };
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : i18n.t("enrollmentB:useStripePayment.unexpectedError"),
      };
    }
  };

  return {
    processStripePayment,
    isStripeReady: !!(stripe && elements),
  };
};
