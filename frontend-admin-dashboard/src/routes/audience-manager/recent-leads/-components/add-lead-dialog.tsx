import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
    filterByCampaignTypes,
} from '../../list/-utils/campaign-types';

export interface AddLeadAudienceOption {
    id: string;
    name: string;
    campaignType?: string | null;
    status?: string | null;
}

interface AddLeadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    audiences: AddLeadAudienceOption[];
    isLoading: boolean;
    /** Institute's naming for "Campaign Type" and "Audience List". */
    campaignTypeTerm: string;
    audienceTerm: string;
    /** The page the form returns to once the lead is saved. */
    from?: 'all-leads' | 'lead-lookup';
    /** Check Lead → the phone / email just searched, so it isn't typed twice. */
    prefill?: { phone?: string; email?: string };
}

// Audiences saved without a campaign type still need a way in.
const NO_TYPE_VALUE = '__no_type__';

/**
 * All Leads → "Add New Lead": pick a campaign type, then one of its audiences,
 * then continue to that audience's own add-lead form
 * (/audience-manager/list/campaign-users/add) with `from=all-leads`, which is
 * what makes the form assign the lead (to the counsellor filling it, or to the
 * counsellor an admin picks) and return here afterwards. Check Lead opens the
 * same dialog with `from=lead-lookup` and the number / address it just searched.
 *
 * Only ACTIVE audiences are offered — the submit endpoint rejects any other.
 */
export const AddLeadDialog = ({
    open,
    onOpenChange,
    audiences,
    isLoading,
    campaignTypeTerm,
    audienceTerm,
    from = 'all-leads',
    prefill,
}: AddLeadDialogProps) => {
    const { t } = useTranslation('audienceManagerAddLeadDialog');
    const { t: tCampaignType } = useTranslation('audienceManagerCampaignTypeDropdown');
    const navigate = useNavigate();
    const [campaignType, setCampaignType] = useState('');
    const [audienceId, setAudienceId] = useState('');

    useEffect(() => {
        if (!open) {
            setCampaignType('');
            setAudienceId('');
        }
    }, [open]);

    const activeAudiences = useMemo(
        () => audiences.filter((a) => (a.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE'),
        [audiences]
    );

    // Only types that have at least one active audience — a type with nothing
    // behind it would lead to an empty second dropdown.
    const typeOptions = useMemo(() => {
        const all = buildCampaignTypeFilterOptions(
            buildDefaultCampaignTypeOptions(tCampaignType),
            activeAudiences.map((a) => a.campaignType)
        );
        const options = all
            .filter((opt) => filterByCampaignTypes(activeAudiences, [opt.value]).length > 0)
            .map((opt) => ({ value: opt.value, label: opt.label }));
        if (activeAudiences.some((a) => !a.campaignType?.trim())) {
            options.push({ value: NO_TYPE_VALUE, label: t('noCampaignType') });
        }
        return options;
    }, [activeAudiences, tCampaignType, t]);

    const audienceOptions = useMemo(() => {
        if (!campaignType) return [];
        const matching =
            campaignType === NO_TYPE_VALUE
                ? activeAudiences.filter((a) => !a.campaignType?.trim())
                : filterByCampaignTypes(activeAudiences, [campaignType]);
        return matching
            .map((a) => ({ value: a.id, label: a.name }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [activeAudiences, campaignType]);

    const selectedAudience = activeAudiences.find((a) => a.id === audienceId);

    const handleContinue = () => {
        if (!selectedAudience) return;
        onOpenChange(false);
        void navigate({
            to: '/audience-manager/list/campaign-users/add',
            search: {
                campaignId: selectedAudience.id,
                campaignName: selectedAudience.name,
                from,
                prefillPhone: prefill?.phone || undefined,
                prefillEmail: prefill?.email || undefined,
            },
        });
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-md"
            footer={
                <div className="flex w-full justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!selectedAudience}
                        onClick={handleContinue}
                    >
                        {t('continue')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-5 p-6">
                <p className="text-body text-neutral-600">{t('description', { audienceTerm })}</p>
                {!isLoading && typeOptions.length === 0 ? (
                    <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-center text-body text-neutral-500">
                        {t('emptyState', { audienceTerm: audienceTerm.toLowerCase() })}
                    </p>
                ) : (
                    <>
                        <div className="flex flex-col gap-2">
                            <Label className="text-body font-medium text-neutral-700">
                                {campaignTypeTerm}
                            </Label>
                            <SearchableSelect
                                options={typeOptions}
                                value={campaignType}
                                onChange={(value) => {
                                    setCampaignType(value);
                                    setAudienceId('');
                                }}
                                placeholder={
                                    isLoading
                                        ? t('loading')
                                        : t('selectPlaceholder', { term: campaignTypeTerm })
                                }
                                searchPlaceholder={t('searchPlaceholder')}
                                emptyText={t('noResults')}
                                disabled={isLoading}
                                portal={false}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className="text-body font-medium text-neutral-700">
                                {audienceTerm}
                            </Label>
                            <SearchableSelect
                                options={audienceOptions}
                                value={audienceId}
                                onChange={setAudienceId}
                                placeholder={
                                    campaignType
                                        ? t('selectPlaceholder', { term: audienceTerm })
                                        : t('pickTypeFirst', { term: campaignTypeTerm })
                                }
                                searchPlaceholder={t('searchPlaceholder')}
                                emptyText={t('noResults')}
                                disabled={!campaignType}
                                portal={false}
                            />
                        </div>
                    </>
                )}
            </div>
        </MyDialog>
    );
};

export default AddLeadDialog;
