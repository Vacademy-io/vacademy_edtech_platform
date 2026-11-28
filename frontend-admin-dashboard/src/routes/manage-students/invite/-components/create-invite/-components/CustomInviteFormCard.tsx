import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { MyButton } from '@/components/design-system/button';
import { DotsSixVertical, PencilSimple, Plus, TrashSimple } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    AddCustomFieldDialog as SharedAddCustomFieldDialog,
    type DropdownOption,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';

interface CustomInviteFormCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
    updateFieldOrders: () => void;
    handleDeleteOpenField: (id: number) => void;
    toggleIsRequired: (id: number) => void;
    handleAddGender: (type: string, name: string, oldKey: boolean) => void;
    handleAddOpenFieldValues: (type: string, name: string, oldKey: boolean) => void;
    handleValueChange: (id: string, newValue: string) => void;
    handleEditClick: (id: number) => void;
    handleDeleteOptionField: (id: number) => void;
    handleAddDropdownOptions: () => void;
    handleCloseDialog: (type: string, name: string, oldKey: boolean) => void;
    handleEditFieldAt: (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) => void;
}

const CustomInviteFormCard = ({
    form,
    updateFieldOrders,
    handleDeleteOpenField,
    toggleIsRequired,
    handleAddGender,
    handleAddOpenFieldValues,
    handleValueChange,
    handleEditClick,
    handleDeleteOptionField,
    handleAddDropdownOptions,
    handleCloseDialog,
    handleEditFieldAt,
}: CustomInviteFormCardProps) => {
    const { t } = useTranslation('manageStudentsCustomInviteFormCard');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { control, getValues } = form;
    const { fields: customFieldsArray, move: moveCustomField } = useFieldArray({
        control,
        name: 'custom_fields',
        // keyName: RHF otherwise overwrites each row's `id` with a fresh uuid on
        // every array-level setValue, remounting rows (focus loss) and breaking
        // id-based matching. Keep the domain id intact.
        keyName: '_rhfKey',
    });
    const customFields = getValues('custom_fields');
    return (
        <Card className="mb-4">
            <CardHeader>
                <CardTitle className="flex flex-col text-lg font-semibold">
                    <span className="text-2xl font-bold">{t('header.title')}</span>
                    <span className="text-sm text-gray-600">{t('header.subtitle')}</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex w-full flex-col gap-4">
                    <div className="flex flex-col gap-4">
                        <FormFieldRowHeader />
                        <Sortable
                            value={customFieldsArray}
                            onMove={({ activeIndex, overIndex }) => {
                                    setEditingIndex(null);
                                moveCustomField(activeIndex, overIndex);
                                updateFieldOrders();
                            }}
                        >
                            <div className="flex flex-col gap-4">
                                {customFieldsArray.map((field, index) => {
                                    const isEditing = editingIndex === index;
                                    return (
                                        <SortableItem key={field.id} value={field.id} asChild>
                                            <div>
                                                <FormFieldRow
                                                    position={index + 1}
                                                    name={field.name}
                                                    type={field.type}
                                                    isRequired={field.isRequired}
                                                    isEditing={isEditing}
                                                    onToggleRequired={() =>
                                                        toggleIsRequired(index)
                                                    }
                                                    onEdit={() => setEditingIndex(index)}
                                                    onDelete={() => {
                                                            setEditingIndex(null);
                                                            handleDeleteOpenField(index);
                                                        }}
                                                    dragHandle={
                                                        <SortableDragHandle
                                                            variant="ghost"
                                                            size="icon"
                                                            className="cursor-grab"
                                                        >
                                                            <DotsSixVertical size={18} />
                                                        </SortableDragHandle>
                                                    }
                                                />
                                            </div>
                                        </SortableItem>
                                    );
                                })}
                            </div>
                        </Sortable>
                        {/* Editing reuses the add dialog, prefilled. Keyed per row so opening a
                            different field re-runs the prefill. */}
                        {editingIndex !== null && customFieldsArray[editingIndex] && (
                            <SharedAddCustomFieldDialog
                                key={customFieldsArray[editingIndex]._rhfKey}
                                mode="edit"
                                open
                                onOpenChange={(isOpen) => {
                                    if (!isOpen) setEditingIndex(null);
                                }}
                                initialField={{
                                    type: customFieldsArray[editingIndex].type,
                                    name: customFieldsArray[editingIndex].name,
                                    options: (customFieldsArray[editingIndex].options ?? []).map(
                                        (o) => o.value
                                    ),
                                    isRequired: customFieldsArray[editingIndex].isRequired,
                                }}
                                onAddField={(type, name, _oldKey, options, config) => {
                                    handleEditFieldAt(
                                        editingIndex,
                                        type,
                                        name,
                                        options,
                                        config as Record<string, unknown>
                                    );
                                    setEditingIndex(null);
                                }}
                                // Its own name must stay available, or saving an unchanged
                                // label would be blocked as a duplicate.
                                existingFieldNames={customFieldsArray
                                    .filter((_, i) => i !== editingIndex)
                                    .map((f) => f.name)}
                            />
                        )}
                    </div>
                    <div className="mt-2 flex items-center gap-6">
                        {!customFields?.some((field) => field.name === 'Gender') && (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAddGender('dropdown', 'Gender', false);
                                }}
                            >
                                <Plus size={32} /> {t('quickAddButtons.gender')}
                            </MyButton>
                        )}
                        {!customFields?.some((field) => field.name === 'State') && (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAddOpenFieldValues('textfield', 'State', false);
                                }}
                            >
                                <Plus size={32} /> {t('quickAddButtons.state')}
                            </MyButton>
                        )}
                        {!customFields?.some((field) => field.name === 'City') && (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAddOpenFieldValues('textfield', 'City', false);
                                }}
                            >
                                <Plus size={32} /> {t('quickAddButtons.city')}
                            </MyButton>
                        )}
                        {!customFields?.some((field) => field.name === 'School/College') && (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAddOpenFieldValues('textfield', 'School/College', false);
                                }}
                            >
                                <Plus size={32} /> {t('quickAddButtons.schoolCollege')}
                            </MyButton>
                        )}
                        <Dialog
                            open={form.watch('isDialogOpen')}
                            onOpenChange={(open) => form.setValue('isDialogOpen', open)}
                        >
                            <DialogTrigger asChild>
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    onClick={() => form.setValue('isDialogOpen', true)}
                                >
                                    <Plus size={32} /> {t('customFieldDialog.triggerButton')}
                                </MyButton>
                            </DialogTrigger>
                            <DialogContent className="flex max-h-dialog-tall !w-dialog-md flex-col p-0">
                                <h1 className="shrink-0 rounded-lg bg-primary-50 p-4 text-primary-500">
                                    {t('customFieldDialog.title')}
                                </h1>
                                <div className="flex-1 flex-col gap-4 overflow-y-auto px-4">
                                    <h1>{t('customFieldDialog.typePrompt')}</h1>
                                    <RadioGroup
                                        defaultValue={form.watch('selectedOptionValue')}
                                        onValueChange={(value) =>
                                            form.setValue('selectedOptionValue', value)
                                        }
                                        className="flex items-center gap-6"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="textfield" id="option-one" />
                                            <Label htmlFor="option-one">
                                                {t('customFieldDialog.fieldTypeOptions.textField')}
                                            </Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="dropdown" id="option-two" />
                                            <Label htmlFor="option-two">
                                                {t('customFieldDialog.fieldTypeOptions.dropdown')}
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                    {form.watch('selectedOptionValue') === 'textfield' ? (
                                        <div className="flex flex-col gap-1">
                                            <h1>
                                                {t('customFieldDialog.textFieldNameLabel')}
                                                <span className="text-subtitle text-danger-600">
                                                    *
                                                </span>
                                            </h1>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t('placeholders.typeHere')}
                                                input={form.watch('textFieldValue')}
                                                onChangeFunction={(e) =>
                                                    form.setValue('textFieldValue', e.target.value)
                                                }
                                                size="large"
                                                className="w-full"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            <h1>
                                                {t('customFieldDialog.dropdownNameLabel')}
                                                <span className="text-subtitle text-danger-600">
                                                    *
                                                </span>
                                            </h1>
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t('placeholders.typeHere')}
                                                input={form.watch('textFieldValue')}
                                                onChangeFunction={(e) =>
                                                    form.setValue('textFieldValue', e.target.value)
                                                }
                                                size="large"
                                                className="w-full"
                                            />
                                            <h1 className="mt-4">
                                                {t('customFieldDialog.dropdownOptionsLabel')}
                                            </h1>
                                            <div className="flex flex-col gap-4">
                                                {form
                                                    .watch('dropdownOptions')
                                                    .map((option, idx) => {
                                                        return (
                                                            <div
                                                                className="flex w-full items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-1"
                                                                key={option.id} // Use unique identifier
                                                            >
                                                                <MyInput
                                                                    inputType="text"
                                                                    inputPlaceholder={option.value}
                                                                    input={option.value}
                                                                    onChangeFunction={(e) =>
                                                                        handleValueChange(
                                                                            option.id,
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    size="large"
                                                                    disabled={option.disabled}
                                                                    className="border-none pl-0"
                                                                />
                                                                <div className="flex items-center gap-6">
                                                                    <MyButton
                                                                        type="button"
                                                                        scale="medium"
                                                                        buttonType="secondary"
                                                                        className="h-6 min-w-6 !rounded-sm px-1"
                                                                        onClick={() =>
                                                                            handleEditClick(idx)
                                                                        }
                                                                    >
                                                                        <PencilSimple size={32} />
                                                                    </MyButton>
                                                                    {form.watch('dropdownOptions')
                                                                        .length > 1 && (
                                                                        <MyButton
                                                                            type="button"
                                                                            scale="medium"
                                                                            buttonType="secondary"
                                                                            onClick={() =>
                                                                                handleDeleteOptionField(
                                                                                    idx
                                                                                )
                                                                            }
                                                                            className="h-6 min-w-6 !rounded-sm px-1"
                                                                        >
                                                                            <TrashSimple className="!size-4 text-danger-500" />
                                                                        </MyButton>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                            <MyButton
                                                type="button"
                                                scale="small"
                                                buttonType="secondary"
                                                className="mt-2 w-20 min-w-4 border-none font-thin !text-primary-500"
                                                onClick={handleAddDropdownOptions}
                                            >
                                                <Plus size={18} />
                                                {t('customFieldDialog.addOptionButton')}
                                            </MyButton>
                                        </div>
                                    )}
                                    <div className="mb-6 flex justify-center">
                                        <MyButton
                                            type="button"
                                            scale="medium"
                                            buttonType="primary"
                                            className="mt-4 w-fit"
                                            onClick={() =>
                                                handleCloseDialog(
                                                    form.watch('selectedOptionValue'),
                                                    form.watch('textFieldValue'),
                                                    false
                                                )
                                            }
                                        >
                                            {t('customFieldDialog.doneButton')}
                                        </MyButton>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                    <Dialog>
                        <DialogTrigger className="flex justify-start">
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                className="mt-4 w-fit"
                            >
                                {t('previewDialog.triggerButton')}
                            </MyButton>
                        </DialogTrigger>
                        <DialogContent className="flex max-h-dialog-tall flex-col p-0">
                            <h1 className="shrink-0 rounded-md bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('previewDialog.title')}
                            </h1>
                            <div className="flex-1 flex-col gap-4 overflow-y-auto px-4 py-2">
                                {customFields?.map((testInputFields, idx) => {
                                    return (
                                        <div className="flex flex-col items-start gap-4" key={idx}>
                                            {testInputFields.type === 'dropdown' ? (
                                                <SelectField
                                                    label={testInputFields.name}
                                                    labelStyle="font-normal"
                                                    name={testInputFields.name}
                                                    options={
                                                        testInputFields?.options?.map(
                                                            (option, index) => ({
                                                                value: option.value,
                                                                label: option.value,
                                                                _id: index,
                                                            })
                                                        ) || []
                                                    }
                                                    control={form.control}
                                                    className="mt-4 w-full font-thin"
                                                    required={
                                                        testInputFields.isRequired ? true : false
                                                    }
                                                />
                                            ) : (
                                                <div className="flex w-full flex-col gap-1.5">
                                                    <h1 className="mt-3 text-sm">
                                                        {testInputFields.name}
                                                        {testInputFields.isRequired && (
                                                            <span className="text-subtitle text-danger-600">
                                                                *
                                                            </span>
                                                        )}
                                                    </h1>
                                                    <MyInput
                                                        inputType="text"
                                                        inputPlaceholder={testInputFields.name}
                                                        input=""
                                                        onChangeFunction={() => {}}
                                                        size="large"
                                                        disabled
                                                        className="!min-w-full"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardContent>
        </Card>
    );
};

export default CustomInviteFormCard;
