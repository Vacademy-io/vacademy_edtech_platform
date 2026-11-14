import { useRef } from 'react';
import { useFieldArray, UseFormReturn } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import type { DropdownOption } from '@/components/common/custom-fields/AddCustomFieldDialog';

/**
 * The enrollment-form field builder's handlers, shared by every form that renders
 * CustomInviteFormCard.
 *
 * These used to be inlined in GenerateInviteLinkDialog. The course-creation wizard's
 * Payment & Enrolment step renders the same card, and two copies of this logic would
 * drift, so they live here instead. Behaviour is preserved verbatim, including the mix
 * of `customFieldsArray` (useFieldArray's view) and `getValues('custom_fields')` that
 * the original used per handler.
 *
 * `isDirty()` reports whether the admin has touched the field list at all. The
 * course-creation flow needs it because a PUT to an existing invite replaces its
 * custom fields wholesale, so an untouched list must be echoed back rather than
 * overwritten with our seeded defaults.
 */
export function useInviteCustomFieldHandlers(
    form: UseFormReturn<InviteLinkFormValues>,
    t: TFunction
) {
    const { control, setValue, getValues } = form;

    // Subscribe so the card re-renders as the array is mutated below.
    form.watch('custom_fields');

    const { fields: customFieldsArray } = useFieldArray({ control, name: 'custom_fields' });
    const customFields = getValues('custom_fields');

    const dirtyRef = useRef(false);
    const markDirty = () => {
        dirtyRef.current = true;
    };

    const handleDeleteOpenField = (id: number) => {
        const updatedFields = customFieldsArray
            .filter((field, idx) => idx !== id)
            .map((field, index) => ({
                ...field,
                order: index, // Update order of remaining fields
            }));
        setValue('custom_fields', updatedFields);
        markDirty();
    };

    // Function that explicitly updates the order property of all fields
    const updateFieldOrders = () => {
        const currentFields = getValues('custom_fields');

        if (!currentFields) return;

        // Create a copy with updated order values matching their array positions
        const updatedFields = currentFields.map((field, index) => ({
            ...field,
            order: index,
        }));

        // Update the form values
        setValue('custom_fields', updatedFields, {
            shouldDirty: true,
            shouldTouch: true,
        });
        markDirty();
    };

    const toggleIsRequired = (id: number) => {
        const updatedFields = customFieldsArray?.map((field, idx) =>
            idx === id ? { ...field, isRequired: !field.isRequired } : field
        );
        setValue('custom_fields', updatedFields);
        markDirty();
    };

    // Index-based to match toggleIsRequired / handleDeleteOpenField above.
    const patchFieldAt = (index: number, patch: Record<string, unknown>) => {
        const current = getValues('custom_fields');
        const updatedFields = current?.map((field, idx) =>
            idx === index ? { ...field, ...patch } : field
        );
        setValue('custom_fields', updatedFields);
        markDirty();
    };

    /**
     * Applies an edit made in the (prefilled) custom-field dialog. Type, label, options and
     * required come back together, so they are written in one patch.
     */
    const handleEditFieldAt = (
        index: number,
        type: string,
        name: string,
        options?: DropdownOption[],
        config?: Record<string, unknown>
    ) =>
        patchFieldAt(index, {
            type,
            name,
            isRequired: (config?.isRequired as boolean | undefined) ?? true,
            // The dialog only returns options for choice types, so switching away from one
            // clears them instead of leaving stale values to reappear.
            options: options?.map((opt, i) => ({ id: String(i), value: opt.value })),
        });

    const handleAddGender = (type: string, name: string, oldKey: boolean) => {
        // Create the new field
        const newField = {
            id: String(customFields.length), // Use the current array length as the new ID
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && {
                options: [
                    {
                        id: '0',
                        value: 'MALE',
                        disabled: true,
                    },
                    {
                        id: '1',
                        value: 'FEMALE',
                        disabled: true,
                    },
                    {
                        id: '2',
                        value: 'OTHER',
                        disabled: true,
                    },
                ],
            }), // Include options if type is dropdown
            isRequired: true,
            key: '',
            order: customFields.length,
        };

        // Add the new field to the array
        const updatedFields = [...customFields, newField];

        // Update the form state
        setValue('custom_fields', updatedFields);
        markDirty();
    };

    const handleAddOpenFieldValues = (type: string, name: string, oldKey: boolean) => {
        // Add the new field to the array
        const updatedFields = [
            ...customFields,
            {
                id: String(customFields.length), // Use the current array length as the new ID
                type,
                name,
                oldKey,
                isRequired: true,
                key: '',
                order: customFields.length,
            },
        ];

        // Update the form state with the new array
        setValue('custom_fields', updatedFields);
        markDirty();
    };

    const handleValueChange = (id: string, newValue: string) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.map((option) =>
                option.id === id ? { ...option, value: newValue } : option
            )
        );
    };

    const handleEditClick = (id: number) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.map((option, idx) =>
                idx === id ? { ...option, disabled: !option.disabled } : option
            )
        );
    };

    const handleDeleteOptionField = (id: number) => {
        const prevOptions = getValues('dropdownOptions');
        setValue(
            'dropdownOptions',
            prevOptions.filter((field, idx) => idx !== id)
        );
    };

    const handleAddDropdownOptions = () => {
        const prevOptions = getValues('dropdownOptions');
        setValue('dropdownOptions', [
            ...prevOptions,
            {
                id: String(prevOptions.length),
                value: t('customField.defaultOptionLabel', { number: prevOptions.length + 1 }),
                disabled: true,
            },
        ]);
    };

    const handleCloseDialog = (type: string, name: string, oldKey: boolean) => {
        // Create the new field
        const newField = {
            id: String(customFields.length), // Use the current array length as the new ID
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && { options: getValues('dropdownOptions') }), // Include options if type is dropdown
            isRequired: true,
            key: '',
            order: customFields.length,
        };

        // Add the new field to the array
        const updatedFields = [...customFields, newField];

        // Update the form state
        setValue('custom_fields', updatedFields);
        markDirty();

        // Reset dialog and temporary values
        setValue('isDialogOpen', false);
        setValue('textFieldValue', '');
        setValue('dropdownOptions', []);
    };

    return {
        customFieldsArray,
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
        /** True once the admin has added, removed, reordered or edited a field. */
        isDirty: () => dirtyRef.current,
    };
}
