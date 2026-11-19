/**
 * Pieces the buying pages share (checkout, order, track order, account): the shop's checkout
 * settings, the shopper session, the bot check, form fields and the order body.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { CommerceApiError } from '../api/client';
import type { CheckoutConfig, OrderView, OtpVerified } from '../api/types';
import type { MessageKey } from '../i18n';
import { TIMELINE_STEPS, stateName, timelineIndex } from '../logic/checkout';
import { formatDate } from '../logic/dates';
import { formatMoney, quantityText } from '../logic/format';
import { challengeToken } from '../logic/turnstile';
import {
    browserLocalStorage,
    clearSession,
    onSessionChange,
    readSession,
    saveSession,
    sessionKey,
    type ShopperSession,
} from '../state/session';
import { shouldRetry } from './primitives';
import { useCommerceSite } from './site';

/* ── settings ─────────────────────────────────────────────────────── */

/** GET /checkout/config, kept for the 60 seconds the server allows. */
export const useCheckoutConfig = () => {
    const { client, instituteId } = useCommerceSite();
    return useQuery({
        queryKey: ['commerce', instituteId, 'checkout-config'],
        queryFn: ({ signal }) => client.getCheckoutConfig(signal),
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
    });
};

export const codeLengthOf = (config: CheckoutConfig | undefined): number => {
    const n = Number(config?.otp?.code_length);
    return Number.isInteger(n) && n >= 4 && n <= 8 ? n : 6;
};

/* ── shopper session ──────────────────────────────────────────────── */

/** The stored session of this shop, kept in step with other tabs and with sign-out. */
export const useShopperSession = () => {
    const { instituteId } = useCommerceSite();
    const [session, setSession] = useState<ShopperSession | null>(() => readSession(instituteId));
    useEffect(() => {
        const reread = () => setSession(readSession(instituteId));
        reread();
        const off = onSessionChange(reread);
        const onStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === sessionKey(instituteId)) reread();
        };
        window.addEventListener('storage', onStorage);
        // Expiry: read again when the token runs out while the page is open.
        const current = readSession(instituteId);
        const timer = current ? window.setTimeout(reread, Math.min(current.expiresAt - Date.now() + 50, 2 ** 31 - 1)) : 0;
        return () => {
            off();
            window.removeEventListener('storage', onStorage);
            window.clearTimeout(timer);
        };
    }, [instituteId]);
    const save = useCallback((verified: OtpVerified) => saveSession(instituteId, verified, browserLocalStorage()), [instituteId]);
    const clear = useCallback(() => clearSession(instituteId), [instituteId]);
    return { session, save, clear };
};

/* ── bot check ────────────────────────────────────────────────────── */

export class CheckoutUnavailableError extends Error {
    constructor() {
        super('checkout unavailable');
        this.name = 'CheckoutUnavailableError';
    }
}

/**
 * A fresh Turnstile token per call when the shop has the check on, null when it is off. The
 * hidden host box must be rendered by the caller (`host`).
 */
export const useChallenge = (config: CheckoutConfig | undefined) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const required = !!config?.bot_check?.required;
    const siteKey = config?.bot_check?.site_key || '';
    const get = useCallback(async (): Promise<string | null> => {
        if (!required) return null;
        if (!siteKey || !hostRef.current) throw new CheckoutUnavailableError();
        return challengeToken(siteKey, hostRef.current);
    }, [required, siteKey]);
    const host = <div ref={hostRef} className="cmx-challenge" aria-hidden={required ? undefined : true} />;
    return { get, host, unavailable: required && !siteKey };
};

/* ── fields ───────────────────────────────────────────────────────── */

export const FIELD_ERROR_KEYS: Record<string, MessageKey> = {
    required: 'form.error.required',
    phone: 'form.error.phone',
    email: 'form.error.email',
    pincode: 'form.error.pincode',
    gstin: 'form.error.gstin',
    short: 'form.error.short',
};

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
    label: string;
    hint?: string | null;
    error?: string | null;
    /** Something drawn inside the box before the input ("+91"). */
    prefix?: string;
    /** Something after the input (a "Change" button). */
    after?: React.ReactNode;
    fieldRef?: React.Ref<HTMLInputElement>;
    optionalText?: string | null;
}

/** A labelled 52 px field with its hint and error tied to it (aria-describedby). */
export const Field: React.FC<FieldProps> = ({ label, hint, error, prefix, after, fieldRef, optionalText, className, ...input }) => {
    const id = useId();
    const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
    return (
        <div className={cn('cmx-field', className)}>
            <label htmlFor={id} className="cmx-field__label">
                {label}
                {optionalText && <span className="cmx-muted"> ({optionalText})</span>}
            </label>
            <div className={cn('cmx-field__box', !!error && 'cmx-field__box--bad')}>
                {prefix && (
                    <span className="cmx-field__prefix" aria-hidden="true">
                        {prefix}
                    </span>
                )}
                <input
                    id={id}
                    ref={fieldRef}
                    className="cmx-field__input"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    {...input}
                />
                {after}
            </div>
            {hint && !error && (
                <p id={`${id}-hint`} className="cmx-field__hint">
                    {hint}
                </p>
            )}
            {error && (
                <p id={`${id}-error`} className="cmx-field__error" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
};

/** A collapsed section ("GST details", "Gift note"): a native disclosure, keyboard and reader friendly. */
export const Collapsible: React.FC<{ summary: string; open?: boolean; children: React.ReactNode }> = ({ summary, open, children }) => (
    <details className="cmx-acc cmx-buy-acc" open={open}>
        <summary>
            <span>{summary}</span>
            <span className="cmx-caret" aria-hidden="true">
                ▾
            </span>
        </summary>
        <div className="cmx-acc__body flex flex-col gap-3">{children}</div>
    </details>
);

/** A message for a refused call, in the shopper's language. */
export const apiErrorKey = (error: unknown): MessageKey => {
    if (error instanceof CommerceApiError) {
        if (error.kind === 'network') return 'error.network';
        if (error.kind === 'rate_limited') return 'error.rateLimited';
        if (error.status === 503) return 'buy.error.later';
    }
    return 'error.generic';
};

/* ── the order body (order page, track order) ─────────────────────── */

const STATUS_KEYS: Record<string, MessageKey> = {
    PENDING_PAYMENT: 'order.status.PENDING_PAYMENT',
    COD_PENDING_CONFIRMATION: 'order.status.COD_PENDING_CONFIRMATION',
    CONFIRMED: 'order.status.CONFIRMED',
    PACKED: 'order.status.PACKED',
    SHIPPED: 'order.status.SHIPPED',
    DELIVERED: 'order.status.DELIVERED',
    CANCELLED: 'order.status.CANCELLED',
    RTO: 'order.status.RTO',
};

export const statusKey = (status: string | null | undefined): MessageKey =>
    STATUS_KEYS[(status || '').toUpperCase()] || 'order.status.other';

const STEP_KEYS: Record<(typeof TIMELINE_STEPS)[number], MessageKey> = {
    PLACED: 'order.step.PLACED',
    CONFIRMED: 'order.step.CONFIRMED',
    PACKED: 'order.step.PACKED',
    SHIPPED: 'order.step.SHIPPED',
    DELIVERED: 'order.step.DELIVERED',
};

/** Placed → confirmed → packed → shipped → delivered, with the dates the server recorded. */
export const OrderTimeline: React.FC<{ view: OrderView }> = ({ view }) => {
    const { t, locale } = useCommerceSite();
    const at = useMemo(() => {
        const out: Partial<Record<string, string>> = {};
        for (const entry of view.timeline || []) {
            if (entry.at) out[(entry.status || '').toUpperCase()] = entry.at;
        }
        return out;
    }, [view.timeline]);
    const reached = timelineIndex(view.status);
    if (reached < 0) return null;
    return (
        <ol className="cmx-timeline" aria-label={t('order.timeline')}>
            {TIMELINE_STEPS.map((step, index) => {
                const done = index <= reached;
                const when = step === 'PLACED' ? view.placed_at : at[step];
                return (
                    <li key={step} className={cn('cmx-timeline__step', done && 'cmx-timeline__step--done')} aria-current={index === reached ? 'step' : undefined}>
                        {done ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
                        <span>{t(STEP_KEYS[step])}</span>
                        {done && when && <span className="cmx-small cmx-muted">{formatDate(when, locale)}</span>}
                    </li>
                );
            })}
        </ol>
    );
};

/** Items, the totals the server stored, and where the parcel goes (city and PIN only). */
export const OrderBody: React.FC<{ view: OrderView }> = ({ view }) => {
    const { t, locale } = useCommerceSite();
    const money = (value: number | null | undefined) => formatMoney(value, view.currency);
    const totals = view.totals || {};
    const recipient = view.recipient;
    return (
        <div className="flex flex-col gap-4">
            <ul className="cmx-rows" aria-label={t('order.items')}>
                {(view.lines || []).map((line, index) => {
                    const quantity = quantityText(line.quantity, line.qty_scale, line.unit, t);
                    return (
                        <li key={line.line_ref || index} className="flex items-start justify-between gap-3 py-3">
                            <div className="min-w-0">
                                <p className="font-medium">{line.name}</p>
                                {line.variant_label && <p className="cmx-small cmx-muted">{line.variant_label}</p>}
                                <p className="cmx-small cmx-muted">{t('order.qty', { qty: quantity })}</p>
                                {!!line.qty_cancelled && <p className="cmx-small cmx-bad">{t('order.lineCancelled', { qty: quantityText(line.qty_cancelled, line.qty_scale, line.unit, t) })}</p>}
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums">{money(line.line_total)}</span>
                        </li>
                    );
                })}
            </ul>
            <dl className="cmx-totals" aria-label={t('cart.totalsLabel')}>
                {typeof totals.subtotal === 'number' && (
                    <div>
                        <dt>{t('cart.subtotal')}</dt>
                        <dd>{money(totals.subtotal)}</dd>
                    </div>
                )}
                {typeof totals.discount === 'number' && totals.discount > 0 && (
                    <div>
                        <dt>{t('cart.discount')}</dt>
                        <dd className="cmx-ok">-{money(totals.discount)}</dd>
                    </div>
                )}
                {typeof totals.shipping === 'number' && (
                    <div>
                        <dt>{t('cart.delivery')}</dt>
                        <dd>{totals.shipping > 0 ? money(totals.shipping) : t('cart.free')}</dd>
                    </div>
                )}
                {typeof totals.cod_charge === 'number' && totals.cod_charge > 0 && (
                    <div>
                        <dt>{t('checkout.codCharge')}</dt>
                        <dd>{money(totals.cod_charge)}</dd>
                    </div>
                )}
                <div className="cmx-totals__total">
                    <dt>{t('cart.total')}</dt>
                    <dd>{money(totals.total)}</dd>
                </div>
                {typeof totals.tax === 'number' && totals.tax > 0 && <p className="cmx-small cmx-muted">{t('cart.inclTax', { tax: money(totals.tax) })}</p>}
            </dl>
            {recipient && (recipient.city || recipient.pincode) && (
                <div className="cmx-small">
                    <p className="font-semibold">{t('order.deliverTo')}</p>
                    <p className="cmx-body">
                        {[recipient.name, recipient.city, stateName(recipient.state_code, locale), recipient.pincode].filter(Boolean).join(', ')}
                    </p>
                    {recipient.phone_masked && <p className="cmx-muted">{recipient.phone_masked}</p>}
                </div>
            )}
        </div>
    );
};

/** "Delivered by WhatsApp": a short helper line with the shop's number, when it has one. */
export const useSecondsLeft = (until: number | null): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!until) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [until]);
    return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
};

/** 75 -> "1:15". */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
