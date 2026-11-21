import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, Trash } from '@phosphor-icons/react';
import type {
    DripCondition,
    DripConditionBehavior,
    DripConditionConfig,
    DripConditionContentLevel,
    DripConditionRule,
    RelativeDateParams,
} from '@/types/course-settings';
import {
    createDefaultRule,
    formatDripRule,
    generateDripConditionId,
    getLevelDisplayName,
    getRuleTypeDisplayName,
    isProgressRule,
} from '@/utils/drip-conditions';

const RULE_TYPES = [
    'relative_date',
    'date_based',
    'sequential',
    'completion_based',
    'prerequisite',
] as const;

function toLocalDateTimeString(isoString: string): string {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
        date.getHours()
    )}:${pad(date.getMinutes())}`;
}

function toISOStringFromLocal(local: string): string {
    const date = new Date(local);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export interface ContentDripConditionDialogProps {
    open: boolean;
    onClose: () => void;
    /** Which level of content this dialog is editing. */
    level: DripConditionContentLevel;
    itemId: string | null;
    itemName: string | null;
    packageId: string | null;
    /** Every condition saved for this institute. */
    dripConditions: DripCondition[];
    onSave: (updatedConditions: DripCondition[]) => Promise<void>;
    /** Items at the same level, offered as prerequisites. */
    siblings?: Array<{ id: string; name: string }>;
    /** Institute master switch — surfaced so an admin isn't editing a dead rule. */
    dripEnabled?: boolean;
    /**
     * Whether progress rules are applied to learners yet. Date and day-wise
     * rules apply regardless, so this only changes the hint for the others.
     */
    enforcing?: boolean;
}

/**
 * Unlock rules for one subject, module or chapter.
 *
 * Deliberately edits ONE rule set per item rather than a list of them: the
 * learner side applies the first enabled condition it finds for an item, so a
 * second condition on the same item is never evaluated and only ever misleads
 * whoever added it.
 */
export function ContentDripConditionDialog({
    open,
    onClose,
    level,
    itemId,
    itemName,
    packageId,
    dripConditions,
    onSave,
    siblings = [],
    dripEnabled = true,
    enforcing = false,
}: ContentDripConditionDialogProps) {
    const { t } = useTranslation('studyLibraryContentDripConditionDialog');
    const conditions = useMemo(
        () => (Array.isArray(dripConditions) ? dripConditions : []),
        [dripConditions]
    );
    const levelLabel = getLevelDisplayName(level);

    const existing = useMemo(
        () =>
            conditions.find(
                (c) => c.level === level && c.level_id === itemId && c.enabled !== false
            ),
        [conditions, level, itemId]
    );

    // A course-level condition targeting this level already governs the item;
    // adding a second rule here would be silently ignored at runtime.
    const courseWideConfigs = useMemo(
        () =>
            conditions
                .filter((c) => c.level === 'package' && c.level_id === packageId && c.enabled !== false)
                .flatMap((c) => (Array.isArray(c.drip_condition) ? c.drip_condition : []))
                .filter((config) => config.target === level && config.is_enabled !== false),
        [conditions, packageId, level]
    );

    const [behavior, setBehavior] = useState<DripConditionBehavior>('lock');
    const [isEnabled, setIsEnabled] = useState(true);
    const [rule, setRule] = useState<DripConditionRule>(() => createDefaultRule('relative_date'));
    const [saving, setSaving] = useState(false);

    // Reload the form whenever the dialog opens on a different item, otherwise
    // it keeps showing the rule of whichever item was opened first.
    useEffect(() => {
        if (!open) return;
        const config: DripConditionConfig | undefined = Array.isArray(existing?.drip_condition)
            ? existing?.drip_condition[0]
            : undefined;
        setBehavior(config?.behavior ?? 'lock');
        setIsEnabled(config?.is_enabled ?? true);
        setRule(config?.rules?.[0] ?? createDefaultRule('relative_date'));
    }, [open, itemId, existing]);

    // Params are a discriminated union across five rule types; each editor only
    // ever patches fields belonging to its own type, which the union cannot
    // express without re-deriving the rule type on every keystroke.
    const updateParams = (patch: Record<string, unknown>) =>
        setRule(
            (prev) =>
                ({
                    type: prev.type,
                    params: { ...(prev.params as unknown as Record<string, unknown>), ...patch },
                }) as unknown as DripConditionRule
        );

    const persist = async (next: DripCondition[]) => {
        try {
            setSaving(true);
            await onSave(next);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async () => {
        if (!itemId) return;
        const now = new Date().toISOString();
        const condition: DripCondition = {
            id: existing?.id ?? generateDripConditionId(),
            level,
            level_id: itemId,
            enabled: true,
            created_at: existing?.created_at ?? now,
            updated_at: now,
            drip_condition: [{ target: level, behavior, is_enabled: isEnabled, rules: [rule] }],
        };
        const next = existing
            ? conditions.map((c) => (c.id === existing.id ? condition : c))
            : [...conditions, condition];
        await persist(next);
    };

    const handleRemove = async () => {
        if (!existing) return;
        // The dialog this replaced refused to delete an active rule outright
        // and confirmed before any delete. Dropping the refusal is deliberate
        // (an admin unlocking content in a hurry should not have to disable a
        // rule first), but removing a live rule silently is not — this opens
        // content to every learner on the course.
        const live = Array.isArray(existing.drip_condition)
            ? existing.drip_condition[0]?.is_enabled !== false
            : false;
        const warning = live
            ? t('confirmRemoveActive', {
                  item: itemName || levelLabel,
                  level: levelLabel.toLowerCase(),
              })
            : t('confirmRemove', { item: itemName || levelLabel });
        if (!window.confirm(warning)) return;
        await persist(conditions.filter((c) => c.id !== existing.id));
    };

    const renderRuleEditor = () => {
        switch (rule.type) {
            case 'relative_date': {
                const params = rule.params as RelativeDateParams;
                return (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label>{t('relativeDate.unlocksOnDay')}</Label>
                            <Input
                                type="number"
                                min={1}
                                value={params.unlock_on_day ?? 1}
                                onChange={(e) =>
                                    updateParams({
                                        unlock_on_day: Math.max(
                                            1,
                                            parseInt(e.target.value, 10) || 1
                                        ),
                                    })
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('relativeDate.dayOneNote')}
                            </p>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('relativeDate.countedFrom')}</Label>
                            <Select
                                value={params.anchor ?? 'enrollment'}
                                onValueChange={(v) => updateParams({ anchor: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="enrollment">
                                        {t('relativeDate.enrollmentDate')}
                                    </SelectItem>
                                    <SelectItem value="session_start">
                                        {t('relativeDate.sessionStartDate')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>{t('relativeDate.opensAt')}</Label>
                            <Input
                                type="time"
                                value={params.unlock_time || '00:00'}
                                onChange={(e) =>
                                    updateParams({ unlock_time: e.target.value || '00:00' })
                                }
                            />
                        </div>
                    </div>
                );
            }

            case 'date_based': {
                const params = rule.params as { unlock_date: string };
                return (
                    <div className="space-y-1">
                        <Label>{t('dateBased.releaseDate')}</Label>
                        <Input
                            type="datetime-local"
                            value={params.unlock_date ? toLocalDateTimeString(params.unlock_date) : ''}
                            onChange={(e) =>
                                updateParams({ unlock_date: toISOStringFromLocal(e.target.value) })
                            }
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('dateBased.sameMomentNote')}
                        </p>
                    </div>
                );
            }

            case 'sequential': {
                const params = rule.params as { threshold: number };
                return (
                    <div className="space-y-1">
                        <Label>
                            {t('sequential.completedAtLeastLabel', {
                                level: levelLabel.toLowerCase(),
                            })}
                        </Label>
                        <Input
                            type="number"
                            min={0}
                            max={100}
                            value={params.threshold ?? 100}
                            onChange={(e) =>
                                updateParams({ threshold: parseInt(e.target.value, 10) || 0 })
                            }
                        />
                    </div>
                );
            }

            case 'completion_based': {
                const params = rule.params as {
                    metric: 'average_of_all' | 'average_of_last_n';
                    count?: number;
                    threshold: number;
                };
                return (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label>{t('completionBased.metric')}</Label>
                            <Select
                                value={params.metric}
                                onValueChange={(v) => updateParams({ metric: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="average_of_all">
                                        {t('completionBased.averageOfAll')}
                                    </SelectItem>
                                    <SelectItem value="average_of_last_n">
                                        {t('completionBased.averageOfLastN')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {params.metric === 'average_of_last_n' && (
                            <div className="space-y-1">
                                <Label>{t('completionBased.howMany')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={params.count ?? 1}
                                    onChange={(e) =>
                                        updateParams({
                                            count: Math.max(1, parseInt(e.target.value, 10) || 1),
                                        })
                                    }
                                />
                            </div>
                        )}
                        <div className="space-y-1">
                            <Label>{t('completionBased.threshold')}</Label>
                            <Input
                                type="number"
                                min={0}
                                max={100}
                                value={params.threshold ?? 0}
                                onChange={(e) =>
                                    updateParams({ threshold: parseInt(e.target.value, 10) || 0 })
                                }
                            />
                        </div>
                    </div>
                );
            }

            case 'prerequisite': {
                const params = rule.params as {
                    required_chapters?: string[];
                    threshold: number;
                };
                return (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>{t('prerequisite.mustFinishFirst')}</Label>
                            <MultiSelect
                                options={siblings.map((s) => ({ label: s.name, value: s.id }))}
                                selected={params.required_chapters || []}
                                onChange={(ids) => updateParams({ required_chapters: ids })}
                                placeholder={t('prerequisite.selectLevelsPlaceholder', {
                                    level: levelLabel.toLowerCase(),
                                })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>{t('prerequisite.completionThreshold')}</Label>
                            <Input
                                type="number"
                                min={0}
                                max={100}
                                value={params.threshold ?? 100}
                                onChange={(e) =>
                                    updateParams({ threshold: parseInt(e.target.value, 10) || 0 })
                                }
                            />
                        </div>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={t('heading', { item: itemName || levelLabel })}
        >
            <div className="space-y-4">
                {!dripEnabled && (
                    <Alert className="border-amber-200 bg-amber-50">
                        <Info className="size-4 text-amber-600" />
                        <AlertDescription className="text-sm text-amber-900">
                            {t('alerts.dripDisabled')}
                        </AlertDescription>
                    </Alert>
                )}

                {dripEnabled && !enforcing && isProgressRule(rule) && (
                    <Alert className="border-neutral-200 bg-neutral-50">
                        <Info className="size-4 text-neutral-500" />
                        <AlertDescription className="text-sm">
                            {t('alerts.previewOnly')}
                        </AlertDescription>
                    </Alert>
                )}

                {courseWideConfigs.length > 0 && (
                    <Alert className="border-blue-200 bg-blue-50">
                        <Info className="size-4 text-blue-600" />
                        <AlertDescription className="space-y-1 text-sm text-blue-900">
                            <div className="font-semibold">
                                {t('alerts.courseWideHeading', {
                                    level: levelLabel.toLowerCase(),
                                })}
                            </div>
                            {courseWideConfigs.flatMap((config, ci) =>
                                config.rules.map((r, ri) => (
                                    <div key={`${ci}-${ri}`}>• {formatDripRule(r)}</div>
                                ))
                            )}
                            <div className="text-xs">
                                {t('alerts.courseWideFootnote', {
                                    level: levelLabel.toLowerCase(),
                                })}
                            </div>
                        </AlertDescription>
                    </Alert>
                )}

                <div className="space-y-1">
                    <Label>{t('unlockWhen')}</Label>
                    <Select
                        value={rule.type}
                        onValueChange={(v) => setRule(createDefaultRule(v as DripConditionRule['type']))}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {RULE_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                    {getRuleTypeDisplayName(type)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="rounded-md border bg-white p-3">{renderRuleEditor()}</div>

                <div className="space-y-1">
                    <Label>{t('untilThen')}</Label>
                    <Select
                        value={behavior}
                        onValueChange={(v) => setBehavior(v as DripConditionBehavior)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="lock">{t('lockBehavior')}</SelectItem>
                            <SelectItem value="hide">{t('hideBehavior')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="drip-rule-enabled" className="font-medium">
                            {t('ruleActive')}
                        </Label>
                        <p className="text-xs text-muted-foreground">{t('ruleActiveNote')}</p>
                    </div>
                    <Switch
                        id="drip-rule-enabled"
                        checked={isEnabled}
                        onCheckedChange={setIsEnabled}
                    />
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                    <div>
                        {existing && (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={handleRemove}
                                disabled={saving}
                            >
                                <Trash size={16} />
                                <span>{t('removeRule')}</span>
                            </MyButton>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {existing && <Badge variant="outline">{t('editingExistingRule')}</Badge>}
                        <MyButton buttonType="secondary" onClick={onClose} disabled={saving}>
                            {t('cancel')}
                        </MyButton>
                        <MyButton onClick={handleSave} disabled={saving || !itemId}>
                            {saving ? t('saving') : t('save')}
                        </MyButton>
                    </div>
                </div>
            </div>
        </MyDialog>
    );
}
