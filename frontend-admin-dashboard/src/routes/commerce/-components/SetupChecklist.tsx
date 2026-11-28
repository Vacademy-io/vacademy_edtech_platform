import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Info } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import {
    useLocations,
    useMyPinStatus,
    useTaxClasses,
    useTaxSettings,
} from '@/routes/commerce/-shared/commerce-hooks';
import { buildSetupChecklist, setupProgress } from '@/routes/commerce/-shared/setup-checklist';
import { CommerceLoadingRows, CommerceStatusChip } from './CommerceStates';

/**
 * The setup checklist. Phase 1 has no wizard: Home lists the
 * items, says what is still missing, and each row links to the Settings card
 * that completes it. Shown to the people who set the shop up (manager, admin).
 *
 * Each read is held back unless the institute has the feature its endpoint
 * checks, so a shop without POS does not collect a 403 for the PIN status. A
 * read that fails leaves its row as "could not check", never as "to do".
 */
export function SetupChecklist() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const canReadTax = access.isManager && access.isFeatureOn(COMMERCE_FEATURE.TAX_REPORTS);
    const canReadStock = access.isManager && access.isFeatureOn(COMMERCE_FEATURE.STOCK);
    const canReadPin = access.isManager && access.isFeatureOn(COMMERCE_FEATURE.POS);

    const taxSettings = useTaxSettings(canReadTax);
    const taxClasses = useTaxClasses(canReadTax);
    const locations = useLocations(canReadStock);
    const pin = useMyPinStatus(canReadPin);

    const loading =
        (canReadTax && (taxSettings.isLoading || taxClasses.isLoading)) ||
        (canReadStock && locations.isLoading) ||
        (canReadPin && pin.isLoading);

    const items = useMemo(
        () =>
            buildSetupChecklist({
                taxSettings: taxSettings.data,
                taxClasses: taxClasses.data,
                locations: locations.data,
                hasPin: pin.data?.has_pin,
            }),
        [taxSettings.data, taxClasses.data, locations.data, pin.data]
    );
    const progress = useMemo(() => setupProgress(items), [items]);
    const blocking = progress.remaining.filter((item) => item.blocksOrders);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-title font-medium">{t('checklist.title')}</CardTitle>
                <CardDescription className="text-body">
                    {loading
                        ? t('checklist.checking')
                        : t('checklist.progress', {
                              done: progress.done,
                              total: progress.actionable,
                          })}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {!loading && blocking.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-warning-600" />
                        <span>
                            {t('checklist.blocking', {
                                items: blocking
                                    .map((item) => t(`checklist.items.${item.id}.title`))
                                    .join(', '),
                            })}
                        </span>
                    </div>
                )}
                {loading ? (
                    <CommerceLoadingRows rows={4} />
                ) : (
                    <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {items.map((item) => {
                            const row = (
                                <div className="flex items-center gap-3 p-3 sm:p-4">
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-caption tabular-nums text-neutral-600">
                                        {item.number}
                                    </span>
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-body font-medium text-foreground">
                                            {t(`checklist.items.${item.id}.title`)}
                                        </span>
                                        <span className="text-caption text-muted-foreground">
                                            {t(`checklist.items.${item.id}.description`)}
                                        </span>
                                    </div>
                                    <CommerceStatusChip kind="setup" value={item.status} />
                                    {item.to && (
                                        <ArrowRight
                                            size={16}
                                            className="shrink-0 text-muted-foreground rtl:rotate-180"
                                        />
                                    )}
                                </div>
                            );
                            return (
                                <li key={item.id}>
                                    {item.to ? (
                                        <Link
                                            to={item.to as never}
                                            className="block hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                        >
                                            {row}
                                        </Link>
                                    ) : (
                                        row
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                )}
            </CardContent>
        </Card>
    );
}
