import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkle, CheckCircle, Warning, Check, DownloadSimple } from '@phosphor-icons/react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    useCreditPacksQuery,
    usePurchaseCreditPackMutation,
    useOrderStatusQuery,
    useInvalidateCreditQueriesOnPaid,
    useBillingProfileQuery,
    downloadInvoicePdf,
    isValidGstin,
    type CreditPack,
} from '@/services/ai-credits/credit-pack-services';
import { EMPTY_GST_BILLING, GstBillingFields } from './GstBillingFields';

interface TopUpModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Set when the modal is reopened after returning from Razorpay's hosted
     * page (the platform_payment_id from the ?topup_pp query param). The modal
     * then skips the picker and resumes polling for webhook fulfillment.
     */
    resumePaymentId?: string | null;
}

type Phase = 'pick' | 'launching' | 'awaiting' | 'success' | 'error';

/**
 * Modal: pick a pack -> create Razorpay order -> open Razorpay Checkout ->
 * poll our /orders/{id}/status until PAID. Webhook is the source of truth;
 * this UI just reflects what the webhook has fulfilled.
 */
export function TopUpModal({ open, onOpenChange, resumePaymentId }: TopUpModalProps) {
    const { t: tPlans } = useTranslation('aiPlans');
    const instituteId = getCurrentInstituteId();
    const packsQuery = useCreditPacksQuery(instituteId, open);
    const purchaseMutation = usePurchaseCreditPackMutation();
    const invalidateCredits = useInvalidateCreditQueriesOnPaid();

    const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
    const [phase, setPhase] = useState<Phase>('pick');
    const [pollingFor, setPollingFor] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    // GST identity — prefilled from the institute's saved billing profile and
    // written back on purchase. Only shown for INR buyers (exports are 0%).
    const billingQuery = useBillingProfileQuery(instituteId, open);
    const [gstin, setGstin] = useState('');
    const [stateCode, setStateCode] = useState('');
    const [billingTouched, setBillingTouched] = useState(false);
    const [gstinError, setGstinError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || billingTouched || !billingQuery.data) return;
        setGstin(billingQuery.data.gstin ?? '');
        setStateCode(billingQuery.data.state_code ?? '');
    }, [open, billingTouched, billingQuery.data]);

    const isInr =
        (packsQuery.data?.[0]?.currency ?? billingQuery.data?.currency ?? 'INR') === 'INR';

    // Poll status every 2s while awaiting webhook fulfillment.
    const statusQuery = useOrderStatusQuery(
        pollingFor,
        phase === 'awaiting' ? 2000 : false,
        phase === 'awaiting'
    );

    // Reset state on close so re-open starts fresh.
    useEffect(() => {
        if (!open) {
            setSelectedPackId(null);
            setPhase('pick');
            setPollingFor(null);
            setErrorMessage(null);
            setBillingTouched(false);
            setGstinError(null);
            setDownloading(false);
        }
    }, [open]);

    // Resume flow: reopened after the Razorpay redirect (parent passes the
    // platform_payment_id from ?topup_pp). Skip the picker and poll our backend
    // until the webhook grants — reusing the same awaiting → success UI.
    useEffect(() => {
        if (open && resumePaymentId) {
            setPollingFor(resumePaymentId);
            setPhase('awaiting');
        }
    }, [open, resumePaymentId]);

    // Auto-pick the badged pack on first load (Most Popular).
    useEffect(() => {
        if (open && packsQuery.data && !selectedPackId) {
            const popular =
                packsQuery.data.find((p) => p.badge === 'Most Popular') ?? packsQuery.data[0];
            if (popular) setSelectedPackId(popular.pack_id);
        }
    }, [open, packsQuery.data, selectedPackId]);

    // React to status polling: PAID -> celebrate; FAILED -> show error.
    useEffect(() => {
        if (phase !== 'awaiting' || !statusQuery.data) return;
        if (statusQuery.data.payment_status === 'PAID') {
            setPhase('success');
            invalidateCredits();
            toast.success('Credits added to your balance', {
                description: statusQuery.data.credits_granted
                    ? `+${statusQuery.data.credits_granted} credits`
                    : undefined,
            });
        } else if (statusQuery.data.payment_status === 'FAILED') {
            setPhase('error');
            setErrorMessage('Payment was not completed. No credits were charged.');
        }
    }, [phase, statusQuery.data, invalidateCredits]);

    // Stop polling after 60s — webhook may run later under load.
    useEffect(() => {
        if (phase !== 'awaiting' || !pollingFor) return;
        const timer = setTimeout(() => {
            if (phase === 'awaiting') {
                toast.message('Payment is processing', {
                    description: 'Credits will appear in your balance shortly.',
                });
                onOpenChange(false);
            }
        }, 60_000);
        return () => clearTimeout(timer);
    }, [phase, pollingFor, onOpenChange]);

    const selectedPack = useMemo(
        () => packsQuery.data?.find((p) => p.pack_id === selectedPackId) ?? null,
        [packsQuery.data, selectedPackId]
    );

    const handleBuy = async () => {
        if (!instituteId || !selectedPack) return;

        const trimmedGstin = gstin.trim();
        if (isInr) {
            if (trimmedGstin && !isValidGstin(trimmedGstin)) {
                setGstinError('Enter a valid 15-character GSTIN, e.g. 27AAAAA0000A1Z5');
                return;
            }
            if (!trimmedGstin && !stateCode) {
                setGstinError(
                    'Select your state so the correct GST (CGST/SGST or IGST) is applied'
                );
                return;
            }
        }

        setPhase('launching');
        setErrorMessage(null);

        try {
            // Come back to THIS page after Razorpay's hosted payment. Strip any
            // stale return params so a retry doesn't stack them.
            const url = new URL(window.location.href);
            [
                'topup_pp',
                'razorpay_payment_id',
                'razorpay_payment_link_id',
                'razorpay_payment_link_reference_id',
                'razorpay_payment_link_status',
                'razorpay_signature',
            ].forEach((k) => url.searchParams.delete(k));

            const order = await purchaseMutation.mutateAsync({
                instituteId,
                packId: selectedPack.pack_id,
                returnUrl: url.toString(),
                ...(isInr && billingTouched
                    ? { buyerGstin: trimmedGstin, buyerStateCode: stateCode || undefined }
                    : {}),
            });

            if (!order.payment_link_url) {
                throw new Error('Payment link unavailable — please try again');
            }

            // Redirect to Razorpay's hosted page. Unlike checkout.js it works on
            // the platform's custom admin domains; credits are granted by the
            // webhook, and on return we resume polling via the ?topup_pp param.
            window.location.href = order.payment_link_url;
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to start payment';
            setPhase('error');
            setErrorMessage(message);
            toast.error('Could not start payment', { description: message });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-2xl">
                {/* ── Header ─────────────────────────────────────────── */}
                <DialogHeader className="space-y-2 border-b border-neutral-100 px-5 py-4 sm:px-6">
                    <DialogTitle className="flex items-center gap-2.5 text-base font-semibold text-neutral-900 sm:text-lg">
                        <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 text-white shadow-sm">
                            <Sparkle className="size-4" weight="fill" />
                        </span>
                        Top up AI credits
                    </DialogTitle>
                    <DialogDescription className="text-xs text-neutral-500 sm:text-sm">
                        Credits land in your balance the moment payment clears. Indian institutes
                        see GST inclusive in the total below.
                    </DialogDescription>
                </DialogHeader>

                {/* ── Body (scrolls on overflow) ─────────────────────── */}
                <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                    {phase === 'pick' && (
                        <>
                            {packsQuery.isLoading && (
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {[0, 1, 2, 3].map((i) => (
                                        <Skeleton key={i} className="h-40 w-full rounded-xl" />
                                    ))}
                                </div>
                            )}

                            {packsQuery.isError && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    Could not load packs. Please try again later.
                                </div>
                            )}

                            {packsQuery.data && packsQuery.data.length === 0 && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                                    No credit packs are available for your region yet. Contact
                                    support.
                                </div>
                            )}

                            {packsQuery.data && packsQuery.data.length > 0 && (
                                <div
                                    role="radiogroup"
                                    aria-label="Credit pack"
                                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                                >
                                    {packsQuery.data.map((pack) => (
                                        <PackCard
                                            key={pack.pack_id}
                                            pack={pack}
                                            selected={pack.pack_id === selectedPackId}
                                            onSelect={() => setSelectedPackId(pack.pack_id)}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* GST details — INR buyers only */}
                            {isInr && packsQuery.data && packsQuery.data.length > 0 && (
                                <div className="mt-4">
                                    <GstBillingFields
                                        value={{ ...EMPTY_GST_BILLING, gstin, stateCode }}
                                        onChange={(patch) => {
                                            setBillingTouched(true);
                                            setGstinError(null);
                                            if (patch.gstin !== undefined) setGstin(patch.gstin);
                                            if (patch.stateCode !== undefined) {
                                                setStateCode(patch.stateCode);
                                            }
                                        }}
                                        error={gstinError}
                                        hint={
                                            billingQuery.data?.gstin && !billingTouched
                                                ? tPlans('billing.savedHint')
                                                : null
                                        }
                                    />
                                </div>
                            )}

                            {/* Quiet trust line */}
                            <p className="mt-4 text-center text-[11px] text-neutral-400">
                                Secure payments by Razorpay · Cards, UPI, Netbanking
                            </p>
                        </>
                    )}

                    {phase === 'launching' && (
                        <div className="flex flex-col items-center gap-3 py-12">
                            <Loader2 className="size-8 animate-spin text-purple-600" />
                            <p className="text-sm text-neutral-600">Opening Razorpay…</p>
                        </div>
                    )}

                    {phase === 'awaiting' && (
                        <div className="flex flex-col items-center gap-3 py-12">
                            <Loader2 className="size-8 animate-spin text-purple-600" />
                            <p className="text-sm font-medium text-neutral-800">
                                Confirming your payment…
                            </p>
                            <p className="text-xs text-neutral-500">
                                This usually takes a few seconds.
                            </p>
                        </div>
                    )}

                    {phase === 'success' && (
                        <div className="flex flex-col items-center gap-3 py-12">
                            <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100">
                                <CheckCircle className="size-10 text-emerald-500" weight="fill" />
                            </div>
                            <p className="text-base font-semibold text-neutral-900">
                                Payment received
                            </p>
                            {statusQuery.data?.credits_granted != null && (
                                <p className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                                    +{statusQuery.data.credits_granted.toLocaleString('en-IN')}{' '}
                                    credits added
                                </p>
                            )}
                            {statusQuery.data?.invoice_id ? (
                                <button
                                    type="button"
                                    disabled={downloading}
                                    onClick={async () => {
                                        const inv = statusQuery.data;
                                        if (!inv?.invoice_id) return;
                                        setDownloading(true);
                                        try {
                                            await downloadInvoicePdf(
                                                inv.invoice_id,
                                                `${inv.invoice_number ?? inv.invoice_id}.pdf`
                                            );
                                        } catch {
                                            toast.error('Could not download the invoice', {
                                                description:
                                                    'You can also find it under AI Credits → Billing.',
                                            });
                                        } finally {
                                            setDownloading(false);
                                        }
                                    }}
                                    className="mt-1 inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
                                >
                                    {downloading ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <DownloadSimple className="size-4" weight="bold" />
                                    )}
                                    Download GST invoice
                                    {statusQuery.data.invoice_number && (
                                        <span className="font-mono text-xs text-neutral-400">
                                            {statusQuery.data.invoice_number}
                                        </span>
                                    )}
                                </button>
                            ) : (
                                <p className="max-w-xs text-center text-xs text-neutral-500">
                                    Your GST tax invoice has been emailed and is available under AI
                                    Credits → Billing.
                                </p>
                            )}
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className="flex flex-col items-center gap-3 py-12">
                            <div className="flex size-16 items-center justify-center rounded-full bg-amber-100">
                                <Warning className="size-10 text-amber-500" weight="fill" />
                            </div>
                            <p className="text-base font-semibold text-neutral-900">
                                Couldn&rsquo;t process payment
                            </p>
                            {errorMessage && (
                                <p className="max-w-sm text-center text-sm text-neutral-600">
                                    {errorMessage}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer ─────────────────────────────────────────── */}
                <DialogFooter className="flex-col-reverse gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
                    {phase === 'pick' && (
                        <>
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                className="w-full rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 sm:w-auto"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleBuy}
                                disabled={!selectedPack || purchaseMutation.isPending}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none sm:w-auto"
                            >
                                {purchaseMutation.isPending && (
                                    <Loader2 className="size-4 animate-spin" />
                                )}
                                {selectedPack
                                    ? `Pay ${selectedPack.display_price_major}`
                                    : 'Pick a pack'}
                            </button>
                        </>
                    )}
                    {(phase === 'success' || phase === 'error') && (
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 sm:w-auto"
                        >
                            Done
                        </button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface PackCardProps {
    pack: CreditPack;
    selected: boolean;
    onSelect: () => void;
}

function PackCard({ pack, selected, onSelect }: PackCardProps) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={onSelect}
            className={cn(
                'group relative flex flex-col rounded-xl border p-4 text-left outline-none transition-all',
                'focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2',
                selected
                    ? 'border-purple-500 bg-gradient-to-br from-purple-50 via-white to-indigo-50/40 shadow-sm ring-2 ring-purple-200'
                    : 'border-neutral-200 bg-white hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-sm'
            )}
        >
            {/* Badge — sits at top-right, inside the card so it never collides with the title */}
            {pack.badge && (
                <span className="absolute right-3 top-3 rounded-full bg-purple-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm">
                    {pack.badge}
                </span>
            )}

            {/* Selected indicator — bottom-right small check */}
            {selected && (
                <span className="absolute bottom-3 right-3 flex size-5 items-center justify-center rounded-full bg-purple-600 text-white shadow-sm">
                    <Check className="size-3" weight="bold" />
                </span>
            )}

            {/* Pack name (small label) */}
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {pack.name}
            </span>

            {/* Credits — the headline, this is what they're buying */}
            <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold leading-none text-neutral-900">
                    {pack.credits.toLocaleString()}
                </span>
                <span className="text-xs font-medium text-neutral-500">credits</span>
            </div>

            {/* Total price — secondary but bold */}
            <div className="mt-3 text-lg font-bold leading-none text-neutral-900">
                {pack.display_price_major}
            </div>

            {/* Tax breakdown */}
            <div className="mt-3 border-t border-dashed border-neutral-200 pt-2.5 text-[11px] text-neutral-500">
                <div className="flex items-center justify-between">
                    <span>Base</span>
                    <span className="tabular-nums">{pack.display_base_major}</span>
                </div>
                {!pack.is_export && pack.tax_amount_minor > 0 && (
                    <div className="mt-1 flex items-center justify-between">
                        <span>GST ({(pack.tax_rate_bps / 100).toFixed(0)}%)</span>
                        <span className="tabular-nums">{pack.display_tax_major}</span>
                    </div>
                )}
                {pack.is_export && <div className="mt-1 text-neutral-400">No GST · export</div>}
            </div>
        </button>
    );
}
