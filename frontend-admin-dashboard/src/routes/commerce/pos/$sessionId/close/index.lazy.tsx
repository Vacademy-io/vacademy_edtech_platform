import { createLazyFileRoute } from '@tanstack/react-router';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { PosClosePage } from '@/routes/commerce/pos/-components/PosClosePage';

/** P6: count the drawer, close the counter, print the day report. */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/close/')({
    component: PageRoute,
});

function PageRoute() {
    const { sessionId } = Route.useParams();
    return (
        <CommerceGate navId="commerce-pos">
            <PosClosePage sessionId={sessionId} />
        </CommerceGate>
    );
}
