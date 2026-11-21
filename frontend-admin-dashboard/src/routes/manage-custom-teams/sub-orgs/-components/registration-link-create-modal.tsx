import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CircleNotch, FilePdf, Plus, Trash } from '@phosphor-icons/react';

import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { FileUploader } from '@/routes/instructor-copilot/-components/FileUploader';
import { useFileUpload } from '@/hooks/use-file-upload';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSTITUTE_VENDORS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { getAllRoles } from '../../-services/custom-team-services';
import {
    createRegistrationTemplate,
    updateRegistrationTemplate,
    type CreateRegistrationTemplateRequest,
    type RegistrationTemplateCustomField,
    type TemplateDetail,
} from '../../-services/sub-org-registration-services';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getPaymentOptions } from '@/services/payment-options';
import type { PaymentOptionApi } from '@/types/payment';
import { formatPlanPrice } from '@/utils/finance-utils';

// Local package-session lookups — same inline pattern as create-sub-org-modal so this
// picker can't accidentally couple to the dashboard-wide package service call sites.
const fetchBatchesSummaryLocal = async (instituteId: string, statuses: string[]) => {
    const params = new URLSearchParams();
    statuses.forEach((s) => params.append('statuses', s));
    const url = `${BASE_URL}/admin-core-service/institute/v1/batches-summary/${instituteId}${
        params.toString() ? `?${params.toString()}` : ''
    }`;
    const response = await authenticatedAxiosInstance({ method: 'GET', url });
    return response.data;
};

const fetchCourseBatchesLocal = async (courseId: string): Promise<PackageSessionDTO[]> => {
    const url = `${BASE_URL}/admin-core-service/course/v1/${courseId}/batches`;
    const response = await authenticatedAxiosInstance({ method: 'GET', url });
    return response.data;
};

const ADMIN_PERMISSION_OPTIONS = ['FULL', 'CREATE_COURSE'] as const;

const FIELD_TYPE_OPTIONS = ['TEXT', 'NUMBER', 'EMAIL', 'PHONE', 'DROPDOWN'] as const;
type FieldType = (typeof FIELD_TYPE_OPTIONS)[number];

interface BuilderField {
    name: string;
    type: FieldType;
    /** Comma-separated options; only used when type === 'DROPDOWN'. */
    optionsCsv: string;
    mandatory: boolean;
    /** custom_field.id from an existing template (edit mode) — lets the backend update instead of recreate. */
    existingId?: string;
    /** custom_field.fieldKey from an existing template (edit mode). */
    fieldKey?: string;
    /**
     * Snapshot of the stored definition (edit mode). The backend only updates the
     * MAPPING row for an existing id (order/mandatory) and silently ignores
     * name/type/options changes — so if the definition changed we must drop the
     * id and let the backend create a fresh field (the old one is soft-deleted;
     * existing registrations keep their answers on the old field).
     */
    original?: { name: string; type: FieldType; optionsCsv: string };
}

// NO CPO here on purpose — registration links only support FREE / ONE_TIME / SUBSCRIPTION.
const PAYMENT_TYPE_VALUES = ['FREE', 'ONE_TIME', 'SUBSCRIPTION'] as const;
type PaymentType = (typeof PAYMENT_TYPE_VALUES)[number];

// DigiLocker KYC scope — AADHAAR is always required by the backend; PAN is optional on top.
const KYC_SCOPE_VALUES = ['AADHAAR', 'AADHAAR_PAN'] as const;
type KycScope = (typeof KYC_SCOPE_VALUES)[number];

// What the registrant sees after completing — mirrors the backend precedence:
// completion_redirect_url -> REDIRECT; completion_message/button -> MESSAGE; else DEFAULT.
const COMPLETION_MODE_VALUES = ['DEFAULT', 'MESSAGE', 'REDIRECT'] as const;
type CompletionMode = (typeof COMPLETION_MODE_VALUES)[number];

// Type-only shape — messages don't matter for z.infer, so this instance is never
// used for runtime validation (see buildBaseFormSchema below for the translated one).
const baseFormSchemaShape = z.object({
    name: z.string().min(1),
    memberCount: z.number().min(1).optional(),
    validityInDays: z.number().min(1).optional(),
    maxRegistrations: z.number().min(1).optional(),
    paymentType: z.enum(PAYMENT_TYPE_VALUES),
    // Required for ONE_TIME / SUBSCRIPTION — picked from the institute's existing
    // payment options (Payment Settings). FREE keeps the fresh-option backend path.
    paymentOptionId: z.string().optional(),
    vendor: z.string().optional(),
    vendorId: z.string().optional(),
    currency: z.string().optional(),
});

type FormValues = z.infer<typeof baseFormSchemaShape>;

const buildBaseFormSchema = (t: TFunction) =>
    z.object({
        name: z.string().min(1, t('validation.nameRequired')),
        memberCount: z.number().min(1, t('validation.minOne')).optional(),
        validityInDays: z.number().min(1, t('validation.minOneDay')).optional(),
        maxRegistrations: z.number().min(1, t('validation.minOne')).optional(),
        paymentType: z.enum(PAYMENT_TYPE_VALUES),
        paymentOptionId: z.string().optional(),
        vendor: z.string().optional(),
        vendorId: z.string().optional(),
        currency: z.string().optional(),
    });

const buildFormSchema = (t: TFunction) =>
    buildBaseFormSchema(t)
        .refine((values) => values.paymentType === 'FREE' || !!values.paymentOptionId, {
            message: t('validation.selectPaymentOption'),
            path: ['paymentOptionId'],
        })
        .refine((values) => values.paymentType === 'FREE' || !!values.vendor, {
            message: t('validation.vendorRequired'),
            path: ['vendor'],
        });

const buildPaymentTypeLabels = (t: TFunction): Record<PaymentType, string> => ({
    FREE: t('paymentTypeLabel.free'),
    ONE_TIME: t('paymentTypeLabel.oneTime'),
    SUBSCRIPTION: t('paymentTypeLabel.subscription'),
});

/**
 * Reverse of buildInstituteCustomFields — maps an existing template's custom-field rows
 * back into builder working rows (edit-mode prefill), keeping custom_field id/fieldKey so
 * the update payload lets the backend dedupe/update instead of duplicating.
 */
const mapDetailCustomFields = (
    rows: RegistrationTemplateCustomField[] | null | undefined
): BuilderField[] => {
    if (!rows || rows.length === 0) return [];
    return [...rows]
        .sort(
            (a, b) =>
                (a.individual_order ?? a.custom_field?.formOrder ?? 0) -
                (b.individual_order ?? b.custom_field?.formOrder ?? 0)
        )
        .map((row) => {
            const rawType = (row.custom_field?.fieldType || 'TEXT').toUpperCase();
            const type: FieldType = (FIELD_TYPE_OPTIONS as readonly string[]).includes(rawType)
                ? (rawType as FieldType)
                : 'TEXT';
            let optionsCsv = '';
            if (type === 'DROPDOWN' && row.custom_field?.config) {
                try {
                    const parsed: unknown = JSON.parse(row.custom_field.config);
                    if (Array.isArray(parsed)) {
                        optionsCsv = parsed
                            .map((o: unknown) =>
                                typeof o === 'string'
                                    ? o
                                    : String((o as { value?: unknown })?.value ?? '')
                            )
                            .map((v) => v.trim())
                            .filter(Boolean)
                            .join(', ');
                    }
                } catch {
                    optionsCsv = '';
                }
            }
            const name = row.custom_field?.fieldName || '';
            return {
                name,
                type,
                optionsCsv,
                mandatory: row.is_mandatory ?? row.custom_field?.isMandatory ?? false,
                existingId: row.custom_field?.id,
                fieldKey: row.custom_field?.fieldKey,
                original: { name, type, optionsCsv },
            };
        });
};

const numberOrUndefined = (value: unknown) =>
    value === '' || value === null || value === undefined || Number.isNaN(Number(value))
        ? undefined
        : Number(value);

interface RegistrationLinkCreateModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Full detail of an existing template — presence switches the modal to EDIT mode:
     * every section prefills, payment renders read-only (immutable after creation) and
     * submit PUTs an update. The invite code never changes on edit.
     */
    editTemplate?: TemplateDetail | null;
}

export function RegistrationLinkCreateModal({
    open,
    onOpenChange,
    editTemplate,
}: RegistrationLinkCreateModalProps) {
    const { t } = useTranslation('manageCustomTeamsRegistrationLinkCreateModal');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const isEditMode = !!editTemplate;
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    const { uploadFile } = useFileUpload();

    const token = getTokenFromCookie(TokenKey.accessToken);
    const currentUserId = getTokenDecodedData(token)?.user ?? '';

    // Edit mode skips the paid-link refinements — payment config is immutable and the
    // PUT endpoint ignores payment fields, so they must never block saving other edits.
    const form = useForm<FormValues>({
        resolver: zodResolver(isEditMode ? buildBaseFormSchema(t) : buildFormSchema(t)),
        defaultValues: { name: '', paymentType: 'FREE' },
    });

    const [selectedPackageSessionIds, setSelectedPackageSessionIds] = useState<string[]>([]);
    const [selectedAuthRoles, setSelectedAuthRoles] = useState<string[]>(['ADMIN']);
    const [selectedTeamRoles, setSelectedTeamRoles] = useState<string[]>([]);
    const [selectedAdminPermissions, setSelectedAdminPermissions] = useState<string[]>(['FULL']);
    const [customFields, setCustomFields] = useState<BuilderField[]>([]);
    const [tncEnabled, setTncEnabled] = useState(false);
    const [tncFileId, setTncFileId] = useState<string | null>(null);
    const [tncFileName, setTncFileName] = useState<string>('');
    const [isUploadingTnc, setIsUploadingTnc] = useState(false);
    // Consent statements (each a required checkbox in the wizard); inline links via [label](url).
    const [tncConsentItems, setTncConsentItems] = useState<string[]>([]);
    const [kycEnabled, setKycEnabled] = useState(false);
    const [kycScope, setKycScope] = useState<KycScope>('AADHAAR');
    // Optional copy shown on the identity-verification step; empty = backend default note.
    const [kycInstructions, setKycInstructions] = useState('');
    // Wizard content — helper text under the Organization Name field + full-address toggle.
    const [orgNameHint, setOrgNameHint] = useState('');
    const [collectAddress, setCollectAddress] = useState(false);
    // After-registration behaviour (see CompletionMode precedence above).
    const [completionMode, setCompletionMode] = useState<CompletionMode>('DEFAULT');
    const [completionMessage, setCompletionMessage] = useState('');
    const [completionButtonLabel, setCompletionButtonLabel] = useState('');
    const [completionButtonUrl, setCompletionButtonUrl] = useState('');
    const [completionRedirectUrl, setCompletionRedirectUrl] = useState('');

    const courseLabel = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursesLabel = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);

    // Fetch packages + prefetch every package's sessions in parallel so the picker
    // renders the full (package · level · session) checkbox list immediately —
    // same flat pattern as create-sub-org-modal step 2.
    const { data: packagesSummary, isLoading: isLoadingSummary } = useQuery({
        queryKey: ['sub-org-packages-summary-local', instituteId],
        queryFn: () => fetchBatchesSummaryLocal(instituteId || '', ['ACTIVE']),
        enabled: open && !!instituteId,
    });

    const packageIds: string[] = (packagesSummary?.packages || []).map((p: { id: string }) => p.id);
    const sessionQueries = useQueries({
        queries: packageIds.map((pkgId: string) => ({
            queryKey: ['sub-org-package-sessions-local', pkgId],
            queryFn: () => fetchCourseBatchesLocal(pkgId),
            enabled: open && !!pkgId,
            staleTime: 30000,
        })),
    });
    const isLoadingSessions = isLoadingSummary || sessionQueries.some((q) => q.isLoading);

    type FlatRow = {
        packageId: string;
        packageName: string;
        packageSessionId: string;
        levelName: string;
        sessionName: string;
    };
    const flatRows: FlatRow[] = (packagesSummary?.packages || []).flatMap(
        (pkg: { id: string; name: string }, idx: number) => {
            const sessions = (sessionQueries[idx]?.data || []) as PackageSessionDTO[];
            return sessions.map((ps) => ({
                packageId: pkg.id,
                packageName: pkg.name || pkg.id,
                packageSessionId: ps.id,
                levelName: ps.level?.level_name || '—',
                sessionName: ps.session?.session_name || '—',
            }));
        }
    );

    const { data: rolesList = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['roles'],
        queryFn: getAllRoles,
        staleTime: 1000 * 60 * 5,
        enabled: open,
    });

    // Fetch payment vendors for institute — same lookup as create-sub-org-modal step 3.
    const { data: vendorsList = [] } = useQuery<{ vendor: string; vendor_id: string }[]>({
        queryKey: ['institute-vendors', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(
                `${GET_INSTITUTE_VENDORS}?instituteId=${instituteId}`
            );
            return response.data;
        },
        enabled: open && !!instituteId,
    });

    // Fetch the institute's existing payment options (Payment Settings) — the
    // registering sub-org admin pays via one of these for paid links.
    const { data: institutePaymentOptions = [], isLoading: isLoadingPaymentOptions } = useQuery<
        PaymentOptionApi[]
    >({
        queryKey: ['sub-org-institute-payment-options', instituteId],
        queryFn: () =>
            getPaymentOptions({
                types: ['ONE_TIME', 'SUBSCRIPTION', 'FREE'],
                source: 'INSTITUTE',
                source_id: instituteId || '',
                require_approval: true,
                not_require_approval: true,
            }),
        enabled: open && !!instituteId,
        staleTime: 30000,
    });

    const paymentType = form.watch('paymentType');
    const isPaid = paymentType === 'ONE_TIME' || paymentType === 'SUBSCRIPTION';
    const optionsForType = institutePaymentOptions.filter(
        (o) => o.status === 'ACTIVE' && o.type === paymentType
    );

    // Auto-select vendor when there's exactly one. `open` is a dep so a reopen after
    // resetAll re-stamps the (cached) single vendor back onto the form. Skipped in edit
    // mode — payment config is immutable and prefilled from the template detail.
    useEffect(() => {
        if (open && !isEditMode && vendorsList.length === 1 && vendorsList[0]) {
            form.setValue('vendor', vendorsList[0].vendor);
            form.setValue('vendorId', vendorsList[0].vendor_id);
        }
    }, [vendorsList, open, isEditMode, form]);

    // EDIT-MODE PREFILL — stamp every section from the template detail whenever the
    // modal opens with an editTemplate. Payment fields are prefilled only so the
    // read-only summary + rebuilt settings keep the original type (backend ignores
    // them on PUT anyway).
    useEffect(() => {
        if (!open || !editTemplate) return;
        const paymentType: PaymentType = (PAYMENT_TYPE_VALUES as readonly string[]).includes(
            editTemplate.payment_type
        )
            ? (editTemplate.payment_type as PaymentType)
            : 'FREE';
        form.reset({
            name: editTemplate.name || '',
            memberCount: editTemplate.member_count ?? undefined,
            validityInDays: editTemplate.validity_in_days ?? undefined,
            maxRegistrations: editTemplate.max_registrations ?? undefined,
            paymentType,
            paymentOptionId: editTemplate.payment_option_id ?? undefined,
            vendor: editTemplate.vendor ?? undefined,
            vendorId: undefined,
            currency: editTemplate.currency ?? undefined,
        });
        setSelectedPackageSessionIds(editTemplate.package_session_ids ?? []);
        // auth_roles must never be sent empty — fall back to the create-mode default.
        setSelectedAuthRoles(
            editTemplate.auth_roles && editTemplate.auth_roles.length > 0
                ? editTemplate.auth_roles
                : ['ADMIN']
        );
        setSelectedTeamRoles(editTemplate.allowed_team_roles ?? []);
        setSelectedAdminPermissions(
            editTemplate.admin_permissions && editTemplate.admin_permissions.length > 0
                ? editTemplate.admin_permissions
                : ['FULL']
        );
        setCustomFields(mapDetailCustomFields(editTemplate.institute_custom_fields));
        const consentItems = editTemplate.tnc_consent_items ?? [];
        setTncEnabled(!!editTemplate.tnc_file_id || consentItems.length > 0);
        setTncFileId(editTemplate.tnc_file_id ?? null);
        // The real filename isn't stored on the template — the chip falls back to a label.
        setTncFileName(editTemplate.tnc_file_id ? t('tnc.existingFileLabel') : '');
        setTncConsentItems(consentItems);
        const kycDocs = editTemplate.kyc_documents ?? [];
        setKycEnabled(kycDocs.length > 0);
        setKycScope(kycDocs.includes('PAN') ? 'AADHAAR_PAN' : 'AADHAAR');
        setKycInstructions(editTemplate.kyc_instructions ?? '');
        setOrgNameHint(editTemplate.org_name_hint ?? '');
        setCollectAddress(editTemplate.collect_address === true);
        // Completion mode follows the same precedence the wizard applies at runtime:
        // redirect URL wins, then a custom message/button, else the default screen.
        const redirectUrl = editTemplate.completion_redirect_url ?? '';
        const message = editTemplate.completion_message ?? '';
        const buttonLabel = editTemplate.completion_button_label ?? '';
        const buttonUrl = editTemplate.completion_button_url ?? '';
        setCompletionMode(
            redirectUrl ? 'REDIRECT' : message || buttonLabel || buttonUrl ? 'MESSAGE' : 'DEFAULT'
        );
        setCompletionMessage(message);
        setCompletionButtonLabel(buttonLabel);
        setCompletionButtonUrl(buttonUrl);
        setCompletionRedirectUrl(redirectUrl);
    }, [open, editTemplate, form, t]);

    const createMutation = useMutation({
        mutationFn: (payload: CreateRegistrationTemplateRequest) =>
            createRegistrationTemplate(instituteId || '', payload),
        onSuccess: (data) => {
            toast.success(t('toast.createSuccess'));
            if (data.invite_code) {
                toast.info(t('toast.createCode', { code: data.invite_code }));
            }
            queryClient.invalidateQueries({
                queryKey: ['sub-org-registration-templates', instituteId],
            });
            resetAll();
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || t('toast.createError');
            toast.error(message);
        },
    });

    // Edit-mode PUT — the invite code never changes, so no new-link toast here.
    const updateMutation = useMutation({
        mutationFn: ({
            templateId,
            payload,
        }: {
            templateId: string;
            payload: CreateRegistrationTemplateRequest;
        }) => updateRegistrationTemplate(templateId, instituteId || '', payload),
        onSuccess: (_data, variables) => {
            toast.success(t('toast.updateSuccess'));
            queryClient.invalidateQueries({
                queryKey: ['sub-org-registration-templates', instituteId],
            });
            queryClient.invalidateQueries({
                queryKey: ['sub-org-registration-template-detail', variables.templateId],
            });
            resetAll();
            onOpenChange(false);
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || t('toast.updateError');
            toast.error(message);
        },
    });

    const resetAll = () => {
        form.reset({ name: '', paymentType: 'FREE' });
        setSelectedPackageSessionIds([]);
        setSelectedAuthRoles(['ADMIN']);
        setSelectedTeamRoles([]);
        setSelectedAdminPermissions(['FULL']);
        setCustomFields([]);
        setTncEnabled(false);
        setTncFileId(null);
        setTncFileName('');
        setTncConsentItems([]);
        setKycEnabled(false);
        setKycScope('AADHAAR');
        setKycInstructions('');
        setOrgNameHint('');
        setCollectAddress(false);
        setCompletionMode('DEFAULT');
        setCompletionMessage('');
        setCompletionButtonLabel('');
        setCompletionButtonUrl('');
        setCompletionRedirectUrl('');
    };

    const togglePackageSession = (id: string) => {
        setSelectedPackageSessionIds((prev) =>
            prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
        );
    };

    const toggleInList = (
        setter: React.Dispatch<React.SetStateAction<string[]>>,
        value: string,
        checked: boolean
    ) => {
        setter((prev) =>
            checked ? Array.from(new Set([...prev, value])) : prev.filter((v) => v !== value)
        );
    };

    const addCustomField = () => {
        setCustomFields((prev) => [
            ...prev,
            { name: '', type: 'TEXT', optionsCsv: '', mandatory: false },
        ]);
    };

    const updateCustomField = (index: number, patch: Partial<BuilderField>) => {
        setCustomFields((prev) =>
            prev.map((field, i) => (i === index ? { ...field, ...patch } : field))
        );
    };

    const removeCustomField = (index: number) => {
        setCustomFields((prev) => prev.filter((_, i) => i !== index));
    };

    const handleTncFileSelected = async (file: File) => {
        if (file.type !== 'application/pdf') {
            toast.error(t('toast.pdfOnly'));
            return;
        }
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: setIsUploadingTnc,
                userId: currentUserId || 'admin',
                source: instituteId || 'FLOOR_DOCUMENTS',
                sourceId: 'SUB_ORG_REGISTRATION_TNC',
                publicUrl: true,
            });
            if (fileId && typeof fileId === 'string') {
                setTncFileId(fileId);
                setTncFileName(file.name);
                toast.success(t('toast.pdfUploaded'));
            } else {
                toast.error(t('toast.uploadNoFileId'));
            }
        } catch {
            toast.error(t('toast.pdfUploadFailed'));
        }
    };

    /**
     * Builds admin_core's InstituteCustomFieldDTO list. Outer keys snake_case; the
     * nested `custom_field` (common.dto.CustomFieldDTO, no @JsonNaming) is camelCase —
     * same shape the audience-campaign flow sends to the same backend DTO.
     * Field order = list order.
     */
    const buildInstituteCustomFields = (): RegistrationTemplateCustomField[] | undefined => {
        const cleaned = customFields
            .map((field) => ({ ...field, name: field.name.trim() }))
            .filter((field) => field.name.length > 0);
        if (cleaned.length === 0) return undefined;

        const normalizeOptions = (csv: string) =>
            csv
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
                .join('|');

        return cleaned.map((field, index) => {
            const options =
                field.type === 'DROPDOWN'
                    ? field.optionsCsv
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean)
                    : [];
            // The backend can't update a field's definition in place — keep the id
            // only when name/type/options are untouched; otherwise submit as new.
            const definitionUnchanged =
                !!field.original &&
                field.original.name.trim() === field.name &&
                field.original.type === field.type &&
                (field.type !== 'DROPDOWN' ||
                    normalizeOptions(field.original.optionsCsv) ===
                        normalizeOptions(field.optionsCsv));
            const keepIdentity = !!field.existingId && definitionUnchanged;
            return {
                institute_id: instituteId || '',
                type: 'ENROLL_INVITE' as const,
                status: 'ACTIVE' as const,
                individual_order: index,
                is_mandatory: field.mandatory,
                custom_field: {
                    // Preserve identity on edit so the backend updates instead of duplicating.
                    ...(keepIdentity && { id: field.existingId }),
                    ...(keepIdentity && field.fieldKey && { fieldKey: field.fieldKey }),
                    fieldName: field.name,
                    fieldType: field.type,
                    formOrder: index + 1,
                    isMandatory: field.mandatory,
                    ...(field.type === 'DROPDOWN' && {
                        // Same config JSON the invite/audience dropdown fields persist.
                        config: JSON.stringify(
                            options.map((value, i) => ({ id: i + 1, value, label: value }))
                        ),
                    }),
                },
            };
        });
    };

    const onSubmit = (values: FormValues) => {
        if (selectedPackageSessionIds.length === 0) {
            toast.error(t('toast.selectBatch'));
            return;
        }
        const cleanedConsentItems = tncConsentItems.map((s) => s.trim()).filter(Boolean);
        if (tncEnabled && !tncFileId && cleanedConsentItems.length === 0) {
            toast.error(t('toast.tncRequired'));
            return;
        }
        const invalidDropdown = customFields.find(
            (field) =>
                field.name.trim().length > 0 &&
                field.type === 'DROPDOWN' &&
                field.optionsCsv
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean).length === 0
        );
        if (invalidDropdown) {
            toast.error(t('toast.dropdownOptionRequired', { field: invalidDropdown.name }));
            return;
        }

        // After-registration config — mirrors the backend buildSettings rules:
        // button label+URL must be BOTH set or BOTH absent; URLs must be https://.
        const trimmedCompletionMessage = completionMessage.trim();
        const trimmedButtonLabel = completionButtonLabel.trim();
        const trimmedButtonUrl = completionButtonUrl.trim();
        const trimmedRedirectUrl = completionRedirectUrl.trim();
        if (completionMode === 'MESSAGE') {
            // Message OR a complete button pair is enough (backend allows button-only).
            if (!trimmedCompletionMessage && !(trimmedButtonLabel && trimmedButtonUrl)) {
                toast.error(t('toast.completionMessageRequired'));
                return;
            }
            if (!!trimmedButtonLabel !== !!trimmedButtonUrl) {
                toast.error(t('toast.completionButtonPairRequired'));
                return;
            }
            if (trimmedButtonUrl && !trimmedButtonUrl.startsWith('https://')) {
                toast.error(t('toast.completionButtonUrlHttps'));
                return;
            }
        }
        if (completionMode === 'REDIRECT') {
            if (!trimmedRedirectUrl) {
                toast.error(t('toast.redirectUrlRequired'));
                return;
            }
            if (!trimmedRedirectUrl.startsWith('https://')) {
                toast.error(t('toast.redirectUrlHttps'));
                return;
            }
        }
        const trimmedOrgNameHint = orgNameHint.trim();
        const trimmedKycInstructions = kycInstructions.trim();

        // FREE keeps the current fresh-option backend path — only paid links reuse an
        // existing institute payment option (+ gateway vendor).
        const isGatewayBacked =
            values.paymentType === 'ONE_TIME' || values.paymentType === 'SUBSCRIPTION';

        const payload: CreateRegistrationTemplateRequest = {
            name: values.name.trim(),
            package_session_ids: selectedPackageSessionIds,
            member_count: values.memberCount,
            validity_in_days: values.validityInDays,
            auth_roles: selectedAuthRoles.length > 0 ? selectedAuthRoles : undefined,
            admin_permissions:
                selectedAdminPermissions.length > 0 ? selectedAdminPermissions : undefined,
            allowed_team_roles: selectedTeamRoles.length > 0 ? selectedTeamRoles : undefined,
            tnc_file_id: tncEnabled && tncFileId ? tncFileId : undefined,
            tnc_consent_items:
                tncEnabled && cleanedConsentItems.length > 0 ? cleanedConsentItems : undefined,
            // AADHAAR is always included — the backend rejects KYC configs without it.
            kyc_documents: kycEnabled
                ? kycScope === 'AADHAAR_PAN'
                    ? ['AADHAAR', 'PAN']
                    : ['AADHAAR']
                : undefined,
            max_registrations: values.maxRegistrations,
            institute_custom_fields: buildInstituteCustomFields(),
            org_name_hint: trimmedOrgNameHint || undefined,
            // Absent = false server-side, so omitting when unchecked also clears it on edit.
            collect_address: collectAddress || undefined,
            kyc_instructions:
                kycEnabled && trimmedKycInstructions ? trimmedKycInstructions : undefined,
            // Completion precedence: default -> omit all; custom message -> message
            // (+ button pair when filled); redirect -> redirect URL only.
            ...(completionMode === 'MESSAGE' && {
                completion_message: trimmedCompletionMessage || undefined,
                ...(trimmedButtonLabel &&
                    trimmedButtonUrl && {
                        completion_button_label: trimmedButtonLabel,
                        completion_button_url: trimmedButtonUrl,
                    }),
            }),
            ...(completionMode === 'REDIRECT' && {
                completion_redirect_url: trimmedRedirectUrl,
            }),
            // Payment config is immutable after creation — omit it entirely on edit
            // so the wire contract doesn't imply otherwise (backend ignores it anyway).
            ...(editTemplate
                ? {}
                : {
                      payment_type: values.paymentType,
                      payment_option_id: isGatewayBacked ? values.paymentOptionId : undefined,
                      vendor: isGatewayBacked ? values.vendor : undefined,
                      vendor_id: isGatewayBacked ? values.vendorId : undefined,
                      currency: isGatewayBacked ? values.currency : undefined,
                  }),
        };
        if (editTemplate) {
            // Payment fields in the payload are ignored server-side on PUT (immutable).
            updateMutation.mutate({ templateId: editTemplate.template_id, payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    const isPending = createMutation.isPending || updateMutation.isPending;

    // Read-only payment summary bits (edit mode). The payment-options query already
    // covers all three types, so we can resolve the configured option's display name.
    const editPaymentType: PaymentType =
        editTemplate && (PAYMENT_TYPE_VALUES as readonly string[]).includes(editTemplate.payment_type)
            ? (editTemplate.payment_type as PaymentType)
            : 'FREE';
    const editIsPaid = editPaymentType === 'ONE_TIME' || editPaymentType === 'SUBSCRIPTION';
    const editPaymentOptionName = editTemplate?.payment_option_id
        ? isLoadingPaymentOptions
            ? t('payment.option.loadingShort')
            : institutePaymentOptions.find((o) => o.id === editTemplate.payment_option_id)?.name ||
              editTemplate.payment_option_id
        : '—';

    return (
        <MyDialog
            heading={isEditMode ? t('title.edit') : t('title.create')}
            open={open}
            onOpenChange={(o) => {
                if (!o) resetAll();
                onOpenChange(o);
            }}
            dialogWidth="max-w-2xl"
        >
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* 1. Name */}
                <div className="space-y-2">
                    <Label htmlFor="registration-link-name">{t('fields.name.label')}</Label>
                    <Input
                        id="registration-link-name"
                        placeholder={t('fields.name.placeholder')}
                        {...form.register('name')}
                    />
                    {form.formState.errors.name && (
                        <p className="text-sm text-danger-600">
                            {form.formState.errors.name.message}
                        </p>
                    )}
                </div>

                {/* 2. Courses (package-session picker) */}
                <div className="space-y-2">
                    <div>
                        <Label>{t('fields.courses.label', { label: coursesLabel })}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('fields.courses.hint', { subOrg: subOrgTerm.toLowerCase() })}
                        </p>
                    </div>
                    <ScrollArea className="h-72 rounded-md border p-3">
                        {isLoadingSessions && flatRows.length === 0 && (
                            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                                <CircleNotch className="size-4 animate-spin" />
                                {t('fields.courses.loading')}
                            </div>
                        )}
                        {!isLoadingSessions && flatRows.length === 0 && (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {t('fields.courses.empty')}
                            </p>
                        )}
                        {(packagesSummary?.packages || []).map(
                            (pkg: { id: string; name: string }) => {
                                const rows = flatRows.filter((r) => r.packageId === pkg.id);
                                if (rows.length === 0) return null;
                                return (
                                    <div key={pkg.id} className="mb-3">
                                        <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            {pkg.name}
                                        </p>
                                        <div className="space-y-1">
                                            {rows.map((row) => (
                                                <label
                                                    key={row.packageSessionId}
                                                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                                                >
                                                    <Checkbox
                                                        checked={selectedPackageSessionIds.includes(
                                                            row.packageSessionId
                                                        )}
                                                        onCheckedChange={() =>
                                                            togglePackageSession(
                                                                row.packageSessionId
                                                            )
                                                        }
                                                    />
                                                    <span>
                                                        {row.levelName} - {row.sessionName}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                );
                            }
                        )}
                    </ScrollArea>
                    {selectedPackageSessionIds.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                            {t('fields.courses.selectedCount', {
                                count: selectedPackageSessionIds.length,
                            })}
                        </p>
                    )}
                </div>

                {/* 3. Seat cap + validity */}
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="registration-link-seats">{t('fields.seatLimit.label')}</Label>
                        <Input
                            id="registration-link-seats"
                            type="number"
                            min={1}
                            placeholder={t('fields.seatLimit.placeholder')}
                            {...form.register('memberCount', { setValueAs: numberOrUndefined })}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('fields.seatLimit.hint', { subOrg: subOrgTerm.toLowerCase() })}
                        </p>
                        {form.formState.errors.memberCount && (
                            <p className="text-sm text-danger-600">
                                {form.formState.errors.memberCount.message}
                            </p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="registration-link-validity">{t('fields.validity.label')}</Label>
                        <Input
                            id="registration-link-validity"
                            type="number"
                            min={1}
                            placeholder={t('fields.validity.placeholder')}
                            {...form.register('validityInDays', { setValueAs: numberOrUndefined })}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('fields.validity.hint', { subOrg: subOrgTerm.toLowerCase() })}
                        </p>
                        {form.formState.errors.validityInDays && (
                            <p className="text-sm text-danger-600">
                                {form.formState.errors.validityInDays.message}
                            </p>
                        )}
                    </div>
                </div>

                {/* 4. Payment — read-only in edit mode; payment config is immutable */}
                {isEditMode ? (
                    <div className="space-y-2">
                        <Label>{t('payment.label')}</Label>
                        <div className="space-y-1 rounded-md border bg-muted/50 p-3 text-sm">
                            <p>
                                <span className="text-muted-foreground">{t('payment.typeLabelPrefix')}</span>
                                {buildPaymentTypeLabels(t)[editPaymentType]}
                            </p>
                            {editIsPaid && (
                                <>
                                    <p>
                                        <span className="text-muted-foreground">
                                            {t('payment.optionLabelPrefix')}
                                        </span>
                                        {editPaymentOptionName}
                                    </p>
                                    <p>
                                        <span className="text-muted-foreground">{t('payment.vendorLabelPrefix')}</span>
                                        {editTemplate?.vendor || '—'}
                                    </p>
                                    <p>
                                        <span className="text-muted-foreground">{t('payment.currencyLabelPrefix')}</span>
                                        {editTemplate?.currency || '—'}
                                    </p>
                                </>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t('payment.immutableNote')}
                        </p>
                    </div>
                ) : (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <div>
                            <Label>{t('payment.typeSelect.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('payment.typeSelect.hint')}
                            </p>
                        </div>
                        <Select
                            value={paymentType}
                            onValueChange={(v) => {
                                form.setValue('paymentType', v as PaymentType);
                                // Options are type-scoped — clear so a stale pick from
                                // another type can't leak into the request.
                                form.setValue('paymentOptionId', undefined);
                                form.setValue('currency', undefined);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FREE">{t('paymentTypeLabel.free')}</SelectItem>
                                <SelectItem value="ONE_TIME">{t('paymentTypeLabel.oneTime')}</SelectItem>
                                <SelectItem value="SUBSCRIPTION">{t('paymentTypeLabel.subscription')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {isPaid && (
                        <div className="space-y-2">
                            <div>
                                <Label>{t('payment.option.label')}</Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('payment.option.hint')}
                                </p>
                            </div>
                            <Select
                                value={form.watch('paymentOptionId') || ''}
                                onValueChange={(v) => {
                                    form.setValue('paymentOptionId', v, {
                                        shouldValidate: true,
                                    });
                                    const opt = optionsForType.find((o) => o.id === v);
                                    const cur = opt?.payment_plans?.[0]?.currency;
                                    if (cur) form.setValue('currency', cur);
                                }}
                                disabled={isLoadingPaymentOptions}
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={
                                            isLoadingPaymentOptions
                                                ? t('payment.option.loading')
                                                : optionsForType.length === 0
                                                  ? t('payment.option.noneFound')
                                                  : t('payment.option.placeholder')
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {optionsForType.map((o) => {
                                        const plan = o.payment_plans?.[0];
                                        const priceLabel = plan
                                            ? ` — ${formatPlanPrice(plan.actual_price)} ${plan.currency || ''}`
                                            : '';
                                        return (
                                            <SelectItem key={o.id} value={o.id}>
                                                {o.name}
                                                {priceLabel}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                            {!isLoadingPaymentOptions && optionsForType.length === 0 && (
                                <p className="text-sm text-amber-600">
                                    {t('payment.option.noActiveOfType', {
                                        type: paymentType.replace('_', '-').toLowerCase(),
                                    })}
                                </p>
                            )}
                            {form.formState.errors.paymentOptionId && (
                                <p className="text-sm text-danger-600">
                                    {form.formState.errors.paymentOptionId.message}
                                </p>
                            )}
                        </div>
                    )}

                    {isPaid && (
                        <div className="space-y-2">
                            <Label>{t('payment.vendor.label')}</Label>
                            {vendorsList.length === 0 ? (
                                <p className="text-sm text-amber-600">
                                    {t('payment.vendor.noneFound')}
                                </p>
                            ) : vendorsList.length === 1 && vendorsList[0] ? (
                                <Input
                                    value={vendorsList[0].vendor}
                                    disabled
                                    className="bg-muted"
                                />
                            ) : (
                                <Select
                                    value={form.watch('vendor') || ''}
                                    onValueChange={(v) => {
                                        const selected = vendorsList.find((vl) => vl.vendor === v);
                                        form.setValue('vendor', v, { shouldValidate: true });
                                        form.setValue('vendorId', selected?.vendor_id || v);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('payment.vendor.placeholder')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {vendorsList.map((v) => (
                                            <SelectItem key={v.vendor} value={v.vendor}>
                                                {v.vendor}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            {form.formState.errors.vendor && (
                                <p className="text-sm text-danger-600">
                                    {form.formState.errors.vendor.message}
                                </p>
                            )}
                        </div>
                    )}
                </div>
                )}

                {/* 5. Roles + permissions */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <div>
                            <Label>{t('roles.admin.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('roles.admin.hint')}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 rounded-md border p-2">
                            {rolesList.map((role) => (
                                <label
                                    key={role.id}
                                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted"
                                >
                                    <Checkbox
                                        checked={selectedAuthRoles.includes(role.name)}
                                        onCheckedChange={(checked) =>
                                            toggleInList(
                                                setSelectedAuthRoles,
                                                role.name,
                                                checked === true
                                            )
                                        }
                                    />
                                    {role.name}
                                </label>
                            ))}
                            {rolesList.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                    {t('roles.noneFound')}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div>
                            <Label>{t('roles.team.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('roles.team.hint', { subOrg: subOrgTerm.toLowerCase() })}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 rounded-md border p-2">
                            {rolesList.map((role) => (
                                <label
                                    key={role.id}
                                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted"
                                >
                                    <Checkbox
                                        checked={selectedTeamRoles.includes(role.name)}
                                        onCheckedChange={(checked) =>
                                            toggleInList(
                                                setSelectedTeamRoles,
                                                role.name,
                                                checked === true
                                            )
                                        }
                                    />
                                    {role.name}
                                </label>
                            ))}
                            {rolesList.length === 0 && (
                                <span className="text-xs text-muted-foreground">
                                    {t('roles.noneFound')}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div>
                            <Label>{t('roles.permissions.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('roles.permissions.hint', { subOrg: subOrgTerm.toLowerCase() })}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2 rounded-md border p-2">
                            {ADMIN_PERMISSION_OPTIONS.map((perm) => (
                                <label
                                    key={perm}
                                    className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted"
                                >
                                    <Checkbox
                                        checked={selectedAdminPermissions.includes(perm)}
                                        onCheckedChange={(checked) =>
                                            toggleInList(
                                                setSelectedAdminPermissions,
                                                perm,
                                                checked === true
                                            )
                                        }
                                    />
                                    {perm === 'CREATE_COURSE'
                                        ? t('roles.permissions.createCourse', { course: courseLabel })
                                        : perm}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 6. Custom form fields */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <Label>{t('customFields.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('customFields.hint')}
                            </p>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={addCustomField}
                        >
                            <Plus className="mr-1 size-3" />
                            {t('customFields.addField')}
                        </MyButton>
                    </div>
                    {customFields.length === 0 ? (
                        <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
                            {t('customFields.empty')}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {customFields.map((field, index) => (
                                <div key={index} className="space-y-2 rounded-md border p-3">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            placeholder={t('customFields.namePlaceholder')}
                                            value={field.name}
                                            onChange={(e) =>
                                                updateCustomField(index, {
                                                    name: e.target.value,
                                                })
                                            }
                                            className="flex-1"
                                        />
                                        <Select
                                            value={field.type}
                                            onValueChange={(v) =>
                                                updateCustomField(index, {
                                                    type: v as FieldType,
                                                })
                                            }
                                        >
                                            <SelectTrigger className="w-36">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {FIELD_TYPE_OPTIONS.map((type) => (
                                                    <SelectItem key={type} value={type}>
                                                        {type}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            scale="small"
                                            layoutVariant="icon"
                                            onClick={() => removeCustomField(index)}
                                            aria-label={t('customFields.removeAria')}
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    </div>
                                    {field.type === 'DROPDOWN' && (
                                        <Input
                                            placeholder={t('customFields.optionsPlaceholder')}
                                            value={field.optionsCsv}
                                            onChange={(e) =>
                                                updateCustomField(index, {
                                                    optionsCsv: e.target.value,
                                                })
                                            }
                                        />
                                    )}
                                    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={field.mandatory}
                                            onCheckedChange={(checked) =>
                                                updateCustomField(index, {
                                                    mandatory: checked === true,
                                                })
                                            }
                                        />
                                        {t('customFields.mandatory')}
                                    </label>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 6b. Wizard content — copy tweaks + address collection */}
                <div className="space-y-2">
                    <div>
                        <Label>{t('wizard.label')}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('wizard.hint')}
                        </p>
                    </div>
                    <div className="space-y-2 rounded-md border p-3">
                        <Label htmlFor="registration-link-org-name-hint">
                            {t('wizard.orgNameHint.label')}
                        </Label>
                        <Input
                            id="registration-link-org-name-hint"
                            maxLength={300}
                            placeholder={t('wizard.orgNameHint.placeholder')}
                            value={orgNameHint}
                            onChange={(e) => setOrgNameHint(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('wizard.orgNameHint.hint')}
                        </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div>
                            <Label htmlFor="registration-link-collect-address">
                                {t('wizard.collectAddress.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('wizard.collectAddress.hint')}
                            </p>
                        </div>
                        <Switch
                            id="registration-link-collect-address"
                            checked={collectAddress}
                            onCheckedChange={setCollectAddress}
                        />
                    </div>
                </div>

                {/* 7. Terms & Conditions */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label htmlFor="registration-link-tnc">{t('tnc.label')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('tnc.hint')}
                            </p>
                        </div>
                        <Switch
                            id="registration-link-tnc"
                            checked={tncEnabled}
                            onCheckedChange={setTncEnabled}
                        />
                    </div>
                    {tncEnabled &&
                        (tncFileId ? (
                            <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
                                <span className="flex min-w-0 items-center gap-2 text-sm">
                                    <FilePdf className="size-4 shrink-0 text-primary-500" />
                                    <span className="truncate">
                                        {tncFileName || t('tnc.defaultFileLabel')}
                                    </span>
                                </span>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => {
                                        setTncFileId(null);
                                        setTncFileName('');
                                    }}
                                >
                                    {t('tnc.removeFile')}
                                </MyButton>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                <FileUploader
                                    onFileSelected={handleTncFileSelected}
                                    maxSize={10}
                                    acceptFormats={{ 'application/pdf': ['.pdf'] }}
                                    acceptMsg={t('tnc.acceptFormat')}
                                />
                                {isUploadingTnc && (
                                    <p className="text-xs text-primary-500">{t('tnc.uploading')}</p>
                                )}
                            </div>
                        ))}
                    {tncEnabled && (
                        <div className="space-y-2 rounded-md border p-3">
                            <div>
                                <Label>{t('tnc.consent.label')}</Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('tnc.consent.hint')}
                                </p>
                            </div>
                            {tncConsentItems.map((item, index) => (
                                <div key={index} className="flex items-start gap-2">
                                    <Textarea
                                        value={item}
                                        onChange={(e) =>
                                            setTncConsentItems((prev) =>
                                                prev.map((s, i) =>
                                                    i === index ? e.target.value : s
                                                )
                                            )
                                        }
                                        placeholder={t('tnc.consent.itemPlaceholder')}
                                        rows={2}
                                        maxLength={1000}
                                        className="flex-1 text-sm"
                                    />
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() =>
                                            setTncConsentItems((prev) =>
                                                prev.filter((_, i) => i !== index)
                                            )
                                        }
                                    >
                                        <Trash className="size-4" />
                                    </MyButton>
                                </div>
                            ))}
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setTncConsentItems((prev) => [...prev, ''])}
                                disable={tncConsentItems.length >= 10}
                            >
                                <Plus className="mr-1 size-4" />
                                {t('tnc.consent.addStatement')}
                            </MyButton>
                        </div>
                    )}
                </div>

                {/* 8. Identity Verification (DigiLocker) */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <Label htmlFor="registration-link-kyc">
                                {t('kyc.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('kyc.hint')}
                            </p>
                        </div>
                        <Switch
                            id="registration-link-kyc"
                            checked={kycEnabled}
                            onCheckedChange={setKycEnabled}
                        />
                    </div>
                    {kycEnabled && (
                        <div className="space-y-2 rounded-md border p-3">
                            <RadioGroup
                                value={kycScope}
                                onValueChange={(v) => setKycScope(v as KycScope)}
                            >
                                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                                    <RadioGroupItem value="AADHAAR" />
                                    {t('kyc.aadhaarOnly')}
                                </label>
                                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                                    <RadioGroupItem value="AADHAAR_PAN" />
                                    {t('kyc.aadhaarPan')}
                                </label>
                            </RadioGroup>
                            <p className="text-xs text-muted-foreground">
                                {t('kyc.scopeHint')}
                            </p>
                            <div className="space-y-1 border-t pt-3">
                                <Label htmlFor="registration-link-kyc-instructions">
                                    {t('kyc.instructions.label')}
                                </Label>
                                <Textarea
                                    id="registration-link-kyc-instructions"
                                    value={kycInstructions}
                                    onChange={(e) => setKycInstructions(e.target.value)}
                                    rows={3}
                                    maxLength={1000}
                                    placeholder={t('kyc.instructions.placeholder')}
                                    className="text-sm"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('kyc.instructions.hint')}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* 9. Max registrations */}
                <div className="space-y-2">
                    <Label htmlFor="registration-link-max">{t('maxRegistrations.label')}</Label>
                    <Input
                        id="registration-link-max"
                        type="number"
                        min={1}
                        placeholder={t('maxRegistrations.placeholder')}
                        {...form.register('maxRegistrations', { setValueAs: numberOrUndefined })}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('maxRegistrations.hint')}
                    </p>
                    {form.formState.errors.maxRegistrations && (
                        <p className="text-sm text-danger-600">
                            {form.formState.errors.maxRegistrations.message}
                        </p>
                    )}
                </div>

                {/* 10. After registration — completion screen behaviour */}
                <div className="space-y-2">
                    <div>
                        <Label>{t('completion.label')}</Label>
                        <p className="text-xs text-muted-foreground">
                            {t('completion.hint')}
                        </p>
                    </div>
                    <div className="space-y-3 rounded-md border p-3">
                        <RadioGroup
                            value={completionMode}
                            onValueChange={(v) => setCompletionMode(v as CompletionMode)}
                        >
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <RadioGroupItem value="DEFAULT" className="mt-0.5" />
                                <span>
                                    {t('completion.mode.default.title')}
                                    <span className="block text-xs text-muted-foreground">
                                        {t('completion.mode.default.desc')}
                                    </span>
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <RadioGroupItem value="MESSAGE" className="mt-0.5" />
                                <span>
                                    {t('completion.mode.message.title')}
                                    <span className="block text-xs text-muted-foreground">
                                        {t('completion.mode.message.desc')}
                                    </span>
                                </span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                                <RadioGroupItem value="REDIRECT" className="mt-0.5" />
                                <span>
                                    {t('completion.mode.redirect.title')}
                                    <span className="block text-xs text-muted-foreground">
                                        {t('completion.mode.redirect.desc')}
                                    </span>
                                </span>
                            </label>
                        </RadioGroup>
                        {completionMode === 'MESSAGE' && (
                            <div className="space-y-2 border-t pt-3">
                                <div className="space-y-1">
                                    <Label htmlFor="registration-link-completion-message">
                                        {t('completion.message.label')}
                                    </Label>
                                    <Textarea
                                        id="registration-link-completion-message"
                                        value={completionMessage}
                                        onChange={(e) => setCompletionMessage(e.target.value)}
                                        rows={3}
                                        maxLength={2000}
                                        placeholder={t('completion.message.placeholder')}
                                        className="text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        {t('completion.message.linksHint')}
                                    </p>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label htmlFor="registration-link-completion-button-label">
                                            {t('completion.message.buttonLabel.label')}
                                        </Label>
                                        <Input
                                            id="registration-link-completion-button-label"
                                            maxLength={100}
                                            placeholder={t('completion.message.buttonLabel.placeholder')}
                                            value={completionButtonLabel}
                                            onChange={(e) =>
                                                setCompletionButtonLabel(e.target.value)
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="registration-link-completion-button-url">
                                            {t('completion.message.buttonUrl.label')}
                                        </Label>
                                        <Input
                                            id="registration-link-completion-button-url"
                                            placeholder={t('completion.message.buttonUrl.placeholder')}
                                            value={completionButtonUrl}
                                            onChange={(e) =>
                                                setCompletionButtonUrl(e.target.value)
                                            }
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {t('completion.message.buttonHint')}
                                </p>
                            </div>
                        )}
                        {completionMode === 'REDIRECT' && (
                            <div className="space-y-1 border-t pt-3">
                                <Label htmlFor="registration-link-completion-redirect-url">
                                    {t('completion.redirect.label')}
                                </Label>
                                <Input
                                    id="registration-link-completion-redirect-url"
                                    placeholder={t('completion.redirect.placeholder')}
                                    value={completionRedirectUrl}
                                    onChange={(e) => setCompletionRedirectUrl(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('completion.redirect.hint')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => {
                            resetAll();
                            onOpenChange(false);
                        }}
                        disable={isPending}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        disable={isPending || isUploadingTnc}
                    >
                        {isPending && <CircleNotch className="mr-2 size-4 animate-spin" />}
                        {isEditMode ? t('actions.save') : t('title.create')}
                    </MyButton>
                </div>
            </form>
        </MyDialog>
    );
}
