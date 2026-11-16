import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COMMERCE_NAV } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SetupChecklist } from './SetupChecklist';

/**
 * Commerce Home. For the people who set the shop up it leads with the setup
 * checklist; everyone sees the shop screens their role opens. Today's numbers
 * (orders to pack, low stock, till status) arrive with the order, stock and POS
 * work packages; nothing is shown in their place rather than an empty tile.
 */
export function CommerceHome() {
    const { t } = useTranslation(['commerce', 'sidebar']);
    const access = useCommerceAccess();
    const screens = COMMERCE_NAV.filter(
        (rule) => rule.id !== 'commerce-home' && access.canOpen(rule.id)
    );

    return (
        <div className="flex flex-col gap-6">
            {access.isManager && <SetupChecklist />}
            <Card>
                <CardHeader>
                    <CardTitle className="text-title font-medium">
                        {t('commerce:home.screensTitle')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {screens.length === 0 ? (
                        <p className="text-body text-muted-foreground">
                            {t('commerce:home.noScreens')}
                        </p>
                    ) : (
                        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {screens.map((rule) => (
                                <li key={rule.id}>
                                    <Link
                                        to={rule.route as never}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-border p-4 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                    >
                                        <div className="flex min-w-0 flex-col gap-0.5">
                                            <span className="text-body font-medium text-foreground">
                                                {t(`sidebar:${rule.labelKey}`)}
                                            </span>
                                            <span className="text-caption text-muted-foreground">
                                                {t(`commerce:home.screens.${rule.id}`)}
                                            </span>
                                        </div>
                                        <ArrowRight
                                            size={16}
                                            className="shrink-0 text-muted-foreground rtl:rotate-180"
                                        />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
