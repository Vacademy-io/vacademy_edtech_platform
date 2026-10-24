import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { fetchCampaignLeads } from '@/routes/audience-manager/list/-services/get-campaign-users';
import { SUBMIT_CATALOGUE_LEAD_URL, AUDIENCE_CAMPAIGN } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Fields a website form list starts with. Richer fields stay in Audience Manager.
 * `phoneRequired` is for the Freebies list, where the phone is what a
 * counsellor calls back on.
 */
export const websiteFormFields = (
    instituteId: string | null | undefined,
    phoneRequired = false
) => {
    const mkField = (
        fieldName: string,
        fieldType: string,
        isMandatory: boolean,
        order: number
    ) => ({
        instituteId,
        type: 'AUDIENCE_FORM',
        groupName: '',
        individualOrder: order,
        groupInternalOrder: 0,
        isMandatory,
        status: 'ACTIVE',
        customField: {
            fieldName,
            fieldType,
            defaultValue: '',
            config: '{}',
            formOrder: order,
            isMandatory,
            status: 'ACTIVE',
        },
    });
    return [
        mkField('Full Name', 'TEXT', true, 1),
        mkField('Email', 'TEXT', true, 2),
        mkField('Phone Number', 'TEXT', phoneRequired, 3),
    ];
};

/**
 * Campaign (audience list) picker — the shared "where do these leads go?"
 * control for every website capture point. Lists the institute's ACTIVE
 * campaigns from Audience Manager; the empty choice means the auto-provisioned
 * default website-leads list.
 */
export const CampaignPicker = ({
    value,
    onChange,
    label,
    allowEmpty = true,
}: {
    value: string;
    onChange: (id: string, name: string) => void;
    label?: string;
    allowEmpty?: boolean;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const resolvedLabel = label ?? t('campaignPicker.sendResponsesTo');
    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        ...handleFetchCampaignsList({
            institute_id: instituteId || '',
            status: 'ACTIVE',
            page: 0,
            size: 100,
        }),
        enabled: !!instituteId,
    });
    const campaigns = ((data?.content || []) as any[])
        .map((c) => ({ id: c.id || c.audience_id || c.campaign_id, name: c.campaign_name }))
        .filter((c) => c.id);

    // Inline creation: without it, "connect a form" meant leaving the editor
    // for Audience Manager, building a campaign + its fields, and finding the
    // way back — the single most common place a non-technical admin lost the
    // thread. A new campaign here starts with Name / Email / Phone, which is
    // what a website enquiry form needs; richer fields stay in Audience Manager.
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const createMutation = useMutation({
        mutationFn: async (campaignName: string) => {
            const { data: newId } = await axios.post(
                AUDIENCE_CAMPAIGN,
                {
                    institute_id: instituteId,
                    campaign_name: campaignName,
                    campaign_type: 'WEBSITE',
                    campaign_objective: 'LEAD_GENERATION',
                    description: 'Created from the website builder',
                    status: 'ACTIVE',
                    institute_custom_fields: websiteFormFields(instituteId),
                },
                { headers: { Authorization: `Bearer ${getTokenFromCookie(TokenKey.accessToken)}` } }
            );
            return { id: String(newId).replace(/^"|"$/g, ''), name: campaignName };
        },
        onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: ['campaignsList'] });
            onChange(created.id, created.name);
            setCreating(false);
            setNewName('');
        },
    });

    return (
        <div>
            <Label className="text-xs">{resolvedLabel}</Label>
            <select
                className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                value={value || ''}
                onChange={(e) => {
                    const picked = campaigns.find((c) => c.id === e.target.value);
                    onChange(e.target.value, picked?.name || '');
                }}
            >
                <option value="">
                    {isLoading
                        ? t('campaignPicker.loadingCampaigns')
                        : allowEmpty
                          ? t('campaignPicker.defaultWebsiteLeadsList')
                          : t('campaignPicker.selectCampaign')}
                </option>
                {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
            {creating ? (
                <div className="mt-2 space-y-2 rounded border border-primary-200 bg-primary-50 p-2">
                    <Label className="text-xs">{t('campaignPicker.newCampaignName')}</Label>
                    <Input
                        autoFocus
                        className="mt-1"
                        placeholder={t('campaignPicker.newCampaignNamePlaceholder')}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newName.trim())
                                createMutation.mutate(newName.trim());
                            if (e.key === 'Escape') setCreating(false);
                        }}
                    />
                    <p className="text-caption text-gray-500">
                        {t('campaignPicker.newCampaignHint')}
                    </p>
                    <div className="flex gap-1">
                        <Button
                            size="sm"
                            className="h-7 text-caption"
                            disabled={!newName.trim() || createMutation.isPending}
                            onClick={() => createMutation.mutate(newName.trim())}
                        >
                            {createMutation.isPending
                                ? t('campaignPicker.creating')
                                : t('campaignPicker.createAndUse')}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-caption"
                            onClick={() => setCreating(false)}
                        >
                            {t('actions.cancel')}
                        </Button>
                    </div>
                    {createMutation.isError && (
                        <p className="text-caption text-danger-600">
                            {t('campaignPicker.createError')}
                        </p>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="mt-1 text-caption font-medium text-primary-500 hover:underline"
                >
                    + {t('campaignPicker.newCampaign')}
                </button>
            )}
            <p className="mt-1 text-caption text-gray-400">
                {t('campaignPicker.campaignsFromHint')}
            </p>
            {value && <CampaignHealth audienceId={value} />}
        </div>
    );
};

/**
 * Proof-of-life under every campaign picker: how many leads this campaign has
 * ever received, when the last one arrived, and a one-click test submission
 * that exercises the REAL public pipeline end-to-end.
 *
 * WHY: capture failures here have historically been silent — the contact form
 * discarded every submission for months while looking perfectly healthy. An
 * admin placing a form must be able to see “it works” without leaving the
 * editor or waiting for a real visitor.
 */
const CampaignHealth = ({ audienceId }: { audienceId: string }) => {
    const { t, i18n } = useTranslation('managePagesPropertyPanel');
    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['CAMPAIGN_HEALTH', audienceId],
        queryFn: async () => {
            const res = await fetchCampaignLeads({
                audience_id: audienceId,
                conversion_status_filter: 'ALL',
                page: 0,
                size: 1,
                sort_by: 'submittedAt',
                sort_direction: 'DESC',
            } as any);
            const rows = (res as any)?.content || [];
            return {
                total: (res as any)?.totalElements ?? 0,
                lastAt: rows[0]?.submitted_at_local as string | undefined,
            };
        },
        enabled: !!audienceId,
        staleTime: 30_000,
    });

    const testMutation = useMutation({
        mutationFn: async () => {
            // The exact endpoint + shape the live site submits through — if this
            // round-trips, a visitor's submission will too.
            const stamp = Date.now();
            await axios.post(SUBMIT_CATALOGUE_LEAD_URL, {
                institute_id: instituteId,
                audience_id: audienceId,
                full_name: 'TEST LEAD — sent from the page builder',
                email: `test-lead-${stamp}@test.vacademy.io`,
                mobile_number: '',
                source_type: 'TEST_SUBMISSION',
                source_id: 'builder-test-lead',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['CAMPAIGN_HEALTH', audienceId] });
        },
    });

    return (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
            <span className="text-caption text-gray-500">
                {isLoading
                    ? t('campaignHealth.checkingSubmissions')
                    : data?.lastAt
                      ? t('campaignHealth.leadsReceivedWithLast', {
                            count: data?.total ?? 0,
                            date: new Date(data.lastAt).toLocaleDateString(i18n.language),
                        })
                      : t('campaignHealth.leadsReceived', { count: data?.total ?? 0 })}
            </span>
            <button
                type="button"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="rounded px-2 py-0.5 text-caption font-medium text-primary-500 hover:bg-primary-50 disabled:opacity-50"
            >
                {testMutation.isPending
                    ? t('campaignHealth.sending')
                    : testMutation.isSuccess
                      ? t('campaignHealth.testLeadDelivered')
                      : testMutation.isError
                        ? t('campaignHealth.failedRetry')
                        : t('campaignHealth.sendTestLead')}
            </button>
        </div>
    );
};
