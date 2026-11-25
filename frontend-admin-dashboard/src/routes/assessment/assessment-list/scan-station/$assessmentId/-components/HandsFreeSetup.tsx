import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { HelperPrinter } from '../-lib/scan-helper-client';
import type { HandsFreeSettings } from '../-lib/hands-free';

/**
 * The few questions asked once per desk before the first pile: one side or
 * both, whether checking starts by itself, whether checked copies print, and
 * whether copies are matched to this test's students.
 */
export const HandsFreeSetup = ({
    value,
    onChange,
    printer,
    disabled = false,
}: {
    value: HandsFreeSettings;
    onChange: (next: HandsFreeSettings) => void;
    printer: HelperPrinter | null;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    const set = (patch: Partial<HandsFreeSettings>) => onChange({ ...value, ...patch });
    const canPrint = !!printer && value.autoCheck;

    return (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-100 bg-neutral-50 p-3">
            <p className="text-body font-medium text-neutral-800">{t('handsFree.title')}</p>

            <div className="flex flex-col gap-1">
                <span className="text-caption text-neutral-600" id="hf-sides">
                    {t('handsFree.sides.label')}
                </span>
                <div role="radiogroup" aria-labelledby="hf-sides" className="flex flex-wrap gap-2">
                    {(['ONE', 'BOTH'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={value.sides === option}
                            disabled={disabled}
                            onClick={() => set({ sides: option })}
                            className={cn(
                                'rounded-md border px-3 py-2 text-start text-body transition-colors disabled:opacity-60',
                                value.sides === option
                                    ? 'border-primary-500 bg-primary-50 font-medium text-primary-600'
                                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-primary-200'
                            )}
                        >
                            {t(`handsFree.sides.${option}`)}
                        </button>
                    ))}
                </div>
                <span className="text-caption text-neutral-500">
                    {t(
                        value.sides === 'ONE'
                            ? 'handsFree.sides.oneHint'
                            : 'handsFree.sides.bothHint'
                    )}
                </span>
            </div>

            <Toggle
                id="hf-auto"
                checked={value.autoCheck}
                disabled={disabled}
                onChange={(on) => set({ autoCheck: on, print: on ? value.print : false })}
                label={t('handsFree.auto.label')}
                hint={t('handsFree.auto.hint')}
            />
            <Toggle
                id="hf-print"
                checked={canPrint && value.print}
                disabled={disabled || !canPrint}
                onChange={(on) => set({ print: on })}
                label={
                    printer
                        ? t('handsFree.print.label', { printer: printer.name })
                        : t('handsFree.print.noPrinter')
                }
                hint={
                    !printer
                        ? t('handsFree.print.noPrinterHint')
                        : !value.autoCheck
                          ? t('handsFree.print.needsAuto')
                          : t(
                                printer.duplex
                                    ? 'handsFree.print.twoSided'
                                    : 'handsFree.print.oneSided'
                            )
                }
            />
            <Toggle
                id="hf-match"
                checked={value.matchStudents}
                disabled={disabled}
                onChange={(on) => set({ matchStudents: on })}
                label={t('handsFree.match.label')}
                hint={t(value.matchStudents ? 'handsFree.match.onHint' : 'handsFree.match.offHint')}
            />
        </div>
    );
};

const Toggle = ({
    id,
    checked,
    disabled,
    onChange,
    label,
    hint,
}: {
    id: string;
    checked: boolean;
    disabled: boolean;
    onChange: (on: boolean) => void;
    label: string;
    hint: string;
}) => (
    <div className="flex items-start gap-3">
        <Switch
            id={id}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
            aria-describedby={`${id}-hint`}
            className="mt-0.5"
        />
        <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body text-neutral-800">{label}</span>
            <span id={`${id}-hint`} className="text-caption text-neutral-500">
                {hint}
            </span>
        </label>
    </div>
);

export default HandsFreeSetup;
