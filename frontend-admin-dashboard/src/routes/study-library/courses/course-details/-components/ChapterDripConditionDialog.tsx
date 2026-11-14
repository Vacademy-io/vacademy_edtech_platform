import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Plus, Trash, Info } from 'phosphor-react';
import type { DripCondition, DripConditionRule } from '@/types/course-settings';
import { formatDripRule } from '@/utils/drip-conditions';

// Helper functions to convert between ISO string and local datetime-local format
function toLocalDateTimeString(isoString: string): string {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toISOStringFromLocal(localDateTimeString: string): string {
    const date = new Date(localDateTimeString);
    return date.toISOString();
}

interface ChapterDripConditionDialogProps {
    open: boolean;
    onClose: () => void;
    chapterId: string | null;
    chapterName: string | null;
    packageId: string | null;
    dripConditions: DripCondition[];
    onSave: (updatedConditions: DripCondition[]) => Promise<void>;
    allChapters?: Array<{ id: string; name: string }>;
}

export function ChapterDripConditionDialog({
    open,
    onClose,
    chapterId,
    chapterName,
    packageId,
    dripConditions,
    onSave,
    allChapters = [],
}: ChapterDripConditionDialogProps) {
    const { t } = useTranslation('studyLibraryCourseDetailsChapterDripConditionDialog');
    const [editingConditionId, setEditingConditionId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Ensure dripConditions is an array
    const conditions = Array.isArray(dripConditions) ? dripConditions : [];

    // Check if package has chapter-targeting conditions (check array format)
    const packageChapterConditions = conditions.filter((c) => {
        if (c.level !== 'package' || c.level_id !== packageId || !c.enabled) {
            return false;
        }
        // Check if any config in the drip_condition array targets chapters AND is enabled
        return (
            Array.isArray(c.drip_condition) &&
            c.drip_condition.some((config) => config.target === 'chapter' && config.is_enabled)
        );
    });

    // Get chapter-specific conditions
    const chapterConditions = conditions.filter(
        (c) => c.level === 'chapter' && c.level_id === chapterId && c.enabled !== false
    );

    const hasPackageConflict = packageChapterConditions.length > 0;

    const handleAddCondition = () => {
        setEditingConditionId('new');
    };

    const handleSaveCondition = async (condition: Omit<DripCondition, 'id'>) => {
        try {
            setSaving(true);
            let updatedConditions: DripCondition[];

            if (editingConditionId === 'new') {
                // Add new condition
                const newCondition: DripCondition = {
                    ...condition,
                    id: `drip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                };
                updatedConditions = [...conditions, newCondition];
            } else {
                // Update existing condition
                updatedConditions = conditions.map((c) =>
                    c.id === editingConditionId ? { ...condition, id: c.id } : c
                );
            }

            await onSave(updatedConditions);
            setEditingConditionId(null);
        } catch (error) {
            console.error('Failed to save condition:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteCondition = async (conditionId: string) => {
        const conditionToDelete = conditions.find((c) => c.id === conditionId);
        if (!conditionToDelete) return;

        // Check if condition is enabled
        const isEnabled = conditionToDelete.drip_condition?.[0]?.is_enabled;
        if (isEnabled) {
            alert(t('alerts.cannotDeleteEnabled'));
            return;
        }

        if (!confirm(t('alerts.confirmDelete'))) return;

        try {
            setSaving(true);
            const updatedConditions = conditions.filter((c) => c.id !== conditionId);
            await onSave(updatedConditions);
        } catch (error) {
            console.error('Failed to delete condition:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleEditCondition = (conditionId: string) => {
        setEditingConditionId(conditionId);
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={t('dialog.heading', { chapterName: chapterName || t('dialog.defaultChapterName') })}
        >
            <div className="space-y-4">
                {hasPackageConflict && (
                    <Alert className="border-blue-200 bg-blue-50">
                        <Info className="size-4 text-blue-600" />
                        <AlertDescription className="text-sm text-blue-900">
                            <div className="mb-2 font-semibold">{t('packageConflict.title')}</div>
                            <div className="space-y-2">
                                {packageChapterConditions.map((condition) => {
                                    // Find chapter-targeting configs in the array
                                    const chapterConfigs = Array.isArray(condition.drip_condition)
                                        ? condition.drip_condition.filter(
                                              (c) => c.target === 'chapter'
                                          )
                                        : [];

                                    return chapterConfigs.map((config, configIdx) => (
                                        <div
                                            key={`${condition.id}-${configIdx}`}
                                            className="rounded-md border border-blue-200 bg-white p-3"
                                        >
                                            <div className="mb-2 flex items-start gap-2">
                                                <Badge
                                                    variant="outline"
                                                    className="bg-purple-100 text-purple-700"
                                                >
                                                    {t('packageConflict.courseLevel')}
                                                </Badge>
                                                <Badge
                                                    variant="outline"
                                                    className="bg-blue-100 text-blue-700"
                                                >
                                                    {config.behavior}
                                                </Badge>
                                            </div>
                                            <div className="space-y-1 text-sm text-gray-700">
                                                {config.rules.map((rule, idx) => (
                                                    <div key={idx}>• {formatDripRule(rule)}</div>
                                                ))}
                                            </div>
                                        </div>
                                    ));
                                })}
                            </div>
                            <div className="mt-3 text-xs text-blue-700">
                                {t('packageConflict.explanation')}
                            </div>
                        </AlertDescription>
                    </Alert>
                )}

                {!hasPackageConflict && (
                    <>
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-900">
                                {t('dialog.chapterDripConditions')}
                            </h3>
                            {!editingConditionId && (
                                <MyButton
                                    buttonType="primary"
                                    scale="small"
                                    onClick={handleAddCondition}
                                    disabled={saving}
                                >
                                    <Plus size={16} weight="bold" />
                                    <span>{t('actions.addCondition')}</span>
                                </MyButton>
                            )}
                        </div>

                        {chapterConditions.length === 0 && !editingConditionId && (
                            <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
                                <p className="text-sm text-gray-500">
                                    {t('dialog.emptyState')}
                                </p>
                            </div>
                        )}

                        {chapterConditions.map((condition) => (
                            <div key={condition.id}>
                                {editingConditionId === condition.id ? (
                                    <ConditionForm
                                        condition={condition}
                                        chapterId={chapterId!}
                                        onSave={handleSaveCondition}
                                        saving={saving}
                                        allChapters={allChapters}
                                    />
                                ) : (
                                    <div className="rounded-lg border border-gray-200 p-4 transition-colors hover:border-primary-300">
                                        <div className="mb-3 flex items-start justify-between">
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant="outline"
                                                    className="bg-blue-100 text-blue-700"
                                                >
                                                    {condition.drip_condition[0]?.behavior ||
                                                        t('behavior.lock')}
                                                </Badge>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() =>
                                                        handleEditCondition(condition.id)
                                                    }
                                                    disabled={saving}
                                                    className="h-8 px-2"
                                                >
                                                    {t('actions.edit')}
                                                </Button>
                                                {!condition.drip_condition?.[0]?.is_enabled && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() =>
                                                            handleDeleteCondition(condition.id)
                                                        }
                                                        disabled={saving}
                                                        className="h-8 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                        title={t('actions.deleteConditionTitle')}
                                                    >
                                                        <Trash size={16} />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="space-y-1 text-sm text-gray-700">
                                            {(condition.drip_condition[0]?.rules || []).map(
                                                (rule, idx) => (
                                                    <div key={idx}>• {formatDripRule(rule)}</div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {editingConditionId === 'new' && (
                            <ConditionForm
                                chapterId={chapterId!}
                                onSave={handleSaveCondition}
                                saving={saving}
                                allChapters={allChapters}
                            />
                        )}
                    </>
                )}

                <div className="flex justify-end border-t pt-4">
                    <MyButton buttonType="secondary" onClick={onClose}>
                        {t('actions.close')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}

interface ConditionFormProps {
    condition?: DripCondition;
    chapterId: string;
    onSave: (condition: Omit<DripCondition, 'id'>) => void;
    saving: boolean;
    allChapters?: Array<{ id: string; name: string }>;
}

function ConditionForm({
    condition,
    chapterId,
    onSave,
    saving,
    allChapters = [],
}: ConditionFormProps) {
    const { t } = useTranslation('studyLibraryCourseDetailsChapterDripConditionDialog');
    const target = 'chapter';

    // Extract first config from array or create default
    const existingConfig = condition?.drip_condition?.[0];

    const [behavior, setBehavior] = useState<'lock' | 'hide' | 'both'>(
        existingConfig?.behavior || 'lock'
    );
    const [isEnabled, setIsEnabled] = useState<boolean>(existingConfig?.is_enabled ?? true);
    const [rules, setRules] = useState<DripConditionRule[]>(
        existingConfig?.rules || [
            { type: 'date_based', params: { unlock_date: new Date().toISOString() } },
        ]
    );

    const handleRuleTypeChange = (index: number, type: string) => {
        const newRules = [...rules];
        switch (type) {
            case 'date_based':
                newRules[index] = {
                    type: 'date_based',
                    params: { unlock_date: new Date().toISOString() },
                };
                break;
            case 'completion_based':
                newRules[index] = {
                    type: 'completion_based',
                    params: { metric: 'average_of_all', threshold: 100 },
                };
                break;
            case 'prerequisite':
                newRules[index] = {
                    type: 'prerequisite',
                    params: { required_chapters: [], threshold: 100 },
                };
                break;
            case 'sequential':
                newRules[index] = {
                    type: 'sequential',
                    params: { requires_previous: true, threshold: 100 },
                };
                break;
        }
        setRules(newRules);
    };

    const handleRuleChange = (index: number, field: string, value: any) => {
        const newRules = [...rules];
        const existingRule = newRules[index];
        if (!existingRule) return;
        newRules[index] = {
            type: existingRule.type,
            params: { ...(existingRule?.params || {}), [field]: value } as any,
        };
        setRules(newRules);
    };

    const renderRuleEditor = (rule: DripConditionRule, index: number) => {
        switch (rule.type) {
            case 'date_based': {
                const params = rule.params as { unlock_date: string };
                return (
                    <div className="space-y-2">
                        <Label>{t('form.releaseDate')}</Label>
                        <Input
                            type="datetime-local"
                            value={
                                params.unlock_date ? toLocalDateTimeString(params.unlock_date) : ''
                            }
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                handleRuleChange(
                                    index,
                                    'unlock_date',
                                    toISOStringFromLocal(e.target.value)
                                )
                            }
                        />
                    </div>
                );
            }

            case 'completion_based': {
                const params = rule.params as {
                    metric: 'average_of_last_n' | 'average_of_all';
                    count?: number;
                    threshold: number;
                };
                return (
                    <div className="space-y-2">
                        <div>
                            <Label>{t('form.metric')}</Label>
                            <Select
                                value={params.metric}
                                onValueChange={(value) => handleRuleChange(index, 'metric', value)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="average_of_all">{t('form.averageOfAll')}</SelectItem>
                                    <SelectItem value="average_of_last_n">
                                        {t('form.averageOfLastN')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {params.metric === 'average_of_last_n' && (
                            <div>
                                <Label>{t('form.count')}</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={params.count || 0}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                        handleRuleChange(index, 'count', parseInt(e.target.value))
                                    }
                                />
                            </div>
                        )}
                        <div>
                            <Label>{t('form.thresholdPercent')}</Label>
                            <Input
                                type="number"
                                min="0"
                                max="100"
                                value={params.threshold || 0}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleRuleChange(index, 'threshold', parseInt(e.target.value))
                                }
                            />
                        </div>
                    </div>
                );
            }

            case 'prerequisite': {
                const params = rule.params as {
                    required_chapters?: string[];
                    required_slides?: string[];
                    threshold: number;
                };
                return (
                    <div className="space-y-2">
                        <div>
                            <Label>{t('form.requiredChapters')}</Label>
                            <MultiSelect
                                options={allChapters.map((ch) => ({
                                    label: ch.name,
                                    value: ch.id,
                                }))}
                                selected={params.required_chapters || []}
                                onChange={(ids) =>
                                    handleRuleChange(index, 'required_chapters', ids)
                                }
                                placeholder={t('form.selectChapters')}
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('form.requiredChaptersHint')}
                            </p>
                        </div>
                        <div>
                            <Label>{t('form.completionThresholdPercent')}</Label>
                            <Input
                                type="number"
                                min="0"
                                max="100"
                                value={params.threshold || 0}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleRuleChange(index, 'threshold', parseInt(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('form.prerequisiteThresholdHint')}
                            </p>
                        </div>
                    </div>
                );
            }

            case 'sequential': {
                const params = rule.params as { requires_previous: boolean; threshold: number };
                return (
                    <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id={`sequential-chapter-${index}`}
                                checked={params.requires_previous !== false}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleRuleChange(index, 'requires_previous', e.target.checked)
                                }
                                className="size-4 rounded border-gray-300"
                            />
                            <Label
                                htmlFor={`sequential-chapter-${index}`}
                                className="cursor-pointer"
                            >
                                {t('form.requiresPreviousCompletion')}
                            </Label>
                        </div>
                        <div>
                            <Label>{t('form.completionThresholdPercent')}</Label>
                            <Input
                                type="number"
                                min="0"
                                max="100"
                                value={params.threshold || 0}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleRuleChange(index, 'threshold', parseInt(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('form.sequentialThresholdHint')}
                            </p>
                        </div>
                    </div>
                );
            }

            default:
                return null;
        }
    };

    const handleSubmit = () => {
        // Validate
        const hasEmptyFields = rules.some((rule) => {
            if (rule.type === 'date_based') {
                const params = rule.params as { unlock_date: string };
                return !params.unlock_date;
            }
            if (rule.type === 'completion_based') {
                const params = rule.params as { threshold: number };
                return params.threshold === undefined;
            }
            if (rule.type === 'prerequisite') {
                const params = rule.params as { threshold: number };
                return params.threshold === undefined;
            }
            return false;
        });

        if (hasEmptyFields) {
            alert(t('alerts.fillRequiredFields'));
            return;
        }

        const newCondition: Omit<DripCondition, 'id'> = {
            level: 'chapter',
            level_id: chapterId,
            drip_condition: [
                {
                    target,
                    behavior,
                    is_enabled: isEnabled,
                    rules,
                },
            ],
            enabled: true,
        };

        onSave(newCondition);
    };

    return (
        <div className="space-y-4 rounded-lg border-2 p-4">
            <div className="space-y-2">
                <Label>{t('form.behavior')}</Label>
                <Select value={behavior} onValueChange={(v) => setBehavior(v as any)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="lock">{t('behaviorOptions.lock')}</SelectItem>
                        <SelectItem value="hide">{t('behaviorOptions.hide')}</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>{t('form.unlockRule')}</Label>
                </div>

                {rules.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                        {t('form.noRuleConfigured')}
                    </div>
                ) : (
                    rules.map((rule, index) => (
                        <div key={index} className="space-y-3 rounded-md border bg-white p-3">
                            <div className="flex items-center justify-between">
                                <Select
                                    value={rule.type}
                                    onValueChange={(v) => handleRuleTypeChange(index, v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="date_based">{t('ruleTypes.dateBased')}</SelectItem>
                                        <SelectItem value="completion_based">
                                            {t('ruleTypes.completionBased')}
                                        </SelectItem>
                                        <SelectItem value="prerequisite">{t('ruleTypes.prerequisite')}</SelectItem>
                                        <SelectItem value="sequential">{t('ruleTypes.sequential')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {renderRuleEditor(rule, index)}
                        </div>
                    ))
                )}
            </div>

            {/* Enable Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex flex-col gap-1">
                    <Label htmlFor="chapter-condition-enabled" className="font-medium">
                        {t('form.enableConditionLabel')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        {t('form.enableConditionHint')}
                    </p>
                </div>
                <Switch
                    id="chapter-condition-enabled"
                    checked={isEnabled}
                    onCheckedChange={setIsEnabled}
                />
            </div>

            <div className="flex justify-end gap-2 pt-2">
                <MyButton onClick={handleSubmit} disabled={saving || rules.length === 0}>
                    {saving ? t('actions.saving') : t('actions.saveCondition')}
                </MyButton>
            </div>
        </div>
    );
}
