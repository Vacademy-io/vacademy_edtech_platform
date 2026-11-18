import { useEffect, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { PosGate } from '@/routes/commerce/pos/-components/PosGate';
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
    // The exchange arrives once from the returns screen. The bill keeps it in this tab's session store
    // until a bill uses it or the cashier removes it (a reload brings it back), so the address drops it.
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
        <PosGate>
            <PosSellPage key={sessionId} sessionId={sessionId} exchange={exchange} />
        </PosGate>
    );
}
