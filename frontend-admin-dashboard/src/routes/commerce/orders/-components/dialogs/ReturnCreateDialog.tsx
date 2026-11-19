import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Switch } from '@/components/ui/switch';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { useLocations } from '@/routes/commerce/-shared/commerce-hooks';
import { itemLines } from '@/routes/commerce/orders/-shared/order-actions';
import { createReturn, previewReturn } from '@/routes/commerce/orders/-shared/order-api';
import { lengthProblemText, unitWord } from '@/routes/commerce/-shared/units';
import { returnRequestLines, typedQuantity } from '@/routes/commerce/orders/-shared/length-entry';
import { formatQuantity } from '@/routes/commerce/orders/-shared/order-format';
import { owesOnCredit, previewSplit, receiptDue } from '@/routes/commerce/orders/-shared/refund-cap';
import {
    RETURN_REASONS,
    RETURN_VIA,
    type ReturnCreateBody,
    type ReturnPreview,
    type ReturnView,
} from '@/routes/commerce/orders/-shared/order-types';
import { DialogButtons, Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass, money } from '../order-ui';
import type { OrderDialogProps } from './dialog-types';
import { useAnswerWrite } from './use-answer-write';

export const PREVIEW_DELAY_MS = 400;
export const RETURN_WARNINGS = ['OUTSIDE_WINDOW', 'COLLECTION_NO_RETURNS', 'REASON_NOT_ALLOWED', 'PHOTO_MISSING'] as const;
export const RETURN_SHIPPING_PAID_BY = ['SELLER', 'BUYER'] as const;

/**
 * Create return (contract §5.7.1, manager): pick lines and quantities, the
 * reason and how the customer asked. Every change is previewed (debounced): the
 * policy, its warnings, what each line can still return and an estimate of the
 * credit. A warning needs a reason to go ahead anyway. No photos (owner Q11).
 *
 * A staff order left on credit may be returned before it is paid (contract
 * §15): the dialog says what is still owed and that the credit first lowers
 * it, and splits the estimate into "off what is owed" and "paid back".
 */
export function ReturnCreateDialog({ open, onOpenChange, detail }: OrderDialogProps) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const access = useCommerceAccess();
    const stockOn = access.isFeatureOn(COMMERCE_FEATURE.STOCK);
    const locations = useLocations(open && stockOn && access.isManager);
    const order = detail.order;
    const lines = useMemo(
        () => itemLines(detail).filter((line) => line.qty_shipped - line.qty_returned > 0),
        [detail]
    );

    /** Typed quantities, in display units, per order line. */
    const [quantities, setQuantities] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('');
    const [via, setVia] = useState<string>('PHONE');
    const [reasonNote, setReasonNote] = useState('');
    const [override, setOverride] = useState('');
    const [forceOverride, setForceOverride] = useState(false);
    const [approveNow, setApproveNow] = useState(true);
    const [locationId, setLocationId] = useState(detail.fulfilment_location_id ?? '');
    const [preview, setPreview] = useState<ReturnPreview | null>(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const [touched, setTouched] = useState(false);

    const write = useAnswerWrite((body: ReturnCreateBody) => createReturn(body), {
        open,
        onOpenChange,
        currency: order.currency,
        prefix: 'ret',
    });

    useEffect(() => {
        if (!open) return;
        setQuantities({});
        setReason('');
        setVia('PHONE');
        setReasonNote('');
        setOverride('');
        setForceOverride(false);
        setApproveNow(true);
        setLocationId(detail.fulfilment_location_id ?? '');
        setPreview(null);
        setPreviewFailed(false);
        setTouched(false);
        // Fresh on every opening.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Typed in metres for measured lines; a refused box ("1.25" at scale 10) sends nothing.
    const requested = useMemo(() => returnRequestLines(lines, quantities), [lines, quantities]);

    // Preview every change, 400 ms after the last one.
    const previewKey = JSON.stringify({ requested, reason, via });
    useEffect(() => {
        if (!open || !reason || requested.length === 0) return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            previewReturn({ order_id: order.id, reason, requested_via: via, lines: requested })
                .then((answer) => {
                    if (cancelled) return;
                    setPreview(answer);
                    setPreviewFailed(false);
                })
                .catch(() => {
                    if (!cancelled) setPreviewFailed(true);
                });
        }, PREVIEW_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
        // previewKey holds the body.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, previewKey, order.id]);

    const returnableOf = (lineId: string, fallback: number): number => {
        const found = preview?.lines.find((line) => line.order_line_id === lineId);
        return found ? found.returnable_quantity : fallback;
    };

    /** The sentence of a refused box: extra decimals, not a number, or more than can come back. */
    const lineProblemOf = (line: (typeof lines)[number]): string | null => {
        const typed = typedQuantity(quantities[line.id], line.qty_scale);
        if ('problem' in typed) return lengthProblemText(typed.problem, line.qty_scale, t);
        return typed.stored > returnableOf(line.id, line.qty_shipped - line.qty_returned) ? t('orders.returns.tooMany') : null;
    };
    const lineProblems = lines.filter((line) => lineProblemOf(line) !== null);
    const warnings = preview?.warnings ?? [];
    const needsOverride = warnings.length > 0 || forceOverride;
    const overrideError = needsOverride && !override.trim() ? t('orders.dialogs.reasonRequired') : null;
    const reasonError = !reason ? t('orders.returns.reasonRequired') : null;
    const linesError = requested.length === 0 ? t('orders.returns.linesRequired') : null;
    const invalid = !!(reasonError || linesError || overrideError || lineProblems.length > 0);

    const owing = owesOnCredit(detail);
    const due = receiptDue(detail);
    const split = previewSplit(preview, owing, due);

    const policyText = preview?.policy?.policy_text[language] ?? preview?.policy?.policy_text[language === 'hi' ? 'en' : 'hi'];
    const activeLocations = (locations.data ?? []).filter(
        (location) => (location.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE'
    );

    const submit = async () => {
        setTouched(true);
        if (invalid) return;
        const answer: ReturnView | null = await write.submit({
            order_id: order.id,
            ...(stockOn && locationId ? { location_id: locationId } : {}),
            reason,
            ...(reasonNote.trim() ? { reason_note: reasonNote.trim() } : {}),
            requested_via: via,
            lines: requested,
            ...(needsOverride && override.trim() ? { override_reason: override.trim() } : {}),
            approve_now: approveNow,
        });
        if (answer) {
            toast.success(t('orders.returns.created', { number: answer.return_number ?? '' }));
            write.close();
        }
    };

    // A 409 policy warning the preview had not shown: ask for the reason now.
    useEffect(() => {
        if (write.error?.code === 'RETURN_POLICY_WARNING') setForceOverride(true);
    }, [write.error]);

    return (
        <MyDialog
            heading={t('orders.actions.CREATE_RETURN')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <DialogButtons onCancel={() => onOpenChange(false)}>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        // W5: a refused length box (or more than can come back) stops the return at once.
                        disable={lines.length === 0 || lineProblems.length > 0 ? true : undefined}
                        onAsyncClick={submit}
                        data-testid="return-create-submit"
                    >
                        {t('orders.actions.CREATE_RETURN')}
                    </MyButton>
                </DialogButtons>
            }
        >
            <div className="flex flex-col gap-4">
                {owing && (
                    <OrderNotice tone="info">
                        <p data-testid="return-before-payment">
                            {t('orders.returns.beforePayment', { amount: money(due, order.currency) })}
                        </p>
                    </OrderNotice>
                )}
                {lines.length === 0 && <OrderNotice tone="info">{t('orders.returns.nothingShipped')}</OrderNotice>}
                {lines.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {lines.map((line) => {
                            const left = returnableOf(line.id, line.qty_shipped - line.qty_returned);
                            const bad = lineProblems.includes(line);
                            return (
                                <li key={line.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 flex-col">
                                        <span className="text-body font-medium text-foreground">
                                            {line.name ?? line.sku ?? '—'}
                                            {line.variant_label ? ` · ${line.variant_label}` : ''}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {t('orders.returns.returnable', {
                                                quantity: formatQuantity(left, line.qty_scale, line.unit, t),
                                            })}
                                        </span>
                                    </div>
                                    <div className="flex flex-col gap-1 sm:w-32">
                                        {line.qty_scale > 1 && (
                                            <span className="text-caption text-muted-foreground">
                                                {t('orders.units.lengthLabel', { unit: unitWord(line.unit, t) ?? '' })}
                                            </span>
                                        )}
                                        <input
                                            inputMode={line.qty_scale > 1 ? 'decimal' : 'numeric'}
                                            aria-label={t('orders.returns.quantityFor', { name: line.name ?? line.sku ?? '' })}
                                            aria-invalid={bad || undefined}
                                            className={inputClass}
                                            value={quantities[line.id] ?? ''}
                                            onChange={(event) =>
                                                setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                                            }
                                        />
                                        {bad && (
                                            <p role="alert" className="text-caption text-danger-600">
                                                {lineProblemOf(line)}
                                            </p>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {touched && linesError && <p role="alert" className="text-caption text-danger-600">{linesError}</p>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <PlainSelect
                            label={t('orders.returns.reason')}
                            value={reason}
                            onChange={setReason}
                            placeholder={t('orders.returns.choose')}
                            invalid={touched && !!reasonError}
                            options={RETURN_REASONS.map((value) => ({
                                value,
                                label: t(`orders.returns.reasons.${value}`),
                            }))}
                        />
                        {touched && reasonError && (
                            <p role="alert" className="text-caption text-danger-600">
                                {reasonError}
                            </p>
                        )}
                    </div>
                    <PlainSelect
                        label={t('orders.returns.requestedVia')}
                        value={via}
                        onChange={(next) => setVia(next || 'PHONE')}
                        options={RETURN_VIA.map((value) => ({ value, label: t(`orders.returns.via.${value}`) }))}
                    />
                </div>
                <TextAreaField
                    id="return-reason-note"
                    label={t('orders.returns.reasonNote')}
                    value={reasonNote}
                    onChange={setReasonNote}
                    maxLength={500}
                />

                {preview?.policy && (
                    <section className="flex flex-col gap-1 rounded-lg border border-border bg-muted p-3 text-caption text-foreground">
                        <span className="text-body font-medium">{t('orders.returns.policy.title')}</span>
                        {preview.policy.window_days !== null && (
                            <span>{t('orders.returns.policy.window', { days: preview.policy.window_days })}</span>
                        )}
                        {preview.policy.days_since_delivery !== null && (
                            <span>
                                {t('orders.returns.policy.sinceDelivery', { days: preview.policy.days_since_delivery })}
                            </span>
                        )}
                        {preview.policy.allowed_reasons.length > 0 && (
                            <span>
                                {t('orders.returns.policy.allowedReasons', {
                                    reasons: preview.policy.allowed_reasons
                                        .map((value) => t(`orders.returns.reasons.${value}`, { defaultValue: value }))
                                        .join(', '),
                                })}
                            </span>
                        )}
                        {preview.policy.photo_required && <span>{t('orders.returns.policy.photoRequired')}</span>}
                        {preview.policy.return_shipping_paid_by && (
                            <span>
                                {t(
                                    preview.policy.return_shipping_paid_by === 'BUYER'
                                        ? 'orders.returns.policy.paidByBuyer'
                                        : 'orders.returns.policy.paidBySeller'
                                )}
                            </span>
                        )}
                        {policyText && <p className="whitespace-pre-line text-muted-foreground">{policyText}</p>}
                    </section>
                )}
                {warnings.length > 0 && (
                    <OrderNotice tone="warning">
                        <ul className="flex flex-col gap-0.5">
                            {warnings.map((warning) => (
                                <li key={warning}>
                                    {t(`orders.returns.warnings.${warning}`, { defaultValue: warning })}
                                </li>
                            ))}
                        </ul>
                    </OrderNotice>
                )}
                {preview && preview.credit_estimate !== null && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                        <div className="flex flex-col">
                            <span className="text-body text-foreground">{t('orders.returns.creditEstimate')}</span>
                            <span className="text-caption text-muted-foreground">{t('orders.returns.estimateNote')}</span>
                        </div>
                        <MoneyCell value={preview.credit_estimate} currency={order.currency} />
                    </div>
                )}
                {split && (
                    <dl className="flex flex-col gap-1 rounded-lg border border-border p-3 text-caption" data-testid="return-credit-split">
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">{t('orders.returns.offDue')}</dt>
                            <dd>
                                <MoneyCell value={split.offDue} currency={order.currency} />
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <dt className="text-muted-foreground">{t('orders.returns.paidBack')}</dt>
                            <dd>
                                <MoneyCell value={split.paidBack} currency={order.currency} />
                            </dd>
                        </div>
                    </dl>
                )}
                {previewFailed && <p className="text-caption text-muted-foreground">{t('orders.returns.previewFailed')}</p>}
                {needsOverride && (
                    <TextAreaField
                        id="return-override"
                        label={t('orders.returns.override')}
                        value={override}
                        onChange={setOverride}
                        required
                        maxLength={500}
                        error={touched ? overrideError : null}
                    />
                )}

                <label className="flex items-center justify-between gap-3 text-body text-foreground">
                    <span>{t('orders.returns.approveNow')}</span>
                    <Switch checked={approveNow} onCheckedChange={setApproveNow} aria-label={t('orders.returns.approveNow')} />
                </label>
                {stockOn && activeLocations.length > 0 && (
                    <Field label={t('orders.returns.restockLocation')}>
                        <PlainSelect
                            label={t('orders.returns.restockLocation')}
                            hideLabel
                            value={locationId}
                            onChange={setLocationId}
                            options={activeLocations.map((location) => ({ value: location.id, label: location.name }))}
                        />
                    </Field>
                )}
                <OrderErrorAlert error={write.error} currency={order.currency} />
            </div>
        </MyDialog>
    );
}
