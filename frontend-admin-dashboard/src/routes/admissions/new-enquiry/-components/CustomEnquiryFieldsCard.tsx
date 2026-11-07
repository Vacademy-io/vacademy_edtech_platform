import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    getCustomFieldSettingsFromCache,
    type CustomField,
    type FieldGroup,
} from '@/services/custom-field-settings';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface CustomEnquiryFieldsCardProps {
    customFieldValues: Record<string, string>;
    onFieldChange: (fieldId: string, value: string) => void;
}

interface GroupedField {
    type: 'group' | 'field';
    order: number;
    groupName?: string;
    group?: FieldGroup;
    field?: CustomField;
}

/**
 * CustomEnquiryFieldsCard Component
 *
 * Displays custom fields that have the "Enquiry" location enabled.
 * Fields are rendered in groups if they have a groupName, otherwise individually.
 * Order is maintained based on the order field from custom field settings.
 */
const CustomEnquiryFieldsCard = ({
    customFieldValues,
    onFieldChange,
}: CustomEnquiryFieldsCardProps) => {
    const { t } = useTranslation('admissionsCustomEnquiryFieldsCard');

    // Get organized fields: groups and individual fields in correct order
    const organizedFields = useMemo(() => {
        const settings = getCustomFieldSettingsFromCache();
        if (!settings) return [];

        const result: GroupedField[] = [];
        const processedFieldIds = new Set<string>();

        // Combine all field types
        const allFields: CustomField[] = [
            ...(settings.customFields || []),
            ...(settings.instituteFields || []),
            ...(settings.fixedFields || []),
        ];

        // Custom Fields Revamp: the per-feature enquiry visibility checkbox was
        // removed from Settings. In create mode, pre-select ALL institute defaults.
        const enquiryFields = allFields.sort((a, b) => (a.order || 0) - (b.order || 0));

        const enquiryGroups = (settings.fieldGroups || [])
            .filter((group) => group.fields.length > 0);

        // First, mark all fields that are in groups
        enquiryGroups.forEach((group) => {
            group.fields.forEach((field) => {
                processedFieldIds.add(field.id);
            });
        });

        // Add individual fields first (not in a group)
        enquiryFields.forEach((field) => {
            // Skip if already part of a group
            if (!processedFieldIds.has(field.id) && !field.groupName) {
                result.push({
                    type: 'field',
                    order: field.order,
                    field,
                });
            }
        });

        // Then add groups
        enquiryGroups.forEach((group) => {
            result.push({
                type: 'group',
                order: group.order,
                groupName: group.name,
                group,
            });
        });

        // Sort by order
        result.sort((a, b) => a.order - b.order);

        return result;
    }, []);

    // Don't render the card if no enquiry fields are configured
    if (organizedFields.length === 0) {
        return null;
    }

    const renderField = (field: CustomField, key?: string) => (
        <div key={key || field.id}>
            <Label htmlFor={field.id}>
                {field.name}
                {field.required && <span className="text-red-500"> *</span>}
            </Label>

            {/* Render based on field type */}
            {field.type === 'dropdown' ? (
                <Select
                    value={customFieldValues[field.id] || ''}
                    onValueChange={(value) => onFieldChange(field.id, value)}
                    required={field.required}
                >
                    <SelectTrigger id={field.id}>
                        <SelectValue
                            placeholder={t('placeholder.select', {
                                fieldName: field.name.toLowerCase(),
                            })}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {field.options?.map((option, index) => (
                            <SelectItem key={index} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : (
                <Input
                    id={field.id}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={customFieldValues[field.id] || ''}
                    onChange={(e) => onFieldChange(field.id, e.target.value)}
                    placeholder={t('placeholder.enter', {
                        fieldName: field.name.toLowerCase(),
                    })}
                    required={field.required}
                />
            )}
        </div>
    );

    return (
        <Card className="mb-4">
            <CardHeader>
                <CardTitle>{t('header.title')}</CardTitle>
                <CardDescription>{t('header.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {organizedFields.map((item, index) => {
                    if (item.type === 'group' && item.group) {
                        return (
                            <div key={`group-${item.groupName}-${index}`} className="space-y-4">
                                <h3 className="text-base font-semibold text-neutral-900">
                                    {item.group.name}
                                </h3>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    {item.group.fields.map((field) =>
                                        renderField(
                                            field as CustomField,
                                            `${item.groupName}-${field.id}`
                                        )
                                    )}
                                </div>
                            </div>
                        );
                    } else if (item.type === 'field' && item.field) {
                        return (
                            <div
                                key={`field-${item.field.id}-${index}`}
                                className="grid grid-cols-1 gap-4 md:grid-cols-2"
                            >
                                {renderField(item.field)}
                            </div>
                        );
                    }
                    return null;
                })}
            </CardContent>
        </Card>
    );
};

export default CustomEnquiryFieldsCard;
