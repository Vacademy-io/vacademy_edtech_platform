/**
 * The shopper's account (contract P2 §9): signed in by phone and a WhatsApp code (purpose
 * ACCOUNT), no password and no learner account. Orders (rows of orders placed without a proved
 * phone are masked), reorder, saved addresses (at most 10), WhatsApp offers, and sign-out on
 * this device or everywhere.
 */
import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Package, PencilSimple, SignOut, Trash, WhatsappLogo } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { CommerceApiError } from '../api/client';
import type { AddressView, CheckoutAddress, OrderSummary, ShopperAuth } from '../api/types';
import type { MessageKey } from '../i18n';
import { INDIAN_STATES, isPincode, normaliseMobile, stateName } from '../logic/checkout';
import { formatDate } from '../logic/dates';
import { formatMoney } from '../logic/format';
import { useCommerceCart } from '../state/cart-store';
import { handOffOrder } from '../state/order-handoff';
import { FIELD_ERROR_KEYS, Field, apiErrorKey, statusKey, useCheckoutConfig, useShopperSession } from './buy-common';
import { StateSelect } from './Checkout';
import { OtpStep, PhoneField } from './Otp';
import { ConsentToggle } from './OrderPage';
import { EmptyState } from './primitives';
import { ShopLink, useCommerceSite, whatsappLink } from './site';

const PAGE_SIZE = 20;
const MAX_ADDRESSES = 10;

const isInvalid = (error: unknown): boolean => error instanceof CommerceApiError && error.status === 401;

export const AccountPage: React.FC = () => {
    const { t } = useCommerceSite();
    const { session, save, clear } = useShopperSession();
    // A shop that cannot issue sessions still answers /me with a fresh phone token (this page only).
    const [phoneToken, setPhoneToken] = useState<string | null>(null);
    const [signedOutNote, setSignedOutNote] = useState<MessageKey | null>(null);
    const auth: ShopperAuth | null = session ? { session: session.token } : phoneToken ? { phoneToken } : null;
    const signOutLocal = (note: MessageKey | null) => {
        clear();
        setPhoneToken(null);
        setSignedOutNote(note);
    };
    if (!auth) {
        return (
            <AccountGate
                note={signedOutNote}
                onVerified={(verified) => {
                    setSignedOutNote(null);
                    if (!save(verified)) setPhoneToken(verified.verified_phone_token);
                }}
            />
        );
    }
    return (
        <AccountHome
            auth={auth}
            sessionToken={session?.token || null}
            onInvalid={() => signOutLocal('account.signInAgain')}
            onSignedOut={() => signOutLocal('account.signedOut')}
            title={t('account.title')}
        />
    );
};

const AccountGate: React.FC<{ note: MessageKey | null; onVerified: React.ComponentProps<typeof OtpStep>['onVerified'] }> = ({ note, onVerified }) => {
    const { t } = useCommerceSite();
    const config = useCheckoutConfig().data;
    const [phone, setPhone] = useState('');
    return (
        <div className="cmx-shell cmx-section">
            <div className="cmx-narrow flex flex-col gap-4">
                <h1 className="cmx-h1">{t('account.title')}</h1>
                <p className="cmx-body">{t('account.gate.body')}</p>
                {note && (
                    <p className="cmx-note" role="status">
                        {t(note)}
                    </p>
                )}
                <PhoneField value={phone} onChange={setPhone} />
                <OtpStep purpose="ACCOUNT" phone={phone} config={config} recommended sendLabel={t('account.gate.send')} onVerified={onVerified} />
                <p className="cmx-small cmx-muted">{t('account.gate.noPassword')}</p>
                <ShopLink to="track-order" className="cmx-link self-start">
                    {t('account.gate.track')}
                </ShopLink>
            </div>
        </div>
    );
};

const AccountHome: React.FC<{
    auth: ShopperAuth;
    sessionToken: string | null;
    onInvalid(): void;
    onSignedOut(): void;
    title: string;
}> = ({ auth, sessionToken, onInvalid, onSignedOut, title }) => {
    const { t, client, instituteId } = useCommerceSite();
    const authKey = 'session' in auth ? auth.session : auth.phoneToken;
    const me = useQuery({
        queryKey: ['commerce', instituteId, 'me', authKey],
        queryFn: ({ signal }) => client.getMe(auth, signal),
        staleTime: 60_000,
        retry: false,
    });
    useEffect(() => {
        if (isInvalid(me.error)) onInvalid();
    }, [me.error, onInvalid]);
    const [signingOut, setSigningOut] = useState(false);
    const [outError, setOutError] = useState<MessageKey | null>(null);
    const everywhere = async () => {
        setSigningOut(true);
        setOutError(null);
        try {
            await client.logout(auth);
            onSignedOut();
        } catch (failure) {
            if (isInvalid(failure)) onSignedOut();
            else setOutError(apiErrorKey(failure));
        } finally {
            setSigningOut(false);
        }
    };
    return (
        <div className="cmx-shell cmx-section">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="cmx-h1">{title}</h1>
                    {me.data && (
                        <p className="cmx-small cmx-muted">
                            {[me.data.name, me.data.phone_masked && `+91 ${me.data.phone_masked}`, me.data.email_masked].filter(Boolean).join(' · ')}
                        </p>
                    )}
                </div>
            </div>
            <div className="cmx-account">
                <OrdersSection auth={auth} onInvalid={onInvalid} />
                <div className="flex flex-col gap-6">
                    <AddressesSection auth={auth} onInvalid={onInvalid} />
                    {sessionToken && <ConsentToggle token={sessionToken} onInvalid={onInvalid} />}
                    <section className="cmx-panel flex flex-col gap-2" aria-label={t('account.signOut')}>
                        <button type="button" className="cmx-btn cmx-btn--outline cmx-btn--block" onClick={onSignedOut}>
                            <SignOut size={18} aria-hidden="true" />
                            {t('account.signOutHere')}
                        </button>
                        <button type="button" className="cmx-btn cmx-btn--ghost cmx-btn--block" onClick={() => void everywhere()} disabled={signingOut} aria-busy={signingOut}>
                            {t('account.signOutEverywhere')}
                        </button>
                        {outError && (
                            <p className="cmx-small cmx-bad" role="alert">
                                {t(outError)}
                            </p>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

/* ── orders ───────────────────────────────────────────────────────── */

const OrdersSection: React.FC<{ auth: ShopperAuth; onInvalid(): void }> = ({ auth, onInvalid }) => {
    const { t, client, instituteId } = useCommerceSite();
    const [page, setPage] = useState(0);
    const authKey = 'session' in auth ? auth.session : auth.phoneToken;
    const orders = useQuery({
        queryKey: ['commerce', instituteId, 'me-orders', authKey, page],
        queryFn: ({ signal }) => client.myOrders(auth, page, PAGE_SIZE, signal),
        staleTime: 30_000,
        retry: false,
    });
    useEffect(() => {
        if (isInvalid(orders.error)) onInvalid();
    }, [orders.error, onInvalid]);
    const rows = orders.data?.orders || [];
    const total = orders.data?.total || 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
        <section aria-labelledby="cmx-acc-orders" className="flex flex-col gap-3">
            <h2 className="cmx-h2" id="cmx-acc-orders">
                {t('account.orders')}
            </h2>
            {orders.isPending ? (
                <div className="flex flex-col gap-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="cmx-skel h-24 w-full" />
                    ))}
                </div>
            ) : orders.error && !isInvalid(orders.error) ? (
                <p className="cmx-note cmx-note--error" role="alert">
                    {t(apiErrorKey(orders.error))}{' '}
                    <button type="button" className="cmx-link" onClick={() => void orders.refetch()}>
                        {t('common.retry')}
                    </button>
                </p>
            ) : rows.length === 0 ? (
                <EmptyState title={t('account.noOrders')} body={t('account.noOrdersBody')}>
                    <ShopLink to="" className="cmx-btn cmx-btn--primary">
                        {t('cart.continue')}
                    </ShopLink>
                </EmptyState>
            ) : (
                <ul className="flex flex-col gap-3">
                    {rows.map((order) => (
                        <OrderRow key={order.order_number} order={order} />
                    ))}
                </ul>
            )}
            {pages > 1 && (
                <nav className="flex items-center justify-between gap-3" aria-label={t('account.pages')}>
                    <button type="button" className="cmx-btn cmx-btn--outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                        {t('account.newer')}
                    </button>
                    <span className="cmx-small cmx-muted">{t('account.page', { page: page + 1, pages })}</span>
                    <button type="button" className="cmx-btn cmx-btn--outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                        {t('account.older')}
                    </button>
                </nav>
            )}
        </section>
    );
};

const OrderRow: React.FC<{ order: OrderSummary }> = ({ order }) => {
    const { t, locale, href, config: shop, client, instituteId } = useCommerceSite();
    const router = useRouter();
    const add = useCommerceCart((s) => s.add);
    const [reorder, setReorder] = useState<'idle' | 'busy' | MessageKey>('idle');
    const masked = order.masked === true || !order.order_access_token;
    const date = formatDate(order.placed_at, locale);
    const help = whatsappLink(shop.whatsappNumber, t('account.returnText', { number: order.order_number }));

    const doReorder = async () => {
        if (!order.order_access_token) return;
        setReorder('busy');
        try {
            const view = await client.viewOrder(order.order_access_token);
            const lines = (view.lines || []).filter((l) => !!l.sku && l.quantity > (l.qty_cancelled || 0));
            if (lines.length === 0) {
                setReorder('account.reorderNone');
                return;
            }
            // Priced by SKU: the server names today's variant, price and stock for each.
            const price = await client.priceCart({
                lines: lines.map((l) => ({ line_ref: l.sku!, sku: l.sku!, quantity: l.quantity - (l.qty_cancelled || 0) })),
                payment_method: 'PREPAID',
            });
            let added = 0;
            for (const line of price.lines || []) {
                if (!line.variant_id || !line.slug) continue;
                const outcome = add({
                    variantId: line.variant_id,
                    slug: line.slug,
                    name: line.name || '',
                    variantLabel: line.variant_label,
                    imageUrl: null,
                    quantity: line.quantity,
                    qtyScale: line.qty_scale || 1,
                    qtyStep: line.qty_step || 1,
                    unit: line.unit,
                    piece: line.piece,
                    unitPrice: line.unit_price,
                });
                if (outcome !== 'full') added += 1;
            }
            if (added === 0) {
                setReorder('account.reorderNone');
                return;
            }
            setReorder('idle');
            await router.navigate({ href: href('cart') });
        } catch (failure) {
            setReorder(apiErrorKey(failure));
        }
    };

    return (
        <li className={cn('cmx-panel cmx-order-row', masked && 'cmx-order-row--masked')}>
            <div className="flex items-start gap-3">
                <Package size={24} aria-hidden="true" className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold">{order.order_number}</span>
                        {!masked && <span className="font-semibold tabular-nums">{formatMoney(order.total, order.currency)}</span>}
                    </p>
                    <p className="cmx-small cmx-body">
                        {[t(statusKey(order.status)), date].filter(Boolean).join(' · ')}
                    </p>
                    {!masked && order.first_item_name && (
                        <p className="cmx-small cmx-muted">
                            {order.item_count && order.item_count > 1
                                ? t('account.itemsMore', { name: order.first_item_name, count: order.item_count - 1 })
                                : order.first_item_name}
                        </p>
                    )}
                    {masked && <p className="cmx-small cmx-muted">{t('account.maskedRow')}</p>}
                </div>
            </div>
            {!masked && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {/* A button, not a link: the token stays in this tab's sessionStorage, never in an address. */}
                    <button
                        type="button"
                        className="cmx-btn cmx-btn--outline"
                        onClick={() =>
                            // Only unmasked rows (orders whose phone was proved) open here.
                            void router.navigate({ href: href('order'), state: handOffOrder(instituteId, order.order_access_token, { phoneProved: true }) as never })
                        }
                    >
                        {t('account.viewOrder')}
                    </button>
                    <button type="button" className="cmx-btn cmx-btn--ghost" onClick={() => void doReorder()} disabled={reorder === 'busy'} aria-busy={reorder === 'busy'}>
                        {t('account.reorder')}
                    </button>
                    {help && (
                        <a href={help} target="_blank" rel="noopener noreferrer" className="cmx-link inline-flex min-h-11 items-center gap-2">
                            <WhatsappLogo size={18} aria-hidden="true" />
                            {t('account.returnHelp')}
                        </a>
                    )}
                </div>
            )}
            {reorder !== 'idle' && reorder !== 'busy' && (
                <p className="cmx-small cmx-bad mt-2" role="alert">
                    {t(reorder)}
                </p>
            )}
        </li>
    );
};

/* ── addresses ────────────────────────────────────────────────────── */

interface AddressDraft {
    name: string;
    phone: string;
    line1: string;
    landmark: string;
    city: string;
    stateCode: string;
    pincode: string;
}

const draftOf = (a: AddressView | null): AddressDraft => ({
    name: a?.name || '',
    phone: normaliseMobile(a?.phone) || '',
    line1: [a?.line1, a?.line2].filter(Boolean).join(', '),
    landmark: a?.landmark || '',
    city: a?.city || '',
    stateCode: a?.state_code || '',
    pincode: a?.pincode || '',
});

const draftErrors = (d: AddressDraft): Partial<Record<keyof AddressDraft, string>> => {
    const out: Partial<Record<keyof AddressDraft, string>> = {};
    if (d.name.trim().length < 2) out.name = d.name.trim() ? 'short' : 'required';
    if (!normaliseMobile(d.phone)) out.phone = d.phone ? 'phone' : 'required';
    if (d.line1.trim().length < 5) out.line1 = d.line1.trim() ? 'short' : 'required';
    if (!d.city.trim()) out.city = 'required';
    if (!INDIAN_STATES.some((s) => s.code === d.stateCode)) out.stateCode = 'required';
    if (!isPincode(d.pincode)) out.pincode = d.pincode ? 'pincode' : 'required';
    return out;
};

const AddressesSection: React.FC<{ auth: ShopperAuth; onInvalid(): void }> = ({ auth, onInvalid }) => {
    const { t, client, instituteId, locale } = useCommerceSite();
    const queryClient = useQueryClient();
    const authKey = 'session' in auth ? auth.session : auth.phoneToken;
    const key = ['commerce', instituteId, 'me-addresses', authKey];
    const addresses = useQuery({ queryKey: key, queryFn: ({ signal }) => client.myAddresses(auth, signal), staleTime: 60_000, retry: false });
    useEffect(() => {
        if (isInvalid(addresses.error)) onInvalid();
    }, [addresses.error, onInvalid]);
    const [editing, setEditing] = useState<AddressView | 'new' | null>(null);
    const [problem, setProblem] = useState<MessageKey | null>(null);
    const list = addresses.data || [];
    const refresh = () => queryClient.invalidateQueries({ queryKey: key });
    const remove = async (id: string) => {
        setProblem(null);
        try {
            await client.deleteAddress(auth, id);
            await refresh();
        } catch (failure) {
            if (isInvalid(failure)) onInvalid();
            else setProblem(apiErrorKey(failure));
        }
    };
    return (
        <section className="cmx-panel flex flex-col gap-3" aria-labelledby="cmx-acc-addr">
            <h2 className="cmx-h3" id="cmx-acc-addr">
                {t('account.addresses')}
            </h2>
            {editing ? (
                <AddressForm
                    initial={editing === 'new' ? null : editing}
                    onCancel={() => setEditing(null)}
                    onSave={async (address) => {
                        if (editing === 'new') await client.addAddress(auth, address);
                        else await client.updateAddress(auth, editing.id, address);
                        await refresh();
                        setEditing(null);
                    }}
                />
            ) : (
                <>
                    {list.length === 0 && !addresses.isPending && <p className="cmx-small cmx-muted">{t('account.noAddresses')}</p>}
                    <ul className="flex flex-col gap-2">
                        {list.map((a) => (
                            <li key={a.id} className="cmx-addr-row">
                                <span className="cmx-small min-w-0">
                                    <span className="block font-medium">{a.name}</span>
                                    {[a.line1, a.landmark, a.city, stateName(a.state_code, locale), a.pincode].filter(Boolean).join(', ')}
                                </span>
                                <span className="flex shrink-0">
                                    <button type="button" className="cmx-icon-btn" aria-label={t('account.editAddress', { name: a.name || '' })} onClick={() => setEditing(a)}>
                                        <PencilSimple size={18} aria-hidden="true" />
                                    </button>
                                    <button type="button" className="cmx-icon-btn" aria-label={t('account.deleteAddress', { name: a.name || '' })} onClick={() => void remove(a.id)}>
                                        <Trash size={18} aria-hidden="true" />
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ul>
                    {list.length < MAX_ADDRESSES ? (
                        <button type="button" className="cmx-btn cmx-btn--outline cmx-btn--block" onClick={() => setEditing('new')}>
                            {t('account.addAddress')}
                        </button>
                    ) : (
                        <p className="cmx-small cmx-muted">{t('account.addressLimit', { count: MAX_ADDRESSES })}</p>
                    )}
                </>
            )}
            {problem && (
                <p className="cmx-small cmx-bad" role="alert">
                    {t(problem)}
                </p>
            )}
        </section>
    );
};

const AddressForm: React.FC<{ initial: AddressView | null; onCancel(): void; onSave(address: CheckoutAddress): Promise<void> }> = ({ initial, onCancel, onSave }) => {
    const { t, client } = useCommerceSite();
    const [draft, setDraft] = useState<AddressDraft>(() => draftOf(initial));
    const [errors, setErrors] = useState<Partial<Record<keyof AddressDraft, string>>>({});
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<MessageKey | null>(null);
    const set = (name: keyof AddressDraft, value: string) => {
        setDraft((d) => ({ ...d, [name]: value }));
        setErrors((e) => ({ ...e, [name]: undefined }));
    };
    useEffect(() => {
        if (!isPincode(draft.pincode)) return;
        const controller = new AbortController();
        client
            .getPincode(draft.pincode, controller.signal)
            .then((info) =>
                setDraft((d) =>
                    d.pincode === info.pincode
                        ? { ...d, city: d.city || info.city || '', stateCode: d.stateCode || info.state_code || '' }
                        : d
                )
            )
            .catch(() => undefined);
        return () => controller.abort();
    }, [draft.pincode, client]);
    const err = (name: keyof AddressDraft) => (errors[name] ? t(FIELD_ERROR_KEYS[errors[name]!]!) : null);
    return (
        <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={async (event) => {
                event.preventDefault();
                const found = draftErrors(draft);
                if (Object.keys(found).length) {
                    setErrors(found);
                    return;
                }
                setSaving(true);
                setProblem(null);
                try {
                    await onSave({
                        name: draft.name.trim(),
                        phone: normaliseMobile(draft.phone)!,
                        line1: draft.line1.trim(),
                        landmark: draft.landmark.trim() || null,
                        city: draft.city.trim(),
                        state_code: draft.stateCode,
                        pincode: draft.pincode,
                    });
                } catch (failure) {
                    setProblem(apiErrorKey(failure));
                } finally {
                    setSaving(false);
                }
            }}
        >
            <Field label={t('form.pincode')} inputMode="numeric" autoComplete="postal-code" maxLength={6} value={draft.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} error={err('pincode')} />
            <div className="cmx-field-row">
                <Field label={t('form.city')} autoComplete="address-level2" maxLength={80} value={draft.city} onChange={(e) => set('city', e.target.value)} error={err('city')} />
                <StateSelect value={draft.stateCode} onChange={(code) => set('stateCode', code)} error={err('stateCode')} />
            </div>
            <Field label={t('form.name')} autoComplete="name" maxLength={120} value={draft.name} onChange={(e) => set('name', e.target.value)} error={err('name')} />
            <Field label={t('form.line1')} autoComplete="street-address" maxLength={240} value={draft.line1} onChange={(e) => set('line1', e.target.value)} error={err('line1')} />
            <Field label={t('form.landmark')} optionalText={t('form.optional')} maxLength={120} value={draft.landmark} onChange={(e) => set('landmark', e.target.value)} />
            <PhoneField value={draft.phone} onChange={(next) => set('phone', next)} error={err('phone')} />
            {problem && (
                <p className="cmx-small cmx-bad" role="alert">
                    {t(problem)}
                </p>
            )}
            <div className="flex gap-2">
                <button type="submit" className="cmx-btn cmx-btn--primary flex-1" disabled={saving} aria-busy={saving}>
                    {t('account.saveAddress')}
                </button>
                <button type="button" className="cmx-btn cmx-btn--outline flex-1" onClick={onCancel}>
                    {t('account.cancel')}
                </button>
            </div>
        </form>
    );
};
