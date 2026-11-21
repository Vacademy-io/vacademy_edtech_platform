import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RazorpayCheckoutForm,
  type RazorpayCheckoutFormRef,
} from "@/components/common/enroll-by-invite/-components/razorpay-checkout-form";
import {
  Receipt,
  CalendarBlank,
  CreditCard,
  SpinnerGap,
  CheckCircle,
  Warning,
} from "@phosphor-icons/react";
import {
  GET_INSTITUTE_DEFAULT_VENDOR,
  GET_INVOICE_PUBLIC,
  INITIATE_INVOICE_PAYMENT,
  PUBLIC_INSTITUTE_BRANDING_URL,
} from "@/constants/urls";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { useTheme } from "@/providers/theme/theme-provider";
import { getCurrencySymbol } from "@/utils/currency";
import { useMemo } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { StripeCheckoutForm } from "@/components/common/enroll-by-invite/-components/stripe-checkout-form";
import { EwayProvider } from "@/components/common/enroll-by-invite/-contexts/eway-context";
import { EwayCardForm } from "@/components/common/enroll-by-invite/-components/eway-card-form";
import { getKeyData } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { useTranslation } from "react-i18next";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InvoiceLineItem {
  id: string;
  item_type: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface InvoiceDTO {
  id: string;
  invoice_number: string;
  user_id: string;
  institute_id: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  status: string;
  pdf_file_id: string | null;
  pdf_url: string | null;
  tax_included: boolean;
  created_at: string;
  updated_at: string;
  line_items: InvoiceLineItem[];
}

interface InstituteBranding {
  institute_id: string;
  institute_name: string;
  logo_file_id: string | null;
  institute_theme_code: string | null;
}

interface PaymentResponseDTO {
  response_data: Record<string, unknown>;
  order_id: string;
  status: string;
  message: string;
  payment_type: string;
}

// ── Route definition ───────────────────────────────────────────────────────────

import { z } from "zod";

// Optional in-app path to return to after payment (e.g. the live-class
// registration page) — forwarded to /payment-result which renders a
// "Continue" action on success.
const invoicePaySearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/pay/invoice/$invoiceId/")({
  validateSearch: invoicePaySearchSchema,
  component: InvoicePaymentPage,
});

// ── Currency helpers ───────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(dueDateIso: string): boolean {
  const due = new Date(dueDateIso);
  return !isNaN(due.getTime()) && due < new Date();
}

// ── Page Component ─────────────────────────────────────────────────────────────

function InvoicePaymentPage() {
  const { t } = useTranslation("miscRoutesB");
  const { invoiceId } = Route.useParams();
  const { redirect } = Route.useSearch();
  const redirectParam = redirect
    ? `&redirect=${encodeURIComponent(redirect)}`
    : "";
  const { setPrimaryColor } = useTheme();

  const razorpayRef = useRef<RazorpayCheckoutFormRef>(null);
  const pendingOrderId = useRef<string>("");

  const [isPaying, setIsPaying] = useState(false);
  const [paymentInitiated, setPaymentInitiated] = useState(false);
  const [razorpayError, setRazorpayError] = useState<string | null>(null);

  // Card-collecting gateways (Stripe / eWay) — vendor data the forms produce
  const [cardError, setCardError] = useState<string | null>(null);
  const stripeProcessRef = useRef<
    | (() => Promise<{ success: boolean; paymentMethodId?: string; error?: string }>)
    | null
  >(null);
  const [ewayData, setEwayData] = useState<{
    encryptedNumber: string;
    encryptedCVN: string;
    cardData: { name: string; expiryMonth: string; expiryYear: string };
  } | null>(null);

  // Fetch invoice publicly (no auth)
  const {
    data: invoice,
    isLoading,
    isError,
  } = useQuery<InvoiceDTO>({
    queryKey: ["invoice-public", invoiceId],
    queryFn: async () => {
      const resp = await axios.get(GET_INVOICE_PUBLIC(invoiceId));
      return resp.data as InvoiceDTO;
    },
    enabled: !!invoiceId,
    retry: 1,
    staleTime: 60_000,
  });

  // Which gateway this institute's invoice payments charge through — decides
  // whether we must collect card data (Stripe/eWay) before initiating.
  const { data: vendorData } = useQuery<{ vendor?: string }>({
    queryKey: ["invoice-default-vendor", invoice?.institute_id],
    queryFn: async () => {
      const resp = await axios.get(GET_INSTITUTE_DEFAULT_VENDOR, {
        params: { instituteId: invoice!.institute_id },
      });
      return resp.data as { vendor?: string };
    },
    enabled: !!invoice?.institute_id && invoice?.status !== "PAID",
    staleTime: 60_000 * 60,
  });
  const vendor = (vendorData?.vendor ?? "").toUpperCase();
  const needsCardForm = vendor === "STRIPE" || vendor === "EWAY";

  // Publishable keys for the card gateways (open endpoint)
  const { data: gatewayKeys } = useQuery<Record<string, string>>({
    queryKey: ["invoice-gateway-keys", invoice?.institute_id, vendor],
    queryFn: () => getKeyData(invoice!.institute_id, vendor),
    enabled: !!invoice?.institute_id && needsCardForm,
    staleTime: 60_000 * 60,
  });

  const stripePromise: Promise<StripeJs | null> | null = useMemo(
    () =>
      vendor === "STRIPE" && gatewayKeys?.publishableKey
        ? loadStripe(gatewayKeys.publishableKey)
        : null,
    [vendor, gatewayKeys?.publishableKey]
  );

  // Fetch institute branding once institute_id is known
  const { data: branding } = useQuery<InstituteBranding>({
    queryKey: ["institute-branding-public", invoice?.institute_id],
    queryFn: async () => {
      const resp = await axios.get(
        `${PUBLIC_INSTITUTE_BRANDING_URL}/${invoice!.institute_id}`
      );
      return resp.data as InstituteBranding;
    },
    enabled: !!invoice?.institute_id,
    staleTime: 60_000 * 60,
  });

  // Fetch logo URL without auth (public page)
  const { data: logoUrl } = useQuery<string>({
    queryKey: ["institute-logo-public", branding?.logo_file_id],
    queryFn: () => getPublicUrlWithoutLogin(branding!.logo_file_id),
    enabled: !!branding?.logo_file_id,
    staleTime: 60_000 * 60 * 24,
  });

  // Apply institute theme colour
  useEffect(() => {
    if (branding?.institute_theme_code) {
      setPrimaryColor(branding.institute_theme_code);
    }
  }, [branding?.institute_theme_code]);

  // ── Pay handler ────────────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!invoice) return;
    setCardError(null);

    // Card gateways: collect/tokenize the card BEFORE initiating — the backend
    // charge cannot run without this vendor data (Stripe payment_method, eWay
    // encrypted card). Amount/currency stay server-side from the invoice.
    let vendorBody: Record<string, unknown> = {};
    if (vendor === "STRIPE") {
      const processPayment = stripeProcessRef.current;
      if (!processPayment) {
        toast.error(t("payInvoice.toast.formLoading"));
        return;
      }
      setIsPaying(true);
      const result = await processPayment();
      if (!result.success || !result.paymentMethodId) {
        setCardError(result.error ?? t("payInvoice.toast.cardVerificationFailed"));
        setIsPaying(false);
        return;
      }
      vendorBody = {
        stripe_request: {
          payment_method_id: result.paymentMethodId,
          card_last4: null,
          customer_id: null,
          return_url: `${window.location.origin}/payment-result?source=invoice&instituteId=${invoice.institute_id}${redirectParam}`,
        },
      };
    } else if (vendor === "EWAY") {
      if (!ewayData) {
        toast.error(t("payInvoice.toast.enterCardDetails"));
        return;
      }
      vendorBody = {
        eway_request: {
          customer_id: null,
          card_name: ewayData.cardData.name,
          expiry_month: ewayData.cardData.expiryMonth,
          expiry_year: ewayData.cardData.expiryYear,
          card_number: ewayData.encryptedNumber,
          cvn: ewayData.encryptedCVN,
          country_code: "au",
        },
      };
    }

    setIsPaying(true);
    try {
      const resp = await axios.post<PaymentResponseDTO>(
        INITIATE_INVOICE_PAYMENT(invoiceId),
        vendorBody,
        { params: { instituteId: invoice.institute_id } }
      );
      const data = resp.data;
      const rd = data.response_data ?? {};
      const paymentStatus = String(
        (rd.paymentStatus as string) ?? (rd.payment_status as string) ?? ""
      ).toUpperCase();

      // Synchronous gateways (eWay always, Stripe without a 3DS challenge)
      // confirm in-request — go straight to the result page.
      if (paymentStatus === "PAID") {
        window.location.href = `/payment-result?orderId=${data.order_id}&instituteId=${invoice.institute_id}&source=invoice${redirectParam}`;
        return;
      }
      if (paymentStatus === "FAILED") {
        setCardError(t("payInvoice.toast.paymentDeclined"));
        return;
      }

      if (rd.payment_link) {
        window.location.href = rd.payment_link as string;
        return;
      }

      const razorpayKeyId = rd.razorpayKeyId as string | undefined;
      const razorpayOrderId = rd.razorpayOrderId as string | undefined;

      if (razorpayKeyId && razorpayOrderId) {
        pendingOrderId.current = data.order_id;
        razorpayRef.current?.openPayment({
          razorpayKeyId,
          razorpayOrderId,
          amount: (rd.amount as number) ?? invoice.total_amount,
          currency: (rd.currency as string) ?? invoice.currency,
          contact: "",
          email: "",
        });
        return;
      }

      // Fallback redirect — source=invoice skips gateway-specific polling
      window.location.href = `/payment-result?orderId=${data.order_id}&instituteId=${invoice.institute_id}&source=invoice${redirectParam}`;
    } catch {
      toast.error(t("payInvoice.toast.initiateFailed"));
    } finally {
      setIsPaying(false);
    }
  };

  const handlePaymentReady = () => {
    // Navigate to the polling confirmation page; source=invoice skips gateway-specific status checks
    if (pendingOrderId.current && invoice?.institute_id) {
      window.location.href = `/payment-result?orderId=${pendingOrderId.current}&source=invoice&instituteId=${invoice.institute_id}${redirectParam}`;
    } else {
      setPaymentInitiated(true);
    }
  };

  // ── Shared outer wrapper ───────────────────────────────────────────────────
  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 overflow-y-auto bg-muted/40 flex flex-col items-center justify-center p-4">
      {children}
    </div>
  );

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <div className="w-full max-w-md space-y-3">
          <div className="flex items-center gap-3 justify-center mb-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="bg-primary-50 border-b border-border px-6 py-5 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="px-6 py-5 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-px w-full mt-4" />
              <Skeleton className="h-5 w-32 ms-auto" />
              <Skeleton className="h-10 w-full mt-4" />
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Error / not found state ────────────────────────────────────────────────
  if (isError || !invoice) {
    return (
      <PageShell>
        <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-danger-50 flex items-center justify-center mx-auto">
            <Receipt size={28} className="text-danger-500" weight="duotone" />
          </div>
          <h1 className="text-h3 text-foreground font-semibold">
            {t("payInvoice.notFound.title")}
          </h1>
          <p className="text-body text-muted-foreground">
            {t("payInvoice.notFound.description")}
          </p>
        </div>
      </PageShell>
    );
  }

  // ── Payment initiated state ────────────────────────────────────────────────
  if (paymentInitiated) {
    return (
      <PageShell>
        <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-success-50 flex items-center justify-center mx-auto">
            <CheckCircle size={28} className="text-success-500" weight="duotone" />
          </div>
          <h1 className="text-h3 text-foreground font-semibold">
            {t("payInvoice.initiated.title")}
          </h1>
          <p className="text-body text-muted-foreground">
            {t("payInvoice.initiated.description")}
          </p>
        </div>
      </PageShell>
    );
  }

  const overdue = isOverdue(invoice.due_date) && invoice.status !== "PAID";
  const instituteName = branding?.institute_name;

  // ── Main page ──────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <div className="w-full max-w-md space-y-4">
        {/* ── Institute branding header ────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 text-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={instituteName ?? t("payInvoice.defaultLogoAlt")}
              className="h-12 w-auto max-w-40 object-contain"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <Receipt size={20} className="text-primary-500" weight="duotone" />
            </div>
          )}
          {instituteName && (
            <p className="text-subtitle font-semibold text-foreground">
              {instituteName}
            </p>
          )}
        </div>

        {/* ── Invoice card ──────────────────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Card header */}
          <div className="bg-primary-50 border-b border-border px-6 py-4 flex items-center gap-3">
            <div className="min-w-0">
              <h1 className="text-subtitle font-semibold text-foreground leading-tight">
                {t("payInvoice.header.title")}
              </h1>
              <p className="text-caption text-muted-foreground mt-0.5 truncate">
                {invoice.invoice_number}
              </p>
            </div>
          </div>

          {/* Card body */}
          <div className="px-6 py-5 space-y-5">
            {/* Line items table */}
            <div className="space-y-0 border border-border rounded-xl overflow-hidden">
              {/* Table header — hidden on mobile, shown on sm+ */}
              <div className="hidden sm:grid grid-cols-12 gap-2 bg-muted px-3 py-2">
                <span className="col-span-5 text-caption font-medium text-muted-foreground">
                  {t("payInvoice.table.description")}
                </span>
                <span className="col-span-2 text-caption font-medium text-muted-foreground text-end">
                  {t("payInvoice.table.qty")}
                </span>
                <span className="col-span-2 text-caption font-medium text-muted-foreground text-end">
                  {t("payInvoice.table.unit")}
                </span>
                <span className="col-span-3 text-caption font-medium text-muted-foreground text-end">
                  {t("payInvoice.table.amount")}
                </span>
              </div>
              {/* Mobile-only table header */}
              <div className="grid grid-cols-2 bg-muted px-3 py-2 sm:hidden">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("payInvoice.table.description")}
                </span>
                <span className="text-caption font-medium text-muted-foreground text-end">
                  {t("payInvoice.table.amount")}
                </span>
              </div>

              {invoice.line_items.map((item, idx) => (
                <div
                  key={item.id}
                  className={cn(
                    "border-t border-border",
                    idx === 0 && "border-t-0"
                  )}
                >
                  {/* Mobile layout: description + qty/unit on left, amount on right */}
                  <div className="flex items-start justify-between gap-3 px-3 py-2.5 sm:hidden">
                    <div className="min-w-0">
                      <p className="text-body text-foreground break-words leading-snug">
                        {item.description}
                      </p>
                      <p className="text-caption text-muted-foreground mt-0.5 tabular-nums">
                        {item.quantity} × {formatCurrency(item.unit_price, invoice.currency)}
                      </p>
                    </div>
                    <span className="text-body text-foreground tabular-nums font-medium shrink-0">
                      {formatCurrency(item.amount, invoice.currency)}
                    </span>
                  </div>
                  {/* Desktop layout: 4-column grid */}
                  <div className="hidden sm:grid grid-cols-12 gap-2 px-3 py-2.5">
                    <span className="col-span-5 text-body text-foreground break-words leading-snug">
                      {item.description}
                    </span>
                    <span className="col-span-2 text-body text-muted-foreground text-end tabular-nums">
                      {item.quantity}
                    </span>
                    <span className="col-span-2 text-body text-muted-foreground text-end tabular-nums">
                      {formatCurrency(item.unit_price, invoice.currency)}
                    </span>
                    <span className="col-span-3 text-body text-foreground text-end tabular-nums font-medium">
                      {formatCurrency(item.amount, invoice.currency)}
                    </span>
                  </div>
                </div>
              ))}

              {/* Subtotal */}
              <div className="flex justify-between px-3 py-2.5 border-t border-border bg-muted/50">
                <span className="text-body text-muted-foreground">{t("payInvoice.table.subtotal")}</span>
                <span className="text-body text-foreground tabular-nums">
                  {formatCurrency(invoice.subtotal, invoice.currency)}
                </span>
              </div>

              {/* Discount */}
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between px-3 py-2.5 border-t border-border">
                  <span className="text-body text-success-500">{t("payInvoice.table.discount")}</span>
                  <span className="text-body text-success-500 tabular-nums">
                    -{formatCurrency(invoice.discount_amount, invoice.currency)}
                  </span>
                </div>
              )}

              {/* Tax */}
              {invoice.tax_amount > 0 && (
                <div className="flex justify-between px-3 py-2.5 border-t border-border">
                  <span className="text-body text-muted-foreground">{t("payInvoice.table.tax")}</span>
                  <span className="text-body text-foreground tabular-nums">
                    {formatCurrency(invoice.tax_amount, invoice.currency)}
                  </span>
                </div>
              )}

              {/* Total */}
              <div className="flex justify-between px-3 py-3 border-t border-border bg-primary-50">
                <span className="text-subtitle font-semibold text-foreground">{t("payInvoice.table.total")}</span>
                <span className="text-subtitle font-semibold text-primary-500 tabular-nums">
                  {formatCurrency(invoice.total_amount, invoice.currency)}
                </span>
              </div>
            </div>

            {/* Due date chip */}
            <div
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-caption font-medium",
                overdue
                  ? "bg-warning-100 text-warning-700"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {overdue ? (
                <Warning size={14} weight="fill" />
              ) : (
                <CalendarBlank size={14} weight="regular" />
              )}
              <span>{t("payInvoice.due.label", { date: formatDate(invoice.due_date) })}</span>
              {overdue && <span className="text-warning-600">{t("payInvoice.due.overdue")}</span>}
            </div>

            {/* Card entry for gateways that need it (Stripe / eWay) */}
            {invoice.status !== "PAID" && vendor === "STRIPE" && stripePromise && (
              <Elements stripe={stripePromise}>
                <StripeCheckoutForm
                  error={cardError}
                  onPaymentMethodReady={(processPayment) => {
                    stripeProcessRef.current = processPayment;
                  }}
                />
              </Elements>
            )}
            {invoice.status !== "PAID" && vendor === "EWAY" && gatewayKeys && (
              <EwayProvider
                encryptionKey={gatewayKeys.encryptionKey}
                publicKey={gatewayKeys.publicKey}
              >
                <EwayCardForm
                  isProcessing={isPaying}
                  onPaymentReady={setEwayData}
                  onError={(err) => setCardError(err)}
                />
                {cardError && (
                  <p className="text-caption text-danger-500">{cardError}</p>
                )}
              </EwayProvider>
            )}

            {/* Action area */}
            <div className="space-y-2 pt-1">
              <Button
                className="w-full gap-2"
                size="lg"
                disabled={
                  isPaying ||
                  invoice.status === "PAID" ||
                  (vendor === "EWAY" && !ewayData)
                }
                onClick={handlePay}
              >
                {isPaying ? (
                  <>
                    <SpinnerGap size={18} className="animate-spin" weight="bold" />
                    {t("payInvoice.pay.processing")}
                  </>
                ) : invoice.status === "PAID" ? (
                  <>
                    <CheckCircle size={18} weight="fill" />
                    {t("payInvoice.pay.alreadyPaid")}
                  </>
                ) : (
                  <>
                    <CreditCard size={18} weight="regular" />
                    {t("payInvoice.pay.cta", {
                      amount: formatCurrency(invoice.total_amount, invoice.currency),
                    })}
                  </>
                )}
              </Button>

              <p className="text-center text-caption text-muted-foreground">
                {t("payInvoice.secured")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden Razorpay form */}
      <div className="hidden">
        <RazorpayCheckoutForm
          ref={razorpayRef}
          error={razorpayError}
          amount={invoice.total_amount}
          currency={invoice.currency}
          onPaymentReady={handlePaymentReady}
          onError={(err) => {
            setRazorpayError(err);
            if (!err.toLowerCase().includes("cancel")) {
              toast.error(err);
            }
          }}
          courseName={t("payInvoice.checkout.defaultTitle")}
          courseDescription={t("payInvoice.checkout.description", {
            invoiceNumber: invoice.invoice_number,
          })}
          userName=""
        />
      </div>
    </PageShell>
  );
}
