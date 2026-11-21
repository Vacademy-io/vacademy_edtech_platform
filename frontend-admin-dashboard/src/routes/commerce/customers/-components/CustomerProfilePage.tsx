import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceComingSoon,
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { OrderNotice, useOrderErrorText } from '@/routes/commerce/orders/-components/order-ui';
import { readOrderError } from '@/routes/commerce/orders/-shared/order-errors';
import { useCustomer, useCustomerOrders } from '@/routes/commerce/customers/-shared/customer-hooks';
import { isCustomerNotFound, isCustomersApiMissing } from '@/routes/commerce/customers/-shared/customer-logic';
import type { CustomerAddress, CustomerProfile } from '@/routes/commerce/customers/-shared/customer-types';

export type CustomerProfileTab = 'overview' | 'orders' | 'addresses';

/**
 * S8 Customer profile: contact and consent, orders (the order list searched by
 * the customer's phone) and saved addresses. Read-only; one deep-linkable page
 * on every width.
 */
export function CustomerProfilePage({
    customerId,
    tab,
    onTabChange,
}: {
    customerId: string;
    tab: CustomerProfileTab;
    onTabChange: (tab: CustomerProfileTab) => void;
}) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const enabled = access.isResolved && access.canOpen('commerce-customers');
    const query = useCustomer(customerId, enabled);
    const customer = query.data?.customer;
    const title = customer
        ? customer.anonymised
            ? t('customers.anonymised')
            : customer.name || t('customers.noName')
        : t('customers.title');
    return (
        <CommercePage
            navId="commerce-customers"
            title={title}
            backTo={{ to: '/commerce/customers', label: t('customers.backToList') }}
        >
            <ProfileBody query={query} tab={tab} onTabChange={onTabChange} ordersEnabled={enabled} />
        </CommercePage>
    );
}

function ProfileBody({
    query,
    tab,
    onTabChange,
    ordersEnabled,
}: {
    query: ReturnType<typeof useCustomer>;
    tab: CustomerProfileTab;
    onTabChange: (tab: CustomerProfileTab) => void;
    ordersEnabled: boolean;
}) {
    const { t } = useTranslation('commerce');
    const errorText = useOrderErrorText();
    if (query.isLoading) {
        return (
            <div className="flex flex-col gap-4" aria-busy="true">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-48 w-full" />
            </div>
        );
    }
    if (query.isError) {
        if (isCustomerNotFound(query.error) && readOrderError(query.error).code === 'CUSTOMER_NOT_FOUND') {
            return (
                <OrderNotice tone="warning">
                    <p>{t('customers.notFound')}</p>
                    <Link to="/commerce/customers" className="text-primary-500 hover:underline">
                        {t('customers.backToList')}
                    </Link>
                </OrderNotice>
            );
        }
        if (isCustomersApiMissing(query.error)) return <CommerceComingSoon title={t('customers.notAvailable')} />;
        return <CommerceErrorState message={errorText(readOrderError(query.error))} onRetry={() => void query.refetch()} />;
    }
    const profile = query.data;
    if (!profile) return null;
    return (
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as CustomerProfileTab)}>
            <TabsList>
                <TabsTrigger value="overview">{t('customers.tabs.overview')}</TabsTrigger>
                <TabsTrigger value="orders">{t('customers.tabs.orders')}</TabsTrigger>
                <TabsTrigger value="addresses">{t('customers.tabs.addresses')}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
                <Overview profile={profile} />
            </TabsContent>
            <TabsContent value="orders" className="mt-4">
                <CustomerOrders phone={profile.customer.phone} enabled={ordersEnabled && tab === 'orders'} />
            </TabsContent>
            <TabsContent value="addresses" className="mt-4">
                <Addresses addresses={profile.addresses} />
            </TabsContent>
        </Tabs>
    );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
        <dt className="text-caption text-muted-foreground sm:w-48 sm:shrink-0">{label}</dt>
        <dd className="text-body text-foreground">{children}</dd>
    </div>
);

function Overview({ profile }: { profile: CustomerProfile }) {
    const { t } = useTranslation('commerce');
    const c = profile.customer;
    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={t('customers.overview.contact')}>
                <dl className="flex flex-col gap-3">
                    <Row label={t('customers.columns.phone')}>
                        {c.phone ? (
                            <a href={`tel:${c.phone}`} className="text-primary-500 hover:underline">
                                {c.phone}
                            </a>
                        ) : (
                            '—'
                        )}
                    </Row>
                    <Row label={t('customers.columns.email')}>{c.email ?? '—'}</Row>
                    <Row label={t('customers.overview.since')}>{c.created_at ? formatDate(c.created_at) : '—'}</Row>
                    <Row label={t('customers.columns.consent')}>
                        {c.marketing_consent ? t('customers.yes') : t('customers.no')}
                        {c.consent_at && (
                            <span className="block text-caption text-muted-foreground">
                                {t('customers.overview.consentAt', { time: formatDateTime(c.consent_at) })}
                                {c.consent_source ? ` · ${c.consent_source}` : ''}
                            </span>
                        )}
                    </Row>
                    <Row label={t('customers.columns.codRefusals')}>{c.cod_refusals}</Row>
                </dl>
            </SectionCard>
            <SectionCard title={t('customers.overview.totals')}>
                <dl className="flex flex-col gap-3">
                    <Row label={t('customers.columns.orders')}>{c.orders_count}</Row>
                    <Row label={t('customers.columns.totalSpent')}>
                        <MoneyCell value={c.total_spent} className="text-start" />
                    </Row>
                    <Row label={t('customers.columns.dues')}>
                        <MoneyCell value={c.dues} className={c.dues > 0 ? 'text-start text-warning-600' : 'text-start'} />
                    </Row>
                    <Row label={t('customers.columns.lastOrder')}>
                        {c.last_order_at ? formatDateTime(c.last_order_at) : '—'}
                    </Row>
                </dl>
            </SectionCard>
            <SectionCard title={t('customers.overview.notes')} className="lg:col-span-2">
                <p className="whitespace-pre-wrap text-body text-foreground">{c.notes || t('customers.overview.noNotes')}</p>
            </SectionCard>
        </div>
    );
}

function CustomerOrders({ phone, enabled }: { phone: string | null; enabled: boolean }) {
    const { t } = useTranslation('commerce');
    const errorText = useOrderErrorText();
    const query = useCustomerOrders(phone, enabled);
    if (!phone) return <CommerceEmptyState title={t('customers.orders.noPhone')} />;
    if (query.isLoading) return <CommerceLoadingRows rows={4} />;
    if (query.isError) {
        return <CommerceErrorState message={errorText(readOrderError(query.error))} onRetry={() => void query.refetch()} />;
    }
    const orders = query.data?.orders ?? [];
    if (orders.length === 0) return <CommerceEmptyState title={t('customers.orders.empty')} />;
    return (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {orders.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div className="flex min-w-0 flex-col">
                        <Link
                            to="/commerce/orders/$orderId"
                            params={{ orderId: order.id }}
                            className="text-body font-medium text-primary-500 hover:underline"
                        >
                            {order.order_number}
                        </Link>
                        <span className="text-caption text-muted-foreground">
                            {order.created_at ? formatDateTime(order.created_at) : '—'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <CommerceStatusChip kind="order" value={order.status} />
                        <MoneyCell value={order.total} currency={order.currency} />
                    </div>
                </li>
            ))}
            {(query.data?.total ?? 0) > orders.length && (
                <li className="p-3 text-caption text-muted-foreground">
                    {t('customers.orders.more', { count: (query.data?.total ?? 0) - orders.length })}
                </li>
            )}
        </ul>
    );
}

function Addresses({ addresses }: { addresses: CustomerAddress[] }) {
    const { t } = useTranslation('commerce');
    if (addresses.length === 0) return <CommerceEmptyState title={t('customers.addresses.empty')} />;
    return (
        <ul className="grid gap-3 md:grid-cols-2">
            {addresses.map((address) => {
                const cityLine = [
                    address.city,
                    address.state_code ? t(`states.${address.state_code}`, address.state_code) : null,
                    address.pincode,
                ]
                    .filter(Boolean)
                    .join(', ');
                return (
                    <li key={address.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                        <div className="flex items-center gap-2">
                            <span className="text-body font-medium text-foreground">
                                {address.label || address.name || t('customers.addresses.address')}
                            </span>
                            {address.is_default && (
                                <span className="rounded-full bg-primary-50 px-2 text-caption text-primary-500">
                                    {t('customers.addresses.default')}
                                </span>
                            )}
                        </div>
                        <address className="flex flex-col text-body not-italic text-foreground">
                            {address.label && address.name && <span>{address.name}</span>}
                            {address.line1 && <span>{address.line1}</span>}
                            {address.line2 && <span>{address.line2}</span>}
                            {address.landmark && <span>{address.landmark}</span>}
                            {cityLine && <span>{cityLine}</span>}
                            {address.phone && <span className="text-caption text-muted-foreground">{address.phone}</span>}
                        </address>
                    </li>
                );
            })}
        </ul>
    );
}
