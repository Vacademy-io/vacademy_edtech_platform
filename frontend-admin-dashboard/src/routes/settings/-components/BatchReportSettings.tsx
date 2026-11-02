import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    BATCH_REPORT_SECTIONS,
    BATCH_REPORT_SECTION_META,
    type BatchReportSection,
} from '@/services/batch-summary-report';

/**
 * Settings → Batch reports: the template behind Learning Reports → Batch → Generate report —
 * which sections it renders, and the average quiz score a learner needs to count as passed.
 * Stored under the BATCH_REPORT_SETTING institute setting (backend BatchReportSettingConfig).
 */
const SETTING_KEY = 'BATCH_REPORT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const DEFAULT_PASS = 40;

interface BatchReportSettingData {
    sections: BatchReportSection[];
    passPercentage: number;
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
        const pass = Number(stored?.passPercentage);
        return {
            sections: sections.length ? sections : [...BATCH_REPORT_SECTIONS],
            passPercentage: Number.isFinite(pass) && pass >= 0 && pass <= 100 ? pass : DEFAULT_PASS,
        };
    } catch {
        return { sections: [...BATCH_REPORT_SECTIONS], passPercentage: DEFAULT_PASS };
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
    const [pass, setPass] = useState<string>(String(DEFAULT_PASS));

    useEffect(() => {
        if (data) {
            setSections(data.sections);
            setPass(String(data.passPercentage));
        }
    }, [data]);

    const passNumber = Number(pass);
    const passValid =
        pass.trim() !== '' && Number.isFinite(passNumber) && passNumber >= 0 && passNumber <= 100;

    const save = useMutation({
        mutationFn: () => saveSetting({ sections, passPercentage: passNumber }),
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

            <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
                <h3 className="text-sm font-semibold text-neutral-700">Pass mark</h3>
                <p className="text-xs text-neutral-500">
                    A learner counts as passed when their average quiz score is at least this.
                </p>
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        min={0}
                        max={100}
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                        className="w-28"
                        aria-label="Pass mark percentage"
                    />
                    <span className="text-sm text-neutral-600">%</span>
                </div>
                {!passValid && (
                    <p className="text-xs text-danger-600">Enter a number from 0 to 100.</p>
                )}
            </section>

            <div>
                <MyButton
                    onClick={() => save.mutate()}
                    disabled={!passValid || sections.length === 0 || save.isPending}
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
