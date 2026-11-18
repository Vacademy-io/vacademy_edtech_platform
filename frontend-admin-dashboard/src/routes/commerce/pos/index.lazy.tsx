import { createLazyFileRoute } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PosStartPage } from '@/routes/commerce/pos/-components/PosStartPage';

/** P1: pick a counter, open it or continue. Full screen: no admin frame on the till. */
export const Route = createLazyFileRoute('/commerce/pos/')({
    component: () => (
        <CommerceGate navId="commerce-pos">
            <PosStartPage />
        </CommerceGate>
    ),
});
