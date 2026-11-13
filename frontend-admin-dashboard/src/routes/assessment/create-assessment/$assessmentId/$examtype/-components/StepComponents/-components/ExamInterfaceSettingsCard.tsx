import { Control, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Eye, Info, Monitor } from '@phosphor-icons/react';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import {
    EXAM_INTERFACE_CUSTOM_KEY,
    EXAM_INTERFACE_OPTIONS,
    examInterfaceCustomLabel,
    type ExamInterfaceForm,
} from '@/types/assessments/exam-interface';

/**
 * Step 1 "Exam interface" card: draw the learner's test screen like a known
 * computer-based exam, and choose whether answers count only after Save & Next.
 *
 * Saved per assessment as `exam_interface` (see types/assessments/exam-interface.ts).
 * An OMR sheet exam is answered on paper, and a teacher-checked (MANUAL) paper is
 * answered by uploading an answer sheet, which only the standard screen offers; the
 * picker is disabled for both and the save sends the standard screen.
 */
export const ExamInterfaceSettingsCard = ({
    control,
    omrMode,
    manualEvaluation = false,
}: {
    control: Control<BasicSectionFormType>;
    omrMode: boolean;
    /** Result type MANUAL (teacher-checked answer sheets). */
    manualEvaluation?: boolean;
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const examInterface = useWatch({ control, name: 'examInterface' }) as
        | ExamInterfaceForm
        | undefined;
    const choice = examInterface?.choice ?? 'default';
    const locked = omrMode || manualEvaluation;
    const themed = !locked && choice !== 'default';

    return (
        <div
            className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
            id="exam-interface-settings"
        >
            <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <Monitor className="size-4" />
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-900">
                        {t('examInterface.title')}
                    </span>
                    <span className="text-xs text-slate-500">{t('examInterface.description')}</span>
                </div>
            </div>

            <FormField
                control={control}
                name="examInterface.choice"
                render={({ field }) => (
                    <FormItem className="flex flex-col gap-2 space-y-0">
                        <FormLabel className="text-sm text-slate-900">
                            {t('examInterface.pickerLabel')}
                        </FormLabel>
                        <Select
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={locked}
                        >
                            <FormControl>
                                <SelectTrigger
                                    className="w-full md:w-96"
                                    aria-label={t('examInterface.pickerLabel')}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {EXAM_INTERFACE_OPTIONS.map((option) => (
                                    <SelectItem key={option.key} value={option.key}>
                                        {t(`examInterface.options.${option.labelKey}`)}
                                    </SelectItem>
                                ))}
                                {field.value === EXAM_INTERFACE_CUSTOM_KEY && examInterface && (
                                    <SelectItem value={EXAM_INTERFACE_CUSTOM_KEY}>
                                        {t('examInterface.options.custom', {
                                            id: examInterfaceCustomLabel(examInterface),
                                        })}
                                    </SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                        {omrMode && (
                            <span className="text-xs text-slate-500">
                                {t('examInterface.omrDisabled')}
                            </span>
                        )}
                        {!omrMode && manualEvaluation && (
                            <span className="text-xs text-slate-500">
                                {t('examInterface.manualDisabled')}
                            </span>
                        )}
                    </FormItem>
                )}
            />

            {themed && (
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
                    <FormField
                        control={control}
                        name="examInterface.strict"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between gap-4 space-y-0">
                                <div className="flex flex-col">
                                    <FormLabel className="text-sm text-slate-900">
                                        {t('examInterface.strict.label')}
                                    </FormLabel>
                                    <span className="text-xs text-slate-500">
                                        {t('examInterface.strict.description')}
                                    </span>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={Boolean(field.value)}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    {choice === 'gate' && (
                        <FormField
                            control={control}
                            name="examInterface.calculator"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between gap-4 space-y-0">
                                    <div className="flex flex-col">
                                        <FormLabel className="text-sm text-slate-900">
                                            {t('examInterface.calculator.label')}
                                        </FormLabel>
                                        <span className="text-xs text-slate-500">
                                            {t('examInterface.calculator.description')}
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
                    )}
                    <p className="flex items-start gap-2 text-xs text-slate-500">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t('examInterface.disclaimer')}</span>
                    </p>
                    <p className="flex items-start gap-2 text-xs text-slate-500">
                        <Eye className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t('examInterface.previewHint')}</span>
                    </p>
                </div>
            )}
        </div>
    );
};
