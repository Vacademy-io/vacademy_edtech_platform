import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DEFAULT_DRIP_SCHEDULE,
    type DripConditionBehavior,
    type DripConditionContentLevel,
    type DripConditionsSettings,
    type DripScheduleDefaults,
} from '@/types/course-settings';
import { isProgressRule } from '@/utils/drip-conditions';
import { Drop, Info, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface DripConditionsCardProps {
    settings: DripConditionsSettings;
    onUpdate: (settings: DripConditionsSettings) => void;
}

const buildLevelOptions = (
    t: TFunction
): Array<{ value: DripConditionContentLevel; label: string }> => [
    { value: 'subject', label: t('schedule.level.options.subject') },
    { value: 'module', label: t('schedule.level.options.module') },
    { value: 'chapter', label: t('schedule.level.options.chapter') },
    { value: 'slide', label: t('schedule.level.options.slide') },
];

/**
 * Institute-wide drip controls: the master switch, plus the starting point the
 * per-course "Schedule Unlock" generator opens with. Setting the house rule
 * here means a 30-day course is three clicks in the course itself.
 */
export const DripConditionsCard: React.FC<DripConditionsCardProps> = ({ settings, onUpdate }) => {
    const { t } = useTranslation('settingsDripConditionsCard');
    const levelOptions = buildLevelOptions(t);

    const schedule: DripScheduleDefaults = {
        ...DEFAULT_DRIP_SCHEDULE,
        ...settings.scheduleDefaults,
    };

    const updateSchedule = (patch: Partial<DripScheduleDefaults>) =>
        onUpdate({ ...settings, scheduleDefaults: { ...schedule, ...patch } });

    // Progress rules already saved for this institute. Most were written while
    // nothing read them, so the admin needs to see the number before switching
    // them on. Date and day-wise rules are not counted: they already apply.
    const savedRuleCount = (Array.isArray(settings.conditions) ? settings.conditions : [])
        .filter((condition) => condition.enabled !== false)
        .flatMap((condition) =>
            Array.isArray(condition.drip_condition) ? condition.drip_condition : []
        )
        .filter(
            (config) => config.is_enabled !== false && config.rules?.some(isProgressRule)
        ).length;
    const isEnforcing = settings.applyConfiguredRules === true;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Drop className="size-5 text-blue-600" />
                        <CardTitle>{t('header.title')}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="drip-global-toggle">
                            {settings.enabled ? t('header.enabled') : t('header.disabled')}
                        </Label>
                        <Switch
                            id="drip-global-toggle"
                            checked={settings.enabled}
                            onCheckedChange={(enabled) => onUpdate({ ...settings, enabled })}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <Alert>
                    <Info className="size-4" />
                    <AlertDescription>{t('info.description')}</AlertDescription>
                </Alert>

                {settings.enabled && (
                    <div className="space-y-4">
                        <div className="rounded-md border border-neutral-200 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1">
                                    <Label htmlFor="drip-enforce" className="font-medium">
                                        {t('enforce.label')}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t('enforce.hint')}
                                    </p>
                                </div>
                                <Switch
                                    id="drip-enforce"
                                    checked={isEnforcing}
                                    onCheckedChange={(applyConfiguredRules) =>
                                        onUpdate({ ...settings, applyConfiguredRules })
                                    }
                                />
                            </div>

                            {!isEnforcing && savedRuleCount > 0 && (
                                <Alert className="mt-3 border-warning-300 bg-warning-50">
                                    <Warning className="size-4 text-warning-600" />
                                    <AlertDescription className="text-sm">
                                        {t('enforce.warning.prefix')}{' '}
                                        <strong>
                                            {t('enforce.warning.ruleCount', {
                                                count: savedRuleCount,
                                            })}
                                        </strong>
                                        {t('enforce.warning.suffix')}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold text-neutral-900">
                                {t('schedule.title')}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                                {t('schedule.description')}
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label htmlFor="drip-level">{t('schedule.level.label')}</Label>
                                <Select
                                    value={schedule.level}
                                    onValueChange={(value) =>
                                        updateSchedule({
                                            level: value as DripConditionContentLevel,
                                        })
                                    }
                                >
                                    <SelectTrigger id="drip-level">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {levelOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="drip-interval">
                                    {t('schedule.interval.label')}
                                </Label>
                                <Input
                                    id="drip-interval"
                                    type="number"
                                    min={1}
                                    value={schedule.intervalDays}
                                    onChange={(e) =>
                                        updateSchedule({
                                            intervalDays: Math.max(
                                                1,
                                                parseInt(e.target.value, 10) || 1
                                            ),
                                        })
                                    }
                                />
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="drip-start-day">
                                    {t('schedule.startDay.label')}
                                </Label>
                                <Input
                                    id="drip-start-day"
                                    type="number"
                                    min={1}
                                    value={schedule.startDay}
                                    onChange={(e) =>
                                        updateSchedule({
                                            startDay: Math.max(
                                                1,
                                                parseInt(e.target.value, 10) || 1
                                            ),
                                        })
                                    }
                                />
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="drip-anchor">{t('schedule.anchor.label')}</Label>
                                <Select
                                    value={schedule.anchor}
                                    onValueChange={(value) =>
                                        updateSchedule({
                                            anchor: value as DripScheduleDefaults['anchor'],
                                        })
                                    }
                                >
                                    <SelectTrigger id="drip-anchor">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="enrollment">
                                            {t('schedule.anchor.enrollment')}
                                        </SelectItem>
                                        <SelectItem value="session_start">
                                            {t('schedule.anchor.sessionStart')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="drip-time">{t('schedule.time.label')}</Label>
                                <Input
                                    id="drip-time"
                                    type="time"
                                    value={schedule.unlockTime}
                                    onChange={(e) =>
                                        updateSchedule({ unlockTime: e.target.value || '00:00' })
                                    }
                                />
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="drip-behavior">
                                    {t('schedule.behavior.label')}
                                </Label>
                                <Select
                                    value={schedule.behavior}
                                    onValueChange={(value) =>
                                        updateSchedule({ behavior: value as DripConditionBehavior })
                                    }
                                >
                                    <SelectTrigger id="drip-behavior">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="lock">
                                            {t('schedule.behavior.lock')}
                                        </SelectItem>
                                        <SelectItem value="hide">
                                            {t('schedule.behavior.hide')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
