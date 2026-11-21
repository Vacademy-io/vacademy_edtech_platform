import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CustomersPage } from '@/routes/commerce/customers/-components/CustomersPage';
import type { CustomersSearch } from './index';

export const Route = createLazyFileRoute('/commerce/customers/')({
    component: CustomersRoute,
});

function CustomersRoute() {
    const search = Route.useSearch() as CustomersSearch;
    const navigate = useNavigate();
    return (
        <LayoutContainer>
            <CustomersPage
                search={search}
                onSearchChange={(next) =>
                    void navigate({ to: '/commerce/customers', search: next as never, replace: true })
                }
            />
        </LayoutContainer>
    );
}
