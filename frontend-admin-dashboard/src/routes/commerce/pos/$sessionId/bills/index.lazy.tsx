import { createLazyFileRoute } from '@tanstack/react-router';
import { PosGate } from '@/routes/commerce/pos/-components/PosGate';
import { PosBillsPage } from '@/routes/commerce/pos/-components/PosBillsPage';

/** P3: the bills of this counter session (reprint, void, change payment mode). */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/bills/')({
    component: PageRoute,
});

function PageRoute() {
    const { sessionId } = Route.useParams();
    return (
        <PosGate>
            <PosBillsPage sessionId={sessionId} />
        </PosGate>
    );
}
