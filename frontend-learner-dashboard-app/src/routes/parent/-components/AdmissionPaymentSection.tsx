import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  GET_ADMISSION_PAYMENT_OPTIONS,
  INITIATE_APPLICANT_PAYMENT,
} from "@/constants/urls";
import { handleFetchCompleteInstituteDetails } from "@/routes/study-library/courses/-services/institute-details";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  CreditCard,
  CheckCircle,
  Clock,
  WarningCircle,
  SpinnerGap,
  CurrencyInr,
  GraduationCap,
} from "@phosphor-icons/react";
import type { ChildProfile } from "@/types/parent-portal";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PaymentOption {
  id: string;
  name: string;
  status: string;
  type: string;
  payment_plans: Array<{
    id: string;
    name: string;
    actual_price: number;
    elevated_price: number;
    currency: string;
  }>;
}

/** Shape returned by POST /v1/applicant/{id}/payment/initiate */
interface InitiatePaymentResponse {
  razorpayKeyId?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  payment_link?: string;
  // nested path — same pattern as enroll flow
  payment_response?: {
    response_data?: {
      razorpayKeyId?: string;
      razorpayOrderId?: string;
      amount?: number;
      currency?: string;
    };
  };
}

interface AdmissionPaymentSectionProps {
  child: ChildProfile;
}

// ── Status badge helper ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("parent");
  const map: Record<string, { label: string; className: string }> = {
    PENDING: {
      label: t("admissionPortal.status.pending"),
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    PAYMENT_PENDING: {
      label: t("admissionPortal.status.paymentPending"),
      className:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    },
    PAYMENT_COMPLETED: {
      label: t("admissionPortal.status.paid"),
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    APPROVED: {
      label: t("admissionPortal.status.approved"),
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    },
    REJECTED: {
      label: t("admissionPortal.status.rejected"),
      className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    },
    ENROLLED: {
      label: t("admissionPortal.status.enrolled"),
      className:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    },
  };
  const s = map[status] ?? {
    label: status,
    className:
      "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
  };
  return (
    <Badge className={`text-caption px-1.5 py-0.5 ${s.className}`}>
      {s.label}
    </Badge>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AdmissionPaymentSection({
  child,
}: AdmissionPaymentSectionProps) {
  const { t } = useTranslation("parent");
  const { data: instituteData } = useSuspenseQuery(
    handleFetchCompleteInstituteDetails(),
  );
  const instituteId: string = (instituteData as { id?: string })?.id ?? "";

  // applicant_id comes straight from the store's selectedChild
  const applicantId = child.applicant_id;

  // ── Fetch payment options (paymentOptionId + default amount) ─
  const { data: paymentOptions, isLoading: loadingOptions } = useQuery<
    PaymentOption[]
  >({
    queryKey: ["admission-payment-options", instituteId],
    queryFn: async () => {
      const resp = await authenticatedAxiosInstance.post(
        GET_ADMISSION_PAYMENT_OPTIONS,
        {
          type: ["ONE_TIME"],
          source: "INSTITUTE",
          source_id: instituteId,
        },
      );
      return resp.data ?? [];
    },
    enabled: !!instituteId && !!applicantId,
    staleTime: 5 * 60_000,
  });

  // ── Local state ─────────────────────────────────────────────
  const [isPaying, setIsPaying] = useState(false);
  const [razorpayError, setRazorpayError] = useState<string | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);

  // ── Initiate payment mutation ────────────────────────────────
  const initiateMutation = useMutation({
    mutationFn: async ({
      paymentOptionId,
      amount,
      currency,
    }: {
      paymentOptionId: string;
      amount: number;
      currency: string;
    }): Promise<InitiatePaymentResponse> => {
      const resp = await authenticatedAxiosInstance.post(
        INITIATE_APPLICANT_PAYMENT(applicantId!),
        {
          vendor: "RAZORPAY",
          amount,
          currency,
          razorpay_request: {},
        },
        { params: { paymentOptionId } },
      );
      return resp.data;
    },
  });

  // ── Pay handler ─────────────────────────────────────────────
  const handlePay = async () => {
    if (!applicantId) return;

    const option =
      paymentOptions?.find((o) => o.status === "ACTIVE") ?? paymentOptions?.[0];
    if (!option || !option.payment_plans.length) {
      toast.error(t("admissionPortal.payment.toast.noPlan"));
      return;
    }

    const plan = option.payment_plans[0]!;
    setIsPaying(true);
    setRazorpayError(null);

    try {
      const initiated = await initiateMutation.mutateAsync({
        paymentOptionId: option.id,
        amount: plan.actual_price,
        currency: plan.currency || "INR",
      });

      // Unwrap order details — try flat and nested paths
      const orderData = initiated?.payment_response?.response_data ?? initiated;
      const razorpayKeyId = orderData?.razorpayKeyId;
      const razorpayOrderId = orderData?.razorpayOrderId;
      const orderAmount = orderData?.amount ?? plan.actual_price;
      const orderCurrency = orderData?.currency ?? plan.currency ?? "INR";

      // If server returns a hosted link, just open it in a tab
      if (initiated?.payment_link) {
        window.open(initiated.payment_link, "_blank");
        toast.success(t("admissionPortal.payment.toast.redirecting"));
        return;
      }

      if (!razorpayKeyId || !razorpayOrderId) {
        console.error("Missing Razorpay keys in response:", initiated);
        toast.error(t("admissionPortal.payment.toast.detailsFailed"));
        return;
      }

      // Open embedded Razorpay modal
      razorpayRef.current?.openPayment({
        razorpayKeyId,
        razorpayOrderId,
        amount: orderAmount,
        currency: orderCurrency,
        contact: "",
        email: "",
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { ex?: string; message?: string } } })
          ?.response?.data?.ex ||
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (err instanceof Error
          ? err.message
          : t("admissionPortal.payment.toast.initiateFailed"));
      toast.error(msg);
    } finally {
      setIsPaying(false);
    }
  };

  // ── After Razorpay modal closes successfully ─────────────────
  const handlePaymentSuccess = () => {
    // Backend webhook /payments/webhook/callback/razorpay handles verification.
    setPaymentDone(true);
    toast.success(t("admissionPortal.payment.toast.submitted"));
  };

  // ── Loading states ────────────────────────────────────────────

  if (loadingOptions && !!applicantId) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  // No applicant_id on this child — they haven't applied yet
  if (!applicantId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-base">
            {t("admissionPortal.payment.heading")}
          </h3>
        </div>
        <Card className="shadow-sm">
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
            <GraduationCap className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {t("admissionPortal.payment.noApplication", {
                name: child.full_name,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("admissionPortal.payment.submitFirstPrefix")}
              <strong>{t("admissionPortal.payment.submitFirstTab")}</strong>
              {t("admissionPortal.payment.submitFirstSuffix")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Determine payment state from child's admission_status
  const status = child.admission_status;
  const needsPayment =
    status === "PAYMENT_PENDING" || status === "PAYMENT_PARTIAL";
  const isPaid = status === "PAYMENT_COMPLETED" || status === "ENROLLED";
  const isRejected = status === "REJECTED";

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <GraduationCap className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-base">
          {t("admissionPortal.payment.heading")}
        </h3>
      </div>

      <Card
        className={`shadow-sm transition-all ${
          needsPayment && !paymentDone
            ? "border-orange-300 dark:border-orange-700"
            : isPaid || paymentDone
              ? "border-emerald-300/50 dark:border-emerald-700/50"
              : ""
        }`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <CardTitle className="text-sm font-semibold">
                {child.full_name}
              </CardTitle>
              <CardDescription className="text-xs font-mono">
                {t("admissionPortal.payment.applicant", { id: applicantId })}
              </CardDescription>
            </div>
            <StatusBadge status={paymentDone ? "PAYMENT_COMPLETED" : status} />
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {/* Stage indicator */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {needsPayment && !paymentDone ? (
              <CreditCard className="w-3.5 h-3.5 text-orange-500" />
            ) : isPaid || paymentDone ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
            <span>
              {t("admissionPortal.payment.statusLabel")}{" "}
              <span className="font-medium text-foreground capitalize">
                {(paymentDone ? "PAYMENT_COMPLETED" : status)
                  .replace(/_/g, " ")
                  .toLowerCase()}
              </span>
            </span>
          </div>

          {/* Payment plan info */}
          {needsPayment &&
            !paymentDone &&
            paymentOptions &&
            paymentOptions.length > 0 &&
            (() => {
              const opt =
                paymentOptions.find((o) => o.status === "ACTIVE") ??
                paymentOptions[0];
              const plan = opt?.payment_plans[0];
              if (!plan) return null;
              return (
                <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {opt?.name ?? t("admissionPortal.payment.admissionFee")}
                  </p>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {plan.currency === "INR" ? "₹" : plan.currency}
                    {plan.actual_price.toLocaleString("en-IN")}
                  </p>
                </div>
              );
            })()}

          {/* Pay CTA */}
          {needsPayment && !paymentDone && !isRejected && (
            <div className="pt-1 border-t flex items-center justify-between gap-3">
              <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                <WarningCircle className="w-3.5 h-3.5 shrink-0" />
                {t("admissionPortal.payment.requiredToContinue")}
              </p>
              <Button
                size="sm"
                className="h-8 gap-1.5 shrink-0"
                disabled={isPaying || loadingOptions}
                onClick={handlePay}
              >
                {isPaying ? (
                  <>
                    <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
                    {t("admissionPortal.payment.processing")}
                  </>
                ) : (
                  <>
                    <CurrencyInr className="w-3.5 h-3.5" />
                    {t("admissionPortal.payment.payNow")}
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Paid confirmation */}
          {(isPaid || paymentDone) && (
            <div className="pt-1 border-t flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-3.5 h-3.5" />
              {t("admissionPortal.payment.complete")}
            </div>
          )}

          {/* Not yet at payment stage */}
          {!needsPayment && !isPaid && !paymentDone && !isRejected && (
            <p className="text-xs text-muted-foreground pt-1 border-t">
              {t("admissionPortal.payment.notDueYet")}
            </p>
          )}

          {/* Rejected */}
          {isRejected && (
            <p className="text-xs text-destructive pt-1 border-t">
              {t("admissionPortal.payment.rejectedNotice")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Razorpay checkout — hidden, always mounted so script pre-loads */}
      <div className="hidden">
        <RazorpayCheckoutForm
          ref={razorpayRef}
          error={razorpayError}
          amount={0}
          currency="INR"
          onPaymentReady={handlePaymentSuccess}
          onError={(err) => {
            setRazorpayError(err);
            if (!err.toLowerCase().includes("cancel")) {
              toast.error(err);
            }
          }}
          courseName={t("admissionPortal.payment.admissionFee")}
          courseDescription={t("admissionPortal.payment.courseDescription")}
          userName={child.full_name}
        />
      </div>
    </div>
  );
}
