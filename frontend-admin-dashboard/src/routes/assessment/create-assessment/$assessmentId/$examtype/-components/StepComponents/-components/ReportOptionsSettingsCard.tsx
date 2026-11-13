import { Control, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FileText, Info } from '@phosphor-icons/react';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import type { ReportOptionsForm } from '@/types/assessments/report-options';

type ToggleName =
    | 'reportOptions.showQuestionWise'
    | 'reportOptions.showYourAnswer'
    | 'reportOptions.showCorrectAnswer'
    | 'reportOptions.showExplanation';

const TOGGLES: { name: ToggleName; key: string; perQuestion: boolean }[] = [
    { name: 'reportOptions.showQuestionWise', key: 'questionWise', perQuestion: false },
    { name: 'reportOptions.showYourAnswer', key: 'yourAnswer', perQuestion: true },
    { name: 'reportOptions.showCorrectAnswer', key: 'correctAnswer', perQuestion: true },
    { name: 'reportOptions.showExplanation', key: 'explanation', perQuestion: true },
];

/**
 * Step 1 "Student report" card: what the student's report shows per question —
 * the question-wise section itself, their answer, the correct answer and the
 * explanation. Saved per assessment as `report_options` (types/assessments/report-options.ts);
 * "Institute default" saves null so the institute's report settings apply.
 */
export const ReportOptionsSettingsCard = ({
    control,
}: {
    control: Control<BasicSectionFormType>;
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const options = useWatch({ control, name: 'reportOptions' }) as ReportOptionsForm | undefined;
    const custom = options?.useInstituteDefault === false;
    const questionWise = options?.showQuestionWise !== false;

    return (
        <div
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
            id="report-options-settings"
        >
            <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <FileText className="size-4" />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-900">
                        {t('reportOptions.title')}
                    </span>
                    <span className="text-xs text-slate-500">{t('reportOptions.description')}</span>
                </div>
            </div>

            <FormField
                control={control}
                name="reportOptions.useInstituteDefault"
                render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4 space-y-0">
                        <div className="flex flex-col">
                            <FormLabel className="text-sm text-slate-900">
                                {t('reportOptions.instituteDefault.label')}
                            </FormLabel>
                            <span className="text-xs text-slate-500">
                                {t('reportOptions.instituteDefault.description')}
                            </span>
                        </div>
                        <FormControl>
                            <Switch
                                checked={field.value !== false}
                                onCheckedChange={field.onChange}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />

            {custom && (
                <div className="flex flex-col gap-4 border-t border-slate-100 pt-4">
                    {TOGGLES.map((toggle) => (
                        <FormField
                            key={toggle.name}
                            control={control}
                            name={toggle.name}
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between gap-4 space-y-0">
                                    <div className="flex flex-col">
                                        <FormLabel className="text-sm text-slate-900">
                                            {t(`reportOptions.${toggle.key}.label`)}
                                        </FormLabel>
                                        <span className="text-xs text-slate-500">
                                            {t(`reportOptions.${toggle.key}.description`)}
                                        </span>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value !== false}
                                            onCheckedChange={field.onChange}
                                            disabled={toggle.perQuestion && !questionWise}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    ))}
                    <p className="flex items-start gap-2 text-xs text-slate-500">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t('reportOptions.appliesTo')}</span>
                    </p>
                </div>
            )}
        </div>
    );
};
