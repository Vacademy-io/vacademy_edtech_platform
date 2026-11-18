import { useEffect, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PosSellPage } from '@/routes/commerce/pos/-components/PosSellPage';
import type { CartExchange } from '@/routes/commerce/pos/-shared/pos-cart';

/** P2: the bill. */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/')({
    component: SellRoute,
});

function SellRoute() {
    const { sessionId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate();
    // The exchange arrives once from the returns screen; the bill keeps it, the address drops it
    // (a reload must not bring a used credit back).
    const [exchange] = useState<CartExchange | null>(() =>
        search.exchange
            ? { returnId: search.exchange, number: search.exchangeNumber ?? null, credit: search.exchangeCredit ?? 0 }
            : null
    );
    useEffect(() => {
        if (search.exchange) {
            void navigate({ to: '/commerce/pos/$sessionId', params: { sessionId }, search: {}, replace: true });
        }
    }, [search.exchange, navigate, sessionId]);
    return (
        <CommerceGate navId="commerce-pos">
            <PosSellPage key={sessionId} sessionId={sessionId} exchange={exchange} />
        </CommerceGate>
    );
}
