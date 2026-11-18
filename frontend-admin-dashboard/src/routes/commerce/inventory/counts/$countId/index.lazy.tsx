import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { CountSheetPage } from '@/routes/commerce/inventory/-components/CountSheetPage';

/** I4: a count sheet (count, review, post) or a blind recount. */
export const Route = createLazyFileRoute('/commerce/inventory/counts/$countId/')({
    component: () => (
        <LayoutContainer>
            <CountSheetPage />
        </LayoutContainer>
    ),
});
