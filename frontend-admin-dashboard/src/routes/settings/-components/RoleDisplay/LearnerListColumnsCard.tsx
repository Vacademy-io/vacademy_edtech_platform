import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { LearnerListColumnSettings } from '@/types/display-settings';
import {
    getCustomFieldSettings,
    getCustomFieldSettingsFromCache,
    type CustomFieldSettingsData,
} from '@/services/custom-field-settings';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Membership columns shown only when the institute has org-associated batches.
// They follow the opt-in pattern (hidden by default) — admin explicitly enables them.
// Accessors MUST match the column ids in `myColumns` (table-column-data.tsx).
const buildMembershipColumns = (t: TFunction): { accessor: string; label: string }[] => [
    { accessor: 'membership_role', label: t('membershipColumns.membershipRole') },
    { accessor: 'membership_type', label: t('membershipColumns.membershipType') },
];

// Stable list of admin-controlled system columns + their human labels. The
// accessors here MUST match the column ids in `myColumns` (table-column-data.tsx)
// AND the SYSTEM_FIELD_KEY_TO_ACCESSOR mapping. Filter-driven columns
// (Batch/Invite/Plan/Amount/Preferred Batch) are intentionally omitted — they're
// gated by filter state, never by role.
const buildSystemColumns = (t: TFunction): { accessor: string; label: string }[] => [
    { accessor: 'full_name', label: t('systemColumns.fullName') },
    { accessor: 'username', label: t('systemColumns.username') },
    { accessor: 'institute_enrollment_number', label: t('systemColumns.enrollmentNumber') },
    { accessor: 'linked_institute_name', label: t('systemColumns.collegeSchool') },
    { accessor: 'gender', label: t('systemColumns.gender') },
    { accessor: 'mobile_number', label: t('systemColumns.mobileNumber') },
    { accessor: 'email', label: t('systemColumns.emailId') },
    { accessor: 'fathers_name', label: t('systemColumns.fathersName') },
    { accessor: 'mothers_name', label: t('systemColumns.mothersName') },
    { accessor: 'parents_mobile_number', label: t('systemColumns.fathersMobileNumber') },
    { accessor: 'parents_email', label: t('systemColumns.fathersEmail') },
    { accessor: 'parents_to_mother_mobile_number', label: t('systemColumns.mothersMobileNumber') },
    { accessor: 'parents_to_mother_email', label: t('systemColumns.mothersEmail') },
    { accessor: 'city', label: t('systemColumns.city') },
    { accessor: 'region', label: t('systemColumns.state') },
    { accessor: 'attendance_percent', label: t('systemColumns.attendance') },
    { accessor: 'country', label: t('systemColumns.country') },
    { accessor: 'expiry_date', label: t('systemColumns.sessionExpiry') },
    { accessor: 'status', label: t('systemColumns.status') },
    { accessor: 'referral_count', label: t('systemColumns.referralsCount') },
    { accessor: 'counsellor', label: t('systemColumns.counsellor') },
    { accessor: 'billing_contact_name', label: t('systemColumns.billingContactName') },
    { accessor: 'billing_contact_email', label: t('systemColumns.billingContactEmail') },
    { accessor: 'billing_contact_role', label: t('systemColumns.billingContactRole') },
];

interface LearnerListColumnsCardProps {
    settings: LearnerListColumnSettings | undefined;
    onChange: (next: LearnerListColumnSettings) => void;
}

export const LearnerListColumnsCard = ({ settings, onChange }: LearnerListColumnsCardProps) => {
    const { t } = useTranslation('settingsLearnerListColumnsCard');
    const learnerLabel = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const systemColumns = useMemo(() => buildSystemColumns(t), [t]);
    const membershipColumns = useMemo(() => buildMembershipColumns(t), [t]);
    const hidden = useMemo(() => new Set(settings?.hiddenColumns ?? []), [settings?.hiddenColumns]);
    // Custom fields default OFF — admin opts in per role. enabledCustomFields is the
    // explicit allow-list; missing/empty means no custom fields visible for this role.
    const enabledCustom = useMemo(
        () => new Set(settings?.enabledCustomFields ?? []),
        [settings?.enabledCustomFields]
    );

    // Source the custom-field catalogue from the institute settings. Cache-first; if it's
    // missing (admin landed here without hitting the Custom Fields page first), fetch.
    // The institute-wide visibility.learnersList flag is intentionally ignored — role
    // display-settings is the single source of truth for learner-list column visibility.
    const [fieldData, setFieldData] = useState<CustomFieldSettingsData | null>(() =>
        getCustomFieldSettingsFromCache()
    );

    useEffect(() => {
        if (fieldData) return;
        let cancelled = false;
        getCustomFieldSettings()
            .then((data) => {
                if (!cancelled) setFieldData(data);
            })
            .catch((err) => console.error('Failed to load custom fields for role card', err));
        return () => {
            cancelled = true;
        };
    }, [fieldData]);

    const customColumns = useMemo(() => {
        if (!fieldData) return [] as { accessor: string; label: string }[];
        const all = [
            ...fieldData.instituteFields,
            ...fieldData.customFields,
            ...fieldData.fieldGroups.flatMap((g) => g.fields),
        ];
        const byId = new Map<string, { accessor: string; label: string }>();
        for (const f of all) {
            if (!f.id) continue;
            if (!byId.has(f.id)) byId.set(f.id, { accessor: f.id, label: f.name });
        }
        return Array.from(byId.values());
    }, [fieldData]);

    // Count badges show by default; only false when explicitly turned off.
    const showCountBadges = settings?.showCountBadges !== false;

    // System columns: toggling off ADDS to hiddenColumns (default visible).
    const setSystemVisible = (accessor: string, visible: boolean) => {
        const nextHidden = new Set(hidden);
        if (visible) nextHidden.delete(accessor);
        else nextHidden.add(accessor);
        onChange({
            hiddenColumns: Array.from(nextHidden),
            enabledCustomFields: settings?.enabledCustomFields,
            showCountBadges: settings?.showCountBadges,
        });
    };

    // Custom fields: toggling on ADDS to enabledCustomFields (default hidden).
    const setCustomVisible = (accessor: string, visible: boolean) => {
        const nextEnabled = new Set(enabledCustom);
        if (visible) nextEnabled.add(accessor);
        else nextEnabled.delete(accessor);
        onChange({
            hiddenColumns: settings?.hiddenColumns ?? [],
            enabledCustomFields: Array.from(nextEnabled),
            showCountBadges: settings?.showCountBadges,
        });
    };

    const setShowCountBadges = (visible: boolean) => {
        onChange({
            hiddenColumns: settings?.hiddenColumns ?? [],
            enabledCustomFields: settings?.enabledCustomFields,
            showCountBadges: visible,
        });
    };

    const renderSystemRow = ({ accessor, label }: { accessor: string; label: string }) => {
        const visible = !hidden.has(accessor);
        return (
            <div
                key={accessor}
                className="flex items-center justify-between border-b border-neutral-100 py-2 last:border-b-0"
            >
                <Label className="text-sm text-neutral-700">{label}</Label>
                <Switch checked={visible} onCheckedChange={(v) => setSystemVisible(accessor, v)} />
            </div>
        );
    };

    const renderCustomRow = ({ accessor, label }: { accessor: string; label: string }) => {
        const visible = enabledCustom.has(accessor);
        return (
            <div
                key={accessor}
                className="flex items-center justify-between border-b border-neutral-100 py-2 last:border-b-0"
            >
                <Label className="text-sm text-neutral-700">{label}</Label>
                <Switch checked={visible} onCheckedChange={(v) => setCustomVisible(accessor, v)} />
            </div>
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('header.title', { learnerLabel })}</CardTitle>
                <CardDescription>
                    {t('header.description', { learnerLabelLower: learnerLabel.toLowerCase() })}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-600">
                        {t('headerSection.title')}
                    </h4>
                    <div className="flex items-center justify-between border-b border-neutral-100 py-2 last:border-b-0">
                        <Label className="text-sm text-neutral-700">
                            {t('headerSection.countBadges')}
                        </Label>
                        <Switch
                            checked={showCountBadges}
                            onCheckedChange={(v) => setShowCountBadges(v)}
                        />
                    </div>
                </div>
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-600">
                        {t('systemColumns.title')}
                    </h4>
                    <div className="flex flex-col">{systemColumns.map(renderSystemRow)}</div>
                </div>
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-600">
                        {t('membershipColumns.title')}
                    </h4>
                    <p className="mb-2 text-xs text-neutral-400">
                        {t('membershipColumns.description')}
                    </p>
                    <div className="flex flex-col">{membershipColumns.map(renderCustomRow)}</div>
                </div>
                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-600">
                        {t('customFieldColumns.title')}
                    </h4>
                    <p className="mb-2 text-xs text-neutral-400">
                        {t('customFieldColumns.description')}
                    </p>
                    {fieldData == null ? (
                        <p className="text-xs text-neutral-400">
                            {t('customFieldColumns.loading')}
                        </p>
                    ) : customColumns.length > 0 ? (
                        <div className="flex flex-col">{customColumns.map(renderCustomRow)}</div>
                    ) : (
                        <p className="text-xs text-neutral-500">
                            {t('customFieldColumns.empty')}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
