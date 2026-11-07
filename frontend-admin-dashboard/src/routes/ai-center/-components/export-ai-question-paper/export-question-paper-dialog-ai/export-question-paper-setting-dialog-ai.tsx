'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from '@phosphor-icons/react';
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from '@/components/ui/accordion';
import {
    CustomField,
    CustomFieldType,
    Question,
} from '@/components/common/export-offline/types/question';
import {
    ExportSettings,
    useExportSettings,
} from '@/components/common/export-offline/contexts/export-settings-context';
import { AnswerSpacingQuestionPaperDialogAI } from './answer-spacing-question-paper-dialog-ai';

interface ExportSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    questionsData: Question[]; // Add this prop
}

export function ExportQuestionPaperSettingsDialogAI({
    open,
    onOpenChange,
    questionsData,
}: ExportSettingsDialogProps) {
    const { t } = useTranslation('aiCenterExportQuestionPaperSettingDialog');
    const { settings, updateSettings } = useExportSettings();

    const handleSettingChange = useCallback(
        // @ts-expect-error : Parameter 'value' implicitly has an 'any' type.
        (key: keyof ExportSettings, value) => {
            updateSettings({ [key]: value });
        },
        [updateSettings]
    );

    const [newFieldLabel, setNewFieldLabel] = useState('');
    const [isAnswerSpacingDialogOpen, setIsAnswerSpacingDialogOpen] = useState(false);

    const handleCustomFieldChange = (index: number, field: Partial<CustomField>) => {
        const updatedFields = [...(settings.customFields || [])];
        updatedFields[index] = { ...updatedFields[index], ...field } as CustomField;
        updateSettings({ customFields: updatedFields });
    };

    const addCustomField = () => {
        if (!newFieldLabel.trim()) return;
        const newField = {
            label: newFieldLabel,
            enabled: true,
            type: 'blank' as CustomFieldType,
        };
        updateSettings({
            customFields: [...(settings.customFields || []), newField],
        });
        setNewFieldLabel('');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] w-3/5 max-w-2xl overflow-y-auto">{/* design-lint-ignore: vh-based dialog height matches MyDialog primitive */}
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                </DialogHeader>

                <div className="grid gap-6 py-2">
                    {/* Layout Settings */}
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="layout">
                            <AccordionTrigger className="text-base">
                                {t('sections.layout')}
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-4">
                                    <div className="flex w-full gap-x-4">
                                        <div className="flex w-1/2 items-center gap-2">
                                            <Label>{t('layout.columnsPerPage')}</Label>
                                            <div className="flex items-center space-x-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() =>
                                                        handleSettingChange(
                                                            'columnsPerPage',
                                                            Math.max(1, settings.columnsPerPage - 1)
                                                        )
                                                    }
                                                    disabled={settings.columnsPerPage <= 1}
                                                >
                                                    <Minus className="size-4" />
                                                </Button>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    max={3}
                                                    className="w-fit text-center"
                                                    value={settings.columnsPerPage}
                                                    onChange={(e) => {
                                                        const value = Number.parseInt(
                                                            e.target.value
                                                        );
                                                        handleSettingChange(
                                                            'columnsPerPage',
                                                            Math.min(Math.max(1, value), 3)
                                                        );
                                                    }}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() =>
                                                        handleSettingChange(
                                                            'columnsPerPage',
                                                            Math.min(3, settings.columnsPerPage + 1)
                                                        )
                                                    }
                                                    disabled={settings.columnsPerPage >= 3}
                                                >
                                                    <Plus className="size-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>{t('layout.spaceForRoughWork')}</Label>
                                        <RadioGroup
                                            value={settings.spaceForRoughWork}
                                            onValueChange={(value) =>
                                                handleSettingChange(
                                                    'spaceForRoughWork',
                                                    value as 'none' | 'bottom' | 'right'
                                                )
                                            }
                                            className="flex gap-4"
                                        >
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="none" id="rough-none" />
                                                <Label htmlFor="rough-none">
                                                    {t('layout.roughWorkPosition.none')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="bottom" id="rough-bottom" />
                                                <Label htmlFor="rough-bottom">
                                                    {t('layout.roughWorkPosition.bottom')}
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>{t('layout.roughWorkSize.label')}</Label>
                                        <RadioGroup
                                            value={settings.roughWorkSize}
                                            onValueChange={(value) =>
                                                handleSettingChange(
                                                    'roughWorkSize',
                                                    value as 'small' | 'medium' | 'large'
                                                )
                                            }
                                            className="flex gap-4"
                                        >
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="small"
                                                    id="rough-size-small"
                                                />
                                                <Label htmlFor="rough-size-small">
                                                    {t('layout.roughWorkSize.small')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="medium"
                                                    id="rough-size-medium"
                                                />
                                                <Label htmlFor="rough-size-medium">
                                                    {t('layout.roughWorkSize.medium')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="large"
                                                    id="rough-size-large"
                                                />
                                                <Label htmlFor="rough-size-large">
                                                    {t('layout.roughWorkSize.large')}
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>{t('layout.pagePadding.label')}</Label>
                                        <RadioGroup
                                            value={settings.pagePadding}
                                            onValueChange={(value) =>
                                                handleSettingChange(
                                                    'pagePadding',
                                                    value as 'low' | 'medium' | 'high'
                                                )
                                            }
                                            className="flex gap-4"
                                        >
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="low" id="padding-low" />
                                                <Label htmlFor="padding-low">
                                                    {t('layout.pagePadding.low')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="medium"
                                                    id="padding-medium"
                                                />
                                                <Label htmlFor="padding-medium">
                                                    {t('layout.pagePadding.medium')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="high" id="padding-high" />
                                                <Label htmlFor="padding-high">
                                                    {t('layout.pagePadding.high')}
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>{t('layout.fontSize.label')}</Label>
                                        <RadioGroup
                                            value={settings.fontSize}
                                            onValueChange={(value) =>
                                                handleSettingChange(
                                                    'fontSize',
                                                    value as 'small' | 'medium' | 'large'
                                                )
                                            }
                                            className="flex gap-4"
                                        >
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="small" id="font-small" />
                                                <Label htmlFor="font-small">
                                                    {t('layout.fontSize.small')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="medium" id="font-medium" />
                                                <Label htmlFor="font-medium">
                                                    {t('layout.fontSize.medium')}
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="large" id="font-large" />
                                                <Label htmlFor="font-large">
                                                    {t('layout.fontSize.large')}
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t('layout.imageSize.label')}</Label>
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id={'maintainImageAspectRatio'}
                                                checked={settings.maintainImageAspectRatio}
                                                onCheckedChange={(checked) =>
                                                    updateSettings({
                                                        maintainImageAspectRatio:
                                                            checked as boolean,
                                                    })
                                                }
                                            />
                                            <Label htmlFor="maintainImageAspectRatio">
                                                {t('layout.imageSize.maintainAspectRatio')}
                                            </Label>
                                        </div>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="display">
                            <AccordionTrigger className="text-base">
                                {t('sections.display')}
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col gap-y-2">
                                    {[
                                        [
                                            'showInstitutionLetterhead',
                                            t('display.showInstitutionLetterhead'),
                                        ],
                                        [
                                            'showFirstPageInstructions',
                                            t('display.showFirstPageInstructions'),
                                        ],
                                        [
                                            'showAdaptiveMarkingRules',
                                            t('display.showAdaptiveMarkingRules'),
                                        ],
                                        [
                                            'showSectionInstructions',
                                            t('display.showSectionInstructions'),
                                        ],
                                        [
                                            'showSectionDuration',
                                            t('display.showSectionDuration'),
                                        ],
                                        [
                                            'showMarksPerQuestion',
                                            t('display.showMarksPerQuestion'),
                                        ],
                                        [
                                            'showAdaptiveMarkingRulesSection',
                                            t('display.showAdaptiveMarkingRulesSection'),
                                        ],
                                        [
                                            'showCheckboxesBeforeOptions',
                                            t('display.showCheckboxesBeforeOptions'),
                                        ],
                                        ['showPageNumbers', t('display.showPageNumbers')],
                                    ].map(([key, label]) => (
                                        <div key={key} className="flex items-center gap-4">
                                            <Checkbox
                                                id={key}
                                                checked={
                                                    settings[key as keyof ExportSettings] as boolean
                                                }
                                                onCheckedChange={(checked) =>
                                                    handleSettingChange(
                                                        key as keyof ExportSettings,
                                                        checked
                                                    )
                                                }
                                            />
                                            <label htmlFor={key}>{label}</label>
                                        </div>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="paper">
                            <AccordionTrigger className="text-base">
                                {t('sections.paper')}
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col gap-y-2">
                                    <div className="flex items-center gap-2">
                                        <Label>{t('paper.createSets')}</Label>
                                        <div className="flex items-center space-x-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                onClick={() =>
                                                    handleSettingChange(
                                                        'questionPaperSets',
                                                        Math.max(1, settings.questionPaperSets - 1)
                                                    )
                                                }
                                                disabled={settings.questionPaperSets <= 1}
                                            >
                                                <Minus className="size-4" />
                                            </Button>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={3}
                                                className="w-fit text-center"
                                                value={settings.questionPaperSets}
                                                onChange={(e) => {
                                                    const value = Number.parseInt(e.target.value);
                                                    handleSettingChange(
                                                        'questionPaperSets',
                                                        Math.min(Math.max(1, value), 3)
                                                    );
                                                }}
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                onClick={() =>
                                                    handleSettingChange(
                                                        'questionPaperSets',
                                                        Math.min(3, settings.questionPaperSets + 1)
                                                    )
                                                }
                                                disabled={settings.questionPaperSets >= 3}
                                            >
                                                <Plus className="size-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <Checkbox
                                            id="includeQuestionSetCode"
                                            checked={settings.includeQuestionSetCode}
                                            onCheckedChange={(checked) =>
                                                handleSettingChange(
                                                    'includeQuestionSetCode',
                                                    checked
                                                )
                                            }
                                        />
                                        <label htmlFor="includeQuestionSetCode">
                                            {t('paper.includeQuestionSetCode')}
                                        </label>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <Checkbox
                                            id="randomizeQuestions"
                                            checked={settings.randomizeQuestions}
                                            onCheckedChange={(checked) =>
                                                handleSettingChange('randomizeQuestions', checked)
                                            }
                                        />
                                        <label htmlFor="randomizeQuestions">
                                            {t('paper.randomizeQuestions')}
                                        </label>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <Checkbox
                                            id="randomizeOptions"
                                            checked={settings.randomizeOptions}
                                            onCheckedChange={(checked) =>
                                                handleSettingChange('randomizeOptions', checked)
                                            }
                                        />
                                        <label htmlFor="randomizeOptions">
                                            {t('paper.randomizeOptions')}
                                        </label>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="custom">
                            <AccordionTrigger className="text-base">
                                {t('sections.customFields')}
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="grid gap-2">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id="includeCustomInputFields"
                                            checked={settings.includeCustomInputFields}
                                            onCheckedChange={(checked) =>
                                                updateSettings({
                                                    includeCustomInputFields: checked as boolean,
                                                })
                                            }
                                        />
                                        <Label htmlFor="includeCustomInputFields">
                                            {t('customFields.include')}
                                        </Label>
                                    </div>
                                    {settings.includeCustomInputFields && (
                                        <div className="space-y-2">
                                            {(settings.customFields || []).map((field, index) => (
                                                <div
                                                    key={index}
                                                    className="grid grid-cols-12 items-center gap-2"
                                                >
                                                    <div className="col-span-1">
                                                        <Checkbox
                                                            checked={field.enabled}
                                                            onCheckedChange={(checked) =>
                                                                handleCustomFieldChange(index, {
                                                                    enabled: checked as boolean,
                                                                })
                                                            }
                                                        />
                                                    </div>
                                                    <div className="col-span-6">
                                                        <Input
                                                            value={field.label}
                                                            onChange={(e) =>
                                                                handleCustomFieldChange(index, {
                                                                    label: e.target.value,
                                                                })
                                                            }
                                                            className="w-full"
                                                        />
                                                    </div>
                                                    <div className="col-span-5 flex gap-x-1">
                                                        <Select
                                                            value={field.type}
                                                            onValueChange={(value) =>
                                                                handleCustomFieldChange(index, {
                                                                    type: value as CustomFieldType,
                                                                })
                                                            }
                                                        >
                                                            <SelectTrigger>
                                                                <SelectValue
                                                                    placeholder={t(
                                                                        'customFields.selectTypePlaceholder'
                                                                    )}
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="blank">
                                                                    {t('customFields.type.blank')}
                                                                </SelectItem>
                                                                <SelectItem value="blocks">
                                                                    {t('customFields.type.blocks')}
                                                                </SelectItem>
                                                                <SelectItem value="input">
                                                                    {t('customFields.type.input')}
                                                                </SelectItem>
                                                                <SelectItem value="checkbox">
                                                                    {t(
                                                                        'customFields.type.checkbox'
                                                                    )}
                                                                </SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        {field.type === 'blocks' && (
                                                            <div className="col-span-5 flex items-center space-x-2">
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    max={20}
                                                                    value={
                                                                        field.numberOfBlocks || 10
                                                                    }
                                                                    onChange={(e) =>
                                                                        handleCustomFieldChange(
                                                                            index,
                                                                            {
                                                                                numberOfBlocks:
                                                                                    Number(
                                                                                        e.target
                                                                                            .value
                                                                                    ),
                                                                            }
                                                                        )
                                                                    }
                                                                    className="w-fit"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="mt-4 flex gap-4">
                                                <Input
                                                    placeholder={t(
                                                        'customFields.newFieldPlaceholder'
                                                    )}
                                                    value={newFieldLabel}
                                                    onChange={(e) =>
                                                        setNewFieldLabel(e.target.value)
                                                    }
                                                />
                                                <Button onClick={addCustomField} className="gap-2">
                                                    <Plus className="size-4" />
                                                    {t('customFields.add')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="advanced">
                            <AccordionTrigger className="text-base">
                                {t('sections.advanced')}
                            </AccordionTrigger>
                            <AccordionContent>
                                {/* Your existing advanced settings */}

                                <div className="space-y-4">
                                    <div className="flex flex-col gap-2">
                                        <Label>{t('advanced.answerSpacing')}</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setIsAnswerSpacingDialogOpen(true)}
                                        >
                                            {t('advanced.customSpacing')}
                                        </Button>
                                        <p className="text-sm text-muted-foreground">
                                            {t('advanced.customSpacingHint')}
                                        </p>
                                    </div>
                                </div>

                                {/* Rest of your advanced settings */}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    {/* Answer Spacing Dialog */}
                    <AnswerSpacingQuestionPaperDialogAI
                        open={isAnswerSpacingDialogOpen}
                        onOpenChange={setIsAnswerSpacingDialogOpen}
                        questionsData={questionsData}
                        spacings={settings.answerSpacings || {}}
                        onSave={(spacings) => {
                            updateSettings({
                                answerSpacings: spacings,
                            });
                        }}
                    />
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('actions.cancel')}
                    </Button>
                    <Button
                        className="bg-primary-500 text-white hover:bg-primary-400"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.save')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
