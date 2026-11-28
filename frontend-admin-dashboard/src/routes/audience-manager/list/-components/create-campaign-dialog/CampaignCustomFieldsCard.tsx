import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, UseFormReturn } from 'react-hook-form';
import { AudienceCampaignForm } from '../../-schema/AudienceCampaignSchema';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
import { MyButton } from '@/components/design-system/button';
import { DotsSixVertical, PencilSimple, Plus, TrashSimple } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import {
    AddCustomFieldDialog as SharedAddCustomFieldDialog,
    type DropdownOption,
    type CustomFieldConfig,
    type ParentFieldCandidate,
} from '@/components/common/custom-fields/AddCustomFieldDialog';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import {
    FormFieldRow,
    FormFieldRowHeader,
} from '@/components/common/custom-fields/FormFieldRow';
import { useQuery } from '@tanstack/react-query';
import { getCustomFieldUsages } from '@/services/custom-field-mappings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { isDropdownFieldType, savedFieldKeyOf } from '../../-utils/campaignFormFields';

/**
 * Props interface for Campaign Custom Fields Card
 * This component manages custom fields for campaign forms
 * Fields are dynamically loaded from settings cache and can be managed here
 */
interface CampaignCustomFieldsCardProps {
    form: UseFormReturn<AudienceCampaignForm>;
    updateFieldOrders: () => void;
    handleDeleteOpenField: (id: number) => void;
    toggleIsRequired: (id: number) => void;
    handleAddGender: (type: string, name: string, oldKey: boolean) => void;
    handleAddOpenFieldValues: (type: string, name: string, oldKey: boolean) => void;
    handleValueChange: (id: string, newValue: string) => void;
    handleEditClick: (id: number) => void;
    handleDeleteOptionField: (id: number) => void;
    handleAddDropdownOptions: () => void;
    handleCloseDialog: (
        type: string,
        name: string,
        oldKey: boolean,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) => void;
    handleAddPhoneNumber?: (type: string, name: string, oldKey: boolean) => void;
    /** Id of the campaign being edited, so its own usage is not counted as "another form". */
    campaignId?: string | null;
    handleEditFieldAt: (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) => void;
}

/**
 * Campaign Custom Fields Card Component
 * 
 * This component provides a UI for managing custom fields in campaign forms.
 * It displays fields loaded from settings (via getCampaignCustomFields) and
 * allows users to:
 * - View all custom fields (from settings + manually added)
 * - Reorder fields via drag-and-drop
 * - Toggle required status for non-permanent fields
 * - Add new fields (Gender, State, City, Phone Number, or custom)
 * - Delete non-permanent fields
 * - Preview the registration form
 * 
 * Fields are dynamically loaded from settings cache, so any changes made
 * in Custom Fields Settings will automatically reflect here.
 */
const CampaignCustomFieldsCard = ({
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
    handleAddPhoneNumber,
    handleEditFieldAt,
    campaignId,
}: CampaignCustomFieldsCardProps) => {
    const { t } = useTranslation('audienceManagerCampaignCustomFieldsCard');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const { control, getValues } = form;
    const { instituteDetails } = useInstituteDetailsStore();
    const { fields: customFieldsArray, move: moveCustomField } = useFieldArray({
        control,
        name: 'custom_fields',
        // keyName: RHF otherwise overwrites each row's `id` with a fresh uuid on
        // every array-level setValue, remounting rows (focus loss) and breaking
        // id-based matching. Keep the domain id intact.
        keyName: '_rhfKey',
    });
    const customFields = getValues('custom_fields');
    // A deleted field stays in the array until the form is saved, and the row list
    // already hides it — the preview has to agree, or it advertises a field the
    // respondent will never see.
    // A field's type, label and options live on one shared row, so editing them here
    // also edits every other form built on the same field. Look up where else it is
    // used and say so before the admin changes it.
    const editingField = editingIndex !== null ? customFieldsArray[editingIndex] : null;
    const editingFieldMasterId = (editingField as unknown as { _id?: string } | null)?._id;
    const instituteId = instituteDetails?.id;
    const { data: fieldUsages } = useQuery({
        queryKey: ['custom-field-usages', instituteId, editingFieldMasterId],
        queryFn: () => getCustomFieldUsages(instituteId!, editingFieldMasterId!),
        enabled: Boolean(instituteId && editingFieldMasterId),
        staleTime: 60_000,
    });
    const otherFormsUsingField = (fieldUsages ?? []).filter(
        (usage) => usage.type !== 'DEFAULT_CUSTOM_FIELD' && usage.type_id !== campaignId
    );
    const otherFormNames = otherFormsUsingField
        .map((usage) => usage.type_display_name)
        .filter(Boolean) as string[];
    const otherFormNamesList =
        otherFormNames.length > 0
            ? ` (${otherFormNames.slice(0, 3).join(', ')}${otherFormNames.length > 3 ? ', …' : ''})`
            : '';
    const sharedFieldNotice =
        otherFormsUsingField.length === 0
            ? null
            : t('sharedFieldNotice', {
                  count: otherFormsUsingField.length,
                  names: otherFormNamesList,
              });

    /**
     * The dropdowns a dropdown may depend on: every other live dropdown in this form,
     * minus any that already depends on it (directly or further up), which would loop.
     * Undefined without an institute, which hides "Depends on" altogether.
     */
    const parentCandidatesFor = (selfIndex: number | null): ParentFieldCandidate[] | undefined => {
        if (!instituteId) return undefined;
        const live = (customFields ?? [])
            .map((field, index) => ({ field, index, key: savedFieldKeyOf(field, instituteId) }))
            .filter(
                ({ field, key }) =>
                    key &&
                    (field as unknown as { status?: string }).status !== 'DELETED' &&
                    isDropdownFieldType(field.type)
            );
        const parentOf = new Map(
            live.map(({ field, key }) => [key, field.config?.parentFieldKey as string | undefined])
        );
        const selfKey =
            selfIndex !== null ? savedFieldKeyOf(customFields?.[selfIndex], instituteId) : '';
        const dependsOnSelf = (key: string) => {
            const seen = new Set<string>();
            let cursor: string | undefined = key;
            while (cursor && !seen.has(cursor)) {
                if (cursor === selfKey) return true;
                seen.add(cursor);
                cursor = parentOf.get(cursor);
            }
            return false;
        };
        return live
            .filter(({ index, key }) => index !== selfIndex && !(selfKey && dependsOnSelf(key)))
            .map(({ field, key }) => ({
                key,
                label: field.name,
                options: Array.from(
                    new Set((field.options ?? []).map((o) => o.value.trim()).filter(Boolean))
                ),
            }));
    };

    const previewFields = customFields?.filter(
        (field) => (field as unknown as { status?: string }).status !== 'DELETED'
    );

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
                    {/* Sortable Fields List */}
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
                                {customFieldsArray
                                    .map((field, index) => {
                                        // Skip deleted fields from display
                                        if ((field as any).status === 'DELETED') {
                                            return null;
                                        }
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
                                    })
                                    .filter(Boolean)}
                            </div>
                        </Sortable>
                    </div>

                    {/* Quick Add Buttons */}
                    <div className="mt-2 flex flex-wrap items-center gap-6">                     
                        {handleAddPhoneNumber &&
                            !customFields?.some((field) => field.name === 'Phone Number') && (
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleAddPhoneNumber('textfield', 'Phone Number', false);
                                    }}
                                >
                                    <Plus size={32} /> {t('actions.addPhoneNumber')}
                                </MyButton>
                            )}

                        {/* Add Custom Field Dialog */}
                        <SharedAddCustomFieldDialog
                            trigger={
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                >
                                    <Plus size={32} /> {t('actions.addCustomField')}
                                </MyButton>
                            }
                            onAddField={(type, name, oldKey, options, config) =>
                                handleCloseDialog(type, name, oldKey, options, config as Record<string, unknown>)
                            }
                            existingFieldNames={
                                customFields
                                    ?.filter((f) => (f as any).status !== 'DELETED')
                                    .map((f) => f.name) ?? []
                            }
                            parentCandidates={parentCandidatesFor(null)}
                        />
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
                                notice={
                                    sharedFieldNotice ? (
                                        <p className="rounded-md bg-warning-50 p-3 text-caption text-warning-700">
                                            {sharedFieldNotice}
                                        </p>
                                    ) : undefined
                                }
                                initialField={{
                                    type: customFieldsArray[editingIndex].type,
                                    name: customFieldsArray[editingIndex].name,
                                    options: (customFieldsArray[editingIndex].options ?? []).map(
                                        (o) => o.value
                                    ),
                                    optionParents: (
                                        customFieldsArray[editingIndex].options ?? []
                                    ).map((o) => o.parent),
                                    isRequired: customFieldsArray[editingIndex].isRequired,
                                    // So editing opens on the help text / file limits /
                                    // verification the field already carries, rather than
                                    // silently resetting them on save.
                                    config: customFieldsArray[editingIndex].config,
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
                                existingFieldNames={
                                    customFields
                                        ?.filter(
                                            (f, i) =>
                                                i !== editingIndex &&
                                                (f as any).status !== 'DELETED'
                                        )
                                        .map((f) => f.name) ?? []
                                }
                                parentCandidates={parentCandidatesFor(editingIndex)}
                            />
                        )}
                    </div>

                    {/* Preview Dialog */}
                    <Dialog>
                        <DialogTrigger className="flex justify-start">
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                className="mt-4 w-fit"
                            >
                                {t('actions.previewForm')}
                            </MyButton>
                        </DialogTrigger>
                        <DialogContent className="flex max-h-dialog-tall flex-col p-0">
                            <h1 className="shrink-0 rounded-md bg-primary-50 p-4 font-semibold text-primary-500">
                                {t('actions.previewForm')}
                            </h1>
                            <div className="flex-1 flex-col gap-4 overflow-y-auto px-4 py-2">
                                {previewFields?.map((testInputFields, idx) => {
                                    const fieldConfig = (testInputFields as unknown as { config?: { defaultValue?: string; allowedFileTypes?: string[]; maxSizeMB?: number } }).config;
                                    const rendererOptions = testInputFields.options?.map((o) => o.value);
                                    return (
                                        <div className="flex flex-col items-start gap-4" key={idx}>
                                            <div className="flex w-full flex-col gap-1.5">
                                                <h1 className="mt-3 text-sm">
                                                    {testInputFields.name}
                                                    {testInputFields.isRequired && (
                                                        <span className="text-subtitle text-danger-600">
                                                            *
                                                        </span>
                                                    )}
                                                </h1>
                                                <CustomFieldRenderer
                                                    type={testInputFields.type}
                                                    name={testInputFields.name}
                                                    value=""
                                                    disabled={true}
                                                    options={rendererOptions}
                                                    config={fieldConfig}
                                                />
                                            </div>
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

export default CampaignCustomFieldsCard;

