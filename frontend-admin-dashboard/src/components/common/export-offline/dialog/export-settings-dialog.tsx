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
import { useExportSettings, type ExportSettings } from '../contexts/export-settings-context';
import { useCallback, useState } from 'react';
import type { CustomField, CustomFieldType } from '../types/question';
import { Minus, Plus } from '@phosphor-icons/react';
import { AnswerSpacingDialog } from './answer-spacing-dialog';
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from '@/components/ui/accordion';
import { Section } from '../types/question'; // Make sure to import your Section type
import { HeaderSettingsDialog } from './header-settings-dialog';
import { Switch } from '@/components/ui/switch';

interface ExportSettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sections: Section[]; // Add this prop
    /** An OMR set is being printed: sets and randomizing are fixed by the saved set. */
    lockedSetCode?: string;
}

export function ExportSettingsDialog({
    open,
    onOpenChange,
    sections,
    lockedSetCode,
}: ExportSettingsDialogProps) {
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
            <DialogContent
                className="max-h-[90vh] w-3/5 max-w-2xl overflow-y-auto" /* design-lint-ignore: viewport-relative height cap, no token for 90vh */
            >
                <DialogHeader>
                    <DialogTitle>Export Settings</DialogTitle>
                </DialogHeader>

                <div className="grid gap-6 py-2">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="header">
                            <AccordionTrigger className="text-base">
                                Header Settings
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Custom Header</Label>
                                        <Switch
                                            checked={settings.headerSettings.enabled}
                                            onCheckedChange={(checked) =>
                                                updateSettings({
                                                    headerSettings: {
                                                        ...settings.headerSettings,
                                                        enabled: checked,
                                                    },
                                                })
                                            }
                                        />
                                    </div>

                                    {settings.headerSettings.enabled && (
                                        <div className="mt-4">
                                            <HeaderSettingsDialog />
                                        </div>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="footer">
                            <AccordionTrigger className="text-base">
                                Footer Settings
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex items-center gap-4">
                                    <Checkbox
                                        checked={
                                            settings[
                                                'showPageNumbers' as keyof ExportSettings
                                            ] as boolean
                                        }
                                        onCheckedChange={(checked) =>
                                            handleSettingChange(
                                                'showPageNumbers' as keyof ExportSettings,
                                                checked
                                            )
                                        }
                                    />
                                    <label>Show Page Number</label>
                                </div>
                                {settings.showPageNumbers && (
                                    <div className="mt-2 space-y-2">
                                        <Label>Position</Label>
                                        <RadioGroup
                                            value={settings.pageNumbersPosition}
                                            onValueChange={(value) =>
                                                handleSettingChange(
                                                    'pageNumbersPosition',
                                                    value as 'left' | 'center' | 'right'
                                                )
                                            }
                                            className="flex gap-4"
                                        >
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="left"
                                                    id="page-number-left"
                                                />
                                                <Label htmlFor="page-number-left">Left</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="center"
                                                    id="page-number-center"
                                                />
                                                <Label htmlFor="page-number-center">Center</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="right"
                                                    id="page-number-right"
                                                />
                                                <Label htmlFor="page-number-right">Right</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="layout">
                            <AccordionTrigger className="text-base">Layout</AccordionTrigger>
                            <AccordionContent>
                                <div className="space-y-4">
                                    <div className="flex w-full gap-x-4">
                                        <div className="flex w-1/2 items-center gap-2">
                                            <Label>Columns per Page</Label>
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
                                        <Label>Space for Rough Work</Label>
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
                                                <Label htmlFor="rough-none">None</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="bottom" id="rough-bottom" />
                                                <Label htmlFor="rough-bottom">Bottom</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Rough Work Space Size</Label>
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
                                                    Small (50mm)
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="medium"
                                                    id="rough-size-medium"
                                                />
                                                <Label htmlFor="rough-size-medium">
                                                    Medium (100mm)
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="large"
                                                    id="rough-size-large"
                                                />
                                                <Label htmlFor="rough-size-large">
                                                    Large (150mm)
                                                </Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Page Padding</Label>
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
                                                <Label htmlFor="padding-low">Low (10mm)</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem
                                                    value="medium"
                                                    id="padding-medium"
                                                />
                                                <Label htmlFor="padding-medium">
                                                    Medium (20mm)
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="high" id="padding-high" />
                                                <Label htmlFor="padding-high">High (30mm)</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Font Size</Label>
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
                                                <Label htmlFor="font-small">Small (10pt)</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="medium" id="font-medium" />
                                                <Label htmlFor="font-medium">Medium (12pt)</Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <RadioGroupItem value="large" id="font-large" />
                                                <Label htmlFor="font-large">Large (14pt)</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Image Size</Label>
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
                                                Maintain image aspect ratio
                                            </Label>
                                        </div>
                                    </div>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="display">
                            <AccordionTrigger className="text-base">
                                Section and Marking
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col gap-y-2">
                                    {[
                                        ['showInstitutionLetterhead', 'Show Institute Letterhead'],
                                        [
                                            'showFirstPageInstructions',
                                            'Show Instructions on First Page',
                                        ],
                                        [
                                            'showAdaptiveMarkingRules',
                                            'Show Adaptive Marking Rules - Entire Assessment',
                                        ],
                                        [
                                            'showSectionInstructions',
                                            'Show Section-wise Instructions',
                                        ],
                                        ['showSectionDuration', 'Show Section-wise Duration'],
                                        ['showMarksPerQuestion', 'Show Marks per Question'],
                                        [
                                            'showAdaptiveMarkingRulesSection',
                                            'Show Adaptive Marking Rules - Section-wise',
                                        ],
                                        [
                                            'showCheckboxesBeforeOptions',
                                            'Show Checkboxes before Options',
                                        ],
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
                            <AccordionTrigger className="text-base">Paper Sets</AccordionTrigger>
                            <AccordionContent>
                                {lockedSetCode && (
                                    <p className="mb-2 text-sm text-muted-foreground">
                                        This is OMR Set {lockedSetCode}: its question and option
                                        order is fixed by the saved set, so sets and randomizing
                                        cannot be changed here.
                                    </p>
                                )}
                                {/* A disabled fieldset disables every input and checkbox in it. */}
                                <fieldset
                                    disabled={!!lockedSetCode}
                                    className="flex flex-col gap-y-2 disabled:opacity-60"
                                >
                                    <div className="flex items-center gap-2">
                                        <Label>Create Question Papers Sets</Label>
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
                                            Include Question Set Code
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
                                            Randomize Questions
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
                                        <label htmlFor="randomizeOptions">Randomize Options</label>
                                    </div>
                                </fieldset>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="custom">
                            <AccordionTrigger className="text-base">Custom Fields</AccordionTrigger>
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
                                            Include Custom Input Fields
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
                                                                <SelectValue placeholder="Select field type" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="blank">
                                                                    Blank (Default)
                                                                </SelectItem>
                                                                <SelectItem value="blocks">
                                                                    Blocks
                                                                </SelectItem>
                                                                <SelectItem value="input">
                                                                    Input Box
                                                                </SelectItem>
                                                                <SelectItem value="checkbox">
                                                                    Checkbox
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
                                                    placeholder="Enter new field label"
                                                    value={newFieldLabel}
                                                    onChange={(e) =>
                                                        setNewFieldLabel(e.target.value)
                                                    }
                                                />
                                                <Button onClick={addCustomField} className="gap-2">
                                                    <Plus className="size-4" />
                                                    Add
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="advanced">
                            <AccordionTrigger className="text-base">
                                Subjective Questions
                            </AccordionTrigger>
                            <AccordionContent>
                                {/* Your existing advanced settings */}

                                <div className="space-y-4">
                                    <div className="flex flex-col gap-2">
                                        <Label>Answer Spacing</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setIsAnswerSpacingDialogOpen(true)}
                                        >
                                            Custom Spacing
                                        </Button>
                                        <p className="text-sm text-muted-foreground">
                                            Configure custom space for answers.
                                        </p>
                                    </div>
                                </div>

                                {/* Rest of your advanced settings */}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>

                    {/* Answer Spacing Dialog */}
                    <AnswerSpacingDialog
                        open={isAnswerSpacingDialogOpen}
                        onOpenChange={setIsAnswerSpacingDialogOpen}
                        sections={sections}
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
                        Cancel
                    </Button>
                    <Button
                        className="bg-primary-500 text-white hover:bg-primary-400"
                        onClick={() => onOpenChange(false)}
                    >
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
