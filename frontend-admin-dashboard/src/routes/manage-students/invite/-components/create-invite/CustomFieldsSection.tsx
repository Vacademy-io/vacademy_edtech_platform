import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { DotsSixVertical, PencilSimple, Plus, TrashSimple } from '@phosphor-icons/react';
import { AddCustomFieldDialog, DropdownOption } from './AddCustomFieldDialog';
import {
    AddCustomFieldDialog as SharedAddCustomFieldDialog,
    type CustomFieldConfig,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { InviteForm } from '../../-schema/InviteFormSchema';
import { FieldRole, classifyFieldRole } from '@/components/common/custom-fields/field-roles';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CustomFieldsSectionProps {
    toggleIsRequired: (id: number) => void;
    handleAddOpenFieldValues: (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[]
    ) => void;
    handleDeleteOpenField: (id: number) => void;
    handleEditFieldAt: (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: CustomFieldConfig
    ) => void;
}

export const CustomFieldsSection = ({
    toggleIsRequired,
    handleAddOpenFieldValues,
    handleDeleteOpenField,
    handleEditFieldAt,
}: CustomFieldsSectionProps) => {
    const { t } = useTranslation('manageStudentsCustomFieldsSection');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { watch, control } = useFormContext<InviteForm>();
    const customFields = watch('custom_fields');
    const { fields, move } = useFieldArray({
        control,
        name: 'custom_fields',
        // keyName: RHF otherwise overwrites each row's `id` with a fresh uuid on
        // every array-level setValue, remounting rows (focus loss) and breaking
        // id-based matching. Keep the domain id intact.
        keyName: '_rhfKey',
    });

    const handleAddCustomField = (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[]
    ) => {
        handleAddOpenFieldValues(type, name, oldKey, options);
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col">
                <p className="text-title font-semibold">
                    {t('header.title', { count: fields.length })}
                </p>
                <p className="text-caption text-neutral-500">{t('header.subtitle')}</p>
            </div>
            <FormFieldRowHeader />
            <Sortable
                value={fields}
                onMove={({ activeIndex, overIndex }) => {
                                    setEditingIndex(null);
                    move(activeIndex, overIndex);
                }}
                fast={false}
            >
                <div className="flex flex-col gap-4">
                    {fields.map((field, index) => {
                        const isEditing = editingIndex === index;
                        return (
                            <SortableItem key={field.id} value={field.id} asChild>
                                <div className={field.status === 'DELETED' ? 'hidden' : ''}>
                                    <FormFieldRow
                                        position={index + 1}
                                        name={field.name}
                                        type={field.type}
                                        isRequired={field.isRequired}
                                        isEditing={isEditing}
                                        onToggleRequired={() => toggleIsRequired(field.id)}
                                        onEdit={() => setEditingIndex(index)}
                                        onDelete={() => {
                                                            setEditingIndex(null);
                                                            handleDeleteOpenField(field.id);
                                                        }}
                                        dragHandle={
                                            <SortableDragHandle
                                                variant="ghost"
                                                size="icon"
                                                className="cursor-grab"
                                                type="button"
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
            {/* Nothing stops an admin removing Email any more — but a learner is enrolled under
                their email address, so a form without one cannot create their account. Say so
                rather than letting the invite go out broken. */}
            {!(customFields ?? [])
                .filter((field) => field.status !== 'DELETED')
                .some(
                    (field) =>
                        classifyFieldRole({ type: field.type, label: field.name }) ===
                        FieldRole.EMAIL
                ) && (
                <p className="text-caption text-warning-600">
                    Learners are enrolled under their email address — without an Email field on
                    this form, an account cannot be created for them.
                </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Gender') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() =>
                            handleAddOpenFieldValues('dropdown', 'Gender', false, [
                                { id: '0', value: 'MALE', disabled: false },
                                { id: '1', value: 'FEMALE', disabled: false },
                                { id: '2', value: 'OTHER', disabled: false },
                            ])
                        }
                    >
                        <Plus size={32} /> {t('quickAddButtons.gender')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'State') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'State', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.state')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'City') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'City', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.city')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'School/College') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() =>
                            handleAddOpenFieldValues('textfield', 'School/College', false)
                        }
                    >
                        <Plus size={32} /> {t('quickAddButtons.schoolCollege')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Address') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'Address', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.address')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Pincode') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'Pincode', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.pincode')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Father Name') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'Father Name', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.fatherName')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Mother Name') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'Mother Name', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.motherName')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Parent Phone Number') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() =>
                            handleAddOpenFieldValues('textfield', 'Parent Phone Number', false)
                        }
                    >
                        <Plus size={32} /> {t('quickAddButtons.parentPhoneNumber')}
                    </MyButton>
                )}
                {!customFields
                    ?.filter((field) => field.status === 'ACTIVE')
                    ?.some((field) => field.name === 'Parent Email') && (
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={() => handleAddOpenFieldValues('textfield', 'Parent Email', false)}
                    >
                        <Plus size={32} /> {t('quickAddButtons.parentEmail')}
                    </MyButton>
                )}

                <AddCustomFieldDialog
                    trigger={
                        <MyButton type="button" scale="medium" buttonType="secondary">
                            <Plus size={32} /> {t('addCustomFieldButton')}
                        </MyButton>
                    }
                    onAddField={handleAddCustomField}
                    customFields={customFields || []}
                />
                {/* Editing reuses the add dialog, prefilled. Keyed per row so opening a
                    different field re-runs the prefill. */}
                {editingIndex !== null && fields[editingIndex] && (
                    <SharedAddCustomFieldDialog
                        key={fields[editingIndex]._rhfKey}
                        mode="edit"
                        open
                        onOpenChange={(isOpen) => {
                            if (!isOpen) setEditingIndex(null);
                        }}
                        initialField={{
                            type: fields[editingIndex].type,
                            name: fields[editingIndex].name,
                            options: (fields[editingIndex].options ?? []).map((o) => o.value),
                            isRequired: fields[editingIndex].isRequired,
                        }}
                        onAddField={(type, name, _oldKey, options, config) => {
                            handleEditFieldAt(editingIndex, type, name, options, config);
                            setEditingIndex(null);
                        }}
                        // Its own name must stay available, or saving an unchanged label
                        // would be blocked as a duplicate.
                        existingFieldNames={(customFields ?? [])
                            .filter((f, i) => i !== editingIndex && f.status !== 'DELETED')
                            .map((f) => f.name)}
                    />
                )}
            </div>
        </div>
    );
};
