import { CustomField } from '../-schema/InviteFormSchema';

export const getCustomFieldKey = (fieldName: string) => {
    return fieldName.toLowerCase().replaceAll(' ', '_');
};

export const duplicateKeyCheck = (customFields: CustomField[], currentFieldName: string) => {
    const currentFieldKey = getCustomFieldKey(currentFieldName);
    const duplicateKey = customFields.some(
        (field) => getCustomFieldKey(field.name) === currentFieldKey
    );
    if (
        currentFieldKey === 'gender' ||
        currentFieldKey === 'state' ||
        currentFieldKey === 'city' ||
        currentFieldKey === 'school_college' ||
        currentFieldKey === 'address' ||
        currentFieldKey === 'pincode' ||
        currentFieldKey === 'father_name' ||
        currentFieldKey === 'mother_name' ||
        currentFieldKey === 'parent_phone_number' ||
        currentFieldKey === 'parent_email'
    ) {
        return true;
    }
    return duplicateKey;
};
