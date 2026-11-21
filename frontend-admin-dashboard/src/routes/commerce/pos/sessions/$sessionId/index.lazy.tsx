import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { PosSessionDetailPage } from '@/routes/commerce/pos/-components/PosSessionDetailPage';

/** P8: one counter session: day report, cash movements, bills (manager). */
export const Route = createLazyFileRoute('/commerce/pos/sessions/$sessionId/')({
    component: SessionDetailRoute,
});

function SessionDetailRoute() {
    const { sessionId } = Route.useParams();
    return (
        <LayoutContainer>
            <PosSessionDetailPage sessionId={sessionId} />
        </LayoutContainer>
    );
}
