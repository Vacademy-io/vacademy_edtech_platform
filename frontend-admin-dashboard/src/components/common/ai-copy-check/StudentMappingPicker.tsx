import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { getAssessmentSettings } from '@/services/assessment-settings';
import { normalizeStudentMapping, type StudentMapping } from '@/types/assessment-settings';

const OPTIONS: StudentMapping[] = ['ASK', 'MAP', 'CHECK_ONLY'];

/**
 * Settings → Assessment: whether copies uploaded for a bulk AI check are
 * matched to the assessment's students. Read by the Bulk AI check dialog and
 * the Evalezy app.
 */
export const StudentMappingPicker = ({
    value,
    onChange,
    disabled,
}: {
    value: StudentMapping;
    onChange: (value: StudentMapping) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <div className="flex flex-col gap-2">
            <p className="text-body font-medium text-neutral-800">{t('mapping.label')}</p>
            <RadioGroup
                value={value}
                onValueChange={(v) => onChange(normalizeStudentMapping(v))}
                disabled={disabled}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
                {OPTIONS.map((option) => {
                    const id = `student-mapping-${option}`;
                    return (
                        <label
                            key={option}
                            htmlFor={id}
                            className={cn(
                                'flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors',
                                value === option
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 hover:border-neutral-300',
                                disabled && 'cursor-not-allowed opacity-60'
                            )}
                        >
                            <RadioGroupItem id={id} value={option} className="mt-0.5" />
                            <span className="flex flex-col">
                                <span className="text-body font-medium text-neutral-800">
                                    {t(`mapping.${option}.title`)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`mapping.${option}.description`)}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>
        </div>
    );
};

/**
 * The institute's choice (Settings → Assessment), read fresh each time a check is
 * about to start. ASK until it answers, or if it cannot: the teacher is asked,
 * which is always safe.
 */
export const useInstituteStudentMapping = (active: boolean): StudentMapping => {
    const [value, setValue] = useState<StudentMapping>('ASK');
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        getAssessmentSettings(true)
            .then((settings) => {
                if (!cancelled)
                    setValue(normalizeStudentMapping(settings.aiCopyCheck?.studentMapping));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [active]);
    return value;
};

/**
 * What a "start" press does under the setting: ask (open the popup), or go straight
 * to mapping / check-only. A test with no students is never sent to be mapped
 * silently — the popup shows why mapping is off.
 */
export const decideStudentMapping = (
    setting: StudentMapping,
    canMap: boolean
): { ask: true } | { ask: false; mapStudents: boolean } => {
    if (setting === 'CHECK_ONLY') return { ask: false, mapStudents: false };
    if (setting === 'MAP' && canMap) return { ask: false, mapStudents: true };
    return { ask: true };
};
