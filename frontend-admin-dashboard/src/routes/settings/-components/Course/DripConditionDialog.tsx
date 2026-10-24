import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    DripCondition,
    DripConditionLevel,
    DripConditionBehavior,
    DripConditionRuleType,
    DripConditionRule,
} from '@/types/course-settings';
import {
    createEmptyDripCondition,
    validateDripCondition,
    createDefaultRule,
    getRuleTypeDisplayName,
} from '@/utils/drip-conditions';
import { Warning, Trash, Calendar, Target, Lock, Eye } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface DripConditionDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: (condition: DripCondition) => void;
    condition?: DripCondition;
    mode: 'add' | 'edit';
}

export const DripConditionDialog: React.FC<DripConditionDialogProps> = ({
    open,
    onClose,
    onSave,
    condition,
    mode,
}) => {
    const { t } = useTranslation('settingsDripCondition');
    const [formData, setFormData] = useState<Partial<DripCondition>>(createEmptyDripCondition());
    const [errors, setErrors] = useState<string[]>([]);
    const { getCourseFromPackage } = useInstituteDetailsStore();
    const packageList = getCourseFromPackage();

    useEffect(() => {
        if (open) {
            setFormData(condition || createEmptyDripCondition());
            setErrors([]);
        }
    }, [open, condition]);

    const handleSave = () => {
        const validation = validateDripCondition(formData);
        if (!validation.valid) {
            setErrors(validation.errors);
            return;
        }

        const finalCondition: DripCondition = {
            ...formData,
            updated_at: new Date().toISOString(),
        } as DripCondition;

        onSave(finalCondition);
        onClose();
    };

    const addRule = (type: DripConditionRuleType) => {
        const newRule = createDefaultRule(type);
        setFormData((prev) => {
            const currentConfig = prev.drip_condition?.[0] || {
                target: prev.level === 'package' ? 'chapter' : (prev.level as 'chapter' | 'slide'),
                behavior: 'lock' as DripConditionBehavior,
                is_enabled: true,
                rules: [],
            };
            return {
                ...prev,
                drip_condition: [
                    {
                        ...currentConfig,
                        rules: [...currentConfig.rules, newRule],
                    },
                ],
            };
        });
    };

    const removeRule = (index: number) => {
        setFormData((prev) => {
            const currentConfig = prev.drip_condition?.[0];
            if (!currentConfig) return prev;
            return {
                ...prev,
                drip_condition: [
                    {
                        ...currentConfig,
                        rules: currentConfig.rules.filter(
                            (_: DripConditionRule, i: number) => i !== index
                        ),
                    },
                ],
            };
        });
    };

    const updateRule = (index: number, updatedRule: DripConditionRule) => {
        setFormData((prev) => {
            const currentConfig = prev.drip_condition?.[0];
            if (!currentConfig) return prev;
            return {
                ...prev,
                drip_condition: [
                    {
                        ...currentConfig,
                        rules: currentConfig.rules.map((rule: DripConditionRule, i: number) =>
                            i === index ? updatedRule : rule
                        ),
                    },
                ],
            };
        });
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={onClose}
            heading={mode === 'add' ? t('dialog.title.add') : t('dialog.title.edit')}
            dialogWidth="max-w-4xl"
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>
                        {t('footer.cancel')}
                    </Button>
                    <MyButton onClick={handleSave} className="bg-primary-500">
                        {mode === 'add' ? t('footer.addCondition') : t('footer.saveChanges')}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-6">
                <div className="text-sm text-muted-foreground">
                    {t('dialog.description')}
                </div>

                {/* Error Display */}
                {errors.length > 0 && (
                    <Alert variant="destructive">
                        <Warning className="size-4" />
                        <AlertDescription>
                            <ul className="list-disc pl-4">
                                {errors.map((error, index) => (
                                    <li key={index}>{error}</li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                )}

                {/* Basic Settings */}
                <div className="grid gap-4">
                    <div className="grid grid-cols-2 gap-4">
                        {/* Level Selection */}
                        <div className="space-y-2">
                            <Label htmlFor="level">{t('basicSettings.level.label')}</Label>
                            <Select
                                value={formData.level}
                                onValueChange={(value) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        level: value as DripConditionLevel,
                                        level_id: '', // Reset level_id when level changes
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('basicSettings.level.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="package">
                                        <div className="flex items-center gap-2">
                                            <Target className="size-4" />
                                            {t('basicSettings.level.package')}
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="chapter">
                                        <div className="flex items-center gap-2">
                                            <Target className="size-4" />
                                            {getTerminology(ContentTerms.Chapter, SystemTerms.Chapter)}
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="slide">
                                        <div className="flex items-center gap-2">
                                            <Target className="size-4" />
                                            {getTerminology(ContentTerms.Slide, SystemTerms.Slide)}
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Level ID - Dropdown for package, Input for others */}
                        <div className="space-y-2">
                            <Label htmlFor="level-id">
                                {formData.level === 'package'
                                    ? t('basicSettings.levelId.packageLabel')
                                    : formData.level === 'chapter'
                                      ? t('basicSettings.levelId.idLabel', {
                                            term: getTerminology(
                                                ContentTerms.Chapter,
                                                SystemTerms.Chapter
                                            ),
                                        })
                                      : t('basicSettings.levelId.idLabel', {
                                            term: getTerminology(
                                                ContentTerms.Slide,
                                                SystemTerms.Slide
                                            ),
                                        })}
                            </Label>
                            {formData.level === 'package' ? (
                                <Select
                                    value={formData.level_id}
                                    onValueChange={(value) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            level_id: value,
                                        }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={t('basicSettings.levelId.packagePlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {packageList.map((pkg) => (
                                            <SelectItem key={pkg.id} value={pkg.id}>
                                                {pkg.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    id="level-id"
                                    placeholder={t('basicSettings.levelId.idPlaceholder')}
                                    value={formData.level_id}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            level_id: e.target.value,
                                        }))
                                    }
                                />
                            )}
                        </div>
                    </div>

                    {/* Target (for package level only) */}
                    {formData.level === 'package' && (
                        <div className="space-y-2">
                            <Label htmlFor="target">{t('basicSettings.target.label')}</Label>
                            <Select
                                value={formData.drip_condition?.[0]?.target}
                                onValueChange={(value) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        drip_condition: [
                                            {
                                                ...(prev.drip_condition?.[0] || {
                                                    behavior: 'lock' as DripConditionBehavior,
                                                    is_enabled: true,
                                                    rules: [],
                                                }),
                                                target: value as 'chapter' | 'slide',
                                            },
                                        ],
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('basicSettings.target.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="chapter">
                                        {t('basicSettings.target.allItems', {
                                            term: getTerminologyPlural(
                                                ContentTerms.Chapter,
                                                SystemTerms.Chapter
                                            ),
                                        })}
                                    </SelectItem>
                                    <SelectItem value="slide">
                                        {t('basicSettings.target.allItems', {
                                            term: getTerminologyPlural(
                                                ContentTerms.Slide,
                                                SystemTerms.Slide
                                            ),
                                        })}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {t('basicSettings.target.hint')}
                            </p>
                        </div>
                    )}

                    {/* Behavior */}
                    <div className="space-y-2">
                        <Label htmlFor="behavior">{t('basicSettings.behavior.label')}</Label>
                        <Select
                            value={formData.drip_condition?.[0]?.behavior}
                            onValueChange={(value) =>
                                setFormData((prev) => ({
                                    ...prev,
                                    drip_condition: [
                                        {
                                            ...(prev.drip_condition?.[0] || {
                                                target:
                                                    prev.level === 'package'
                                                        ? 'chapter'
                                                        : (prev.level as 'chapter' | 'slide'),
                                                is_enabled: true,
                                                rules: [],
                                            }),
                                            behavior: value as DripConditionBehavior,
                                        },
                                    ],
                                }))
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('basicSettings.behavior.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="lock">
                                    <div className="flex items-center gap-2">
                                        <Lock className="size-4" />
                                        {t('basicSettings.behavior.lock')}
                                    </div>
                                </SelectItem>
                                <SelectItem value="hide">
                                    <div className="flex items-center gap-2">
                                        <Eye className="size-4" />
                                        {t('basicSettings.behavior.hide')}
                                    </div>
                                </SelectItem>
                                <SelectItem value="both">
                                    <div className="flex items-center gap-2">
                                        <Lock className="size-4" />
                                        <Eye className="size-4" />
                                        {t('basicSettings.behavior.both')}
                                    </div>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Enabled Toggle */}
                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                            <Label>{t('basicSettings.enabled.label')}</Label>
                            <p className="text-sm text-muted-foreground">
                                {t('basicSettings.enabled.hint')}
                            </p>
                        </div>
                        <Switch
                            checked={formData.enabled}
                            onCheckedChange={(checked) =>
                                setFormData((prev) => ({ ...prev, enabled: checked }))
                            }
                        />
                    </div>
                </div>

                {/* Rules Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label className="text-base">{t('rules.title')}</Label>
                            <p className="text-sm text-muted-foreground">{t('rules.hint')}</p>
                        </div>
                        <Select onValueChange={(value) => addRule(value as DripConditionRuleType)}>
                            <SelectTrigger className="w-48">
                                <SelectValue placeholder={t('rules.addPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="date_based">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="size-4" />
                                        {t('rules.types.dateBased')}
                                    </div>
                                </SelectItem>
                                <SelectItem value="completion_based">
                                    {t('rules.types.completionBased')}
                                </SelectItem>
                                <SelectItem value="prerequisite">
                                    {t('rules.types.prerequisite')}
                                </SelectItem>
                                <SelectItem value="sequential">
                                    {t('rules.types.sequential')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Rules List */}
                    <div className="space-y-3">
                        {formData.drip_condition?.[0]?.rules.map(
                            (rule: DripConditionRule, index: number) => (
                                <RuleEditor
                                    key={index}
                                    rule={rule}
                                    index={index}
                                    onUpdate={updateRule}
                                    onRemove={removeRule}
                                />
                            )
                        )}

                        {formData.drip_condition?.[0]?.rules.length === 0 && (
                            <div className="rounded-lg border border-dashed p-8 text-center">
                                <p className="text-sm text-muted-foreground">{t('rules.empty')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </MyDialog>
    );
};

// Rule Editor Component
interface RuleEditorProps {
    rule: DripConditionRule;
    index: number;
    onUpdate: (index: number, rule: DripConditionRule) => void;
    onRemove: (index: number) => void;
}

const RuleEditor: React.FC<RuleEditorProps> = ({ rule, index, onUpdate, onRemove }) => {
    const { t } = useTranslation('settingsDripCondition');
    const updateParams = (key: string, value: string | number | string[]) => {
        onUpdate(index, {
            ...rule,
            params: {
                ...rule.params,
                [key]: value,
            },
        });
    };

    return (
        <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">{getRuleTypeDisplayName(rule.type)}</h4>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(index)}
                    className="size-8 p-0 text-red-600 hover:bg-red-50"
                >
                    <Trash className="size-4" />
                </Button>
            </div>

            {/* Date-Based Rule */}
            {rule.type === 'date_based' && (
                <div className="space-y-2">
                    <Label>{t('ruleEditor.dateBased.label')}</Label>
                    <Input
                        type="datetime-local"
                        value={
                            (rule.params as { unlock_date?: string }).unlock_date?.slice(0, 16) ||
                            ''
                        }
                        onChange={(e) => {
                            const isoDate = e.target.value
                                ? new Date(e.target.value).toISOString()
                                : '';
                            updateParams('unlock_date', isoDate);
                        }}
                    />
                </div>
            )}

            {/* Completion-Based Rule */}
            {rule.type === 'completion_based' && (
                <div className="space-y-3">
                    <div className="space-y-2">
                        <Label>{t('ruleEditor.completionBased.metricLabel')}</Label>
                        <Select
                            value={(rule.params as { metric: string }).metric}
                            onValueChange={(value) => updateParams('metric', value)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="average_of_all">
                                    {t('ruleEditor.completionBased.averageOfAll')}
                                </SelectItem>
                                <SelectItem value="average_of_last_n">
                                    {t('ruleEditor.completionBased.averageOfLastN')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {(rule.params as { metric: string }).metric === 'average_of_last_n' && (
                        <div className="space-y-2">
                            <Label>{t('ruleEditor.completionBased.countLabel')}</Label>
                            <Input
                                type="number"
                                min="1"
                                value={(rule.params as { count?: number }).count || 1}
                                onChange={(e) => updateParams('count', parseInt(e.target.value))}
                            />
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>{t('ruleEditor.completionBased.thresholdLabel')}</Label>
                        <Input
                            type="number"
                            min="0"
                            max="100"
                            value={(rule.params as { threshold: number }).threshold || 0}
                            onChange={(e) => updateParams('threshold', parseInt(e.target.value))}
                        />
                    </div>
                </div>
            )}

            {/* Prerequisite Rule */}
            {rule.type === 'prerequisite' && (
                <div className="space-y-3">
                    <div className="space-y-2">
                        <Label>{t('ruleEditor.prerequisite.typeLabel')}</Label>
                        <Select
                            value={
                                (rule.params as { required_chapters?: string[] }).required_chapters
                                    ? 'chapters'
                                    : 'slides'
                            }
                            onValueChange={(value) => {
                                if (value === 'chapters') {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { required_slides, ...rest } = rule.params as {
                                        required_slides?: string[];
                                        threshold: number;
                                    };
                                    onUpdate(index, {
                                        ...rule,
                                        params: { ...rest, required_chapters: [] },
                                    });
                                } else {
                                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                    const { required_chapters, ...rest } = rule.params as {
                                        required_chapters?: string[];
                                        threshold: number;
                                    };
                                    onUpdate(index, {
                                        ...rule,
                                        params: { ...rest, required_slides: [] },
                                    });
                                }
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="chapters">
                                    {t('ruleEditor.prerequisite.requiredItems', {
                                        term: getTerminologyPlural(
                                            ContentTerms.Chapter,
                                            SystemTerms.Chapter
                                        ),
                                    })}
                                </SelectItem>
                                <SelectItem value="slides">
                                    {t('ruleEditor.prerequisite.requiredItems', {
                                        term: getTerminologyPlural(
                                            ContentTerms.Slide,
                                            SystemTerms.Slide
                                        ),
                                    })}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>{t('ruleEditor.prerequisite.itemIdsLabel')}</Label>
                        <Input
                            placeholder={t('ruleEditor.prerequisite.itemIdsPlaceholder')}
                            value={
                                (
                                    rule.params as {
                                        required_chapters?: string[];
                                        required_slides?: string[];
                                    }
                                ).required_chapters?.join(', ') ||
                                (
                                    rule.params as { required_slides?: string[] }
                                ).required_slides?.join(', ') ||
                                ''
                            }
                            onChange={(e) => {
                                const ids = e.target.value
                                    .split(',')
                                    .map((id) => id.trim())
                                    .filter((id) => id);
                                if (
                                    (rule.params as { required_chapters?: string[] })
                                        .required_chapters !== undefined
                                ) {
                                    updateParams('required_chapters', ids);
                                } else {
                                    updateParams('required_slides', ids);
                                }
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('ruleEditor.prerequisite.thresholdLabel')}</Label>
                        <Input
                            type="number"
                            min="0"
                            max="100"
                            value={(rule.params as { threshold: number }).threshold || 0}
                            onChange={(e) => updateParams('threshold', parseInt(e.target.value))}
                        />
                    </div>
                </div>
            )}

            {/* Sequential Rule */}
            {rule.type === 'sequential' && (
                <div className="space-y-2">
                    <Label>{t('ruleEditor.sequential.thresholdLabel')}</Label>
                    <Input
                        type="number"
                        min="0"
                        max="100"
                        value={(rule.params as { threshold: number }).threshold || 0}
                        onChange={(e) => updateParams('threshold', parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('ruleEditor.sequential.hint')}
                    </p>
                </div>
            )}
        </div>
    );
};
