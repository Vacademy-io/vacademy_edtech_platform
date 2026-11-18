import { createLazyFileRoute } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PosBillsPage } from '@/routes/commerce/pos/-components/PosBillsPage';

/** P3: the bills of this counter session (reprint, void, change payment mode). */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/bills/')({
    component: PageRoute,
});

function PageRoute() {
    const { sessionId } = Route.useParams();
    return (
        <CommerceGate navId="commerce-pos">
            <PosBillsPage sessionId={sessionId} />
        </CommerceGate>
    );
}
