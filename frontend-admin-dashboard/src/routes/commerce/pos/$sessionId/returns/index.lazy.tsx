import { createLazyFileRoute } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PosReturnPage } from '@/routes/commerce/pos/-components/PosReturnPage';

/** P4: return or exchange at the counter. */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/returns/')({
    component: ReturnsRoute,
});

function ReturnsRoute() {
    const { sessionId } = Route.useParams();
    const { order } = Route.useSearch();
    return (
        <CommerceGate navId="commerce-pos">
            <PosReturnPage sessionId={sessionId} initialOrderId={order} />
        </CommerceGate>
    );
}
