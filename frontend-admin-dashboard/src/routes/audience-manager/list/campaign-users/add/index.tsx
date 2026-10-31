import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { createFileRoute, useSearch, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowLeft,
    Bank,
    CaretCircleDown,
    EnvelopeSimple,
    FileText,
    GraduationCap,
    Hash,
    Info,
    LinkSimple,
    MapPin,
    PaperPlaneTilt,
    Spinner,
    TextAa,
    User,
    UsersThree,
} from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    ServerMessageError,
    submitAudienceLeadAsAdmin,
    SubmitLeadRequest,
} from '../../-services/submit-audience-lead';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { Trans, useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import {
    useLeadCounsellorOptions,
    type CounsellorOption,
} from '@/hooks/use-lead-counsellor-options';
import { SearchableSelect } from '@/components/design-system/searchable-select';

const NAMESPACE = 'audienceManagerCampaignUsersAdd';

/**
 * Fallback translate function for the zod search-param schema, which is
 * built at module scope (outside any React render tree) so it cannot use
 * the `useTranslation` hook. Uses the shared i18next singleton directly.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

function buildAddResponseSearchSchema(t: TFunction) {
    return z.object({
        campaignId: z.string().min(1, t('schema.campaignIdRequired')),
        campaignName: z.string().optional(),
        customFields: z.string().optional(), // JSON string of custom fields
        // Opened from All Leads / Check Lead → Add New Lead: assign the lead (see
        // handleSubmit) and go back to that page instead of the audience's users list.
        from: z.enum(['all-leads', 'lead-lookup']).optional(),
        // Check Lead hands over the number / address it just searched for.
        prefillPhone: z.string().optional(),
        prefillEmail: z.string().optional(),
    });
}

const addResponseSearchSchema = buildAddResponseSearchSchema(globalT);

export const Route = createFileRoute('/audience-manager/list/campaign-users/add/')({
    component: AddResponsePage,
    validateSearch: addResponseSearchSchema,
});

interface CustomFieldConfig {
    id: string;
    fieldName: string;
    fieldKey: string;
    fieldType: string;
    isMandatory: boolean;
    defaultValue?: string;
    formOrder: number;
    config?: string;
    options?: string[];
    fileConfig?: {
        allowedFileTypes?: string[];
        maxSizeMB?: number;
    };
}

/**
 * "Assign to counsellor" for an admin adding a lead from All Leads. Its own
 * component so the roster is only fetched when the picker is actually shown —
 * the per-audience add flow never mounts it.
 */
function CounsellorPicker({
    value,
    onChange,
    disabled,
}: {
    value: CounsellorOption | null;
    onChange: (next: CounsellorOption | null) => void;
    disabled: boolean;
}) {
    const { t } = useTranslation(NAMESPACE);
    const { options, isLoading } = useLeadCounsellorOptions({ assignable: true });

    return (
        <div className="flex flex-col gap-2 md:col-span-2">
            <Label className="text-body font-medium text-neutral-700">
                {t('assign.label')}{' '}
                <span className="font-normal text-neutral-500">{t('assign.optional')}</span>
            </Label>
            <div className="relative">
                <SearchableSelect
                    options={options.map((c) => ({ value: c.id, label: c.full_name }))}
                    value={value?.id ?? ''}
                    onChange={(id) => onChange(options.find((c) => c.id === id) ?? null)}
                    placeholder={isLoading ? t('assign.loading') : t('assign.placeholder')}
                    searchPlaceholder={t('assign.search')}
                    emptyText={t('assign.empty')}
                    disabled={disabled || isLoading}
                    triggerClassName="h-10 pl-10"
                />
                <User
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
            </div>
            <div className="flex items-start gap-2 rounded-md border border-info-100 bg-info-50 px-3 py-2.5">
                <Info size={18} weight="fill" className="mt-px shrink-0 text-info-500" />
                <p className="text-caption text-neutral-600">{t('assign.hint')}</p>
            </div>
        </div>
    );
}

/** Field types that need the full row: long text, option lists and uploads. */
const FULL_WIDTH_TYPES = new Set(['textarea', 'checkbox', 'radio', 'multi_select', 'file']);

/**
 * The icon shown inside a field, picked from what the field holds. Phone and date
 * controls draw their own (flag, calendar), so they get none.
 */
function fieldIcon(fieldKey: string, fieldName: string, type: string): ReactNode {
    const key = `${fieldKey} ${fieldName}`.toLowerCase();
    const props = { size: 18 } as const;
    if (type === 'phone' || type === 'date') return null;
    if (key.includes('email')) return <EnvelopeSimple {...props} />;
    if (key.includes('course') || key.includes('applied_for')) return <GraduationCap {...props} />;
    if (key.includes('branch') || key.includes('centre') || key.includes('center'))
        return <Bank {...props} />;
    if (key.includes('city') || key.includes('address') || key.includes('location'))
        return <MapPin {...props} />;
    if (key.includes('name')) return <User {...props} />;
    if (type === 'dropdown') return <CaretCircleDown {...props} />;
    if (type === 'number') return <Hash {...props} />;
    if (type === 'url') return <LinkSimple {...props} />;
    return <TextAa {...props} />;
}

// Standard system field keys that always represent a phone number with country code.
// Custom user-created fields with fieldType "number" must NOT be coerced into a phone
// picker just because their name contains "phone" — only these exact keys are promoted.
const SYSTEM_PHONE_KEYS = new Set(['phone_number', 'mobile_number']);

const normalizeFieldType = (field: CustomFieldConfig): string => {
    const normalized = (field.fieldType || 'text').toLowerCase();
    if (normalized === 'phone' || normalized === 'tel') return 'phone';
    if (normalized === 'textfield') return 'text';
    if (SYSTEM_PHONE_KEYS.has((field.fieldKey || '').toLowerCase())) return 'phone';
    return normalized;
};

export function AddResponsePage() {
    const { t } = useTranslation(NAMESPACE);
    const { t: tSubmitLead } = useTranslation('audienceManagerSubmitAudienceLead');
    const { setNavHeading } = useNavHeadingStore();
    const search = useSearch({ from: Route.id });
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Server refused the add because the lead already exists (409) — shown as a dialog.
    const [duplicateBlock, setDuplicateBlock] = useState<string | null>(null);

    // Form state
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;

    // From All Leads (or Check Lead) the lead always gets an owner: an admin picks
    // the counsellor, anyone else (the counsellor filling the form) becomes the owner
    // themselves. From a list, an admin may pick one too; left empty, the usual
    // routing applies.
    const fromAllLeads = search.from === 'all-leads' || search.from === 'lead-lookup';
    const canPickCounsellor = isAdminForInstitute(instituteId);
    const [assignedCounsellor, setAssignedCounsellor] = useState<CounsellorOption | null>(null);

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    // The list's live form, always. The copy some entry points pass in the URL is a
    // snapshot of the list screen's data: it can lack the per-form order (fields then
    // render out of sequence) and still carry fields removed since. It is only the
    // fallback when this request fails.
    const {
        data: fetchedFields,
        isError: fieldsError,
        isPending: fieldsPending,
    } = useQuery({
        queryKey: ['campaign-custom-fields', search.campaignId, instituteId],
        queryFn: async () => {
            if (!instituteId || !search.campaignId) return [];
            const response = await authenticatedAxiosInstance.get(
                `${BASE_URL}/admin-core-service/common/custom-fields/feature-fields`,
                { params: { instituteId, type: 'AUDIENCE_FORM', typeId: search.campaignId } }
            );
            return Array.isArray(response?.data) ? response.data : [];
        },
        enabled: !!instituteId && !!search.campaignId,
        staleTime: 60000,
    });

    const parseFields = (raw: any[]): CustomFieldConfig[] => {
        return raw
            .map((field: any, index: number) => {
                const customField = field.custom_field || field;
                const configStr = customField.config || field.config || '';

                let options: string[] | undefined;
                let fileConfig: { allowedFileTypes?: string[]; maxSizeMB?: number } | undefined;
                let defaultFromConfig: string | undefined;

                if (configStr) {
                    try {
                        const parsed = JSON.parse(configStr);
                        if (Array.isArray(parsed)) {
                            options = parsed.map((opt: any) =>
                                typeof opt === 'string' ? opt : opt.value || opt.label || ''
                            );
                        } else if (typeof parsed === 'object' && parsed !== null) {
                            // Object-format config: { options, defaultValue, allowedFileTypes, ... }
                            if (Array.isArray(parsed.options)) {
                                options = parsed.options.map((opt: any) =>
                                    typeof opt === 'string' ? opt : opt.value || opt.label || ''
                                );
                            }
                            if (Array.isArray(parsed.allowedFileTypes) || parsed.maxSizeMB) {
                                fileConfig = {
                                    allowedFileTypes: parsed.allowedFileTypes,
                                    maxSizeMB: parsed.maxSizeMB,
                                };
                            }
                            if (parsed.defaultValue !== undefined) {
                                defaultFromConfig = String(parsed.defaultValue);
                            }
                            // Legacy: comma-separated options wrapped in object
                            if (
                                !options &&
                                (parsed.coommaSepartedOptions || parsed.commaSeparatedOptions)
                            ) {
                                const csv =
                                    parsed.coommaSepartedOptions || parsed.commaSeparatedOptions;
                                options = csv
                                    .split(',')
                                    .map((v: string) => v.trim())
                                    .filter(Boolean);
                            }
                        }
                    } catch {
                        // Not JSON — treat as plain comma-separated string (legacy format)
                        if (configStr.includes(',')) {
                            options = configStr
                                .split(',')
                                .map((v: string) => v.trim())
                                .filter(Boolean);
                        }
                    }
                }

                return {
                    id: customField.id || field.id,
                    fieldName:
                        customField.fieldName || customField.field_name || field.field_name || '',
                    fieldKey:
                        customField.fieldKey || customField.field_key || field.field_key || '',
                    fieldType:
                        customField.fieldType ||
                        customField.field_type ||
                        field.field_type ||
                        'TEXT',
                    // Per-form answer first — the same precedence the respondent's form and the
                    // campaign builder use. The master flag is shared with every other form.
                    isMandatory:
                        field.is_mandatory ??
                        customField.isMandatory ??
                        field.isMandatory ??
                        true,
                    defaultValue:
                        customField.defaultValue || field.defaultValue || defaultFromConfig || '',
                    // The per-form mapping order is what the admin arranged and what the
                    // public form renders; the master formOrder is the shared catalog
                    // position every other form inherits. Sorting by the master made this
                    // page show the fields in a different sequence to the respondent's.
                    // `??` not `||`: a seeded field's master order is NULL, and `|| 0`
                    // floated all of those to the top.
                    formOrder:
                        field.individual_order ??
                        customField.individualOrder ??
                        customField.formOrder ??
                        field.formOrder ??
                        index,
                    config: configStr,
                    options,
                    fileConfig,
                };
            })
            .filter((f: CustomFieldConfig) => f.id && f.fieldName)
            .sort((a, b) => (a.formOrder ?? 0) - (b.formOrder ?? 0));
    };

    // Live fields first; the URL copy only when the request failed or cannot run.
    const customFields = useMemo<CustomFieldConfig[]>(() => {
        if (fetchedFields && fetchedFields.length > 0) {
            return parseFields(fetchedFields);
        }
        if ((fieldsError || !instituteId) && search.customFields) {
            try {
                const parsed = JSON.parse(search.customFields);
                if (Array.isArray(parsed)) return parseFields(parsed);
            } catch (error) {
                console.error('Error parsing custom fields:', error);
            }
        }
        return [];
    }, [search.customFields, fetchedFields, fieldsError, instituteId]);
    const loadingFields = !!instituteId && fieldsPending && !fieldsError;

    // Initialize form values with default values, then the searched phone / email
    // (Check Lead) into a field of that kind — one extractUserInfo reads back. Only
    // typed inputs qualify: a dropdown named "Mobile App" must not get a number.
    // A real phone / email field wins over a text one whose name merely matches.
    useEffect(() => {
        const initialValues: Record<string, string> = {};
        customFields.forEach((field) => {
            initialValues[field.id] = field.defaultValue || '';
        });
        const prefill = (
            value: string | undefined,
            preferredType: string,
            matches: (text: string) => boolean
        ) => {
            if (!value) return;
            const candidates = customFields.filter(
                (f) =>
                    [preferredType, 'text'].includes(normalizeFieldType(f)) &&
                    (matches(f.fieldKey.toLowerCase()) || matches(f.fieldName.toLowerCase()))
            );
            const field =
                candidates.find((f) => normalizeFieldType(f) === preferredType) ?? candidates[0];
            if (field && !initialValues[field.id]) initialValues[field.id] = value;
        };
        prefill(search.prefillEmail, 'email', (text) => text.includes('email'));
        prefill(
            search.prefillPhone,
            'phone',
            (text) => text.includes('phone') || text.includes('mobile')
        );
        setFormValues(initialValues);
    }, [customFields, search.prefillEmail, search.prefillPhone]);

    const handleInputChange = (fieldId: string, value: string) => {
        setFormValues((prev) => ({ ...prev, [fieldId]: value }));
    };

    const handleBack = () => {
        if (search.from === 'lead-lookup') {
            navigate({ to: '/audience-manager/lead-lookup' });
            return;
        }
        if (fromAllLeads) {
            navigate({ to: '/audience-manager/recent-leads' });
            return;
        }
        navigate({
            to: '/audience-manager/list/campaign-users' as any,
            search: {
                campaignId: search.campaignId,
                campaignName: search.campaignName,
                customFields: search.customFields,
            } as any,
        } as any);
    };

    const validateForm = (): boolean => {
        const missingFields: string[] = [];

        customFields.forEach((field) => {
            if (field.isMandatory && !formValues[field.id]?.trim()) {
                missingFields.push(field.fieldName);
            }
        });

        if (missingFields.length > 0) {
            toast.error(t('validation.missingFields', { fields: missingFields.join(', ') }));
            return false;
        }

        return true;
    };

    // Extract email and phone from custom fields for user_dto
    const extractUserInfo = () => {
        let email = '';
        let phone = '';
        let fullName = '';

        customFields.forEach((field) => {
            const value = formValues[field.id] || '';
            const keyLower = field.fieldKey.toLowerCase();
            const nameLower = field.fieldName.toLowerCase();

            if (keyLower.includes('email') || nameLower.includes('email')) {
                if (!email) email = value;
            }
            if (
                keyLower.includes('phone') ||
                keyLower.includes('mobile') ||
                nameLower.includes('phone') ||
                nameLower.includes('mobile')
            ) {
                if (!phone) phone = value;
            }
            // Exact match — `includes('name')` was too loose and swallowed
            // "Center Name", "Branch Name", etc., so the wrong value landed in
            // user_dto.full_name (whichever name-containing field came first).
            if (
                keyLower === 'full_name' ||
                keyLower === 'fullname' ||
                nameLower === 'full name' ||
                nameLower === 'fullname' ||
                nameLower === 'name' ||
                nameLower === 'parent name'
            ) {
                if (!fullName) fullName = value;
            }
        });

        // Try to construct full name from first + last name if not found
        if (!fullName) {
            const firstName =
                customFields.find(
                    (f) =>
                        f.fieldKey.toLowerCase().includes('first_name') ||
                        f.fieldName.toLowerCase().includes('first name')
                )?.id || '';
            const lastName =
                customFields.find(
                    (f) =>
                        f.fieldKey.toLowerCase().includes('last_name') ||
                        f.fieldName.toLowerCase().includes('last name')
                )?.id || '';

            if (firstName || lastName) {
                fullName = `${formValues[firstName] || ''} ${formValues[lastName] || ''}`.trim();
            }
        }

        return { email, phone, fullName };
    };

    const handleSubmit = async () => {
        if (!validateForm()) return;

        setIsSubmitting(true);

        try {
            const { email, phone, fullName } = extractUserInfo();

            const payload: SubmitLeadRequest = {
                audience_id: search.campaignId,
                source_type: 'WALK_IN',
                source_id: search.campaignId,
                custom_field_values: formValues,
                user_dto: {
                    id: '',
                    username: email || '',
                    email: email || '',
                    full_name: fullName || '',
                    address_line: '',
                    city: '',
                    region: '',
                    pin_code: '',
                    mobile_number: phone || '',
                    date_of_birth: null,
                    gender: '',
                    password: '',
                    profile_pic_file_id: '',
                    roles: [],
                    last_login_time: null,
                    root_user: false,
                },
            };

            if (canPickCounsellor) {
                if (assignedCounsellor) {
                    payload.counsellor_id = assignedCounsellor.id;
                    payload.counsellor_name = assignedCounsellor.full_name;
                }
            } else if (fromAllLeads) {
                const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
                if (tokenData?.user) {
                    payload.counsellor_id = tokenData.user;
                    payload.counsellor_name = tokenData.fullname;
                }
            }

            // Authenticated twin of the open submit endpoint: the token tells the
            // backend who added this lead, which the "only leads assigned to
            // <ROLE>" audience-access option needs in order to stamp the creator
            // as its counsellor. Without it the creator saves a lead and it
            // immediately drops out of their own list.
            await submitAudienceLeadAsAdmin(payload, tSubmitLead);

            toast.success(t('toast.success'));

            // Invalidate the campaign users query to refresh the list
            queryClient.invalidateQueries({ queryKey: ['campaignUsers'] });
            queryClient.invalidateQueries({ queryKey: ['recent-leads'] });

            // Navigate back to the users list
            handleBack();
        } catch (error) {
            console.error('Error submitting response:', error);
            if (error instanceof ServerMessageError && error.status === 409) {
                setDuplicateBlock(error.message);
            } else {
                toast.error(error instanceof Error ? error.message : t('toast.genericError'));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const audienceTerm = getTerminology(OtherTerms.AudienceList, SystemTerms.AudienceList);
    const mandatoryCount = customFields.filter((f) => f.isMandatory).length;

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('helmet.title', { name: search.campaignName || audienceTerm })}</title>
                <meta name="description" content={t('helmet.description')} />
            </Helmet>
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-2">
                <div className="flex flex-col gap-3">
                    <Button variant="ghost" size="sm" onClick={handleBack} className="-ml-3 w-fit">
                        <ArrowLeft className="mr-2 size-4" />
                        {t('backButton', { audienceTerm })}
                    </Button>
                    <div className="flex flex-col gap-1">
                        <h1 className="text-h2 font-semibold text-neutral-900">
                            {t('navHeading')}
                        </h1>
                        <p className="text-body text-neutral-600">{t('header.description')}</p>
                    </div>
                </div>

                <Card className="overflow-hidden border-neutral-200 shadow-sm">
                    <div className="p-4 sm:p-6">
                        <div className="flex flex-col gap-4 rounded-lg bg-primary-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-4">
                                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                                    <UsersThree size={24} weight="duotone" />
                                </div>
                                <div className="flex min-w-0 flex-col gap-1">
                                    <p className="text-caption font-semibold uppercase tracking-wide text-primary-600">
                                        {audienceTerm}
                                    </p>
                                    <h2 className="break-words text-h3 font-semibold text-neutral-900">
                                        {search.campaignName || audienceTerm}
                                    </h2>
                                    <p className="text-body text-neutral-600">
                                        {t('header.cardDescription', {
                                            audienceTerm: audienceTerm.toLowerCase(),
                                        })}
                                    </p>
                                </div>
                            </div>
                            {mandatoryCount > 0 && (
                                <div className="flex shrink-0 items-center gap-2 text-caption text-neutral-600">
                                    <FileText size={20} className="text-neutral-500" />
                                    <span>
                                        <Trans
                                            t={t}
                                            i18nKey="form.requiredHint"
                                            components={{
                                                star: <span className="text-danger-600" />,
                                            }}
                                        />
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {loadingFields ? (
                        <div className="flex items-center justify-center gap-2 px-6 pb-10 pt-4 text-body text-neutral-500">
                            <Spinner className="size-4 animate-spin" />
                            {t('form.loadingFields')}
                        </div>
                    ) : customFields.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-6 pb-10 pt-4 text-center text-neutral-500">
                            <p className="font-medium text-neutral-700">
                                {t('emptyState.title', {
                                    audienceTerm: audienceTerm.toLowerCase(),
                                })}
                            </p>
                            <p className="text-sm">{t('emptyState.hint')}</p>
                        </div>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleSubmit();
                            }}
                        >
                            <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-4 pb-6 sm:px-6 md:grid-cols-2">
                                {customFields.map((field) => {
                                    const type = normalizeFieldType(field);
                                    return (
                                        <div
                                            key={field.id}
                                            className={cn(
                                                'flex min-w-0 flex-col gap-2',
                                                FULL_WIDTH_TYPES.has(type) && 'md:col-span-2'
                                            )}
                                        >
                                            <Label
                                                htmlFor={field.id}
                                                className="flex items-center gap-1 text-body font-medium text-neutral-700"
                                            >
                                                {field.fieldName}
                                                {field.isMandatory && (
                                                    <span className="text-danger-600">*</span>
                                                )}
                                            </Label>
                                            <CustomFieldRenderer
                                                type={type}
                                                name={field.fieldName}
                                                value={formValues[field.id] || ''}
                                                onChange={(val) => handleInputChange(field.id, val)}
                                                options={field.options}
                                                required={field.isMandatory}
                                                disabled={isSubmitting}
                                                config={field.fileConfig}
                                                leadingIcon={fieldIcon(
                                                    field.fieldKey,
                                                    field.fieldName,
                                                    type
                                                )}
                                            />
                                        </div>
                                    );
                                })}

                                {canPickCounsellor && (
                                    <CounsellorPicker
                                        value={assignedCounsellor}
                                        onChange={setAssignedCounsellor}
                                        disabled={isSubmitting}
                                    />
                                )}
                            </div>

                            <div className="mx-4 flex flex-col-reverse items-stretch justify-end gap-3 border-t border-neutral-200 py-5 sm:mx-6 sm:flex-row sm:items-center">
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="large"
                                    onClick={handleBack}
                                    disable={isSubmitting}
                                >
                                    {t('form.cancel')}
                                </MyButton>
                                <MyButton
                                    type="submit"
                                    buttonType="primary"
                                    scale="large"
                                    disable={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Spinner className="mr-2 size-4 animate-spin" />
                                            {t('form.submitting')}
                                        </>
                                    ) : (
                                        <>
                                            <PaperPlaneTilt className="mr-2 size-4" />
                                            {t('form.submit')}
                                        </>
                                    )}
                                </MyButton>
                            </div>
                        </form>
                    )}
                </Card>
            </div>
            <AlertDialog
                open={duplicateBlock !== null}
                onOpenChange={(open) => {
                    if (!open) setDuplicateBlock(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('duplicateBlock.title')}</AlertDialogTitle>
                        <AlertDialogDescription>{duplicateBlock}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setDuplicateBlock(null)}>
                            {t('duplicateBlock.ok')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </LayoutContainer>
    );
}
