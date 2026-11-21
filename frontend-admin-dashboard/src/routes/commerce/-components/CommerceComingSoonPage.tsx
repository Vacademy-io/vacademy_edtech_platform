import { useTranslation } from 'react-i18next';
import { type CommerceNavId, commerceNavRule } from '@/lib/commerce/commerce-access';
import { CommercePage } from './CommercePage';
import { CommerceComingSoon } from './CommerceStates';

/**
 * A shop screen that has its sidebar entry, route and gate, and whose content
 * is built later. The gate is real already: without the feature the route
 * shows the locked page, without the role "no access".
 */
export function CommerceComingSoonPage({ navId }: { navId: CommerceNavId }) {
    const { t } = useTranslation(['commerce', 'sidebar']);
    const rule = commerceNavRule(navId);
    const title = t(`sidebar:${rule?.labelKey ?? 'commerceHome'}`);
    return (
        <CommercePage navId={navId} title={title} description={t(`commerce:home.screens.${navId}`)}>
            <CommerceComingSoon title={t('commerce:comingSoon.screenTitle', { screen: title })} />
        </CommercePage>
    );
}
