import { useMemo } from 'react';
import { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Info } from '@phosphor-icons/react';
import { FormField } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { fetchInstituteDefaultFields } from '@/services/custom-field-mappings';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import {
    MAX_REPORT_STUDENT_FIELDS,
    cleanStudentFields,
    reportStudentFieldChoices,
    sameStudentField,
} from '@/types/assessments/report-options';

/**
 * "Student details on report": which registration answers (roll number, college, ...) the
 * student's reports print under their name. Saved in this assessment's report_options as
 * student_fields, so it never changes any other assessment.
 */
export const ReportStudentFieldsSection = ({
    control,
    instituteId,
    formFieldNames,
}: {
    control: Control<BasicSectionFormType>;
    instituteId?: string;
    /** This test's saved registration form fields, in form order; empty until Step 3 is saved. */
    formFieldNames: string[];
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const { data: defaults = [] } = useQuery({
        queryKey: ['instituteDefaultFields', instituteId],
        queryFn: () => fetchInstituteDefaultFields(instituteId as string),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const instituteFieldNames = useMemo(
        () =>
            [...defaults]
                .sort((a, b) => (a.individual_order ?? 0) - (b.individual_order ?? 0))
                .map((entry) => entry.custom_field?.fieldName ?? ''),
        [defaults]
    );

    return (
        <FormField
            control={control}
            name="reportOptions.studentFields"
            render={({ field }) => {
                const selected = cleanStudentFields(field.value);
                const choices = reportStudentFieldChoices({
                    formFields: formFieldNames,
                    instituteFields: instituteFieldNames,
                    selected,
                });
                const isChecked = (name: string) =>
                    selected.some((s) => sameStudentField(s, name));
                const toggle = (name: string, on: boolean) =>
                    field.onChange(
                        on
                            ? [...selected, name]
                            : selected.filter((s) => !sameStudentField(s, name))
                    );

                return (
                    <div
                        className="flex flex-col gap-3 border-t border-slate-100 pt-4"
                        id="report-student-fields"
                    >
                        <div className="flex flex-col">
                            <span className="text-sm text-slate-900">
                                {t('reportOptions.studentFields.label')}
                            </span>
                            <span className="text-xs text-slate-500">
                                {t('reportOptions.studentFields.description')}
                            </span>
                        </div>
                        {choices.length === 0 ? (
                            <p className="text-xs text-slate-500">
                                {t('reportOptions.studentFields.empty')}
                            </p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {choices.map((choice) => {
                                    const checked = isChecked(choice.name);
                                    return (
                                        <label
                                            key={choice.name}
                                            className={cn(
                                                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-slate-800',
                                                checked
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-slate-200 bg-white'
                                            )}
                                        >
                                            <Checkbox
                                                checked={checked}
                                                disabled={
                                                    !checked &&
                                                    selected.length >= MAX_REPORT_STUDENT_FIELDS
                                                }
                                                onCheckedChange={(value) =>
                                                    toggle(choice.name, value === true)
                                                }
                                            />
                                            <span>{choice.name}</span>
                                            {choice.onForm === false && (
                                                <span className="text-caption text-warning-600">
                                                    {t('reportOptions.studentFields.notOnForm')}
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                        <p className="flex items-start gap-2 text-xs text-slate-500">
                            <Info className="mt-0.5 size-3.5 shrink-0" />
                            <span>{t('reportOptions.studentFields.hint')}</span>
                        </p>
                    </div>
                );
            }}
        />
    );
};
