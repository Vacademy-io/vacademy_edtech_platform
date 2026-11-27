import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { normalizeRemarksLanguage, type RemarksLanguage } from '@/types/assessment-settings';

const OPTIONS: RemarksLanguage[] = ['AUTO', 'ENGLISH'];

/**
 * Settings → Assessment and Evalezy settings: the language the AI writes its
 * remarks in. AUTO gives a Hindi or Sanskrit copy Hindi remarks; ENGLISH keeps
 * every copy in English. Read by assessment-service when a copy is sent to be
 * checked (ASSESSMENT_SETTING.aiCopyCheck.remarksLanguage).
 */
export const RemarksLanguagePicker = ({
    value,
    onChange,
    disabled,
}: {
    value: RemarksLanguage;
    onChange: (value: RemarksLanguage) => void;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    return (
        <div className="flex flex-col gap-2">
            <p className="text-body font-medium text-neutral-800">{t('remarks.label')}</p>
            <RadioGroup
                value={value}
                onValueChange={(v) => onChange(normalizeRemarksLanguage(v))}
                disabled={disabled}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
                {OPTIONS.map((option) => {
                    const id = `remarks-language-${option}`;
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
                                    {t(`remarks.${option}.title`)}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t(`remarks.${option}.description`)}
                                </span>
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>
        </div>
    );
};
