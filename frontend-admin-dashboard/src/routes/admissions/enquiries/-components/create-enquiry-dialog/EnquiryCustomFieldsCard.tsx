import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFieldArray, UseFormReturn } from 'react-hook-form';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { MyButton } from '@/components/design-system/button';
import { DotsSixVertical, PencilSimple, TrashSimple } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { getCustomFieldSettingsFromCache } from '@/services/custom-field-settings';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AddCustomFieldDialog as SharedAddCustomFieldDialog,
    type DropdownOption,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';

interface CustomField {
    id: string | number;
    field_id: number;
    name: string;
    type: string;
    oldKey: boolean;
    isRequired: boolean;
    key: string;
    order: number;
    status?: string;
    options?: Array<{
        id: string;
        value: string;
        disabled: boolean;
    }>;
}

interface EnquiryCustomFieldsCardProps {
    form: UseFormReturn<any>;
    updateFieldOrders: () => void;
    handleDeleteOpenField: (id: number) => void;
    toggleIsRequired: (id: number) => void;
    handleEditFieldAt: (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) => void;
}

/**
 * EnquiryCustomFieldsCard Component
 *
 * Displays fields with "Enquiry" location enabled from Custom Field Settings.
 * Admins can enable/disable and reorder which fields to include in their enquiry campaign.
 */
const EnquiryCustomFieldsCard = ({
    form,
    updateFieldOrders,
    handleDeleteOpenField,
    toggleIsRequired,
    handleEditFieldAt,
}: EnquiryCustomFieldsCardProps) => {
    const { t } = useTranslation('admissionsEnquiryCustomFieldsCard');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { control, getValues, setValue } = form;
    const { fields: customFieldsArray, move: moveCustomField } = useFieldArray({
        control,
        name: 'custom_fields',
        // keyName: RHF otherwise overwrites each row's `id` with a fresh uuid on
        // every array-level setValue, remounting rows (focus loss) and breaking
        // id-based matching. Keep the domain id intact.
        keyName: '_rhfKey',
    });

    // Initialize with enquiry location fields on mount
    useEffect(() => {
        const currentFields = getValues('custom_fields');

        // Only initialize if form is empty (create mode)
        if (!currentFields || currentFields.length === 0) {
            const settings = getCustomFieldSettingsFromCache();
            if (!settings) return;

            // Get all fields with enquiry location enabled
            const allFields = [
                ...(settings.customFields || []),
                ...(settings.instituteFields || []),
                ...(settings.fixedFields || []),
            ];

            const enquiryFields = allFields
                .sort((a, b) => (a.order || 0) - (b.order || 0));

            // Convert to form format
            const formFields = enquiryFields.map((field, index) => ({
                id: field.id,
                field_id: field.id,
                name: field.name,
                type: field.type === 'dropdown' ? 'dropdown' : 'textfield',
                oldKey: !field.canBeDeleted, // System/fixed fields
                isRequired: field.required,
                key: field.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                order: index,
                options:
                    field.type === 'dropdown' && field.options
                        ? field.options.map((opt, idx) => ({
                              id: String(idx),
                              value: opt,
                              disabled: true,
                          }))
                        : undefined,
            }));

            setValue('custom_fields', formFields, {
                shouldDirty: false,
                shouldTouch: false,
            });
        }
    }, [getValues, setValue]);

    return (
        <Card className="mb-4">
            <CardHeader>
                <CardTitle className="flex flex-col text-lg font-semibold">
                    <span className="text-2xl font-bold">{t('header.title')}</span>
                    <span className="text-sm text-gray-600">{t('header.description')}</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex w-full flex-col gap-4">
                    {customFieldsArray.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
                            <p className="text-sm text-neutral-600">{t('emptyState.title')}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                                {t('emptyState.description')}
                            </p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <FormFieldRowHeader />
                            <Sortable
                                // form is UseFormReturn<any>, so the custom keyName
                                // erases `id` from the inferred row type. Rows do
                                // carry the domain id at runtime.
                                value={customFieldsArray as unknown as { id: string }[]}
                                onMove={({ activeIndex, overIndex }) => {
                                    setEditingIndex(null);
                                    moveCustomField(activeIndex, overIndex);
                                    updateFieldOrders();
                                }}
                            >
                                <div className="flex flex-col gap-4">
                                    {customFieldsArray.map((field, index) => {
                                        const typedField = field as unknown as CustomField;
                                        if (typedField?.status === 'DELETED') return null;
                                        const isEditing = editingIndex === index;
                                        return (
                                            <SortableItem
                                                key={typedField.id}
                                                value={typedField.id}
                                                asChild
                                            >
                                                <div>
                                                    <FormFieldRow
                                                        position={index + 1}
                                                        name={typedField.name}
                                                        type={typedField.type}
                                                        isRequired={typedField.isRequired}
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
                            {/* Editing reuses the shared custom-field dialog, prefilled. Keyed
                                per row so opening a different field re-runs the prefill. */}
                            {editingIndex !== null && customFieldsArray[editingIndex] && (
                                <SharedAddCustomFieldDialog
                                    key={
                                        (customFieldsArray[editingIndex] as unknown as CustomField)
                                            .id
                                    }
                                    mode="edit"
                                    open
                                    onOpenChange={(isOpen) => {
                                        if (!isOpen) setEditingIndex(null);
                                    }}
                                    initialField={{
                                        type: (
                                            customFieldsArray[editingIndex] as unknown as CustomField
                                        ).type,
                                        name: (
                                            customFieldsArray[editingIndex] as unknown as CustomField
                                        ).name,
                                        options: (
                                            (
                                                customFieldsArray[
                                                    editingIndex
                                                ] as unknown as CustomField
                                            ).options ?? []
                                        ).map((o) => o.value),
                                        isRequired: (
                                            customFieldsArray[editingIndex] as unknown as CustomField
                                        ).isRequired,
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
                                        .map((f) => f as unknown as CustomField)
                                        .filter((f, i) => i !== editingIndex && f.status !== 'DELETED')
                                        .map((f) => f.name)}
                                />
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default EnquiryCustomFieldsCard;
