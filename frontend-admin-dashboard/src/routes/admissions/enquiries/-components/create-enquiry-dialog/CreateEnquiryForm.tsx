import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useEnquiryForm } from '../../-hooks/useEnquiryForm';
import { defaultEnquiryFormValues, EnquiryForm } from '../../-schema/EnquirySchema';
import { useCreateAudienceCampaign } from '@/routes/audience-manager/list/-hooks/useCreateAudienceCampaign';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MyButton } from '@/components/design-system/button';
import CampaignTypeDropdown from '@/routes/audience-manager/list/-components/create-campaign-dialog/CampaignTypeDropdown';
import StatusDropdown from '@/routes/audience-manager/list/-components/create-campaign-dialog/StatusDropdown';
import MultiEmailInput, {
    MultiEmailInputHandle,
} from '@/routes/audience-manager/list/-components/audience-invite/components/MultiEmailInput';
import EnquiryCustomFieldsCard from './EnquiryCustomFieldsCard';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from '@phosphor-icons/react';
import { Controller, useFieldArray } from 'react-hook-form';
import { CounsellorSettingsCard } from './CounsellorSettingsCard';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

const parseEmailsFromCsv = (value?: string | null) => {
    if (!value) return [];
    return value
        .split(',')
        .map((email) => email.trim())
        .filter((email) => email.length > 0);
};

const formatDateToDateInput = (value?: string | null, fallback?: string) => {
    if (!value) return fallback || '';
    const [datePart] = value.split('T');
    return datePart || value || fallback || '';
};

const formatDateTimeForPayload = (value?: string, isEndOfDay = false) => {
    if (!value) return '';
    if (value.includes('T')) return value;
    return `${value}${isEndOfDay ? 'T23:59:59' : 'T00:00:00'}`;
};

const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const mapFieldTypeToPayload = (type?: string) => {
    if (!type) return 'TEXT';
    const normalized = type.toLowerCase();
    switch (normalized) {
        case 'text':
        case 'textfield':
        case 'textarea':
            return 'TEXT';
        case 'number':
            return 'NUMBER';
        case 'email':
            return 'EMAIL';
        case 'date':
            return 'DATE';
        case 'dropdown':
        case 'select':
            return 'DROPDOWN';
        default:
            return normalized.toUpperCase();
    }
};

const convertFieldsToPayload = (fields: any[], instituteId: string) => {
    if (!Array.isArray(fields) || fields.length === 0) return [];

    return fields.map((field, index) => {
        const options =
            Array.isArray(field.options) && field.options.length > 0
                ? field.options.map((option: any) => option.value?.trim()).filter(Boolean)
                : undefined;

        const fieldId = field.id || field._id || field.field_id;
        const customFieldData = field.custom_field_data || field.custom_field || {};

        const payload: any = {
            ...(fieldId && { id: fieldId }),
            field_id: field.field_id || customFieldData.id || fieldId,
            institute_id: field.institute_id || instituteId,
            type: field.type_id || customFieldData.fieldType || mapFieldTypeToPayload(field.type),
            type_id:
                field.type_id || customFieldData.fieldType || mapFieldTypeToPayload(field.type),
            group_name: field.group_name || customFieldData.groupName || '',
            status: field.status || 'ACTIVE',
            individual_order: field.individual_order ?? field.order ?? index,
            group_internal_order: field.group_internal_order ?? 0,
            // Per-form required-ness. The nested `isMandatory` below is the shared master row
            // that every other form using this field reads; this key is the one that belongs to
            // THIS form, and it is what the Required switch must persist to.
            is_mandatory: Boolean(
                typeof field.isRequired === 'boolean' ? field.isRequired : true
            ),
            custom_field: {
                ...(customFieldData.id && { id: customFieldData.id }),
                ...(customFieldData.guestId && { guestId: customFieldData.guestId }),
                fieldKey: field.key || customFieldData.fieldKey || generateKeyFromName(field.name),
                fieldName: field.name || customFieldData.fieldName || `Field ${index + 1}`,
                fieldType: mapFieldTypeToPayload(field.type || customFieldData.fieldType),
                defaultValue: customFieldData.defaultValue || '',
                config: options ? options.join(',') : customFieldData.config || '',
                formOrder:
                    typeof field.order === 'number'
                        ? field.order + 1
                        : customFieldData.formOrder || index + 1,
                isMandatory: Boolean(
                    typeof field.isRequired === 'boolean'
                        ? field.isRequired
                        : customFieldData.isMandatory ?? true
                ),
                isFilter: customFieldData.isFilter ?? false,
                isSortable: customFieldData.isSortable ?? false,
                isHidden: customFieldData.isHidden ?? false,
                ...(customFieldData.createdAt && { createdAt: customFieldData.createdAt }),
                ...(customFieldData.updatedAt && { updatedAt: customFieldData.updatedAt }),
                ...(customFieldData.sessionId && { sessionId: customFieldData.sessionId }),
                ...(customFieldData.liveSessionId && {
                    liveSessionId: customFieldData.liveSessionId,
                }),
                customFieldValue: customFieldData.customFieldValue || '',
                groupName: field.group_name || customFieldData.groupName || '',
                groupInternalOrder: field.group_internal_order ?? 0,
                individualOrder: field.individual_order ?? field.order ?? index,
            },
        };

        return payload;
    });
};

interface CreateEnquiryFormProps {
    onSuccess?: () => void;
}

export const CreateEnquiryForm: React.FC<CreateEnquiryFormProps> = ({ onSuccess }) => {
    const { instituteDetails } = useInstituteDetailsStore();
    const [emails, setEmails] = useState<string[]>([]);
    const multiEmailRef = useRef<MultiEmailInputHandle>(null);
    const [enableSettings, setEnableSettings] = useState(false);

    const { form, handleSubmit, handleReset, isSubmitting } = useEnquiryForm();
    const {
        control,
        register,
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = form;

    const { t: tCreateAudienceCampaign } = useTranslation('audienceManagerUseCreateAudienceCampaign');
    const createCampaign = useCreateAudienceCampaign(tCreateAudienceCampaign);

    // Get sessions from institute store
    const sessions = useMemo(() => {
        return instituteDetails?.sessions || [];
    }, [instituteDetails]);

    // Custom fields array management
    const { fields: customFieldsArray } = useFieldArray({
        control,
        name: 'custom_fields',
    });
    const customFields = getValues('custom_fields');

    // Custom field handlers
    const updateFieldOrders = () => {
        const currentFields = getValues('custom_fields');
        if (!currentFields) return;
        const updatedFields = currentFields.map((field, index) => ({
            ...field,
            order: index,
        }));
        setValue('custom_fields', updatedFields, {
            shouldDirty: true,
            shouldTouch: true,
        });
    };

    const handleDeleteOpenField = (id: number) => {
        const updatedFields = customFieldsArray.map((field, idx) => {
            if (idx === id) {
                return {
                    ...field,
                    status: 'DELETED',
                };
            }
            return field;
        });
        setValue('custom_fields', updatedFields);
    };

    const toggleIsRequired = (id: number) => {
        const updatedFields = customFieldsArray?.map((field, idx) =>
            idx === id ? { ...field, isRequired: !field.isRequired } : field
        );
        setValue('custom_fields', updatedFields);
    };

    // Index-based to match toggleIsRequired/handleDeleteOpenField in this file.
    const patchFieldAt = (index: number, patch: Record<string, unknown>) => {
        const updatedFields = customFieldsArray?.map((field, idx) =>
            idx === index ? { ...field, ...patch } : field
        );
        setValue('custom_fields', updatedFields);
    };

    /**
     * Applies an edit made in the (prefilled) custom-field dialog. Type, label, options and
     * required come back together, so they are written in one patch.
     */
    const handleEditFieldAt = (
        index: number,
        type: string,
        name: string,
        options?: { id: string; value: string }[],
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
        const newField = {
            id: String(customFields.length),
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && {
                options: [
                    { id: '0', value: 'MALE', disabled: true },
                    { id: '1', value: 'FEMALE', disabled: true },
                    { id: '2', value: 'OTHER', disabled: true },
                ],
            }),
            isRequired: true,
            key: '',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields);
    };

    const handleAddOpenFieldValues = (type: string, name: string, oldKey: boolean) => {
        const updatedFields = [
            ...customFields,
            {
                id: String(customFields.length),
                type,
                name,
                oldKey,
                isRequired: true,
                key: '',
                order: customFields.length,
            },
        ];
        setValue('custom_fields', updatedFields);
    };

    const handleAddPhoneNumber = (type: string, name: string, oldKey: boolean) => {
        const newField = {
            id: String(customFields.length),
            type,
            name,
            oldKey,
            isRequired: true,
            key: 'phone_number',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields);
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
                value: `option ${prevOptions.length + 1}`,
                disabled: true,
            },
        ]);
    };

    const handleCloseDialog = (type: string, name: string, oldKey: boolean) => {
        const newField = {
            id: String(customFields.length),
            type,
            name,
            oldKey,
            ...(type === 'dropdown' && { options: getValues('dropdownOptions') }),
            isRequired: true,
            key: '',
            order: customFields.length,
        };
        const updatedFields = [...customFields, newField];
        setValue('custom_fields', updatedFields);
        setValue('isDialogOpen', false);
        setValue('textFieldValue', '');
        setValue('dropdownOptions', []);
    };

    const statusValue = watch('status');
    const isStatusActive = statusValue?.toUpperCase?.() === 'ACTIVE';

    // Set start date to today when form initializes
    useEffect(() => {
        const today = new Date();
        const todayDateOnly =
            today.toISOString().split('T')[0] || today.toISOString().substring(0, 10);
        if (todayDateOnly) {
            setValue('start_date_local', todayDateOnly, { shouldValidate: false });
        }
    }, [setValue]);

    const onFormSubmit = handleSubmit(async (data: EnquiryForm) => {
        if (!instituteDetails?.id) {
            toast.error('Institute context unavailable. Please refresh and try again.');
            return;
        }

        // Flush any half-typed email in the Team Notifications box into the
        // committed list before building the payload. Returns the final list
        // synchronously so we don't depend on React state having re-rendered.
        const notifyEmails = multiEmailRef.current?.flush() ?? emails;

        // Build settings JSON from counsellor settings only if enabled
        const settingsJson =
            enableSettings && data.counsellor_settings
                ? JSON.stringify(data.counsellor_settings)
                : undefined;

        // Convert custom fields to payload format
        const customFieldsPayload = convertFieldsToPayload(data.custom_fields, instituteDetails.id);

        const payload = {
            institute_id: instituteDetails.id,
            campaign_name: data.campaign_name.trim(),
            campaign_type: data.campaign_type.trim(),
            description: data.description?.trim() || '',
            campaign_objective: data.campaign_objective?.trim() || '',
            session_id: data.session_id,
            to_notify: notifyEmails.join(', '),
            send_respondent_email: Boolean(data.send_respondent_email),
            json_web_metadata: settingsJson,
            start_date_local: formatDateTimeForPayload(data.start_date_local, false),
            end_date_local: formatDateTimeForPayload(data.end_date_local, true),
            status: data.status?.toUpperCase?.() || data.status,
            institute_custom_fields: customFieldsPayload,
        };

        try {
            await createCampaign.mutateAsync(payload);
            handleFormReset();
            onSuccess?.();
        } catch (error) {
            console.error('Error creating enquiry:', error);
        }
    });

    useEffect(() => {
        setValue('to_notify', emails.join(', '));
    }, [emails, setValue]);

    const handleFormReset = () => {
        handleReset();
        setEmails([]);
    };

    const isSaving = isSubmitting || createCampaign.isPending;
    const primaryButtonLabel = isSaving ? 'Creating...' : 'Create Enquiry Form';

    return (
        <form onSubmit={onFormSubmit} className="w-full space-y-6">
            {/* Enquiry Name */}
            <div>
                <label className="block text-sm font-semibold text-neutral-700">
                    Enquiry Name <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    placeholder="Enter enquiry name"
                    {...register('campaign_name')}
                    className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
                {errors.campaign_name && (
                    <span className="mt-1 block text-sm text-red-500">
                        {errors.campaign_name.message as string}
                    </span>
                )}
            </div>

            {/* Session Selector */}
            <div>
                <label className="block text-sm font-semibold text-neutral-700">
                    Session <span className="text-red-500">*</span>
                </label>
                <div className="mt-2">
                    <Controller
                        name="session_id"
                        control={control}
                        render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select a session" />
                                </SelectTrigger>
                                <SelectContent>
                                    {sessions.map((session) => (
                                        <SelectItem key={session.id} value={session.id}>
                                            {session.session_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    />
                </div>
                {errors.session_id && (
                    <span className="mt-1 block text-sm text-red-500">
                        {errors.session_id.message as string}
                    </span>
                )}
            </div>

            {/* Enquiry Type & Objective Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        Enquiry Type <span className="text-red-500">*</span>
                    </label>
                    <div className="mt-2">
                        <CampaignTypeDropdown
                            value={watch('campaign_type')}
                            error={errors.campaign_type?.message as string}
                            onChange={(val) => {
                                setValue('campaign_type', val, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                });
                            }}
                            placeholder="Select enquiry type"
                            customInputPlaceholder="Enter enquiry type"
                            initialOptions={[
                                { value: 'Admission', label: 'Admission' },
                                { value: 'Mid-term', label: 'Mid-term' },
                                { value: 'Summer Camp', label: 'Summer Camp' },
                            ]}
                        />
                    </div>
                </div>

                {/* Enquiry Objective */}
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        Enquiry Objective
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., Admission, Information"
                        {...register('campaign_objective')}
                        className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                </div>
            </div>

            {/* Emails & Share Analytics */}
            <div className="w-full gap-2 rounded-lg border border-neutral-300 px-3 py-2">
                <div className="flex flex-wrap gap-2">
                    <label className="block text-sm font-semibold text-neutral-700">
                        Team Notifications
                    </label>
                    <TooltipProvider>
                        <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                    aria-label="Information about team notifications"
                                >
                                    <Info className="size-4" weight="bold" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                <p>
                                    Enter email addresses of team members who should receive enquiry
                                    updates
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <MultiEmailInput
                    ref={multiEmailRef}
                    value={emails}
                    onChange={setEmails}
                    placeholder="Enter email addresses"
                    error={errors?.to_notify?.message}
                />

                {/* Share Analytics with Team */}
                <div className="flex items-center justify-between gap-2 px-2 py-2">
                    <div className="flex items-center gap-2">
                        <label className="block text-sm font-semibold text-neutral-700">
                            Notify Respondent
                        </label>
                        <TooltipProvider>
                            <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                        aria-label="Information about sharing analytics"
                                    >
                                        <Info className="size-4" weight="regular" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                    <p>Notify parents about the enquiry submission</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <Switch
                        checked={watch('send_respondent_email')}
                        onCheckedChange={(checked: boolean) =>
                            setValue('send_respondent_email', checked)
                        }
                    />
                </div>
            </div>

            {/* Description */}
            <div>
                <label className="block text-sm font-semibold text-neutral-700">
                    Enquiry Description
                </label>
                <textarea
                    placeholder="Describe the enquiry's purpose and target audience"
                    rows={3}
                    {...register('description')}
                    className="mt-2 w-full resize-none rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
                {errors.description && (
                    <span className="mt-1 block text-sm text-red-500">
                        {errors.description.message as string}
                    </span>
                )}
            </div>

            {/* Start & End Date Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Start Date */}
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        Start Date <span className="text-red-500">*</span>
                    </label>
                    <Controller
                        name="start_date_local"
                        control={control}
                        render={({ field }) => {
                            const rawValue = field.value as unknown;
                            let dateValue = '';

                            if (typeof rawValue === 'string' && rawValue !== '') {
                                if (rawValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                    dateValue = rawValue;
                                } else {
                                    const date = new Date(rawValue);
                                    if (!Number.isNaN(date.getTime())) {
                                        dateValue =
                                            date.toISOString().split('T')[0] ||
                                            date.toISOString().substring(0, 10);
                                    }
                                }
                            } else if (
                                rawValue &&
                                typeof rawValue === 'object' &&
                                typeof (rawValue as Date).toISOString === 'function'
                            ) {
                                const isoString = (rawValue as Date).toISOString();
                                dateValue = isoString.split('T')[0] || isoString.substring(0, 10);
                            }

                            const today = new Date();
                            const minDate =
                                today.toISOString().split('T')[0] ||
                                today.toISOString().substring(0, 10);

                            return (
                                <input
                                    type="date"
                                    value={dateValue}
                                    min={minDate}
                                    onChange={(e) => {
                                        const selectedDate = e.target.value;
                                        setValue('start_date_local', selectedDate, {
                                            shouldValidate: true,
                                            shouldDirty: true,
                                        });
                                    }}
                                    className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                />
                            );
                        }}
                    />
                    {errors.start_date_local && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.start_date_local.message as string}
                        </span>
                    )}
                </div>

                {/* End Date */}
                <div>
                    <label className="block text-sm font-semibold text-neutral-700">
                        End Date <span className="text-red-500">*</span>
                    </label>
                    <Controller
                        name="end_date_local"
                        control={control}
                        render={({ field }) => {
                            const rawValue = field.value as unknown;
                            let dateValue = '';

                            if (typeof rawValue === 'string' && rawValue !== '') {
                                if (rawValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                                    dateValue = rawValue;
                                } else {
                                    const date = new Date(rawValue);
                                    if (!Number.isNaN(date.getTime())) {
                                        dateValue =
                                            date.toISOString().split('T')[0] ||
                                            date.toISOString().substring(0, 10);
                                    }
                                }
                            } else if (
                                rawValue &&
                                typeof rawValue === 'object' &&
                                typeof (rawValue as Date).toISOString === 'function'
                            ) {
                                const isoString = (rawValue as Date).toISOString();
                                dateValue = isoString.split('T')[0] || isoString.substring(0, 10);
                            }

                            const startDateValue = watch('start_date_local');
                            let minEndDate: string;

                            if (startDateValue) {
                                const start = new Date(startDateValue);
                                const nextDay = new Date(start);
                                nextDay.setDate(start.getDate() + 1);
                                const nextDayIso = nextDay.toISOString();
                                minEndDate = (nextDayIso.split('T')[0] ||
                                    nextDayIso.substring(0, 10)) as string;
                            } else {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                const tomorrowIso = tomorrow.toISOString();
                                minEndDate = (tomorrowIso.split('T')[0] ||
                                    tomorrowIso.substring(0, 10)) as string;
                            }

                            return (
                                <input
                                    type="date"
                                    value={dateValue}
                                    min={minEndDate}
                                    onChange={(e) => {
                                        const selectedDate = e.target.value;
                                        setValue('end_date_local', selectedDate, {
                                            shouldValidate: true,
                                            shouldDirty: true,
                                        });
                                    }}
                                    className="mt-2 w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                />
                            );
                        }}
                    />
                    {errors.end_date_local && (
                        <span className="mt-1 block text-sm text-red-500">
                            {errors.end_date_local.message as string}
                        </span>
                    )}
                </div>
            </div>

            {/* Status */}
            <div>
                <div className="flex items-center gap-2">
                    <label className="block text-sm font-semibold text-neutral-700">Status</label>
                    <TooltipProvider>
                        <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 focus:outline-none"
                                    aria-label="Information about status"
                                >
                                    <Info className="size-4" weight="bold" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs bg-neutral-800 text-xs text-white">
                                <p>
                                    To share the enquiry link with prospective students, please
                                    ensure the status is set to Active.
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="mt-2">
                    <StatusDropdown
                        value={watch('status')}
                        error={errors.status?.message as string}
                        onChange={(val) => {
                            setValue('status', val, {
                                shouldValidate: true,
                                shouldDirty: true,
                            });
                        }}
                    />
                </div>
            </div>

            {/* Enquiry Custom Fields Card - Filtered by Enquiry Location */}
            <EnquiryCustomFieldsCard
                form={form}
                updateFieldOrders={updateFieldOrders}
                handleDeleteOpenField={handleDeleteOpenField}
                toggleIsRequired={toggleIsRequired}
                handleEditFieldAt={handleEditFieldAt}
            />

            {/* Counsellor Settings Toggle */}
            <div className="rounded-lg border border-neutral-200 p-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold text-neutral-900">Add Settings</h3>
                    </div>
                    <Switch checked={enableSettings} onCheckedChange={setEnableSettings} />
                </div>
            </div>

            {/* Counsellor Settings Card (conditionally rendered) */}
            {enableSettings && <CounsellorSettingsCard watch={watch} setValue={setValue} />}

            {/* Form Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-neutral-200 pt-6">
                <MyButton
                    type="button"
                    onClick={handleFormReset}
                    buttonType="secondary"
                    scale="medium"
                >
                    Reset
                </MyButton>
                <MyButton type="submit" disabled={isSaving} buttonType="primary" scale="medium">
                    {primaryButtonLabel}
                </MyButton>
            </div>
        </form>
    );
};
