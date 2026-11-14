import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, Storefront } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CATALOG_API_DOCS_URL } from '../../-services/catalog-api';
import { WebsitesSection } from './WebsitesSection';
import { PublishableKeysSection } from './PublishableKeysSection';
import { CourseAddressSection } from './CourseAddressSection';

/**
 * Settings → Integrations → "Catalogue API & websites" (catalog-api-spec.md §1, §3, §4).
 * An institute's own website lists its published courses and sends enquiries with a
 * publishable key that only works from the websites verified here. Admin-only on the
 * server (the usual institute-access checks); a refused call shows its error inline.
 */
export function CatalogApiCard() {
    const { t } = useTranslation('settingsIntegration');
    const instituteId = getCurrentInstituteId() ?? '';

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Storefront className="size-4 text-primary-500" />
                    {t('catalogApi.title')}
                </CardTitle>
                <CardDescription>{t('catalogApi.description')}</CardDescription>
                <a
                    href={CATALOG_API_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-fit items-center gap-1 pt-1 text-caption text-primary-500 underline"
                >
                    {t('catalogApi.docs')}
                    <ArrowSquareOut className="size-3" />
                </a>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <WebsitesSection instituteId={instituteId} />
                <Separator />
                <PublishableKeysSection instituteId={instituteId} />
                <Separator />
                <CourseAddressSection instituteId={instituteId} />
            </CardContent>
        </Card>
    );
}
