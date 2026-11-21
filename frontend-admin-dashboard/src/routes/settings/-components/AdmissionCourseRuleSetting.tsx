/**
 * What happens when a lead is moved to the institute's admission status (key CONVERTED,
 * e.g. "Admission Taken") while the person has no course or fee plan here yet.
 *
 *   OFF   — nothing is checked (the default for every institute);
 *   WARN  — staff see a confirmation first and can go ahead;
 *   BLOCK — staff changes are refused until a course or fee plan is added.
 *
 * Automations, AI calls and enrolment are never held back: an enrolment is what attaches
 * the course. Persisted at LEAD_SETTING.data.admissionCourseRule.mode and read by
 * admin_core_service AdmissionCourseRuleService. The save read-modify-writes the WHOLE
 * LEAD_SETTING data object so sibling keys are never clobbered.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchLeadSettingRawData } from '@/hooks/use-lead-report-settings';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AdmissionCourseMode } from '@/components/shared/leads/services/admission-check';

const SETTING_KEY = 'LEAD_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const QUERY_KEY = ['lead-settings', 'admission-course-rule'];
const MODES: AdmissionCourseMode[] = ['OFF', 'WARN', 'BLOCK'];

function toMode(value: unknown): AdmissionCourseMode {
    const mode = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return (MODES as string[]).includes(mode) ? (mode as AdmissionCourseMode) : 'OFF';
}

async function fetchMode(): Promise<AdmissionCourseMode> {
    const raw = await fetchLeadSettingRawData();
    const rule = raw['admissionCourseRule'] as { mode?: unknown } | undefined;
    return toMode(rule?.mode);
}

async function saveMode(mode: AdmissionCourseMode): Promise<void> {
    const instituteId = getCurrentInstituteId();
    // Read-modify-write: the CURRENT full object right before saving, so a concurrent
    // edit to a sibling subtree isn't lost.
    const current = await fetchLeadSettingRawData();
    const merged = { ...current, admissionCourseRule: { mode } };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: merged },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
}

export default function AdmissionCourseRuleSetting({ statusLabel }: { statusLabel: string }) {
    const { t } = useTranslation('settingsLeadStatusesManager');
    const queryClient = useQueryClient();
    const {
        data: saved,
        isLoading,
        isError,
    } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: fetchMode,
        staleTime: 60 * 1000,
    });
    const [mode, setMode] = useState<AdmissionCourseMode>('OFF');

    useEffect(() => {
        if (saved) setMode(saved);
    }, [saved]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveMode,
        onSuccess: () => {
            toast.success(t('admissionRule.saved'));
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
            queryClient.invalidateQueries({ queryKey: ['admission-check'] });
        },
        onError: () => toast.error(t('admissionRule.saveFailed')),
    });

    const options: { value: AdmissionCourseMode; title: string; hint: string }[] = [
        { value: 'OFF', title: t('admissionRule.off'), hint: t('admissionRule.offHint') },
        { value: 'WARN', title: t('admissionRule.warn'), hint: t('admissionRule.warnHint') },
        {
            value: 'BLOCK',
            title: t('admissionRule.block'),
            hint: t('admissionRule.blockHint', { status: statusLabel }),
        },
    ];

    return (
        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
            <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-neutral-800">
                    {t('admissionRule.title', { status: statusLabel })}
                </p>
                <p className="text-xs text-muted-foreground">{t('admissionRule.description')}</p>
            </div>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : isError ? (
                <p className="text-sm text-danger-600">{t('admissionRule.loadFailed')}</p>
            ) : (
                <>
                    <RadioGroup
                        value={mode}
                        onValueChange={(v) => setMode(toMode(v))}
                        className="gap-2"
                    >
                        {options.map((o) => (
                            <div
                                key={o.value}
                                className={cn(
                                    'flex items-start gap-3 rounded-md border p-3',
                                    mode === o.value
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-neutral-200'
                                )}
                            >
                                <RadioGroupItem
                                    value={o.value}
                                    id={`admission-rule-${o.value}`}
                                    className="mt-0.5"
                                />
                                <Label
                                    htmlFor={`admission-rule-${o.value}`}
                                    className="flex flex-1 cursor-pointer flex-col gap-0.5"
                                >
                                    <span className="text-sm font-medium text-neutral-800">
                                        {o.title}
                                    </span>
                                    <span className="text-xs font-normal text-neutral-500">
                                        {o.hint}
                                    </span>
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>
                    <div className="flex justify-end">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => save(mode)}
                            disable={saving || mode === (saved ?? 'OFF')}
                        >
                            {saving ? t('footer.saving') : t('admissionRule.save')}
                        </MyButton>
                    </div>
                </>
            )}
        </div>
    );
}
