import React from 'react';
import { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EnquiryForm } from '../../-schema/EnquirySchema';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { X, CaretDown } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const buildAssignmentStrategies = (t: TFunction) => [
    {
        value: 'ROUND_ROBIN',
        label: t('strategies.roundRobin.label'),
        desc: t('strategies.roundRobin.desc'),
    },
    {
        value: 'RANDOM',
        label: t('strategies.random.label'),
        desc: t('strategies.random.desc'),
    },
    {
        value: 'WEIGHTED_ROUND_ROBIN',
        label: t('strategies.weighted.label'),
        desc: t('strategies.weighted.desc'),
        disabled: true,
        disabledNote: t('strategies.weighted.disabledNote'),
    },
    {
        value: 'PERFORMANCE_BASED',
        label: t('strategies.performance.label'),
        desc: t('strategies.performance.desc'),
    },
    {
        value: 'LEAST_LOADED',
        label: t('strategies.leastLoaded.label'),
        desc: t('strategies.leastLoaded.desc'),
    },
];

interface CounsellorSettingsCardProps {
    watch: UseFormWatch<EnquiryForm>;
    setValue: UseFormSetValue<EnquiryForm>;
}

export const CounsellorSettingsCard: React.FC<CounsellorSettingsCardProps> = ({
    watch,
    setValue,
}) => {
    const { t } = useTranslation('admissionsCounsellorSettingsCard');
    const ASSIGNMENT_STRATEGIES = React.useMemo(() => buildAssignmentStrategies(t), [t]);
    const [counsellorInput, setCounsellorInput] = React.useState('');

    const allowParentSelection = watch('counsellor_settings.data.allowParentSelection');
    const autoAssignEnabled = watch('counsellor_settings.data.autoAssignEnabled');
    const assignmentStrategy = watch('counsellor_settings.data.assignmentStrategy');
    const counsellorIds = watch('counsellor_settings.data.counsellorIds') || [];
    const maxActiveLeadsPerCounselor = watch('counsellor_settings.data.maxActiveLeadsPerCounselor');
    const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(false);

    const handleAllowParentSelectionChange = (checked: boolean) => {
        setValue('counsellor_settings.data.allowParentSelection', checked, {
            shouldValidate: true,
            shouldDirty: true,
        });

        // If parent selection is enabled, auto-assign must be disabled
        if (checked) {
            setValue('counsellor_settings.data.autoAssignEnabled', false, {
                shouldValidate: true,
                shouldDirty: true,
            });
        }
    };

    const handleAutoAssignChange = (checked: boolean) => {
        // If auto-assign is enabled, parent selection must be disabled
        if (checked) {
            setValue('counsellor_settings.data.allowParentSelection', false, {
                shouldValidate: true,
                shouldDirty: true,
            });
        }
        setValue('counsellor_settings.data.autoAssignEnabled', checked, {
            shouldValidate: true,
            shouldDirty: true,
        });
    };

    const handleAddCounsellor = () => {
        if (counsellorInput.trim()) {
            const updatedIds = [...counsellorIds, counsellorInput.trim()];
            setValue('counsellor_settings.data.counsellorIds', updatedIds, {
                shouldValidate: true,
                shouldDirty: true,
            });
            setCounsellorInput('');
        }
    };

    const handleRemoveCounsellor = (index: number) => {
        const updatedIds = counsellorIds.filter((_: string, i: number) => i !== index);
        setValue('counsellor_settings.data.counsellorIds', updatedIds, {
            shouldValidate: true,
            shouldDirty: true,
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddCounsellor();
        }
    };

    return (
        <div className="space-y-6 rounded-lg border border-neutral-200 p-6">
            <div>
                <h3 className="text-lg font-semibold text-neutral-900">{t('heading')}</h3>
                <p className="mt-1 text-sm text-neutral-500">{t('subheading')}</p>
            </div>

            {/* Auto-Assign Enabled */}
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-4">
                <div className="space-y-0.5">
                    <Label className="text-sm font-medium text-neutral-700">
                        {t('autoAssign.label')}
                    </Label>
                    <p className="text-xs text-neutral-500">{t('autoAssign.desc')}</p>
                </div>
                <Switch
                    checked={autoAssignEnabled}
                    onCheckedChange={handleAutoAssignChange}
                    disabled={allowParentSelection}
                />
            </div>

            {/* Allow Parent Selection */}
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-4">
                <div className="space-y-0.5">
                    <Label className="text-sm font-medium text-neutral-700">
                        {t('allowParent.label')}
                    </Label>
                    <p className="text-xs text-neutral-500">{t('allowParent.desc')}</p>
                </div>
                <Switch
                    checked={allowParentSelection}
                    onCheckedChange={handleAllowParentSelectionChange}
                    disabled={autoAssignEnabled}
                />
            </div>

            {/* Assignment Strategy (only show when auto-assign is enabled) */}
            {autoAssignEnabled && (
                <div className="space-y-3">
                    <Label className="text-sm font-medium text-neutral-700">
                        {t('assignmentStrategy.label')}
                    </Label>
                    <RadioGroup
                        value={
                            // Migrate legacy values to new format
                            assignmentStrategy === 'round_robin' ||
                            assignmentStrategy === 'in_order'
                                ? 'ROUND_ROBIN'
                                : assignmentStrategy
                        }
                        onValueChange={(value) => {
                            setValue(
                                'counsellor_settings.data.assignmentStrategy',
                                value as
                                    | 'round_robin'
                                    | 'in_order'
                                    | 'RANDOM'
                                    | 'ROUND_ROBIN'
                                    | 'WEIGHTED_ROUND_ROBIN'
                                    | 'PERFORMANCE_BASED'
                                    | 'LEAST_LOADED',
                                {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                }
                            );
                        }}
                        className="space-y-2"
                    >
                        {ASSIGNMENT_STRATEGIES.map((strategy) => (
                            <div
                                key={strategy.value}
                                className={`flex items-center space-x-3 rounded-lg border p-3 transition-colors ${
                                    strategy.disabled
                                        ? 'cursor-not-allowed border-neutral-100 bg-neutral-50 opacity-60'
                                        : 'border-neutral-200 hover:border-primary-300 hover:bg-primary-50/30'
                                }`}
                            >
                                <RadioGroupItem
                                    value={strategy.value}
                                    id={strategy.value}
                                    disabled={strategy.disabled}
                                />
                                <Label
                                    htmlFor={strategy.value}
                                    className={`flex-1 text-sm ${strategy.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    <div className="font-medium">{strategy.label}</div>
                                    <div className="text-xs text-neutral-500">{strategy.desc}</div>
                                    {strategy.disabled && strategy.disabledNote && (
                                        <div className="mt-0.5 text-caption font-medium text-amber-600">
                                            {strategy.disabledNote}
                                        </div>
                                    )}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>

                    {/* Advanced Settings */}
                    <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                        <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
                            <CaretDown
                                className={`size-3.5 transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`}
                            />
                            {t('advanced.trigger')}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-medium text-neutral-700">
                                    {t('advanced.maxActiveLeads.label')}
                                </Label>
                                <Input
                                    type="number"
                                    placeholder={t('advanced.maxActiveLeads.placeholder')}
                                    min={1}
                                    value={maxActiveLeadsPerCounselor ?? ''}
                                    onChange={(e) => {
                                        const v = e.target.value
                                            ? parseInt(e.target.value, 10)
                                            : undefined;
                                        setValue(
                                            'counsellor_settings.data.maxActiveLeadsPerCounselor',
                                            v,
                                            { shouldValidate: true, shouldDirty: true }
                                        );
                                    }}
                                    className="h-8 text-sm"
                                />
                                <p className="text-caption text-neutral-400">
                                    {t('advanced.maxActiveLeads.helper')}
                                </p>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>
            )}

            {/* Counsellor IDs */}
            <div className="space-y-3">
                <Label className="text-sm font-medium text-neutral-700">
                    {t('counsellors.label')}{' '}
                    <span className="text-neutral-400">{t('counsellors.optional')}</span>
                </Label>
                <p className="text-xs text-neutral-500">{t('counsellors.desc')}</p>

                {/* Existing counsellor chips */}
                {counsellorIds.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {counsellorIds.map((id: string, index: number) => (
                            <div
                                key={index}
                                className="flex items-center gap-1 rounded-md bg-primary-100 px-3 py-1.5 text-sm text-primary-700"
                            >
                                <span>{id}</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCounsellor(index)}
                                    className="ml-1 hover:text-primary-900"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add counsellor input */}
                <div className="flex gap-2">
                    <Input
                        type="text"
                        placeholder={t('counsellors.inputPlaceholder')}
                        value={counsellorInput}
                        onChange={(e) => setCounsellorInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1"
                    />
                    <MyButton
                        type="button"
                        onClick={handleAddCounsellor}
                        buttonType="secondary"
                        scale="medium"
                        disabled={!counsellorInput.trim()}
                    >
                        {t('counsellors.addButton')}
                    </MyButton>
                </div>
            </div>
        </div>
    );
};
