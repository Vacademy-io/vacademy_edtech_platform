import { createLazyFileRoute } from '@tanstack/react-router';
import { PosGate } from '@/routes/commerce/pos/-components/PosGate';
import { PosStartPage } from '@/routes/commerce/pos/-components/PosStartPage';

/** P1: pick a counter, open it or continue. Full screen: no admin frame on the till. */
export const Route = createLazyFileRoute('/commerce/pos/')({
    component: () => (
        <PosGate>
            <PosStartPage />
        </PosGate>
    ),
});
