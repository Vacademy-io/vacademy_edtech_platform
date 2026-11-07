import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { CampaignUsersTable } from '../-components/campaign-users/campaign-users-table';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { CaretLeft } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';

const NAMESPACE = 'audienceManagerCampaignUsersIndex';

/**
 * Fallback translate function for the zod search-param schema, which is
 * built at module scope (outside any React render tree) so it cannot use
 * the `useTranslation` hook. Uses the shared i18next singleton directly.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

function buildCampaignUsersSearchSchema(t: TFunction) {
    return z.object({
        campaignId: z.string().min(1, t('schema.campaignIdRequired')),
        campaignName: z.string().optional(),
        customFields: z.string().optional(), // JSON string of custom fields
        campaignType: z.string().optional(),
    });
}

const campaignUsersSearchSchema = buildCampaignUsersSearchSchema(globalT);

export const Route = createFileRoute('/audience-manager/list/campaign-users/')({
    component: CampaignUsersPage,
    validateSearch: campaignUsersSearchSchema,
});

export function CampaignUsersPage() {
    const { t } = useTranslation(NAMESPACE);
    const { setNavHeading } = useNavHeadingStore();
    const search = useSearch({ from: Route.id });
    const navigate = useNavigate();
    const audienceTerm = getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList);
    const audienceTermPlural = getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList);

    useEffect(() => {
        setNavHeading(t('navHeading', { audienceTerm }));
    }, [setNavHeading, t, audienceTerm]);

    const handleBack = () => {
        // Both routes are in the generated tree now, so this navigation is fully typed.
        // `to` takes the route path without a trailing slash (the id keeps one).
        navigate({ from: Route.id, to: '/audience-manager/list' });
    };

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('helmet.title', { audienceTerm })}</title>
                <meta
                    name="description"
                    content={t('helmet.description', { audienceTerm: audienceTerm.toLowerCase() })}
                />
            </Helmet>
            <div className="flex w-full flex-col gap-6">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBack}
                    className="w-fit text-neutral-600 hover:text-neutral-900"
                >
                    <CaretLeft className="mr-1.5 size-4" />
                    {t('backButton', { audienceTermPlural })}
                </Button>
                {search.campaignId ? (
                    <CampaignUsersTable
                        campaignId={search.campaignId}
                        campaignName={search.campaignName}
                        customFieldsJson={search.customFields}
                        campaignType={search.campaignType}
                    />
                ) : (
                    <div className="flex w-full flex-col items-center justify-center gap-2 py-20">
                        <p className="text-danger-600">{t('missingCampaignId')}</p>
                    </div>
                )}
            </div>
        </LayoutContainer>
    );
}
