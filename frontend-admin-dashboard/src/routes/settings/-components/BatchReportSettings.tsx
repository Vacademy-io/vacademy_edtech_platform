import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    BATCH_REPORT_SECTIONS,
    BATCH_REPORT_SECTION_META,
    type BatchReportSection,
} from '@/services/batch-summary-report';

/**
 * Settings → Batch reports: the template behind Learning Reports → Batch → Generate report —
 * which sections it renders.
 * Stored under the BATCH_REPORT_SETTING institute setting (backend BatchReportSettingConfig).
 */
const SETTING_KEY = 'BATCH_REPORT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');

interface BatchReportSettingData {
    sections: BatchReportSection[];
}

/** GET returns the SettingDto ({ key, name, data }), so the saved content is at res.data.data. */
async function fetchSetting(): Promise<BatchReportSettingData> {
    try {
        const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
            params: { instituteId: getInstituteId(), settingKey: SETTING_KEY },
            timeout: 10000,
        });
        const stored = res.data?.data;
        const sections = Array.isArray(stored?.sections)
            ? BATCH_REPORT_SECTIONS.filter((s) => stored.sections.includes(s))
            : [];
        return { sections: sections.length ? sections : [...BATCH_REPORT_SECTIONS] };
    } catch {
        return { sections: [...BATCH_REPORT_SECTIONS] };
    }
}

async function saveSetting(data: BatchReportSettingData): Promise<void> {
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Batch Reports', setting_data: data },
        { params: { instituteId: getInstituteId(), settingKey: SETTING_KEY } }
    );
}

export default function BatchReportSettings({ isTab }: { isTab?: boolean }) {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: ['BATCH_REPORT_SETTING'],
        queryFn: fetchSetting,
    });
    const [sections, setSections] = useState<BatchReportSection[]>([]);

    useEffect(() => {
        if (data) setSections(data.sections);
    }, [data]);

    const save = useMutation({
        mutationFn: () => saveSetting({ sections }),
        onSuccess: () => {
            toast.success('Batch report settings saved');
            queryClient.invalidateQueries({ queryKey: ['BATCH_REPORT_SETTING'] });
            queryClient.invalidateQueries({ queryKey: ['BATCH_REPORT_TEMPLATE'] });
            queryClient.invalidateQueries({ queryKey: ['BATCH_SUMMARY_REPORT'] });
        },
        onError: () => toast.error('Could not save the settings'),
    });

    const toggle = (key: BatchReportSection) =>
        setSections((prev) =>
            prev.includes(key)
                ? prev.filter((k) => k !== key)
                : BATCH_REPORT_SECTIONS.filter((k) => k === key || prev.includes(k))
        );

    if (isLoading) return <DashboardLoader />;

    return (
        <div className={isTab ? 'flex flex-col gap-6' : 'flex flex-col gap-6 p-6'}>
            <div>
                <h2 className="text-lg font-semibold text-neutral-800">Batch reports</h2>
                <p className="text-sm text-neutral-500">
                    The template used when a batch report is generated, downloaded or sent from
                    Learning Reports. Admins can still adjust the sections for a single report.
                </p>
            </div>

            <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
                <h3 className="text-sm font-semibold text-neutral-700">Sections to include</h3>
                {BATCH_REPORT_SECTIONS.map((key) => {
                    const meta = BATCH_REPORT_SECTION_META[key];
                    return (
                        <label key={key} className="flex cursor-pointer items-start gap-2">
                            <Checkbox
                                checked={sections.includes(key)}
                                onCheckedChange={() => toggle(key)}
                                className="mt-0.5"
                            />
                            <span className="flex flex-col">
                                <span className="text-sm text-neutral-700">{meta.label}</span>
                                <span className="text-xs text-neutral-500">
                                    {meta.description}
                                    {meta.namesLearners && ' Left out of copies sent to parents.'}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </section>

            <div>
                <MyButton
                    onClick={() => save.mutate()}
                    disabled={sections.length === 0 || save.isPending}
                >
                    {save.isPending ? 'Saving…' : 'Save changes'}
                </MyButton>
                {sections.length === 0 && (
                    <p className="mt-1 text-xs text-danger-600">Pick at least one section.</p>
                )}
            </div>
        </div>
    );
}
