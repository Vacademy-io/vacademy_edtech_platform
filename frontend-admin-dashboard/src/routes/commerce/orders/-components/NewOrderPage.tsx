import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { getInstituteId } from '@/constants/helper';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { PlainSelect, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { CommerceNoAccessCard } from '@/routes/commerce/-components/CommerceStates';
import { GST_STATE_CODES } from '@/routes/commerce/-shared/gstin';
import {
    type AddressForm,
    type NewOrderForm,
    type NewOrderProblems,
    NOTE_MAX,
    buildStaffOrderBody,
    emptyNewOrder,
    estimateTotal,
    mobileDigits,
    needsRemainderRefund,
    prefillCustomer,
    unpricedLines,
    validateNewOrder,
} from '@/routes/commerce/orders/-shared/new-order';
import { lookupCustomer } from '@/routes/commerce/orders/-shared/new-order-api';
import { exchangeableReturn } from '@/routes/commerce/orders/-shared/order-actions';
import { createStaffOrder } from '@/routes/commerce/orders/-shared/order-api';
import { type OrderError, readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { round2 } from '@/routes/commerce/orders/-shared/order-format';
import { applyDetail, useOrderDetail, useReturnView } from '@/routes/commerce/orders/-shared/order-hooks';
import { REFUND_METHODS, type RefundMethod } from '@/routes/commerce/orders/-shared/order-types';
import { useRequestId } from '@/routes/commerce/orders/-shared/request-id';
import { NewOrderLines } from './NewOrderLines';
import { NewOrderPayments } from './NewOrderPayments';
import { Field, OrderErrorAlert, OrderNotice, TextAreaField, inputClass, useOrderErrorHandler, useOrderErrorText } from './order-ui';

export interface NewOrderSearch {
    exchangeReturn?: string;
    exchangeOrder?: string;
}

/**
 * S4 New staff order (phone, WhatsApp, reseller; also an exchange for a
 * received return). Store manager and institute ADMIN only: anyone else gets
 * "no access" and the page reads nothing.
 */
export function NewOrderPage(props: NewOrderSearch) {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage
            navId="commerce-orders"
            title={t('orders.new.title')}
            description={t('orders.new.description')}
            backTo={{ to: '/commerce/orders', label: t('orders.backToDesk') }}
        >
            <NewOrderGate {...props} />
        </CommercePage>
    );
}

function NewOrderGate(props: NewOrderSearch) {
    const access = useCommerceAccess();
    if (!access.isResolved) return null;
    if (!access.isManager) return <CommerceNoAccessCard className="mt-8" />;
    return <NewOrderContent {...props} enabled={access.canOpen('commerce-orders')} />;
}

function AddressFields({
    prefix,
    value,
    onChange,
    problems,
}: {
    prefix: 'shipping' | 'billing';
    value: AddressForm;
    onChange: (next: AddressForm) => void;
    problems: NewOrderProblems;
}) {
    const { t } = useTranslation('commerce');
    const problem = (field: keyof AddressForm) => {
        const key = problems[`${prefix}.${field}`];
        return key ? t(key) : null;
    };
    const text = (field: keyof AddressForm, label: string, required: boolean, extra: { inputMode?: 'tel' | 'numeric'; maxLength?: number } = {}) => (
        <Field label={label} htmlFor={`${prefix}-${field}`} required={required} error={problem(field)}>
            <input
                id={`${prefix}-${field}`}
                value={value[field]}
                maxLength={extra.maxLength ?? 200}
                inputMode={extra.inputMode}
                aria-invalid={!!problem(field) || undefined}
                onChange={(event) => onChange({ ...value, [field]: event.target.value })}
                className={inputClass}
            />
        </Field>
    );
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {text('name', t('orders.new.address.name'), true)}
            {text('phone', t('orders.new.address.phone'), false, { inputMode: 'tel', maxLength: 16 })}
            {text('line1', t('orders.new.address.line1'), true)}
            {text('line2', t('orders.new.address.line2'), false)}
            {text('landmark', t('orders.new.address.landmark'), false)}
            {text('city', t('orders.new.address.city'), true)}
            <div className="flex flex-col gap-1.5">
                <PlainSelect
                    label={`${t('orders.new.address.state')} *`}
                    value={value.state_code}
                    onChange={(state_code) => onChange({ ...value, state_code })}
                    options={GST_STATE_CODES.map((code) => ({ value: code, label: t(`states.${code}`) }))}
                    invalid={!!problem('state_code')}
                />
                {problem('state_code') && (
                    <p role="alert" className="text-caption text-danger-600">
                        {problem('state_code')}
                    </p>
                )}
            </div>
            {text('pincode', t('orders.new.address.pincode'), true, { inputMode: 'numeric', maxLength: 6 })}
        </div>
    );
}

export function NewOrderContent({ exchangeReturn, exchangeOrder, enabled }: NewOrderSearch & { enabled: boolean }) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const handleError = useOrderErrorHandler();
    const errorText = useOrderErrorText();
    const { idFor, reset } = useRequestId('n');

    const [form, setForm] = useState<NewOrderForm>(emptyNewOrder);
    const [tried, setTried] = useState(false);
    const [formError, setFormError] = useState<OrderError | null>(null);
    const [tenderError, setTenderError] = useState<OrderError | null>(null);
    const [exchangeDropped, setExchangeDropped] = useState(false);
    const update = (patch: Partial<NewOrderForm>) => setForm((current) => ({ ...current, ...patch }));

    // Exchange: the return gives the credit, the original order the customer.
    const returnQuery = useReturnView(exchangeReturn, enabled && !!exchangeReturn);
    const originalQuery = useOrderDetail(exchangeOrder, enabled && !!exchangeOrder);
    const prefilled = useRef(false);
    useEffect(() => {
        const original = originalQuery.data;
        if (!original || prefilled.current) return;
        prefilled.current = true;
        setForm((current) =>
            prefillCustomer(current, {
                name: original.order.customer_name,
                phone: original.order.customer_phone,
                email: original.customer_email,
                address: original.shipping_address,
            })
        );
    }, [originalQuery.data]);
    useEffect(() => {
        const view = returnQuery.data;
        if (!view) return;
        if (exchangeableReturn(view)) {
            setExchangeDropped(false);
            update({
                exchange: {
                    returnId: view.id,
                    returnNumber: view.return_number,
                    credit: round2((view.due_raised ?? 0) - (view.refunded ?? 0)),
                },
            });
        } else {
            setExchangeDropped(true);
            update({ exchange: null });
        }
    }, [returnQuery.data]);

    // A known phone: say so, and fill the name only when nothing is typed.
    const digits = mobileDigits(form.phone);
    const lookup = useQuery({
        queryKey: ['commerce', getInstituteId() ?? 'none', 'new-order', 'customer', digits ?? ''],
        queryFn: () => lookupCustomer(digits as string),
        enabled: enabled && !!digits,
        staleTime: 60 * 1000,
        retry: false,
    });
    const known = lookup.data?.available ? lookup.data.customer : null;
    useEffect(() => {
        if (known?.name) setForm((current) => (current.name.trim() ? current : { ...current, name: known.name as string }));
    }, [known?.name]);

    const problems = useMemo(() => (tried ? validateNewOrder(form) : {}), [tried, form]);
    const problem = (key: string) => (problems[key] ? t(problems[key] as string) : null);
    const estimate = estimateTotal(form.lines);
    const unpriced = unpricedLines(form.lines).length;
    const remainder = needsRemainderRefund(form);

    const submit = async () => {
        setTried(true);
        setFormError(null);
        setTenderError(null);
        if (Object.keys(validateNewOrder(form)).length > 0) return;
        const body = buildStaffOrderBody(form);
        try {
            const detail = await createStaffOrder({ client_request_id: idFor(body), ...body });
            applyDetail(queryClient, detail);
            reset();
            toast.success(t('orders.new.created', { number: detail.order.order_number }));
            void navigate({ to: '/commerce/orders/$orderId', params: { orderId: detail.order.id } });
        } catch (failure) {
            const error = handleError(failure, { resetRequestId: reset });
            if (!error) return;
            if (error.code === 'TENDERS_SHORT' || error.code === 'TENDERS_OVER') setTenderError(error);
            else setFormError(error);
        }
    };

    const exchangeLoading = (!!exchangeReturn && returnQuery.isLoading) || (!!exchangeOrder && originalQuery.isLoading);
    const exchangeError = returnQuery.error ?? originalQuery.error;

    return (
        <div className="flex flex-col gap-4">
            {exchangeLoading && <OrderNotice tone="info">{t('orders.exchange.loading')}</OrderNotice>}
            {exchangeError && <OrderNotice tone="danger">{errorText(readOrderError(exchangeError))}</OrderNotice>}
            {form.exchange && (
                <OrderNotice tone="info">
                    {t('orders.exchange.banner', {
                        number: form.exchange.returnNumber ?? '',
                        amount: formatMoney(form.exchange.credit),
                    })}
                </OrderNotice>
            )}
            {exchangeDropped && <OrderNotice tone="warning">{t('orders.exchange.notAvailable')}</OrderNotice>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
                    <SectionCard title={t('orders.new.customer.title')}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Field label={t('orders.new.customer.phone')} htmlFor="new-order-phone" required error={problem('phone')}>
                                <input
                                    id="new-order-phone"
                                    type="tel"
                                    inputMode="tel"
                                    autoComplete="off"
                                    maxLength={16}
                                    value={form.phone}
                                    onChange={(event) => update({ phone: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                            <Field label={t('orders.new.customer.name')} htmlFor="new-order-name" required error={problem('name')}>
                                <input
                                    id="new-order-name"
                                    autoComplete="off"
                                    maxLength={120}
                                    value={form.name}
                                    onChange={(event) => update({ name: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                            <Field label={t('orders.new.customer.email')} htmlFor="new-order-email" error={problem('email')}>
                                <input
                                    id="new-order-email"
                                    type="email"
                                    autoComplete="off"
                                    maxLength={200}
                                    value={form.email}
                                    onChange={(event) => update({ email: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                        </div>
                        {known && (
                            <p role="status" className="text-caption text-success-600">
                                {t('orders.new.customer.known', { name: known.name ?? '', count: known.ordersCount })}
                            </p>
                        )}
                    </SectionCard>

                    <NewOrderLines
                        lines={form.lines}
                        onChange={(lines) => update({ lines })}
                        handOverNow={form.handOverNow}
                        problems={problems}
                        enabled={enabled}
                    />

                    <SectionCard title={t('orders.new.delivery.title')}>
                        <RadioGroup
                            value={form.handOverNow ? 'now' : 'ship'}
                            onValueChange={(value) => update({ handOverNow: value === 'now' })}
                            className="grid-cols-1 sm:grid-cols-2"
                        >
                            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-border p-3 text-body text-foreground">
                                <RadioGroupItem value="ship" />
                                {t('orders.new.delivery.ship')}
                            </label>
                            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-border p-3 text-body text-foreground">
                                <RadioGroupItem value="now" />
                                {t('orders.new.handOverNow')}
                            </label>
                        </RadioGroup>
                        {form.handOverNow ? (
                            <p className="text-caption text-muted-foreground">{t('orders.new.delivery.handOverHint')}</p>
                        ) : (
                            <div className="flex flex-col gap-4">
                                <AddressFields
                                    prefix="shipping"
                                    value={form.shipping}
                                    onChange={(shipping) => update({ shipping })}
                                    problems={problems}
                                />
                                <label className="flex items-center gap-2 text-body text-foreground">
                                    <Checkbox
                                        checked={form.billingSame}
                                        onCheckedChange={(checked) => update({ billingSame: checked === true })}
                                    />
                                    {t('orders.new.delivery.billingSame')}
                                </label>
                                {!form.billingSame && (
                                    <div className="flex flex-col gap-2">
                                        <p className="text-body font-medium text-foreground">{t('orders.new.delivery.billing')}</p>
                                        <AddressFields
                                            prefix="billing"
                                            value={form.billing}
                                            onChange={(billing) => update({ billing })}
                                            problems={problems}
                                        />
                                    </div>
                                )}
                                <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border p-3">
                                    <span className="text-body text-foreground">{t('orders.new.delivery.chargeShipping')}</span>
                                    <Switch
                                        checked={form.chargeShipping}
                                        onCheckedChange={(on) => update({ chargeShipping: on === true })}
                                    />
                                </label>
                            </div>
                        )}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field
                                label={t('orders.new.delivery.buyerGstin')}
                                htmlFor="new-order-gstin"
                                hint={t('orders.new.delivery.buyerGstinHint')}
                                error={problem('buyerGstin')}
                            >
                                <input
                                    id="new-order-gstin"
                                    maxLength={15}
                                    autoComplete="off"
                                    value={form.buyerGstin}
                                    onChange={(event) => update({ buyerGstin: event.target.value.toUpperCase() })}
                                    className={inputClass}
                                />
                            </Field>
                            <Field label={t('orders.new.delivery.coupon')} htmlFor="new-order-coupon">
                                <input
                                    id="new-order-coupon"
                                    maxLength={64}
                                    autoComplete="off"
                                    value={form.couponCode}
                                    onChange={(event) => update({ couponCode: event.target.value })}
                                    className={inputClass}
                                />
                            </Field>
                        </div>
                        <TextAreaField
                            id="new-order-note"
                            label={t('orders.new.delivery.note')}
                            value={form.note}
                            maxLength={NOTE_MAX}
                            onChange={(note) => update({ note })}
                            error={problem('note')}
                        />
                    </SectionCard>

                    <NewOrderPayments
                        tenders={form.tenders}
                        onChange={(tenders) => update({ tenders })}
                        restOnCredit={form.restOnCredit}
                        onRestOnCredit={(restOnCredit) => update({ restOnCredit })}
                        problems={problems}
                        tenderError={tenderError}
                    />
                </div>

                <div className="flex flex-col gap-4">
                    <SectionCard title={t('orders.new.summary.title')} className="lg:sticky lg:top-4">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-body text-muted-foreground">{t('orders.new.summary.estimate')}</span>
                            <span className="text-title tabular-nums text-foreground">{formatMoney(estimate)}</span>
                        </div>
                        <p className="text-caption text-muted-foreground">{t('orders.new.estimate')}</p>
                        {unpriced > 0 && (
                            <p className="text-caption text-warning-600">{t('orders.new.summary.unpriced', { count: unpriced })}</p>
                        )}
                        {form.exchange && (
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-body text-muted-foreground">{t('orders.exchange.credit')}</span>
                                <span className="text-body tabular-nums text-foreground">{formatMoney(form.exchange.credit)}</span>
                            </div>
                        )}
                        {remainder && form.exchange && (
                            <div className="flex flex-col gap-2">
                                <p className="text-caption text-foreground">
                                    {t('orders.exchange.remainder', {
                                        amount: formatMoney(round2(form.exchange.credit - estimate)),
                                    })}
                                </p>
                                <PlainSelect
                                    label={`${t('orders.exchange.remainderMethod')} *`}
                                    value={form.remainderMethod}
                                    onChange={(value) => update({ remainderMethod: value as RefundMethod | '' })}
                                    options={REFUND_METHODS.map((method) => ({
                                        value: method,
                                        label: t(`orders.refund.methods.${method}`),
                                    }))}
                                    invalid={!!problems.remainderMethod}
                                />
                                {problems.remainderMethod && (
                                    <p role="alert" className="text-caption text-danger-600">
                                        {problem('remainderMethod')}
                                    </p>
                                )}
                                <Field label={t('orders.exchange.remainderReference')} htmlFor="new-order-remainder-ref">
                                    <input
                                        id="new-order-remainder-ref"
                                        maxLength={100}
                                        value={form.remainderReference}
                                        onChange={(event) => update({ remainderReference: event.target.value })}
                                        className={inputClass}
                                    />
                                </Field>
                            </div>
                        )}
                        {tried && Object.keys(problems).length > 0 && (
                            <OrderNotice tone="danger">{t('orders.new.problems.fix')}</OrderNotice>
                        )}
                        <OrderErrorAlert error={formError} />
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="w-full"
                            disable={exchangeLoading}
                            onAsyncClick={submit}
                            loadingText={t('common.saving')}
                        >
                            {t('orders.new.create')}
                        </MyButton>
                    </SectionCard>
                </div>
            </div>
        </div>
    );
}
