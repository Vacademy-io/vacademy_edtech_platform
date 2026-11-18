import { createLazyFileRoute } from '@tanstack/react-router';
import { PosGate } from '@/routes/commerce/pos/-components/PosGate';
import { PosBillBookPage } from '@/routes/commerce/pos/-components/PosBillBookPage';

/** P5: key in a paper bill written while the till was down. */
export const Route = createLazyFileRoute('/commerce/pos/$sessionId/bill-book/')({
    component: PageRoute,
});

function PageRoute() {
    const { sessionId } = Route.useParams();
    return (
        <PosGate>
            <PosBillBookPage sessionId={sessionId} />
        </PosGate>
    );
}
