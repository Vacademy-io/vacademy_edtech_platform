import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDate } from '@/lib/formatters';
import {
    USAGE_MAX_DAYS,
    USAGE_PRESETS,
    parseDay,
    rangeProblem,
    type UsageRange,
    type UsageRangeChoice,
} from './usageApi';

const PRESET_KEYS = {
    last7: 'usage.range.last7',
    thisWeek: 'usage.range.thisWeek',
    lastWeek: 'usage.range.lastWeek',
    last30: 'usage.range.last30',
    term: 'usage.range.term',
    custom: 'usage.range.custom',
} as const;

const PROBLEM_KEYS = {
    incomplete: 'usage.range.incomplete',
    order: 'usage.range.order',
    tooLong: 'usage.range.tooLong',
} as const;

export function dayLabel(value: string): string {
    const date = parseDay(value);
    return date ? formatDate(date) : value;
}

/**
 * Date presets, a custom range (at most USAGE_MAX_DAYS days) and, for an admin of several
 * institutes, the "My schools" switch.
 */
export function RangeControls({
    choice,
    range,
    today,
    onPreset,
    onCustom,
    canCompare,
    comparing,
    onCompare,
}: {
    choice: UsageRangeChoice;
    range: UsageRange;
    today: string;
    onPreset: (choice: UsageRangeChoice) => void;
    onCustom: (range: UsageRange) => void;
    canCompare: boolean;
    comparing: boolean;
    onCompare: (on: boolean) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const problem = choice === 'custom' ? rangeProblem(range) : null;
    const choices: UsageRangeChoice[] = [...USAGE_PRESETS, 'custom'];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div
                    role="group"
                    aria-label={t('usage.range.label')}
                    className="flex flex-wrap items-center gap-2"
                >
                    {choices.map((option) => (
                        <MyButton
                            key={option}
                            type="button"
                            scale="small"
                            buttonType={option === choice ? 'primary' : 'secondary'}
                            aria-pressed={option === choice}
                            onClick={() => onPreset(option)}
                        >
                            {t(PRESET_KEYS[option], { days: USAGE_MAX_DAYS })}
                        </MyButton>
                    ))}
                </div>
                {canCompare && (
                    <div className="flex items-center gap-2">
                        <Switch
                            id="classroom-usage-my-schools"
                            checked={comparing}
                            onCheckedChange={onCompare}
                        />
                        <Label
                            htmlFor="classroom-usage-my-schools"
                            className="text-body text-neutral-700"
                        >
                            {t('usage.mySchools.label')}
                        </Label>
                    </div>
                )}
            </div>
            {choice === 'custom' && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <MyInput
                        inputType="date"
                        label={t('usage.range.from')}
                        aria-label={t('usage.range.from')}
                        input={range.from}
                        max={today}
                        onChangeFunction={(event) =>
                            onCustom({ from: event.target.value, to: range.to })
                        }
                        className="w-full sm:w-48"
                    />
                    <MyInput
                        inputType="date"
                        label={t('usage.range.to')}
                        aria-label={t('usage.range.to')}
                        input={range.to}
                        min={range.from || undefined}
                        max={today}
                        onChangeFunction={(event) =>
                            onCustom({ from: range.from, to: event.target.value })
                        }
                        className="w-full sm:w-48"
                    />
                </div>
            )}
            {problem ? (
                <p role="alert" className="text-body text-danger-600">
                    {t(PROBLEM_KEYS[problem], { days: USAGE_MAX_DAYS })}
                </p>
            ) : (
                <p className="text-caption text-neutral-500">
                    {t('usage.range.showing', {
                        from: dayLabel(range.from),
                        to: dayLabel(range.to),
                    })}
                </p>
            )}
        </div>
    );
}
