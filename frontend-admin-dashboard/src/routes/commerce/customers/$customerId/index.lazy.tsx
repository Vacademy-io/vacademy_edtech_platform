import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CustomerProfilePage } from '@/routes/commerce/customers/-components/CustomerProfilePage';
import type { CustomerProfileSearch } from './index';

export const Route = createLazyFileRoute('/commerce/customers/$customerId/')({
    component: CustomerProfileRoute,
});

function CustomerProfileRoute() {
    const { customerId } = Route.useParams();
    const search = Route.useSearch() as CustomerProfileSearch;
    const navigate = useNavigate();
    return (
        <LayoutContainer>
            <CustomerProfilePage
                customerId={customerId}
                tab={search.tab ?? 'overview'}
                onTabChange={(tab) =>
                    void navigate({
                        to: '/commerce/customers/$customerId',
                        params: { customerId },
                        search: { tab } as never,
                        replace: true,
                    })
                }
            />
        </LayoutContainer>
    );
}
