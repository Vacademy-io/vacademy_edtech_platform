import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  fetchPaymentOptions,
  type PaymentOption,
} from "@/routes/courses/-services/payment-options-api";
import {
  INITIATE_APPLICANT_PAYMENT,
  INITIATE_APPLICANT_PAYMENT_OPEN,
} from "@/constants/urls";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  CheckCircle,
  SpinnerGap,
  CurrencyInr,
  WarningCircle,
  GraduationCap,
  Envelope,
} from "@phosphor-icons/react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InitiatePaymentResponse {
  /** Internal order ID (used in webhook notes as orderId) */
  order_id?: string;
  status?: string | null;
  message?: string;
  payment_type?: string | null;
  payment_link?: string;
  response_data?: {
    razorpayKeyId?: string;
    razorpayOrderId?: string;
    amount?: number;
    currency?: string;
    amountDue?: number;
    paymentStatus?: string;
    status?: string;
  };
}

// ── Route definition ──────────────────────────────────────────────────────────

export const Route = createFileRoute(
  "/admission/payment/$instituteId/$applicantId/$paymentOptionId/",
)({
  component: AdmissionPaymentPage,
});

// ── Page Component ────────────────────────────────────────────────────────────

function AdmissionPaymentPage() {
  const { t } = useTranslation("miscRoutesB");
  const { instituteId, applicantId, paymentOptionId } = Route.useParams();

  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [razorpayError, setRazorpayError] = useState<string | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);

  // ── Fetch payment option via the existing public service ─────────────────
  // fetchPaymentOptions uses open/v1/payment-option/default-payment-option (no auth)
  const { data: option, isLoading: loadingOptions } =
    useQuery<PaymentOption | null>({
      queryKey: ["admission-payment-option", paymentOptionId, instituteId],
      queryFn: () => fetchPaymentOptions(instituteId),
      enabled: !!instituteId,
      staleTime: 5 * 60_000,
    });

  const plan = option?.payment_plans?.[0];

  // ── Initiate payment mutation (open/no-auth endpoint) ────────────────────
  const initiateMutation = useMutation({
    mutationFn: async ({
      amount,
      currency,
      email,
    }: {
      amount: number;
      currency: string;
      email: string;
    }): Promise<InitiatePaymentResponse> => {
      const resp = await axios.post(
        INITIATE_APPLICANT_PAYMENT(applicantId),
        {
          vendor: "RAZORPAY",
          amount,
          currency,
          razorpay_request: { email },
        },
        { params: { paymentOptionId } },
      );
      return resp.data;
    },
  });

  // ── Pay handler ───────────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!plan || !option) {
      toast.error(t("admissionPayment.toast.noPlan"));
      return;
    }

    // Validate email
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError(t("admissionPayment.toast.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError(t("admissionPayment.toast.emailInvalid"));
      return;
    }
    setEmailError("");

    setIsPaying(true);
    setRazorpayError(null);

    try {
      const initiated = await initiateMutation.mutateAsync({
        amount: plan.actual_price,
        currency: plan.currency || "INR",
        email: trimmedEmail,
      });

      // Unwrap order details from response_data (top-level in API response)
      const rd = initiated?.response_data;
      const razorpayKeyId = rd?.razorpayKeyId;
      const razorpayOrderId = rd?.razorpayOrderId;
      const orderAmount = rd?.amount ?? plan.actual_price;
      const orderCurrency = rd?.currency ?? plan.currency ?? "INR";

      // If server returns a hosted link, open it directly
      if (initiated?.payment_link) {
        window.location.href = initiated.payment_link;
        return;
      }

      if (!razorpayKeyId || !razorpayOrderId) {
        console.error("Missing Razorpay keys in response:", initiated);
        toast.error(t("admissionPayment.toast.paymentDetailsError"));
        return;
      }

      // Open embedded Razorpay modal
      razorpayRef.current?.openPayment({
        razorpayKeyId,
        razorpayOrderId,
        amount: orderAmount,
        currency: orderCurrency,
        contact: "",
        email: trimmedEmail,
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { ex?: string; message?: string } } })
          ?.response?.data?.ex ||
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (err instanceof Error
          ? err.message
          : t("admissionPayment.toast.initiateFailed"));
      toast.error(msg);
    } finally {
      setIsPaying(false);
    }
  };

  const handlePaymentSuccess = () => {
    setPaymentDone(true);
    toast.success(t("admissionPayment.toast.paymentSubmitted"));
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingOptions) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border p-8 w-full max-w-md space-y-4">
          <Skeleton className="h-6 w-48 mx-auto" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  // ── No plan found ─────────────────────────────────────────────────────────
  if (!plan || !option) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border p-8 w-full max-w-md text-center space-y-3">
          <WarningCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="text-lg font-semibold text-gray-900">
            {t("admissionPayment.notFound.title")}
          </h1>
          <p className="text-sm text-gray-500">
            {t("admissionPayment.notFound.description")}
          </p>
        </div>
      </div>
    );
  }

  // ── Payment complete state ────────────────────────────────────────────────
  if (paymentDone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border p-8 w-full max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            {t("admissionPayment.success.title")}
          </h1>
          <p className="text-sm text-gray-500">
            {t("admissionPayment.success.description")}
          </p>
        </div>
      </div>
    );
  }

  // ── Main payment page ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-primary/5 border-b px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {t("admissionPayment.header.title")}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">{option.name}</p>
          </div>
        </div>

        {/* Amount */}
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-4">
            <p className="text-xs text-gray-500 mb-1">{t("admissionPayment.amountDue")}</p>
            <p className="text-3xl font-bold text-gray-900 flex items-center gap-1">
              {plan.currency === "INR" ? (
                <CurrencyInr className="w-6 h-6" />
              ) : (
                <span className="text-2xl">{plan.currency}</span>
              )}
              {plan.actual_price.toLocaleString("en-IN")}
            </p>
            {plan.elevated_price > plan.actual_price && (
              <p className="text-xs text-gray-400 mt-1 line-through">
                {plan.currency === "INR" ? "₹" : plan.currency}
                {plan.elevated_price.toLocaleString("en-IN")}
              </p>
            )}
          </div>

          {/* Email input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700 flex items-center gap-1">
              <Envelope className="w-3.5 h-3.5" />
              {t("admissionPayment.email.label")}
            </label>
            <Input
              type="email"
              placeholder={t("admissionPayment.email.placeholder")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              className={
                emailError ? "border-red-400 focus-visible:ring-red-400" : ""
              }
            />
            {emailError && <p className="text-xs text-red-500">{emailError}</p>}
          </div>

          <Button
            className="w-full gap-2"
            size="lg"
            disabled={isPaying}
            onClick={handlePay}
          >
            {isPaying ? (
              <>
                <SpinnerGap className="w-4 h-4 animate-spin" />
                {t("admissionPayment.pay.processing")}
              </>
            ) : (
              <>
                <CurrencyInr className="w-4 h-4" />
                {t("admissionPayment.pay.cta")}
              </>
            )}
          </Button>

          <p className="text-center text-xs text-gray-400">
            {t("admissionPayment.secured")}
          </p>
        </div>
      </div>

      {/* Hidden Razorpay checkout form */}
      <div className="hidden">
        <RazorpayCheckoutForm
          ref={razorpayRef}
          error={razorpayError}
          amount={plan.actual_price}
          currency={plan.currency || "INR"}
          onPaymentReady={handlePaymentSuccess}
          onError={(err) => {
            setRazorpayError(err);
            if (!err.toLowerCase().includes("cancel")) {
              toast.error(err);
            }
          }}
          courseName={option.name || t("admissionPayment.checkout.defaultTitle")}
          courseDescription={t("admissionPayment.checkout.description")}
          userName=""
        />
      </div>
    </div>
  );
}
