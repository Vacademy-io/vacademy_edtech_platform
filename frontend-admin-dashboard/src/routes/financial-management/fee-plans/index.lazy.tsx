import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import FeeManagementMain from './-components/FeeManagementMain';

export const Route = createLazyFileRoute('/financial-management/fee-plans/')({
    component: RouteComponent,
});

function RouteComponent() {
    return (
        <LayoutContainer>
            <div className="min-h-screen flex-1 bg-neutral-50 p-6">
                <FeeManagementMain />
            </div>
        </LayoutContainer>
    );
}
