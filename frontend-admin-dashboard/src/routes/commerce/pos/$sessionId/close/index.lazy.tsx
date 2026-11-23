import { createLazyFileRoute } from '@tanstack/react-router';
import { PosGate } from '@/routes/commerce/pos/-components/PosGate';
import { PosClosePage } from '@/routes/commerce/pos/-components/PosClosePage';

/** P6: count the drawer, close the counter, print the day report. */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/close/')({
    component: PageRoute,
});

function PageRoute() {
    const { sessionId } = Route.useParams();
    return (
        <PosGate>
            <PosClosePage sessionId={sessionId} />
        </PosGate>
    );
}
