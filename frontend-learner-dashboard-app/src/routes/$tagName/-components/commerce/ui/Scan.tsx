/**
 * /q/<code>: where the QR code on a printed label leads. The code is resolved by the public
 * API (GET /open/commerce/v1/q/{code}) and the shopper is sent on to the product page, on the
 * variant the label names. A code that cannot be read offers the search instead.
 */
import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPathTo, withQuery } from '../routes';
import { ShopHead } from './Head';
import { EmptyState, ErrorState, isNotFound, shouldRetry } from './primitives';
import { openCommerceSearch } from './Chrome';
import { ShopLink, useCommerceSite, useShopNavigate } from './site';

export const ScanLanding: React.FC<{ code: string }> = ({ code }) => {
    const { t, client, instituteId } = useCommerceSite();
    const navigate = useShopNavigate();
    const query = useQuery({
        queryKey: ['commerce', instituteId, 'scan', code],
        queryFn: ({ signal }) => client.resolveScan(code, signal),
        retry: shouldRetry,
        staleTime: 60_000,
    });
    const target = query.data;
    const to = target ? apiPathTo(target.path) || (target.slug ? `p/${target.slug}` : '') : '';
    useEffect(() => {
        // Only a product address of this site is followed: never a URL from the response.
        if (to && /^p\/[a-z0-9-]+(\?.*)?$/.test(to)) {
            void navigate(target?.sku && !to.includes('v=') ? withQuery(to, { v: target.sku }) : to, { replace: true });
        }
    }, [to, target?.sku, navigate]);
    const failed = query.isError || (query.isSuccess && !to);
    return (
        <div className="cmx-shell cmx-section">
            <ShopHead title={t('scan.resolving')} noindex />
            {!failed ? (
                <p className="cmx-state cmx-muted" role="status">
                    {t('scan.resolving')}
                </p>
            ) : query.isError && !isNotFound(query.error) ? (
                <ErrorState error={query.error} onRetry={() => void query.refetch()} />
            ) : (
                <EmptyState title={t('scan.notFound.title')} body={t('scan.notFound.body')}>
                    <button type="button" className="cmx-btn cmx-btn--primary" onClick={openCommerceSearch}>
                        {t('nav.search')}
                    </button>
                    <ShopLink to="" className="cmx-link">
                        {t('product.browse')}
                    </ShopLink>
                </EmptyState>
            )}
        </div>
    );
};
