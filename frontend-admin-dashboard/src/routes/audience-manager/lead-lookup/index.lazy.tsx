import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { LeadLookupPage } from './-components/lead-lookup-page';

export const Route = createLazyFileRoute('/audience-manager/lead-lookup/')({
    component: LeadLookupRoute,
});

function LeadLookupRoute() {
    return (
        <LayoutContainer>
            <LeadLookupPage />
        </LayoutContainer>
    );
}
