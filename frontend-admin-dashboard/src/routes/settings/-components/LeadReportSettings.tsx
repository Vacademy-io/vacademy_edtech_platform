/**
 * LeadReportSettings — the "Reports" config card on Settings → Lead settings →
 * Configuration. Controls the three institute-level knobs the Reports Center
 * SQL honours:
 *
 *   1. Report timezone        → all day/hour bucketing (AT TIME ZONE)
 *   2. Connected call statuses → which telephony CALL_STATUS values count as
 *                                a "connected" call (connect-rate etc.)
 *   3. Interested statuses     → which lead-status keys count as "interested"
 *                                in source/funnel reports
 *
 * Persisted at LEAD_SETTING.data.reports (snake_case subtree). The save path
 * READ-MODIFY-WRITES the whole LEAD_SETTING data object — fetch current, merge
 * only the reports subtree, save — so sibling keys (enabled, scoringWeights,
 * workbench, …) are never clobbered.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ChartBar } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MultiSelect, type OptionType } from '@/components/design-system/multi-select';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useLeadStatuses } from '@/hooks/use-lead-statuses';
import { DEFAULT_CUSTOM_LEAD_STATUSES } from '@/hooks/use-lead-settings';
import {
    LEAD_REPORT_SETTINGS_QUERY_KEY,
    TELEPHONY_CALL_STATUSES,
    fetchLeadReportSettings,
    fetchLeadSettingRawData,
    humanizeCallStatus,
    type LeadReportSettings as LeadReportSettingsValues,
    type LeadReportSettingsSubtree,
} from '@/hooks/use-lead-report-settings';

const SETTING_KEY = 'LEAD_SETTING';
// Mirrors LeadSettings.tsx — the institute-settings save endpoint.
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

/**
 * Curated IANA timezones — default (Asia/Kolkata) first, then the rest in
 * west-to-east offset order. Extend the list if an institute outside these
 * regions onboards; the value is a free-form IANA id on the backend, only
 * this picker is curated. Exported so other timezone
 * pickers (Settings > Language Settings) share one curated list.
 */
export const REPORT_TIMEZONES = [
    'Asia/Kolkata',
    'Pacific/Honolulu',
    'America/Anchorage',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/Mexico_City',
    'America/New_York',
    'America/Bogota',
    'America/Halifax',
    'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires',
    'Europe/London',
    'Europe/Lisbon',
    'Africa/Lagos',
    'Europe/Paris',
    'Africa/Johannesburg',
    'Europe/Athens',
    'Europe/Istanbul',
    'Africa/Nairobi',
    'Europe/Moscow',
    'Asia/Riyadh',
    'Asia/Tehran',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Colombo',
    'Asia/Kathmandu',
    'Asia/Dhaka',
    'Asia/Bangkok',
    'Asia/Jakarta',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Manila',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Perth',
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
] as const;

const CALL_STATUS_OPTIONS: OptionType[] = TELEPHONY_CALL_STATUSES.map((s) => ({
    value: s,
    label: humanizeCallStatus(s),
}));

async function saveReportSettings(next: LeadReportSettingsValues): Promise<void> {
    const instituteId = getCurrentInstituteId();
    // Read-modify-write: fetch the CURRENT full data object right before saving
    // so concurrent edits to sibling subtrees aren't clobbered.
    const current = await fetchLeadSettingRawData();
    const reports: LeadReportSettingsSubtree = {
        timezone: next.timezone,
        connected_call_statuses: next.connectedCallStatuses,
        interested_status_keys: next.interestedStatusKeys,
    };
    const merged = { ...current, reports };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: merged },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
}

export default function LeadReportSettings() {
    const { t } = useTranslation('settingsLeadReport');
    const queryClient = useQueryClient();

    const { data: saved, isLoading } = useQuery({
        queryKey: LEAD_REPORT_SETTINGS_QUERY_KEY,
        queryFn: fetchLeadReportSettings,
        staleTime: 5 * 60 * 1000,
    });

    // Institute lead-status catalog → options for the "interested" picker.
    const { statuses, isLoading: statusesLoading } = useLeadStatuses();
    const statusOptions: OptionType[] =
        statuses.length > 0
            ? statuses
                  .filter((s) => s.is_active)
                  .map((s) => ({ value: s.status_key, label: s.label }))
            : // Catalog empty / unreachable — fall back to the starter pipeline keys.
              DEFAULT_CUSTOM_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }));

    const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
    const [connectedStatuses, setConnectedStatuses] = useState<string[]>(['COMPLETED']);
    const [interestedKeys, setInterestedKeys] = useState<string[]>(['INTERESTED']);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (saved) {
            setTimezone(saved.timezone);
            setConnectedStatuses(saved.connectedCallStatuses);
            setInterestedKeys(saved.interestedStatusKeys);
            setHasChanges(false);
        }
    }, [saved]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveReportSettings,
        onSuccess: () => {
            toast.success(t('toasts.saved'));
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: LEAD_REPORT_SETTINGS_QUERY_KEY });
            // Other lead-settings consumers re-read the merged LEAD_SETTING object.
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
            queryClient.invalidateQueries({ queryKey: ['lead-settings'] });
        },
        onError: () => {
            toast.error(t('toasts.saveFailed'));
        },
    });

    const handleSave = () => {
        if (connectedStatuses.length === 0) {
            toast.error(t('toasts.connectedRequired'));
            return;
        }
        if (interestedKeys.length === 0) {
            toast.error(t('toasts.interestedRequired'));
            return;
        }
        save({
            timezone,
            connectedCallStatuses: connectedStatuses,
            interestedStatusKeys: interestedKeys,
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ChartBar size={18} className="text-neutral-500" />
                    {t('title')}
                </CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="text-sm text-muted-foreground">{t('loading')}</div>
                ) : (
                    <div className="flex flex-col gap-5">
                        {/* Timezone */}
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="report-timezone">{t('timezone.label')}</Label>
                            <p className="text-xs text-muted-foreground">{t('timezone.hint')}</p>
                            <Select
                                value={timezone}
                                onValueChange={(v) => {
                                    setTimezone(v);
                                    setHasChanges(true);
                                }}
                            >
                                <SelectTrigger id="report-timezone" className="w-full max-w-sm">
                                    <SelectValue placeholder={t('timezone.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {REPORT_TIMEZONES.map((tz) => (
                                        <SelectItem key={tz} value={tz}>
                                            {tz}
                                        </SelectItem>
                                    ))}
                                    {/* Keep a previously saved non-curated zone selectable. */}
                                    {!(REPORT_TIMEZONES as readonly string[]).includes(
                                        timezone
                                    ) && <SelectItem value={timezone}>{timezone}</SelectItem>}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Connected call statuses */}
                        <div className="flex flex-col gap-1.5">
                            <Label>{t('connectedStatuses.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('connectedStatuses.hint')}
                            </p>
                            <MultiSelect
                                options={CALL_STATUS_OPTIONS}
                                selected={connectedStatuses}
                                onChange={(v) => {
                                    setConnectedStatuses(v);
                                    setHasChanges(true);
                                }}
                                placeholder={t('connectedStatuses.placeholder')}
                                className="max-w-sm"
                            />
                        </div>

                        {/* Interested statuses */}
                        <div className="flex flex-col gap-1.5">
                            <Label>{t('interestedStatuses.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('interestedStatuses.hint')}
                            </p>
                            <MultiSelect
                                options={statusOptions}
                                selected={interestedKeys}
                                onChange={(v) => {
                                    setInterestedKeys(v);
                                    setHasChanges(true);
                                }}
                                placeholder={
                                    statusesLoading
                                        ? t('interestedStatuses.placeholderLoading')
                                        : t('interestedStatuses.placeholder')
                                }
                                disabled={statusesLoading}
                                className="max-w-sm"
                            />
                        </div>

                        <div className="flex items-center justify-end">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSave}
                                disable={saving || !hasChanges}
                            >
                                {saving ? t('save.saving') : t('save.button')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
