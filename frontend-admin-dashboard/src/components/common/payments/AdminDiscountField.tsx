import { useEffect, useRef, useState } from 'react';
import { CircleNotch, Tag, WarningCircle } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import {
    extractAdminDiscountError,
    getAdminDiscountValidationError,
    previewAdminDiscount,
    type AdminDiscountMode,
    type AdminDiscountPreview,
    type AdminDiscountRequest,
} from '@/services/admin-discounts';

/** Empty value — "No discount". */
export const EMPTY_ADMIN_DISCOUNT: AdminDiscountRequest = { mode: 'NONE' };

type CyclesChoice = 'FIRST' | 'FIRST_N' | 'EVERY';

const cyclesChoiceFrom = (cycles: number | null | undefined): CyclesChoice => {
    if (cycles == null) return 'EVERY';
    return cycles === 1 ? 'FIRST' : 'FIRST_N';
};

export interface AdminDiscountFieldProps {
    value: AdminDiscountRequest;
    onChange: (value: AdminDiscountRequest) => void;
    /** Plan the discount applies to — the server prices from it when `grossAmount` is absent. */
    paymentPlanId?: string | null;
    /** Explicit price to discount (e.g. an invoice subtotal). Takes precedence over the plan. */
    grossAmount?: number | null;
    /** Shows the "Applies to" (billing cycles) control. */
    isSubscription?: boolean;
    currency?: string | null;
    packageSessionId?: string | null;
    enrollInviteId?: string | null;
    learnerEmail?: string | null;
    instituteId?: string | null;
    /** Fires with the latest successful preview, or null when there is none / it failed. */
    onPreview?: (preview: AdminDiscountPreview | null) => void;
    /**
     * Fires with the server's rejection (e.g. an invalid or expired coupon), or null once
     * the discount is valid / cleared. Lets the parent block Next/Preview — the field's
     * own checks only cover completeness.
     */
    onServerErrorChange?: (error: string | null) => void;
    /** Hide the billing-cycles control even for subscriptions (invoices). */
    hideCycles?: boolean;
    /** Offer the "Coupon code" mode. Default true. */
    allowCoupon?: boolean;
    /** Skip the live price preview (e.g. a pending grant with no plan to price against). */
    disablePreview?: boolean;
    disabled?: boolean;
    className?: string;
    label?: string;
}

const MODE_OPTIONS: { value: AdminDiscountMode; label: string }[] = [
    { value: 'NONE', label: 'No discount' },
    { value: 'PERCENTAGE', label: 'Percentage' },
    { value: 'FLAT', label: 'Flat amount' },
    { value: 'COUPON', label: 'Coupon code' },
];

const toNumberOrUndefined = (raw: string): number | undefined => {
    if (raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
};

/**
 * Admin-granted discount picker used by manual enroll, bulk assign, admin invoices and the
 * learner "Grant discount" dialog. Callers decide whether to render it at all — admin
 * discounts only apply to ONE_TIME and SUBSCRIPTION plans (never FREE / DONATION / CPO).
 */
export const AdminDiscountField = ({
    value,
    onChange,
    paymentPlanId,
    grossAmount,
    isSubscription = false,
    currency,
    packageSessionId,
    enrollInviteId,
    learnerEmail,
    instituteId,
    onPreview,
    onServerErrorChange,
    hideCycles = false,
    allowCoupon = true,
    disablePreview = false,
    disabled = false,
    className,
    label = 'Discount',
}: AdminDiscountFieldProps) => {
    const mode = value?.mode ?? 'NONE';
    const showCycles = isSubscription && !hideCycles && (mode === 'PERCENTAGE' || mode === 'FLAT');
    const currencyCode = (currency || 'INR').toUpperCase();

    // Raw text buffers so number inputs can be cleared/retyped without snapping to 0.
    const [valueText, setValueText] = useState(
        value?.discount_value != null ? String(value.discount_value) : ''
    );
    const [capText, setCapText] = useState(
        value?.max_discount_value != null ? String(value.max_discount_value) : ''
    );
    const [cyclesChoice, setCyclesChoice] = useState<CyclesChoice>(
        cyclesChoiceFrom(value?.apply_for_cycles)
    );
    const [cyclesText, setCyclesText] = useState(
        value?.apply_for_cycles != null && value.apply_for_cycles > 1
            ? String(value.apply_for_cycles)
            : '2'
    );

    // Re-sync the buffers when the parent resets the value (e.g. dialog reopened).
    useEffect(() => {
        if (!value || value.mode === 'NONE') {
            setValueText('');
            setCapText('');
            setCyclesChoice('FIRST');
            setCyclesText('2');
        }
    }, [value?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const [preview, setPreview] = useState<AdminDiscountPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const onPreviewRef = useRef(onPreview);
    onPreviewRef.current = onPreview;
    const onServerErrorRef = useRef(onServerErrorChange);
    onServerErrorRef.current = onServerErrorChange;
    useEffect(() => {
        onServerErrorRef.current?.(previewError);
    }, [previewError]);
    const requestSeq = useRef(0);

    const update = (patch: Partial<AdminDiscountRequest>) => onChange({ ...value, ...patch });

    const setMode = (next: AdminDiscountMode) => {
        if (disabled) return;
        if (next === 'NONE') {
            onChange({ mode: 'NONE' });
            return;
        }
        if (next === 'COUPON') {
            onChange({ mode: 'COUPON', coupon_code: value.coupon_code ?? '' });
            return;
        }
        // Subscriptions default to "first payment only" — an every-cycle discount is the
        // costlier choice and should be picked deliberately.
        const cycles =
            isSubscription && !hideCycles
                ? value.mode === 'PERCENTAGE' || value.mode === 'FLAT'
                    ? value.apply_for_cycles ?? null
                    : 1
                : undefined;
        if (cycles !== undefined) setCyclesChoice(cyclesChoiceFrom(cycles));
        onChange({
            mode: next,
            discount_value: toNumberOrUndefined(valueText),
            max_discount_value: next === 'PERCENTAGE' ? toNumberOrUndefined(capText) : undefined,
            reason: value.reason ?? '',
            apply_for_cycles: cycles,
        });
    };

    const setCycles = (choice: CyclesChoice, nText = cyclesText) => {
        setCyclesChoice(choice);
        if (choice === 'EVERY') update({ apply_for_cycles: null });
        else if (choice === 'FIRST') update({ apply_for_cycles: 1 });
        else {
            const n = parseInt(nText, 10);
            update({ apply_for_cycles: Number.isFinite(n) && n >= 1 ? n : undefined });
        }
    };

    const clientError = getAdminDiscountValidationError(
        // The reason is not needed to price the discount, so it doesn't block the preview.
        value && value.mode !== 'NONE' && value.mode !== 'COUPON'
            ? { ...value, reason: value.reason?.trim() ? value.reason : 'x' }
            : value,
        grossAmount
    );
    const canPrice = !!paymentPlanId || (grossAmount != null && grossAmount > 0);

    // Debounced server preview: gross − discount = net, plus coupon validation errors.
    useEffect(() => {
        if (disablePreview || mode === 'NONE' || clientError || !canPrice) {
            setPreview(null);
            setPreviewError(null);
            setPreviewLoading(false);
            onPreviewRef.current?.(null);
            return;
        }
        const seq = ++requestSeq.current;
        setPreviewLoading(true);
        const timer = setTimeout(async () => {
            try {
                const res = await previewAdminDiscount(
                    {
                        discount: {
                            ...value,
                            coupon_code: value.coupon_code?.trim() || undefined,
                        },
                        payment_plan_id: paymentPlanId || undefined,
                        gross_amount: grossAmount ?? undefined,
                        package_session_id: packageSessionId || undefined,
                        enroll_invite_id: enrollInviteId || undefined,
                        learner_email: learnerEmail || undefined,
                    },
                    instituteId
                );
                if (seq !== requestSeq.current) return;
                setPreview(res);
                setPreviewError(null);
                onPreviewRef.current?.(res);
            } catch (err) {
                if (seq !== requestSeq.current) return;
                setPreview(null);
                setPreviewError(extractAdminDiscountError(err, 'Could not apply this discount'));
                onPreviewRef.current?.(null);
            } finally {
                if (seq === requestSeq.current) setPreviewLoading(false);
            }
        }, 450);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        disablePreview,
        mode,
        value?.discount_value,
        value?.max_discount_value,
        value?.coupon_code,
        clientError,
        canPrice,
        paymentPlanId,
        grossAmount,
        packageSessionId,
        enrollInviteId,
        learnerEmail,
        instituteId,
    ]);

    const modes = MODE_OPTIONS.filter((m) => allowCoupon || m.value !== 'COUPON');
    const fullError = getAdminDiscountValidationError(value, grossAmount);
    const reasonMissing =
        (mode === 'PERCENTAGE' || mode === 'FLAT') && !value.reason?.trim();

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            <div className="flex items-center gap-1.5">
                <Tag className="size-4 text-primary-500" weight="duotone" />
                <Label className="text-sm font-semibold text-neutral-700">{label}</Label>
            </div>

            {/* Mode selector — segmented buttons avoid a Select popover fighting dialog z-index. */}
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
                {modes.map((m) => (
                    <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={mode === m.value}
                        disabled={disabled}
                        onClick={() => setMode(m.value)}
                        className={cn(
                            'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                            mode === m.value
                                ? 'border-primary-400 bg-primary-50 text-primary-700'
                                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        )}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {(mode === 'PERCENTAGE' || mode === 'FLAT') && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="flex-1">
                            <Label className="mb-1 text-xs text-neutral-500">
                                {mode === 'PERCENTAGE'
                                    ? 'Discount (%)'
                                    : `Discount amount (${currencyCode})`}{' '}
                                <span className="text-danger-500">*</span>
                            </Label>
                            <Input
                                type="number"
                                min={0}
                                max={mode === 'PERCENTAGE' ? 100 : undefined}
                                step="0.01"
                                disabled={disabled}
                                placeholder={mode === 'PERCENTAGE' ? 'e.g. 20' : 'e.g. 500'}
                                value={valueText}
                                onChange={(e) => {
                                    setValueText(e.target.value);
                                    update({ discount_value: toNumberOrUndefined(e.target.value) });
                                }}
                            />
                        </div>
                        {mode === 'PERCENTAGE' && (
                            <div className="flex-1">
                                <Label className="mb-1 text-xs text-neutral-500">
                                    Maximum discount ({currencyCode}, optional)
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    disabled={disabled}
                                    placeholder="No cap"
                                    value={capText}
                                    onChange={(e) => {
                                        setCapText(e.target.value);
                                        update({
                                            max_discount_value: toNumberOrUndefined(e.target.value),
                                        });
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {showCycles && (
                        <div>
                            <Label className="mb-1 text-xs text-neutral-500">Applies to</Label>
                            <div className="flex flex-col gap-1.5">
                                <label className="flex items-center gap-2 text-sm text-neutral-700">
                                    <input
                                        type="radio"
                                        className="accent-primary-500"
                                        checked={cyclesChoice === 'FIRST'}
                                        disabled={disabled}
                                        onChange={() => setCycles('FIRST')}
                                    />
                                    First payment only
                                </label>
                                <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
                                    <input
                                        type="radio"
                                        className="accent-primary-500"
                                        checked={cyclesChoice === 'FIRST_N'}
                                        disabled={disabled}
                                        onChange={() => setCycles('FIRST_N')}
                                    />
                                    First
                                    <Input
                                        type="number"
                                        min={1}
                                        step={1}
                                        className="h-8 w-20"
                                        disabled={disabled || cyclesChoice !== 'FIRST_N'}
                                        value={cyclesText}
                                        onChange={(e) => {
                                            setCyclesText(e.target.value);
                                            setCycles('FIRST_N', e.target.value);
                                        }}
                                    />
                                    payments
                                </label>
                                <label className="flex items-center gap-2 text-sm text-neutral-700">
                                    <input
                                        type="radio"
                                        className="accent-primary-500"
                                        checked={cyclesChoice === 'EVERY'}
                                        disabled={disabled}
                                        onChange={() => setCycles('EVERY')}
                                    />
                                    Every billing cycle
                                </label>
                            </div>
                        </div>
                    )}

                    <div>
                        <Label className="mb-1 text-xs text-neutral-500">
                            Reason (internal, not shown to the learner){' '}
                            <span className="text-danger-500">*</span>
                        </Label>
                        <Textarea
                            rows={2}
                            disabled={disabled}
                            placeholder="Why is this discount being given?"
                            value={value.reason ?? ''}
                            onChange={(e) => update({ reason: e.target.value })}
                            className="text-sm"
                        />
                    </div>
                </div>
            )}

            {mode === 'COUPON' && (
                <div>
                    <Label className="mb-1 text-xs text-neutral-500">
                        Coupon code <span className="text-danger-500">*</span>
                    </Label>
                    <Input
                        type="text"
                        disabled={disabled}
                        placeholder="Enter an existing coupon code"
                        value={value.coupon_code ?? ''}
                        onChange={(e) => update({ coupon_code: e.target.value.toUpperCase() })}
                        className="font-mono uppercase"
                    />
                </div>
            )}

            {mode !== 'NONE' && (
                <div className="text-xs">
                    {fullError && !(reasonMissing && fullError === 'A reason is required') ? (
                        <p className="flex items-center gap-1 text-danger-600">
                            <WarningCircle className="size-3.5" /> {fullError}
                        </p>
                    ) : previewLoading ? (
                        <p className="flex items-center gap-1 text-neutral-500">
                            <CircleNotch className="size-3.5 animate-spin" /> Calculating…
                        </p>
                    ) : previewError ? (
                        <p className="flex items-center gap-1 text-danger-600">
                            <WarningCircle className="size-3.5" /> {previewError}
                        </p>
                    ) : preview ? (
                        <p className="rounded-md border border-success-200 bg-success-50 px-2.5 py-1.5 text-success-800">
                            Price {formatCurrency(preview.gross_amount, currencyCode)} − Discount{' '}
                            {formatCurrency(preview.discount_amount, currencyCode)} ={' '}
                            <span className="font-semibold">
                                {formatCurrency(preview.net_amount, currencyCode)}
                            </span>
                        </p>
                    ) : null}
                    {reasonMissing && (
                        <p className="mt-1 text-neutral-500">A reason is required to apply this discount.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default AdminDiscountField;
