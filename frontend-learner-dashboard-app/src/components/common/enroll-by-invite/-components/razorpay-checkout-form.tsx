import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useTranslation } from "react-i18next";
import { parseHtmlToString } from "@/lib/utils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// Razorpay rejects payment creation when `description` exceeds 255 characters
// ("Could not validate payment create request due to: description: the length
// must be no more than 255"). Callers pass a short label — the enroll-invite
// name — never the course's rich-text description; this is the last-resort
// guard for the callers that still pass free text.
//
// The cap is measured in BYTES, not JS string length: Razorpay counts the
// encoded payload, so a 255-char string of ₹ / — / Devanagari is well over the
// limit even though `String.length` says it fits.
const RAZORPAY_DESCRIPTION_MAX_BYTES = 255;
const RAZORPAY_DESCRIPTION_ELLIPSIS = "..."; // ASCII: 1 byte per char

function toRazorpayDescription(raw: string, fallback: string): string {
  const text = parseHtmlToString(raw).replace(/\s+/g, " ").trim();
  if (!text) return fallback;

  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= RAZORPAY_DESCRIPTION_MAX_BYTES) {
    return text;
  }

  const budget =
    RAZORPAY_DESCRIPTION_MAX_BYTES - RAZORPAY_DESCRIPTION_ELLIPSIS.length;
  let truncated = "";
  let bytes = 0;
  // Iterate by code point so surrogate pairs are never split in half.
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) break;
    truncated += char;
    bytes += size;
  }
  return `${truncated.trimEnd()}${RAZORPAY_DESCRIPTION_ELLIPSIS}`;
}

export interface RazorpayCheckoutFormRef {
  openPayment: (orderDetails: {
    razorpayKeyId: string;
    razorpayOrderId: string;
    amount: number;
    currency: string;
    contact: string;
    email: string;
    // Autopay/mandate: when the backend registered a recurring mandate, these
    // make Razorpay Checkout open in mandate mode (UPI Autopay / card e-mandate).
    recurring?: number;
    customerId?: string;
  }) => void;
}

interface RazorpayCheckoutFormProps {
  error: string | null;
  amount: number;
  currency: string;
  onPaymentReady?: (paymentData: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  onError?: (error: string) => void;
  isProcessing?: boolean;
  // Additional user and course details
  userName?: string;
  userEmail?: string;
  userContact?: string;
  courseName?: string;
  courseDescription?: string;
}

export const RazorpayCheckoutForm = forwardRef<
  RazorpayCheckoutFormRef,
  RazorpayCheckoutFormProps
>(
  (
    {
      error,
      amount,
      currency,
      onPaymentReady,
      onError,
      userName = "",
      courseName,
      courseDescription,
    },
    ref
  ) => {
    const { t } = useTranslation("enrollmentA");
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const resolvedCourseName =
      courseName ?? t("razorpayCheckout.defaultCourseName", { course });
    const resolvedCourseDescription =
      courseDescription ??
      t("razorpayCheckout.defaultCourseDescription", { course });
    const [isScriptLoaded, setIsScriptLoaded] = useState(false);
    const [scriptError, setScriptError] = useState<string | null>(null);
    const razorpayInstanceRef = useRef<RazorpayInstance | null>(null);

    // Load Razorpay script
    useEffect(() => {
      // Check if script already exists
      const existingScript = document.querySelector(
        'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
      );

      if (existingScript) {
        setIsScriptLoaded(true);
        return;
      }

      // Create and load script
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => {
        setIsScriptLoaded(true);
      };

      script.onerror = () => {
        console.error("Failed to load Razorpay script");
        setScriptError(t("razorpayCheckout.scriptLoadFailed"));
        if (onError) {
          onError(t("razorpayCheckout.gatewayLoadFailed"));
        }
      };

      document.body.appendChild(script);

      return () => {
        // Cleanup: remove script when component unmounts
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };
    }, [onError]);

    // Expose method to open payment programmatically
    useImperativeHandle(ref, () => ({
      openPayment: (orderDetails: {
        razorpayKeyId: string;
        razorpayOrderId: string;
        amount: number;
        currency: string;
        contact: string;
        email: string;
        recurring?: number;
        customerId?: string;
      }) => {
        if (!isScriptLoaded) {
          console.error("Razorpay script not loaded");
          if (onError) {
            onError(t("razorpayCheckout.gatewayNotReady"));
          }
          return;
        }

        if (!window.Razorpay) {
          console.error("Razorpay object not found");
          if (onError) {
            onError(t("razorpayCheckout.gatewayNotInitialized"));
          }
          return;
        }

        const options: Record<string, unknown> = {
          key: orderDetails.razorpayKeyId,
          amount: orderDetails.amount,
          currency: orderDetails.currency,
          order_id: orderDetails.razorpayOrderId,
          // Autopay: run Checkout in recurring/mandate mode so the learner
          // authorizes UPI Autopay / a card e-mandate (needs a customer_id + an
          // order created with a token block, both from the backend).
          ...(orderDetails.recurring
            ? {
                recurring: orderDetails.recurring,
                customer_id: orderDetails.customerId,
              }
            : {}),
          name: resolvedCourseName,
          description: toRazorpayDescription(
            resolvedCourseDescription,
            t("razorpayCheckout.defaultCourseDescription", { course })
          ),
          handler: function (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) {
            if (onPaymentReady) {
              onPaymentReady({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              });
            }
          },
          prefill: {
            name: userName,
            email: orderDetails.email,
            contact: orderDetails.contact,
          },
          theme: {
            color: "#3399cc", // design-lint-ignore: Razorpay SDK theme color
          },
          modal: {
            ondismiss: function () {
              if (onError) {
                onError(t("razorpayCheckout.paymentCancelled"));
              }
            },
          },
        };

        try {
          razorpayInstanceRef.current = new window.Razorpay(options);
          razorpayInstanceRef.current.open();
        } catch (err) {
          console.error("Error opening Razorpay checkout:", err);
          if (onError) {
            onError(t("razorpayCheckout.gatewayOpenFailed"));
          }
        }
      },
    }));

    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="text-center mb-6 space-y-2">
            <h2 className="text-2xl font-bold text-gray-800">
              💳 {t("razorpayCheckout.title")}
            </h2>
            <p className="text-gray-600">
              {t("razorpayCheckout.description")}
            </p>
          </div>

          {/* Amount Display */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center">
              <span className="text-gray-700 font-medium">{t("common.amountToPay")}</span>
              <span className="text-2xl font-bold text-blue-600">
                {currency.toUpperCase()} {amount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Error Display */}
          {(error || scriptError) && (
            <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-lg">
              <strong className="text-red-800 flex items-center gap-2">
                <span>❌</span> {t("common.error")}
              </strong>
              <p className="text-red-700 text-sm mt-1">
                {error || scriptError}
              </p>
            </div>
          )}

          {/* Security Notice */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              🔒 {t("razorpayCheckout.securedBy")}
              <br />
              {t("razorpayCheckout.methods")}
            </p>
          </div>
        </div>
      </div>
    );
  }
);

RazorpayCheckoutForm.displayName = "RazorpayCheckoutForm";

// Razorpay types
interface RazorpayInstance {
  open: () => void;
  close: () => void;
}

interface RazorpayConstructor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (options: any): RazorpayInstance;
}

// Extend window type for TypeScript
declare global {
  interface Window {
    Razorpay: RazorpayConstructor;
  }
}
