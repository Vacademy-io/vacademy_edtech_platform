/**
 * Track an order (contract P2 §9): order number and phone, a WhatsApp code to that phone
 * (purpose TRACK_ORDER), then the order as its buyer sees it. A wrong number and another
 * phone's order get the same answer, so the form says nothing about orders that are not yours.
 * An order placed with the phone by someone who did not prove it comes back masked: its state
 * and timeline only, as its row in the account.
 */
import React, { useState } from 'react';
import { CommerceApiError } from '../api/client';
import type { OrderView } from '../api/types';
import type { MessageKey } from '../i18n';
import { Field, OrderBody, OrderTimeline, apiErrorKey, useCheckoutConfig, useShopperSession } from './buy-common';
import { OtpStep, PhoneField } from './Otp';
import { OrderState } from './OrderPage';
import { ShopLink, useCommerceSite } from './site';

const ORDER_NUMBER = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;

export const TrackOrderPage: React.FC = () => {
    const { t, client } = useCommerceSite();
    const { session } = useShopperSession();
    const config = useCheckoutConfig().data;
    const [orderNumber, setOrderNumber] = useState('');
    const [phone, setPhone] = useState('');
    const [proof, setProof] = useState<{ token: string; phone: string; expiresAt: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<MessageKey | null>(null);
    const [view, setView] = useState<OrderView | null>(null);
    const numberOk = ORDER_NUMBER.test(orderNumber.trim());
    const fresh = !!proof && proof.phone === phone && proof.expiresAt > Date.now() + 15_000;

    const find = async (token: string) => {
        if (!numberOk) {
            setProblem('track.error.number');
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            setView(await client.trackOrder({ order_number: orderNumber.trim().toUpperCase(), phone_token: token }));
        } catch (failure) {
            setView(null);
            if (failure instanceof CommerceApiError && (failure.status === 404 || failure.code === 'not_found')) setProblem('track.notFound');
            else if (failure instanceof CommerceApiError && (failure.status === 401 || failure.status === 403)) {
                setProof(null);
                setProblem('track.codeExpired');
            } else setProblem(apiErrorKey(failure));
        } finally {
            setBusy(false);
        }
    };

    if (view) {
        return (
            <div className="cmx-shell cmx-section cmx-order">
                <p className="cmx-eyebrow">{t('order.number', { number: view.order_number })}</p>
                <h1 className="cmx-sr">{t('order.title', { number: view.order_number })}</h1>
                <OrderState view={view} thanksBody={view.masked ? null : 'order.thanksBody'} />
                <div className="cmx-order__grid">
                    <section className="cmx-panel" aria-label={t('order.items')}>
                        <OrderTimeline view={view} />
                        {view.masked ? <p className="cmx-small cmx-muted mt-3">{t('track.masked')}</p> : <OrderBody view={view} />}
                    </section>
                    <aside className="flex flex-col gap-3">
                        <button type="button" className="cmx-btn cmx-btn--outline cmx-btn--block" onClick={() => setView(null)}>
                            {t('track.another')}
                        </button>
                        <ShopLink to="account" className="cmx-btn cmx-btn--ghost cmx-btn--block">
                            {t('account.seeOrders')}
                        </ShopLink>
                    </aside>
                </div>
            </div>
        );
    }

    return (
        <div className="cmx-shell cmx-section">
            <div className="cmx-narrow flex flex-col gap-4">
                <h1 className="cmx-h1">{t('track.title')}</h1>
                <p className="cmx-body">{t('track.intro')}</p>
                {session && (
                    <p className="cmx-note">
                        <ShopLink to="account" className="cmx-link">
                            {t('track.signedIn')}
                        </ShopLink>
                    </p>
                )}
                <form
                    className="flex flex-col gap-4"
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (fresh) void find(proof!.token);
                    }}
                >
                    <Field
                        label={t('track.orderNumber')}
                        hint={t('track.orderNumberHint')}
                        autoCapitalize="characters"
                        autoComplete="off"
                        maxLength={40}
                        value={orderNumber}
                        onChange={(event) => {
                            setOrderNumber(event.target.value.replace(/\s/g, ''));
                            setProblem(null);
                        }}
                        error={problem === 'track.error.number' ? t(problem) : null}
                    />
                    <PhoneField value={phone} onChange={setPhone} hint={t('track.phoneHint')} />
                    {fresh ? (
                        <button type="submit" className="cmx-btn cmx-btn--primary cmx-btn--lg cmx-btn--block" disabled={busy} aria-busy={busy}>
                            {busy ? t('common.loading') : t('track.find')}
                        </button>
                    ) : !numberOk ? (
                        // No code is sent (a paid message) before an order number is typed.
                        <button type="button" className="cmx-btn cmx-btn--outline cmx-btn--block" disabled>
                            {t('track.sendCode')}
                        </button>
                    ) : (
                        <OtpStep
                            purpose="TRACK_ORDER"
                            phone={phone}
                            config={config}
                            recommended
                            sendLabel={t('track.sendCode')}
                            onVerified={(verified, verifiedPhone) => {
                                const token = verified.verified_phone_token;
                                setProof({ token, phone: verifiedPhone, expiresAt: Date.now() + Math.max(60, verified.expires_in || 900) * 1000 });
                                void find(token);
                            }}
                        />
                    )}
                    {problem && problem !== 'track.error.number' && (
                        <p className="cmx-note cmx-note--error" role="alert">
                            {t(problem)}
                        </p>
                    )}
                </form>
            </div>
        </div>
    );
};
