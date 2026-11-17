import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';
import { AddressBlock } from './order-ui';

/** Who ordered, where it goes, the bill-to address, GSTIN and notes. */
export function OrderCustomerCard({ detail }: { detail: StaffOrderDetail }) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const order = detail.order;
    const sameAddress =
        !detail.billing_address ||
        JSON.stringify(detail.billing_address) === JSON.stringify(detail.shipping_address);
    return (
        <SectionCard title={t('orders.detail.customer.title')}>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-0.5 text-body">
                    <span className="font-medium text-foreground">{order.customer_name ?? '—'}</span>
                    {order.customer_phone && (
                        <a href={`tel:${order.customer_phone}`} className="w-fit text-primary-500 hover:underline">
                            {order.customer_phone}
                        </a>
                    )}
                    {detail.customer_email && (
                        <span className="break-all text-muted-foreground">{detail.customer_email}</span>
                    )}
                    {detail.customer_id && access.canOpen('commerce-customers') && (
                        <Link
                            to={'/commerce/customers/$customerId' as never}
                            params={{ customerId: detail.customer_id } as never}
                            className="w-fit text-caption text-primary-500 hover:underline"
                        >
                            {t('orders.detail.customer.profile')}
                        </Link>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-muted-foreground">{t('orders.detail.customer.deliveryAddress')}</span>
                    <AddressBlock address={detail.shipping_address} />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-caption text-muted-foreground">{t('orders.detail.customer.billingAddress')}</span>
                    {sameAddress ? (
                        <p className="text-body text-muted-foreground">{t('orders.detail.customer.sameAsDelivery')}</p>
                    ) : (
                        <AddressBlock address={detail.billing_address} />
                    )}
                </div>
                {detail.buyer_gstin && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">{t('orders.detail.customer.gstin')}</span>
                        <span className="font-mono text-body text-foreground">{detail.buyer_gstin}</span>
                    </div>
                )}
                {detail.customer_note && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">{t('orders.detail.customer.customerNote')}</span>
                        <p className="whitespace-pre-line text-body text-foreground">{detail.customer_note}</p>
                    </div>
                )}
                {detail.gift_note && (
                    <div className="flex flex-col gap-1">
                        <span className="text-caption text-muted-foreground">{t('orders.detail.customer.giftNote')}</span>
                        <p className="whitespace-pre-line text-body text-foreground">{detail.gift_note}</p>
                    </div>
                )}
            </div>
        </SectionCard>
    );
}
