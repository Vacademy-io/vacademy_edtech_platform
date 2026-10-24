import { useQuery } from '@tanstack/react-query';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Plus,
    Trash,
    ClipboardText,
    WhatsappLogo,
    DownloadSimple,
    CheckCircle,
    EnvelopeSimple,
    CaretLeft,
    Eye,
    ArrowsClockwise,
} from '@phosphor-icons/react';

import { CURRENCIES, currencySymbols } from '@/constants/currencies';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import SelectField from '@/components/design-system/select-field';
import { StatusChip } from '@/components/design-system/status-chips';
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
} from '@/components/ui/form';
import { DashboardLoader } from '@/components/core/dashboard-loader';

import { fetchInvoiceSettings } from '@/routes/settings/-components/Invoice/invoice-settings-service';
import { downloadInvoicePdf, shareInvoiceOnWhatsApp } from '@/services/invoice-pdf';
import {
    createAdminInvoice,
    updateAdminInvoice,
    previewAdminInvoice,
    type AdminCreateInvoiceRequest,
    type AdminInvoicePaymentLinkResponse,
    type InvoiceDTO,
    type InvoicePlaceholderValue,
} from '@/services/invoice-service';
import {
    AdminDiscountField,
    EMPTY_ADMIN_DISCOUNT,
} from '@/components/common/payments/AdminDiscountField';
import { useCanApplyDiscounts } from '@/hooks/useCanApplyDiscounts';
import {
    getAdminDiscountValidationError,
    toAdminDiscountPayload,
    type AdminDiscountPreview,
    type AdminDiscountRequest,
} from '@/services/admin-discounts';

// ─── Schema ──────────────────────────────────────────────────────────────────

const buildInvoiceFormSchema = (t: TFunction) => {
    const lineItemSchema = z.object({
        description: z.string().min(1, t('manageStudentsCreateInvoiceDialog:validation.descriptionRequired')),
        quantity: z.coerce.number().min(1, t('manageStudentsCreateInvoiceDialog:validation.minQuantity')),
        unit_price: z.coerce
            .number()
            .min(0.01, t('manageStudentsCreateInvoiceDialog:validation.priceMustBePositive')),
        item_type: z.string().optional(),
    });

    return z.object({
        line_items: z
            .array(lineItemSchema)
            .min(1, t('manageStudentsCreateInvoiceDialog:validation.lineItemsRequired')),
        due_date: z.string().min(1, t('manageStudentsCreateInvoiceDialog:validation.dueDateRequired')),
        currency: z.string().min(1, t('manageStudentsCreateInvoiceDialog:validation.currencyRequired')),
        notes: z.string().optional(),
    });
};

type InvoiceFormValues = z.infer<ReturnType<typeof buildInvoiceFormSchema>>;

// ─── Currency options ────────────────────────────────────────────────────────

const CURRENCY_OPTIONS = CURRENCIES.map(({ code, name }) => ({
    _id: code,
    value: code,
    label: `${code} — ${name}`,
}));

const CURRENCY_SYMBOLS: Record<string, string> = currencySymbols;

// Ordered groups for the review panel (matches the backend PLACEHOLDER_META groups).
const GROUP_ORDER = ['INVOICE', 'BILL TO', 'INSTITUTE', 'TAX', 'AMOUNTS', 'NOTES'];

// ─── Props ───────────────────────────────────────────────────────────────────

interface CreateInvoiceDialogProps {
    userId: string;
    userName: string;
    instituteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    /**
     * When set, the dialog opens pre-filled from this invoice's line items, currency,
     * and notes (the "Duplicate" action) instead of a blank form. Tax is NOT copied —
     * it re-defaults from the institute's current settings, which is safer than
     * silently repeating a possibly-stale rate. The synthetic TAX line item (added
     * automatically by the backend) is filtered out so it isn't duplicated as a
     * regular item.
     */
    duplicateFrom?: InvoiceDTO | null;
    /**
     * When set, the dialog edits THIS existing invoice instead of creating a new one:
     * the form seeds from it (including its dates), and saving PUTs to the update
     * endpoint — same invoice number, PDF regenerated. Only unpaid invoices are
     * editable; the server enforces that. Takes precedence over `duplicateFrom`.
     */
    editInvoice?: InvoiceDTO | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ISO timestamp → the `yyyy-MM-dd` an <input type="date"> expects (local calendar day). */
function toDateInputValue(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmt(amount: number, currency: string): string {
    const sym = CURRENCY_SYMBOLS[currency] ?? currency;
    return `${sym}${Number(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

// ─── Success view ────────────────────────────────────────────────────────────

function SuccessView({
    result,
    userName,
    isEditing,
    onClose,
}: {
    result: AdminInvoicePaymentLinkResponse;
    userName: string;
    isEditing?: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation('manageStudentsCreateInvoiceDialog');
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(result.payment_link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error(t('manageStudentsCreateInvoiceDialog:success.copyFailed'));
        }
    };

    // The invoice shape the PDF helpers need (id + number + url).
    const pdfSource = {
        id: result.invoice_id,
        invoice_number: result.invoice_number,
        pdf_url: result.pdf_url,
    };

    const handleWhatsAppShare = async () => {
        const via = await shareInvoiceOnWhatsApp({
            invoice: pdfSource,
            recipientName: userName,
            amountLabel: fmt(result.total_amount, result.currency),
            paymentLink: result.payment_link,
        });
        // Be honest about what actually got shared: only the Web Share path attaches the
        // real PDF; the fallback can only carry links (WhatsApp deep links can't take files).
        if (via === 'link') {
            toast.info(t('manageStudentsCreateInvoiceDialog:success.whatsappShared'));
        }
    };

    return (
        <div className="flex flex-col items-center gap-6 px-6 py-8 text-center">
            <StatusChip
                status="SUCCESS"
                text={
                    isEditing
                        ? t('manageStudentsCreateInvoiceDialog:success.invoiceUpdatedTitle')
                        : t('manageStudentsCreateInvoiceDialog:success.invoiceCreatedTitle')
                }
                textSize="text-subtitle"
                showIcon
            />

            <div className="w-full max-w-sm rounded-lg border border-success-200 bg-success-50 p-4 text-left">
                <div className="mb-1 flex items-center gap-2">
                    <CheckCircle className="size-5 text-success-600" weight="fill" />
                    <span className="text-body font-semibold text-success-700">{result.invoice_number}</span>
                </div>
                <p className="text-caption text-neutral-600">
                    {t('manageStudentsCreateInvoiceDialog:success.totalLabel')}{' '}
                    <span className="font-semibold text-neutral-800">
                        {fmt(result.total_amount, result.currency)}
                    </span>
                </p>
            </div>

            {result.payment_link && (
                <div className="w-full max-w-sm space-y-2">
                    <p className="text-caption font-medium text-neutral-600">
                        {t('manageStudentsCreateInvoiceDialog:success.paymentLinkLabel')}
                    </p>
                    <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <span className="flex-1 truncate text-caption text-neutral-700">
                            {result.payment_link}
                        </span>
                        <MyButton
                            buttonType={copied ? 'primary' : 'secondary'}
                            scale="small"
                            layoutVariant="icon"
                            onClick={handleCopy}
                            title={t('manageStudentsCreateInvoiceDialog:success.copyPaymentLinkTitle')}
                        >
                            <ClipboardText className="size-3.5" />
                        </MyButton>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onAsyncClick={handleWhatsAppShare}
                    loadingText={t('manageStudentsCreateInvoiceDialog:success.preparingWhatsapp')}
                >
                    <WhatsappLogo className="mr-1.5 size-4" />
                    {t('manageStudentsCreateInvoiceDialog:success.shareOnWhatsapp')}
                </MyButton>
                {result.pdf_url && (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onAsyncClick={() => downloadInvoicePdf(pdfSource)}
                        loadingText={t('manageStudentsCreateInvoiceDialog:success.downloadingPdf')}
                    >
                        <DownloadSimple className="mr-1.5 size-4" />
                        {t('manageStudentsCreateInvoiceDialog:success.downloadPdf')}
                    </MyButton>
                )}
                <MyButton buttonType="primary" scale="small" onClick={onClose}>
                    {t('manageStudentsCreateInvoiceDialog:success.close')}
                </MyButton>
            </div>
        </div>
    );
}

// ─── Review & Preview step ─────────────────────────────────────────────────────

function ReviewStep({
    resolvedValues,
    overrides,
    reviewDates,
    previewHtml,
    previewLoading,
    previewError,
    onOverrideChange,
    onDateChange,
    onRetry,
}: {
    resolvedValues: InvoicePlaceholderValue[];
    overrides: Record<string, string>;
    reviewDates: Record<string, string>;
    previewHtml: string;
    previewLoading: boolean;
    previewError: string | null;
    onOverrideChange: (key: string, value: string) => void;
    onDateChange: (key: string, value: string) => void;
    onRetry: () => void;
}) {
    const { t } = useTranslation('manageStudentsCreateInvoiceDialog');

    // Display labels for the backend's PLACEHOLDER_META group codes (GROUP_ORDER). The codes
    // themselves are an internal contract used to match/filter `resolvedValues` — never
    // translate those; only the label shown to the admin.
    const GROUP_LABELS: Record<string, string> = {
        INVOICE: t('manageStudentsCreateInvoiceDialog:review.groups.invoice'),
        'BILL TO': t('manageStudentsCreateInvoiceDialog:review.groups.billTo'),
        INSTITUTE: t('manageStudentsCreateInvoiceDialog:review.groups.institute'),
        TAX: t('manageStudentsCreateInvoiceDialog:review.groups.tax'),
        AMOUNTS: t('manageStudentsCreateInvoiceDialog:review.groups.amounts'),
        NOTES: t('manageStudentsCreateInvoiceDialog:review.groups.notes'),
    };

    const grouped = GROUP_ORDER.map((group) => ({
        group,
        items: resolvedValues.filter((r) => r.group === group),
    })).filter((g) => g.items.length > 0);

    return (
        <div className="flex h-[68vh] min-h-0 flex-col md:flex-row"> {/* design-lint-ignore: viewport-relative preview height, no vh design token exists */}
            {/* ── Editable dynamic values ── */}
            <div className="w-full shrink-0 space-y-5 overflow-y-auto border-b border-neutral-200 px-6 py-5 md:w-2/5 md:border-b-0 md:border-r">
                <p className="text-caption text-neutral-500">
                    {t('manageStudentsCreateInvoiceDialog:review.helperText')}
                </p>

                {grouped.map(({ group, items }) => (
                    <div key={group} className="space-y-3">
                        <p className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                            {GROUP_LABELS[group] ?? group}
                        </p>
                        <div className="space-y-3">
                            {items.map((field) => {
                                if (!field.editable) {
                                    return (
                                        <div key={field.key} className="flex items-center justify-between gap-2">
                                            <span className="text-caption text-neutral-500">{field.label}</span>
                                            <span className="text-body font-medium text-neutral-700 tabular-nums">
                                                {field.value || '—'}
                                            </span>
                                        </div>
                                    );
                                }
                                if (field.input_type === 'date') {
                                    return (
                                        <MyInput
                                            key={field.key}
                                            inputType="date"
                                            label={field.label}
                                            inputPlaceholder=""
                                            input={reviewDates[field.key] ?? field.value ?? ''}
                                            onChangeFunction={(e) => onDateChange(field.key, e.target.value)}
                                            className="w-full"
                                        />
                                    );
                                }
                                if (field.input_type === 'textarea') {
                                    return (
                                        <div key={field.key} className="flex flex-col gap-1">
                                            <label className="text-subtitle font-regular text-neutral-700">
                                                {field.label}
                                            </label>
                                            <Textarea
                                                value={overrides[field.key] ?? field.value ?? ''}
                                                onChange={(e) => onOverrideChange(field.key, e.target.value)}
                                                className="text-body"
                                            />
                                        </div>
                                    );
                                }
                                return (
                                    <MyInput
                                        key={field.key}
                                        inputType="text"
                                        label={field.label}
                                        inputPlaceholder={field.label}
                                        input={overrides[field.key] ?? field.value ?? ''}
                                        onChangeFunction={(e) => onOverrideChange(field.key, e.target.value)}
                                        className="w-full"
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Live preview ── */}
            <div className="flex min-h-0 flex-1 flex-col bg-neutral-100">
                <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5">
                    <Eye className="size-4 text-neutral-500" />
                    <span className="text-caption font-medium text-neutral-600">
                        {t('manageStudentsCreateInvoiceDialog:review.previewLabel')}
                    </span>
                    {previewLoading && (
                        <ArrowsClockwise className="size-3.5 animate-spin text-primary-500" />
                    )}
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {previewError ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                            <p className="text-body text-danger-600">{previewError}</p>
                            <MyButton buttonType="secondary" scale="small" onClick={onRetry}>
                                <ArrowsClockwise className="mr-1.5 size-4" />
                                {t('manageStudentsCreateInvoiceDialog:review.retry')}
                            </MyButton>
                        </div>
                    ) : !previewHtml && previewLoading ? (
                        <div className="flex h-full items-center justify-center">
                            <DashboardLoader />
                        </div>
                    ) : (
                        <iframe
                            title={t('manageStudentsCreateInvoiceDialog:review.previewTitle')}
                            srcDoc={previewHtml}
                            sandbox=""
                            className="size-full border-0 bg-white"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CreateInvoiceDialog({
    userId,
    userName,
    instituteId,
    open,
    onOpenChange,
    onSuccess,
    duplicateFrom,
    editInvoice,
}: CreateInvoiceDialogProps) {
    const { t } = useTranslation('manageStudentsCreateInvoiceDialog');
    const isEditing = !!editInvoice;
    // Discounts are for new invoices only (the update endpoint doesn't take one), by roles
    // with "Apply discounts" on in Display Settings.
    const canApplyDiscounts = useCanApplyDiscounts(instituteId);
    const showDiscount = !isEditing && canApplyDiscounts;
    const [successResult, setSuccessResult] = useState<AdminInvoicePaymentLinkResponse | null>(null);
    const [step, setStep] = useState<'items' | 'review'>('items');

    // Review-step state
    const [resolvedValues, setResolvedValues] = useState<InvoicePlaceholderValue[] | null>(null);
    const [overrides, setOverrides] = useState<Record<string, string>>({});
    const [reviewDates, setReviewDates] = useState<Record<string, string>>({});
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    // Skips exactly one debounced refresh right after seeding (its result is already shown).
    const skipNextPreviewRef = useRef(false);

    // Per-invoice tax override (step 1). null = "not touched, use the institute default" —
    // distinguishing null from false/0 lets an admin explicitly re-enable tax or set a 0%
    // rate without it being mistaken for "untouched".
    const [taxEnabledOverride, setTaxEnabledOverride] = useState<boolean | null>(null);
    // Raw text, not a number: lets the field go genuinely empty while the admin is retyping a
    // rate (e.g. clearing "18" to type "12.5") without the display snapping to "0" on every
    // keystroke. null = untouched (use the institute default); "" = cleared but not yet retyped.
    const [taxRatePercentText, setTaxRatePercentText] = useState<string | null>(null);

    // Admin-granted discount (new invoices only — the update endpoint doesn't take one).
    const [adminDiscount, setAdminDiscount] = useState<AdminDiscountRequest>(EMPTY_ADMIN_DISCOUNT);
    const [discountPreview, setDiscountPreview] = useState<AdminDiscountPreview | null>(null);
    const [discountServerError, setDiscountServerError] = useState<string | null>(null);

    const { data: invoiceSettings, isLoading: isSettingsLoading } = useQuery({
        queryKey: ['invoice-settings'],
        queryFn: fetchInvoiceSettings,
        staleTime: 5 * 60 * 1000,
    });

    const defaultCurrency = invoiceSettings?.currency ?? 'INR';

    const invoiceFormSchema = useMemo(() => buildInvoiceFormSchema(t), [t]);

    const form = useForm<InvoiceFormValues>({
        resolver: zodResolver(invoiceFormSchema),
        defaultValues: {
            line_items: [{ description: '', quantity: 1, unit_price: 0, item_type: 'SERVICE' }],
            due_date: '',
            currency: defaultCurrency,
            notes: '',
        },
    });

    // Sync currency default once settings load
    const formCurrency = form.watch('currency');
    if (invoiceSettings && !form.formState.isDirty && formCurrency !== defaultCurrency) {
        form.setValue('currency', defaultCurrency);
    }

    // Re-seed the form whenever the dialog opens — either from an existing invoice
    // ("Duplicate") or a blank form. Tax controls always reset to "use institute default"
    // (duplicated tax would silently repeat a possibly-stale rate).
    useEffect(() => {
        if (!open) return;
        setTaxEnabledOverride(null);
        setTaxRatePercentText(null);
        setAdminDiscount(EMPTY_ADMIN_DISCOUNT);
        setDiscountPreview(null);
        // Edit takes precedence over duplicate; both seed from an existing invoice's items,
        // but only edit carries the original's due date forward.
        const seedFrom = editInvoice || duplicateFrom;
        if (seedFrom) {
            form.reset({
                line_items:
                    seedFrom.line_items
                        .filter((li) => li.item_type !== 'TAX')
                        .map((li) => ({
                            description: li.description,
                            quantity: li.quantity || 1,
                            unit_price: li.unit_price || 0,
                            item_type: li.item_type || 'SERVICE',
                        })) || [{ description: '', quantity: 1, unit_price: 0, item_type: 'SERVICE' }],
                due_date: editInvoice?.due_date ? toDateInputValue(editInvoice.due_date) : '',
                currency: seedFrom.currency || defaultCurrency,
                notes: seedFrom.notes || '',
            });
        } else {
            form.reset({
                line_items: [{ description: '', quantity: 1, unit_price: 0, item_type: 'SERVICE' }],
                due_date: '',
                currency: defaultCurrency,
                notes: '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, duplicateFrom, editInvoice]);

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: 'line_items',
    });

    // useWatch subscribes to changes and triggers re-renders reliably
    const watchedLineItems = useWatch({ control: form.control, name: 'line_items' });
    const currency = useWatch({ control: form.control, name: 'currency' }) || defaultCurrency;

    const settingsTaxRate = invoiceSettings?.taxRate ?? 0;
    const taxLabel =
        invoiceSettings?.taxLabel ?? t('manageStudentsCreateInvoiceDialog:summary.taxLabelFallback');
    const taxIncluded = invoiceSettings?.taxIncluded ?? false;
    // Effective per-invoice tax: the admin's override when touched, else the institute default.
    // A transiently-empty text buffer ("" while retyping) computes as 0, not the settings
    // default — it only reverts to the default once truly untouched (taxRatePercentText === null).
    const taxEnabled = taxEnabledOverride ?? true;
    const taxRate = taxRatePercentText !== null ? Number(taxRatePercentText) || 0 : settingsTaxRate;

    const subtotal = watchedLineItems.reduce((sum, item) => {
        return sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
    }, 0);
    // The backend applies the admin discount as a DISCOUNT line on the pre-tax subtotal,
    // so tax is computed on the discounted amount.
    const discountAmount =
        showDiscount && adminDiscount.mode !== 'NONE' && discountPreview
            ? Math.min(subtotal, discountPreview.discount_amount || 0)
            : 0;
    const taxableSubtotal = subtotal - discountAmount;
    let taxAmount = 0;
    let total = taxableSubtotal;
    if (taxEnabled && taxRate > 0) {
        if (taxIncluded) {
            const netSubtotal = taxableSubtotal / (1 + taxRate / 100);
            taxAmount = taxableSubtotal - netSubtotal;
        } else {
            taxAmount = taxableSubtotal * (taxRate / 100);
            total = taxableSubtotal + taxAmount;
        }
    }

    const handleClose = () => {
        form.reset();
        setSuccessResult(null);
        setStep('items');
        setResolvedValues(null);
        setOverrides({});
        setReviewDates({});
        setPreviewHtml('');
        setPreviewError(null);
        setTaxEnabledOverride(null);
        setTaxRatePercentText(null);
        setAdminDiscount(EMPTY_ADMIN_DISCOUNT);
        setDiscountPreview(null);
        onOpenChange(false);
    };

    // Build the create/preview request from the items form + review edits.
    const buildRequest = (
        values: InvoiceFormValues,
        ov: Record<string, string>,
        dates: Record<string, string>
    ): AdminCreateInvoiceRequest => {
        // A cleared review date field is an empty string; treat that as "not overridden" and
        // fall back to the step-1 (zod-validated) due date so we never build an invalid date.
        const dueRaw = dates.due_date && dates.due_date !== '' ? dates.due_date : values.due_date;
        let due = new Date(dueRaw);
        if (Number.isNaN(due.getTime())) due = new Date(values.due_date);
        due.setHours(23, 59, 59, 0);
        // Send invoice_date as a NAIVE local date-time string (no toISOString): the backend field
        // is a LocalDateTime, and round-tripping local-midnight through toISOString() would shift
        // the calendar day back for UTC+ timezones (e.g. IST). An empty value falls back to the
        // server's now().
        const invoiceDate = dates.invoice_date ? `${dates.invoice_date}T00:00:00` : undefined;
        return {
            user_ids: [userId],
            institute_id: instituteId,
            line_items: values.line_items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unit_price: item.unit_price,
                item_type: item.item_type || 'SERVICE',
            })),
            currency: values.currency,
            due_date: due.toISOString(),
            invoice_date: invoiceDate,
            notes: ov.notes || undefined,
            overrides: ov,
            // Editing: tell preview which invoice this is, so its own number isn't treated as
            // a collision and swapped for a freshly-generated one in the rendered preview.
            editing_invoice_id: editInvoice?.id,
            // Only sent when the admin actually touched the tax controls — otherwise the
            // institute's INVOICE_SETTING default applies, same as before this feature.
            tax_enabled: taxEnabledOverride ?? undefined,
            tax_rate_percent: taxRatePercentText !== null ? Number(taxRatePercentText) || 0 : undefined,
            // New invoices only; omitted for "No discount". Cycles don't apply to an invoice.
            admin_discount: !showDiscount
                ? undefined
                : toAdminDiscountPayload(adminDiscount, { includeCycles: false }),
        };
    };

    // Render the preview. `seed=true` (re)initialises the editable fields from the
    // server's resolved values; `seed=false` re-renders using the current edits.
    const runPreview = async (seed: boolean) => {
        setPreviewLoading(true);
        setPreviewError(null);
        try {
            const values = form.getValues();
            const req = buildRequest(values, seed ? {} : overrides, seed ? {} : reviewDates);
            const res = await previewAdminInvoice(req);
            setPreviewHtml(res.html);
            setResolvedValues(res.resolved_values);
            if (seed) {
                const ov: Record<string, string> = {};
                const dates: Record<string, string> = {};
                res.resolved_values.forEach((rv) => {
                    if (!rv.editable) return;
                    if (rv.input_type === 'date') dates[rv.key] = rv.value;
                    else ov[rv.key] = rv.value;
                });
                setOverrides(ov);
                setReviewDates(dates);
                skipNextPreviewRef.current = true;
            }
        } catch {
            setPreviewError(t('manageStudentsCreateInvoiceDialog:errors.previewFailed'));
        } finally {
            setPreviewLoading(false);
        }
    };

    // Debounced live refresh while editing dynamic values in the review step.
    useEffect(() => {
        if (step !== 'review' || !resolvedValues) return;
        if (skipNextPreviewRef.current) {
            skipNextPreviewRef.current = false;
            return;
        }
        const timer = setTimeout(() => {
            void runPreview(false);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overrides, reviewDates, step]);

    const handleNext = async () => {
        const ok = await form.trigger();
        if (!ok) return;
        if (showDiscount) {
            const discountErr =
                getAdminDiscountValidationError(adminDiscount, subtotal) ||
                (adminDiscount.mode !== 'NONE' ? discountServerError : null);
            if (discountErr) {
                toast.error(discountErr);
                return;
            }
        }
        const isSeed = resolvedValues === null;
        // Re-entry (Back → Next): setStep('review') re-triggers the debounce effect, which would
        // fire a second identical preview. Suppress that one — the direct runPreview(false) below
        // already refreshes. (On first entry, runPreview(true) sets this flag itself.)
        if (!isSeed) skipNextPreviewRef.current = true;
        setStep('review');
        // Seed on first entry; on re-entry just refresh so prior edits are kept.
        await runPreview(isSeed);
    };

    const handleCreate = async () => {
        const values = form.getValues();
        const req = buildRequest(values, overrides, reviewDates);

        if (editInvoice) {
            // Edit: same invoice number, PDF regenerated server-side. The update endpoint
            // returns the refreshed InvoiceDTO; map it onto the shape SuccessView renders.
            const updated = await updateAdminInvoice(editInvoice.id, instituteId, {
                line_items: req.line_items,
                currency: req.currency,
                due_date: req.due_date,
                invoice_date: req.invoice_date,
                notes: req.notes,
                overrides: req.overrides,
                tax_enabled: req.tax_enabled,
                tax_rate_percent: req.tax_rate_percent,
            });
            setSuccessResult({
                invoice_id: updated.id,
                invoice_number: updated.invoice_number,
                user_id: updated.user_id,
                total_amount: updated.total_amount,
                currency: updated.currency,
                status: updated.status,
                due_date: updated.due_date,
                payment_link: updated.payment_link ?? '',
                pdf_url: updated.pdf_url ?? null,
            });
            onSuccess();
            return;
        }

        const results = await createAdminInvoice(req);
        const userResult = results.find((r) => r.user_id === userId) ?? results[0];
        if (!userResult) throw new Error('No invoice returned from server');
        setSuccessResult(userResult);
        onSuccess();
    };

    const itemsContent = (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(() => {})} className="flex flex-col overflow-hidden">
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                    {isSettingsLoading && (
                        <p className="text-caption text-neutral-500">
                            {t('manageStudentsCreateInvoiceDialog:items.loadingSettings')}
                        </p>
                    )}

                    {/* ── Line Items ── */}
                    <div>
                        <p className="mb-3 text-body font-semibold text-neutral-700">
                            {t('manageStudentsCreateInvoiceDialog:items.heading')}
                        </p>

                        {/* Table header */}
                        <div className="mb-1 grid grid-cols-12 gap-2 px-1">
                            <span className="col-span-5 text-caption font-medium text-neutral-500">
                                {t('manageStudentsCreateInvoiceDialog:items.table.description')}
                            </span>
                            <span className="col-span-2 text-caption font-medium text-neutral-500 text-end">
                                {t('manageStudentsCreateInvoiceDialog:items.table.qty')}
                            </span>
                            <span className="col-span-2 text-caption font-medium text-neutral-500 text-end">
                                {t('manageStudentsCreateInvoiceDialog:items.table.price')}
                            </span>
                            <span className="col-span-3 text-caption font-medium text-neutral-500 text-end">
                                {t('manageStudentsCreateInvoiceDialog:items.table.amount')}
                            </span>
                        </div>

                        <div className="space-y-2">
                            {fields.map((field, index) => {
                                const qty = Number(watchedLineItems[index]?.quantity) || 0;
                                const price = Number(watchedLineItems[index]?.unit_price) || 0;
                                const lineTotal = qty * price;

                                return (
                                    <div
                                        key={field.id}
                                        className="grid grid-cols-12 items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5"
                                    >
                                        {/* Description */}
                                        <FormField
                                            control={form.control}
                                            name={`line_items.${index}.description`}
                                            render={({ field: f }) => (
                                                <FormItem className="col-span-5 space-y-0.5">
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="text"
                                                            inputPlaceholder={t(
                                                                'manageStudentsCreateInvoiceDialog:items.descriptionPlaceholder'
                                                            )}
                                                            input={f.value}
                                                            onChangeFunction={f.onChange}
                                                            className="w-full sm:w-full"
                                                            {...f}
                                                        />
                                                    </FormControl>
                                                    <FormMessage className="text-caption" />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Quantity */}
                                        <FormField
                                            control={form.control}
                                            name={`line_items.${index}.quantity`}
                                            render={({ field: f }) => (
                                                <FormItem className="col-span-2 space-y-0.5">
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="number"
                                                            inputPlaceholder="1"
                                                            input={String(f.value)}
                                                            onChangeFunction={f.onChange}
                                                            className="w-full sm:w-full text-right"
                                                            {...f}
                                                        />
                                                    </FormControl>
                                                    <FormMessage className="text-caption" />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Unit Price */}
                                        <FormField
                                            control={form.control}
                                            name={`line_items.${index}.unit_price`}
                                            render={({ field: f }) => (
                                                <FormItem className="col-span-2 space-y-0.5">
                                                    <FormControl>
                                                        <MyInput
                                                            inputType="number"
                                                            inputPlaceholder="0"
                                                            input={String(f.value)}
                                                            onChangeFunction={f.onChange}
                                                            className="w-full sm:w-full text-right"
                                                            {...f}
                                                        />
                                                    </FormControl>
                                                    <FormMessage className="text-caption" />
                                                </FormItem>
                                            )}
                                        />

                                        {/* Line total + delete */}
                                        <div className="col-span-3 flex items-center justify-end gap-1.5 pt-1.5">
                                            <span className="text-body font-semibold text-neutral-800 tabular-nums">
                                                {fmt(lineTotal, currency)}
                                            </span>
                                            {fields.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => remove(index)}
                                                    className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-danger-500"
                                                    title={t('manageStudentsCreateInvoiceDialog:items.removeItem')}
                                                >
                                                    <Trash className="size-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {form.formState.errors.line_items?.root && (
                            <p className="mt-1 text-caption text-danger-600">
                                {form.formState.errors.line_items.root.message}
                            </p>
                        )}

                        <MyButton
                            buttonType="text"
                            scale="small"
                            className="mt-2"
                            onClick={() =>
                                append({ description: '', quantity: 1, unit_price: 0, item_type: 'SERVICE' })
                            }
                        >
                            <Plus className="mr-1 size-3.5" />
                            {t('manageStudentsCreateInvoiceDialog:items.addItem')}
                        </MyButton>
                    </div>

                    {/* ── Admin discount (new invoices only) ── */}
                    {showDiscount && (
                        <div className="rounded-lg border border-neutral-200 px-4 py-3">
                            <AdminDiscountField
                                value={adminDiscount}
                                onChange={setAdminDiscount}
                                grossAmount={subtotal}
                                currency={currency}
                                instituteId={instituteId}
                                onPreview={setDiscountPreview}
                                onServerErrorChange={setDiscountServerError}
                                hideCycles
                                label={t('manageStudentsCreateInvoiceDialog:discount.label', {
                                    defaultValue: 'Discount (optional)',
                                })}
                            />
                        </div>
                    )}

                    {/* ── Summary ── */}
                    <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3">
                        <div className="space-y-2 text-body">
                            <div className="flex justify-between text-neutral-600">
                                <span>{t('manageStudentsCreateInvoiceDialog:summary.subtotal')}</span>
                                <span className="tabular-nums">{fmt(subtotal, currency)}</span>
                            </div>
                            {discountAmount > 0 && (
                                <div className="flex justify-between text-success-700">
                                    <span>
                                        {t('manageStudentsCreateInvoiceDialog:summary.discount', {
                                            defaultValue: 'Discount',
                                        })}
                                    </span>
                                    <span className="tabular-nums">−{fmt(discountAmount, currency)}</span>
                                </div>
                            )}

                            {/* Tax: defaults to the institute's Invoice Settings, but editable
                                (or removable) per invoice. */}
                            <div className="flex items-center justify-between gap-2 text-neutral-600">
                                <label className="flex items-center gap-2">
                                    <Checkbox
                                        checked={taxEnabled}
                                        onCheckedChange={(checked) => setTaxEnabledOverride(checked === true)}
                                    />
                                    <span>
                                        {t('manageStudentsCreateInvoiceDialog:summary.applyTax', { taxLabel })}
                                    </span>
                                    {taxEnabled && (
                                        <span className="flex items-center gap-1">
                                            <MyInput
                                                inputType="number"
                                                inputPlaceholder="0"
                                                input={
                                                    taxRatePercentText !== null
                                                        ? taxRatePercentText
                                                        : String(settingsTaxRate)
                                                }
                                                onChangeFunction={(e) => setTaxRatePercentText(e.target.value)}
                                                size="small"
                                                className="w-14 text-right tabular-nums"
                                                aria-label={t(
                                                    'manageStudentsCreateInvoiceDialog:summary.taxRateAriaLabel',
                                                    { taxLabel }
                                                )}
                                                min={0}
                                                max={100}
                                                step={0.01}
                                            />
                                            <span className="text-caption">%</span>
                                        </span>
                                    )}
                                </label>
                                {taxEnabled && (
                                    <span className="tabular-nums">{fmt(taxAmount, currency)}</span>
                                )}
                            </div>
                            {taxEnabled && taxIncluded && (
                                <p className="text-caption text-neutral-500">
                                    {t('manageStudentsCreateInvoiceDialog:summary.taxIncludedNote', {
                                        taxRate,
                                        taxLabel,
                                    })}
                                </p>
                            )}

                            <div className="flex justify-between border-t border-primary-200 pt-1.5 font-semibold">
                                <span className="text-neutral-700">
                                    {t('manageStudentsCreateInvoiceDialog:summary.total')}
                                </span>
                                <span className="text-primary-600 tabular-nums">{fmt(total, currency)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Email auto-send notice */}
                    {invoiceSettings?.sendInvoiceEmail && (
                        <div className="flex items-center gap-2 rounded-md border border-info-200 bg-info-50 px-3 py-2">
                            <EnvelopeSimple size={14} className="shrink-0 text-info-600" weight="fill" />
                            <p className="text-caption text-info-700">
                                {t('manageStudentsCreateInvoiceDialog:emailNotice')}
                            </p>
                        </div>
                    )}

                    {/* ── Due Date + Currency ── */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="due_date"
                            render={({ field: f }) => (
                                <FormItem>
                                    <FormLabel className="text-caption text-neutral-600">
                                        {t('manageStudentsCreateInvoiceDialog:form.dueDateLabel')}{' '}
                                        <span className="text-danger-500">*</span>
                                    </FormLabel>
                                    <FormControl>
                                        <MyInput
                                            inputType="date"
                                            inputPlaceholder=""
                                            input={f.value}
                                            onChangeFunction={f.onChange}
                                            className="w-full"
                                            {...f}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <SelectField
                            label={t('manageStudentsCreateInvoiceDialog:form.currencyLabel')}
                            name="currency"
                            control={form.control}
                            options={CURRENCY_OPTIONS}
                            required
                        />
                    </div>
                </div>
            </form>
        </Form>
    );

    const dialogContent = (
        <div className="flex flex-col overflow-hidden">
            {successResult ? (
                <SuccessView
                    result={successResult}
                    userName={userName}
                    isEditing={isEditing}
                    onClose={handleClose}
                />
            ) : step === 'review' && resolvedValues ? (
                <>
                    <ReviewStep
                        resolvedValues={resolvedValues}
                        overrides={overrides}
                        reviewDates={reviewDates}
                        previewHtml={previewHtml}
                        previewLoading={previewLoading}
                        previewError={previewError}
                        onOverrideChange={(key, value) =>
                            setOverrides((prev) => ({ ...prev, [key]: value }))
                        }
                        onDateChange={(key, value) =>
                            setReviewDates((prev) => ({ ...prev, [key]: value }))
                        }
                        onRetry={() => void runPreview(false)}
                    />
                    <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4">
                        <MyButton buttonType="secondary" scale="medium" onClick={() => setStep('items')}>
                            <CaretLeft className="mr-1 size-4" />
                            {t('manageStudentsCreateInvoiceDialog:actions.back')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={handleCreate}
                            loadingText={
                                isEditing
                                    ? t('manageStudentsCreateInvoiceDialog:actions.saving')
                                    : t('manageStudentsCreateInvoiceDialog:actions.creating')
                            }
                        >
                            {isEditing
                                ? t('manageStudentsCreateInvoiceDialog:actions.saveChanges')
                                : t('manageStudentsCreateInvoiceDialog:actions.createInvoice')}
                        </MyButton>
                    </div>
                </>
            ) : (
                <>
                    {itemsContent}
                    <div className="flex items-center justify-end gap-3 border-t border-neutral-200 px-6 py-4">
                        <MyButton buttonType="secondary" scale="medium" onClick={handleClose}>
                            {t('manageStudentsCreateInvoiceDialog:actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={handleNext}
                            loadingText={t('manageStudentsCreateInvoiceDialog:actions.loadingPreview')}
                        >
                            {t('manageStudentsCreateInvoiceDialog:actions.next')}
                        </MyButton>
                    </div>
                </>
            )}
        </div>
    );

    const heading = successResult
        ? t('manageStudentsCreateInvoiceDialog:heading.invoice', { userName })
        : step === 'review'
          ? t('manageStudentsCreateInvoiceDialog:heading.reviewInvoice', { userName })
          : isEditing
            ? t('manageStudentsCreateInvoiceDialog:heading.editInvoice', {
                  invoiceNumber: editInvoice?.invoice_number ?? '',
                  userName,
              })
            : t('manageStudentsCreateInvoiceDialog:heading.createInvoice', { userName });

    return (
        <MyDialog
            open={open}
            onOpenChange={(o) => {
                if (!o) handleClose();
                else onOpenChange(true);
            }}
            heading={heading}
            // Review step needs room for the side-by-side edit + preview panes.
            dialogWidth={step === 'review' && !successResult ? 'max-w-6xl' : 'max-w-3xl'}
            content={dialogContent}
        />
    );
}
