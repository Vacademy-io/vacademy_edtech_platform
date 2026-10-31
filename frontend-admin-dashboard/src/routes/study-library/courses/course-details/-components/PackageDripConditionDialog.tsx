import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Calendar, CheckCircle } from 'lucide-react';
import {
    DripCondition,
    DripConditionRule,
    DripConditionRuleType,
    DripConditionBehavior,
    DripConditionConfig,
    DripConditionContentLevel,
} from '@/types/course-settings';
import { getLevelDisplayName } from '@/utils/drip-conditions';
import { MyButton } from '@/components/design-system/button';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

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

interface PackageDripConditionDialogProps {
    open: boolean;
    onClose: () => void;
    onSave: (condition: DripCondition) => void;
    packageId: string;
    packageName: string;
    condition?: DripCondition;
    initialTarget?: DripConditionContentLevel;
}

export const PackageDripConditionDialog: React.FC<PackageDripConditionDialogProps> = ({
    open,
    onClose,
    onSave,
    packageId,
    packageName,
    condition,
    initialTarget,
}) => {
    const { t } = useTranslation('studyLibraryPackageDripConditionDialog');
    // Start with chapter as default target
    const [selectedTarget, setSelectedTarget] = useState<DripConditionContentLevel>('chapter');

    // Find existing config for selected target or create new one
    const getConfigForTarget = (target: DripConditionContentLevel): DripConditionConfig => {
        if (condition) {
            const existingConfig = condition.drip_condition.find((c) => c.target === target);
            if (existingConfig) {
                return existingConfig;
            }
        }
        return {
            target,
            behavior: 'lock',
            is_enabled: true,
            rules: [
                {
                    type: 'date_based',
                    params: { unlock_date: new Date().toISOString() },
                },
            ],
        };
    };

    const [currentConfig, setCurrentConfig] = useState<DripConditionConfig>(
        getConfigForTarget('chapter')
    );
    const [enabled, setEnabled] = useState(condition?.enabled ?? true);
    const [configEnabled, setConfigEnabled] = useState(currentConfig.is_enabled ?? true);

    // Update config when target changes
    const handleTargetChange = (newTarget: DripConditionContentLevel) => {
        setSelectedTarget(newTarget);
        const newConfig = getConfigForTarget(newTarget);
        setCurrentConfig(newConfig);
        setConfigEnabled(newConfig.is_enabled ?? true);
    };

    useEffect(() => {
        if (open) {
            // When editing existing condition, use initialTarget if provided, otherwise find which target has configs
            let targetToSelect: DripConditionContentLevel = 'chapter';

            if (initialTarget) {
                // Use the explicitly passed target (when editing a specific target)
                targetToSelect = initialTarget;
            } else if (condition?.drip_condition && condition.drip_condition.length > 0) {
                // Select the first available target from existing configs
                targetToSelect = condition?.drip_condition[0]?.target ?? 'chapter';
            }

            const config = getConfigForTarget(targetToSelect);
            setSelectedTarget(targetToSelect);
            setCurrentConfig(config);
            setEnabled(condition?.enabled ?? true);
            setConfigEnabled(config.is_enabled ?? true);
        }
    }, [condition, open, initialTarget]);

    const handleSave = () => {
        // Ensure the currentConfig has the correct target and is_enabled
        const configToSave: DripConditionConfig = {
            ...currentConfig,
            target: selectedTarget,
            is_enabled: configEnabled,
        };

        // Merge the current config with existing configs
        const existingConfigs = condition?.drip_condition || [];
        const otherConfigs = existingConfigs.filter((c) => c.target !== selectedTarget);
        const updatedConfigs = [...otherConfigs, configToSave];

        const updatedCondition: DripCondition = {
            id: condition?.id || `drip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            level: 'package',
            level_id: packageId,
            drip_condition: updatedConfigs,
            enabled,
            created_at: condition?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        onSave(updatedCondition);
        onClose();
    };

    const handleRuleChange = (index: number, rule: DripConditionRule) => {
        setCurrentConfig({
            ...currentConfig,
            rules: currentConfig.rules.map((r, i) => (i === index ? rule : r)),
        });
    };

    const handleRuleTypeChange = (index: number, type: DripConditionRuleType) => {
        const newRule: DripConditionRule = (() => {
            switch (type) {
                case 'date_based':
                    return {
                        type,
                        params: { unlock_date: new Date().toISOString() },
                    };
                case 'completion_based':
                    return {
                        type,
                        params: { metric: 'average_of_all', threshold: 100 },
                    };
                case 'prerequisite':
                    return {
                        type,
                        params: { required_chapters: [], threshold: 100 },
                    };
                case 'sequential':
                    return {
                        type,
                        params: { requires_previous: true, threshold: 100 },
                    };
                default:
                    return {
                        type: 'date_based',
                        params: { unlock_date: new Date().toISOString() },
                    };
            }
        })();
        handleRuleChange(index, newRule);
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
                                handleRuleChange(index, {
                                    ...rule,
                                    params: { unlock_date: toISOStringFromLocal(e.target.value) },
                                })
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
                                onValueChange={(value) =>
                                    handleRuleChange(index, {
                                        ...rule,
                                        params: {
                                            ...params,
                                            metric: value as 'average_of_last_n' | 'average_of_all',
                                        },
                                    })
                                }
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
                                        handleRuleChange(index, {
                                            ...rule,
                                            params: {
                                                ...params,
                                                count: parseInt(e.target.value),
                                            },
                                        })
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
                                    handleRuleChange(index, {
                                        ...rule,
                                        params: {
                                            ...params,
                                            threshold: parseInt(e.target.value),
                                        },
                                    })
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
            heading={condition ? t('dialog.editHeading') : t('dialog.addHeading')}
            content={
                <div className="space-y-6">
                    {/* Package Info */}
                    <div className="rounded-lg bg-blue-50 p-3">
                        <p className="text-sm font-medium text-blue-900">
                            {t('dialog.course', { packageName })}
                        </p>
                    </div>

                    {/* Enable Configuration Toggle - Moved to Top */}
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="config-enabled" className="font-medium">
                                {t('dialog.enableTargetCondition', { target: selectedTarget })}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('dialog.enableTargetConditionHint', { target: selectedTarget })}
                            </p>
                        </div>
                        <Switch
                            id="config-enabled"
                            checked={configEnabled}
                            onCheckedChange={setConfigEnabled}
                        />
                    </div>

                    {/* Target Selection */}
                    <div className="space-y-2">
                        <Label>{t('form.targetContent')}</Label>
                        <Select
                            value={selectedTarget}
                            onValueChange={(value: DripConditionContentLevel) =>
                                handleTargetChange(value)
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('form.selectTarget')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="subject">{getTerminologyPlural(ContentTerms.Subjects, SystemTerms.Subjects)}</SelectItem>
                                <SelectItem value="module">{getTerminologyPlural(ContentTerms.Modules, SystemTerms.Modules)}</SelectItem>
                                <SelectItem value="chapter">{getTerminologyPlural(ContentTerms.Chapter, SystemTerms.Chapter)}</SelectItem>
                                <SelectItem value="slide">{getTerminologyPlural(ContentTerms.Slide, SystemTerms.Slide)}</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            {t('form.appliesToAll', {
                                level: getLevelDisplayName(selectedTarget).toLowerCase(),
                            })}
                        </p>
                    </div>

                    {/* Behavior Selection */}
                    <div className="space-y-2">
                        <Label>{t('form.behavior')}</Label>
                        <Select
                            value={currentConfig.behavior}
                            onValueChange={(value: DripConditionBehavior) =>
                                setCurrentConfig({
                                    ...currentConfig,
                                    behavior: value,
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('form.selectBehavior')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="lock">{t('behaviorOptions.lock')}</SelectItem>
                                <SelectItem value="hide">{t('behaviorOptions.hide')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Rules Section */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label>{t('form.unlockRule')}</Label>
                        </div>

                        {currentConfig.rules.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                                {t('form.noRuleConfigured')}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {currentConfig.rules.map((rule, index) => (
                                    <div
                                        key={index}
                                        className="space-y-3 rounded-lg border bg-gray-50 p-4"
                                    >
                                        <div className="flex items-center justify-between">
                                            <Select
                                                value={rule.type}
                                                onValueChange={(value) =>
                                                    handleRuleTypeChange(
                                                        index,
                                                        value as DripConditionRuleType
                                                    )
                                                }
                                            >
                                                <SelectTrigger className="w-[200px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="date_based">
                                                        <div className="flex items-center gap-2">
                                                            <Calendar className="size-4" />
                                                            {t('ruleTypes.dateBased')}
                                                        </div>
                                                    </SelectItem>
                                                    <SelectItem value="completion_based">
                                                        <div className="flex items-center gap-2">
                                                            <CheckCircle className="size-4" />
                                                            {t('ruleTypes.completionBased')}
                                                        </div>
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {renderRuleEditor(rule, index)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            }
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton buttonType="secondary" onClick={onClose}>
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton onClick={handleSave} disabled={currentConfig.rules.length === 0}>
                        {condition?.drip_condition.find((c) => c.target === selectedTarget)
                            ? t('actions.updateCondition')
                            : t('actions.addCondition')}
                    </MyButton>
                </div>
            }
        />
    );
};
