import { createLazyFileRoute, Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommerceHome } from '@/routes/commerce/-components/CommerceHome';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';

export const Route = createLazyFileRoute('/commerce/')({
    component: () => (
        <LayoutContainer>
            <CommerceHomePage />
        </LayoutContainer>
    ),
});

function CommerceHomePage() {
    const { t } = useTranslation(['commerce', 'sidebar']);
    const access = useCommerceAccess();

    // A cashier has one screen. Home is not theirs: send them straight to POS
    // instead of showing "no access" on the shop's front door.
    if (
        access.isResolved &&
        access.denialFor('commerce-home') === 'role' &&
        access.canOpen('commerce-pos')
    ) {
        return <Navigate to="/commerce/pos" replace />;
    }

    return (
        <CommercePage
            navId="commerce-home"
            title={t('sidebar:commerceHome')}
            description={t('commerce:home.description')}
        >
            <CommerceHome />
        </CommercePage>
    );
}
