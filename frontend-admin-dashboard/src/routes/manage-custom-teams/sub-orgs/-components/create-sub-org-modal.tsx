import { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { TFunction } from 'i18next';
import {
    createSubOrg,
    createSubOrgWithSubscription,
    createCustomRole,
    getAllRoles,
    type CreateSubOrgSubscriptionRequest,
} from '../../-services/custom-team-services';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, UploadCloud, Check, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import type { PackageSessionDTO } from '@/routes/admin-package-management/-types/package-types';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL, GET_INSTITUTE_VENDORS } from '@/constants/urls';
import type { CPOListApiResponse } from '@/routes/financial-management/fee-plans/-types/cpo-types';
import { getPaymentOptions } from '@/services/payment-options';
import type { PaymentOptionApi } from '@/types/payment';
import { formatPlanPrice } from '@/utils/finance-utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Local sub-org helpers — kept inline so the rest of the dashboard's package-service
// calls don't accidentally pick up the same lookup logic.
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

const fetchInstituteCpoListLocal = async (
    instituteId: string,
    pageNo = 0,
    pageSize = 100
): Promise<CPOListApiResponse> => {
    const url = `${BASE_URL}/admin-core-service/v1/fee-management/cpo/${instituteId}`;
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url,
        params: { pageNo, pageSize },
    });
    return response.data;
};

// Step 1 schema: Sub-Org details. Built with `t` so the validation message
// follows the active locale — see the "module-scope constants" convention in
// the i18n rollout guide (these were previously plain module-level z.object()s).
const buildStep1Schema = (t: TFunction) =>
    z.object({
        instituteName: z
            .string()
            .min(1, t('manageCustomTeamsCreateSubOrgModal:validation.nameRequired')),
        instituteLogoFileId: z.string().optional(),
    });

// Step 3 schema: Pricing & Seats
const buildStep3Schema = (t: TFunction) =>
    z.object({
        paymentType: z.enum(['SUBSCRIPTION', 'ONE_TIME', 'FREE', 'CPO']),
        actualPrice: z.number().min(0).optional(),
        elevatedPrice: z.number().min(0).optional(),
        currency: z.string().optional(),
        memberCount: z
            .number()
            .min(1, t('manageCustomTeamsCreateSubOrgModal:validation.seatRequired')),
        validityInDays: z
            .number()
            .min(1, t('manageCustomTeamsCreateSubOrgModal:validation.validityRequired')),
        vendor: z.string().optional(),
        vendorId: z.string().optional(),
        // Required when paymentType=CPO — picked from the institute's existing CPO list.
        complexPaymentOptionId: z.string().optional(),
        // Required for ONE_TIME / SUBSCRIPTION / FREE — picked from the institute's existing
        // payment options (Payment Settings). The admin pays via this option + its plan.
        paymentOptionId: z.string().optional(),
    });

type Step1Values = z.infer<ReturnType<typeof buildStep1Schema>>;
type Step3Values = z.infer<ReturnType<typeof buildStep3Schema>>;

interface CreateSubOrgModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function CreateSubOrgModal({ open, onOpenChange, onSuccess }: CreateSubOrgModalProps) {
    const { t } = useTranslation('manageCustomTeamsCreateSubOrgModal');
    // Institutes rename this concept via Settings → Naming (Channel Partner,
    // Branch, Franchise, VLE …); user-facing labels must follow that.
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile, isUploading } = useFileUpload();
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [, setLocalUploading] = useState(false);

    const token = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(token);
    const currentUserId = tokenData?.user ?? '';
    const instituteId = getCurrentInstituteId();

    // Wizard state
    const [step, setStep] = useState(1);
    const [step1Data, setStep1Data] = useState<Step1Values | null>(null);
    const [selectedPackageSessionIds, setSelectedPackageSessionIds] = useState<string[]>([]);
    const [selectedAuthRoles, setSelectedAuthRoles] = useState<string[]>([]);
    // Custom roles the sub-org admin will be allowed to pick when adding their team
    // members on /manage-suborg-teams. Persisted on settingJson.ALLOWED_TEAM_ROLES.
    // Empty = no restriction. Editable later via the sub-org detail modal.
    const [selectedTeamRoles, setSelectedTeamRoles] = useState<string[]>([]);
    // Permissions stamped on the sub-org admin's FSPSSM rows. Persisted on
    // settingJson.ADMIN_PERMISSIONS. Empty = backend falls back to "FULL".
    const [selectedAdminPermissions, setSelectedAdminPermissions] = useState<string[]>(['FULL']);
    const [showNewRoleInput, setShowNewRoleInput] = useState(false);
    const [newRoleName, setNewRoleName] = useState('');

    // Schemas are rebuilt on every language change so validation messages stay
    // in the active locale.
    const step1Schema = useMemo(() => buildStep1Schema(t), [t]);
    const step3Schema = useMemo(() => buildStep3Schema(t), [t]);

    // Step 1 form
    const step1Form = useForm<Step1Values>({
        resolver: zodResolver(step1Schema),
    });

    // Step 3 form
    const step3Form = useForm<Step3Values>({
        resolver: zodResolver(step3Schema),
        defaultValues: {
            paymentType: 'FREE',
            memberCount: 10,
            validityInDays: 365,
            currency: 'INR',
        },
    });

    // Fetch packages for step 2.
    const { data: packagesSummary, isLoading: isLoadingSummary } = useQuery({
        queryKey: ['sub-org-packages-summary-local', instituteId],
        queryFn: () => fetchBatchesSummaryLocal(instituteId || '', ['ACTIVE']),
        enabled: open && step >= 2 && !!instituteId,
    });

    // Prefetch sessions for every package in parallel so the user sees the full
    // (package · level · session) list immediately as checkboxes — no click-to-expand
    // dance. This was the behaviour that broke against the local backend.
    const packageIds: string[] = (packagesSummary?.packages || []).map(
        (p: { id: string }) => p.id
    );
    const sessionQueries = useQueries({
        queries: packageIds.map((pkgId: string) => ({
            queryKey: ['sub-org-package-sessions-local', pkgId],
            queryFn: () => fetchCourseBatchesLocal(pkgId),
            enabled: open && step >= 2 && !!pkgId,
            staleTime: 30000,
        })),
    });
    const isLoadingSessions =
        isLoadingSummary || sessionQueries.some((q) => q.isLoading);

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

    // Fetch roles from parent institute
    const { data: rolesList = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['roles'],
        queryFn: getAllRoles,
        staleTime: 1000 * 60 * 5,
        enabled: open,
    });

    // Fetch payment vendors for institute
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

    // Fetch institute CPOs — used to populate the picker when payment_type=CPO.
    const { data: cpoListResponse, isLoading: isLoadingCpos } = useQuery({
        queryKey: ['sub-org-institute-cpo-list-local', instituteId],
        queryFn: () => fetchInstituteCpoListLocal(instituteId || '', 0, 100),
        enabled: open && step === 3 && !!instituteId,
        staleTime: 30000,
    });
    const cpoList = (cpoListResponse?.content || []).filter(
        (cpo) => cpo.status === 'ACTIVE'
    );

    // Fetch the institute's existing payment options (Payment Settings) — the sub-org
    // admin pays via one of these instead of a freshly-typed price. CPO stays on its own
    // picker above; this covers ONE_TIME / SUBSCRIPTION / FREE.
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
        enabled: open && step === 3 && !!instituteId,
        staleTime: 30000,
    });
    const optionsForType = institutePaymentOptions.filter(
        (o) => o.status === 'ACTIVE' && o.type === step3Form.watch('paymentType')
    );

    // Auto-select vendor when there's exactly one
    useEffect(() => {
        if (vendorsList.length === 1 && vendorsList[0]) {
            step3Form.setValue('vendor', vendorsList[0].vendor);
            step3Form.setValue('vendorId', vendorsList[0].vendor_id);
        }
    }, [vendorsList]);

    // Mutation for subscription flow
    const subscriptionMutation = useMutation({
        mutationFn: createSubOrgWithSubscription,
        onSuccess: (data) => {
            toast.success(t('toast.createdWithSubscription', { subOrgTerm }));
            if (data.invite_code) {
                toast.info(t('toast.inviteCode', { code: data.invite_code }));
            }
            queryClient.invalidateQueries({ queryKey: ['sub-orgs-list', instituteId] });
            resetWizard();
            onOpenChange(false);
            if (onSuccess) onSuccess();
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toast.createFailed'));
        },
    });

    // Fallback mutation for simple creation (no package sessions selected)
    const simpleMutation = useMutation({
        mutationFn: createSubOrg,
        onSuccess: () => {
            toast.success(t('toast.createdSuccessfully', { subOrgTerm }));
            queryClient.invalidateQueries({ queryKey: ['sub-orgs-list', instituteId] });
            resetWizard();
            onOpenChange(false);
            if (onSuccess) onSuccess();
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toast.createFailed'));
        },
    });

    // Mutation for creating a new role
    const createRoleMutation = useMutation({
        mutationFn: (name: string) => createCustomRole({ name, permissionIds: ['109'] }),
        onSuccess: () => {
            toast.success(t('toast.roleCreated'));
            queryClient.invalidateQueries({ queryKey: ['roles'] });
            setNewRoleName('');
            setShowNewRoleInput(false);
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message || t('toast.roleCreateFailed'));
        },
    });

    const handleCreateRole = () => {
        const trimmed = newRoleName.trim();
        if (!trimmed) {
            toast.error(t('validation.roleNameRequired'));
            return;
        }
        createRoleMutation.mutate(trimmed);
    };

    const resetWizard = () => {
        setStep(1);
        setStep1Data(null);
        setSelectedPackageSessionIds([]);
        setLogoPreview(null);
        setSelectedAuthRoles([]);
        setSelectedTeamRoles([]);
        setSelectedAdminPermissions(['FULL']);
        setShowNewRoleInput(false);
        setNewRoleName('');
        step1Form.reset();
        step3Form.reset({
            paymentType: 'FREE',
            memberCount: 10,
            validityInDays: 365,
            currency: 'INR',
        });
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => setLogoPreview(reader.result as string);
        reader.readAsDataURL(file);

        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: setLocalUploading,
                userId: currentUserId || 'admin',
                source: instituteId || 'FLOOR_DOCUMENTS',
                sourceId: 'STUDENTS',
                publicUrl: true,
            });

            if (fileId && typeof fileId === 'string') {
                step1Form.setValue('instituteLogoFileId', fileId);
                toast.success(t('logo.uploadSuccess'));
            } else {
                toast.error(t('logo.uploadNoFileId'));
            }
        } catch {
            toast.error(t('logo.uploadFailed'));
        }
        e.target.value = '';
    };

    const handleStep1Next = (data: Step1Values) => {
        setStep1Data(data);
        setStep(2);
    };

    const handleStep2Next = () => {
        if (selectedPackageSessionIds.length === 0) {
            toast.error(t('validation.selectPackageSession'));
            return;
        }
        setStep(3);
    };

    const handleStep2Skip = () => {
        // No package sessions — just create simple sub-org
        if (!step1Data) return;
        simpleMutation.mutate({
            institute_name: step1Data.instituteName,
            institute_logo_file_id: step1Data.instituteLogoFileId,
        });
    };

    const handleFinalSubmit = (data: Step3Values) => {
        if (!step1Data) return;

        // CPO needs an explicit picker selection; price/vendor live on the CPO itself.
        if (data.paymentType === 'CPO' && !data.complexPaymentOptionId) {
            toast.error(
                t('validation.selectCpo', { subOrgTerm: subOrgTerm.toLowerCase() })
            );
            return;
        }

        // ONE_TIME / SUBSCRIPTION / FREE reuse an existing institute payment option.
        const reusesOption =
            data.paymentType === 'ONE_TIME' ||
            data.paymentType === 'SUBSCRIPTION' ||
            data.paymentType === 'FREE';
        if (reusesOption && !data.paymentOptionId) {
            toast.error(
                t('validation.selectPaymentOption', { subOrgTerm: subOrgTerm.toLowerCase() })
            );
            return;
        }

        const isGatewayBacked = data.paymentType === 'ONE_TIME' || data.paymentType === 'SUBSCRIPTION';

        const request: CreateSubOrgSubscriptionRequest = {
            sub_org_details: {
                institute_name: step1Data.instituteName,
                institute_logo_file_id: step1Data.instituteLogoFileId,
            },
            package_session_ids: selectedPackageSessionIds,
            payment_type: data.paymentType,
            // Price comes from the reused option's plan — not sent.
            currency: isGatewayBacked ? data.currency : undefined,
            member_count: data.memberCount,
            validity_in_days: data.validityInDays,
            vendor: isGatewayBacked ? data.vendor : undefined,
            vendor_id: isGatewayBacked ? data.vendorId : undefined,
            auth_roles: selectedAuthRoles.length > 0 ? selectedAuthRoles : undefined,
            allowed_team_roles: selectedTeamRoles.length > 0 ? selectedTeamRoles : undefined,
            admin_permissions:
                selectedAdminPermissions.length > 0 ? selectedAdminPermissions : undefined,
            complex_payment_option_id:
                data.paymentType === 'CPO' ? data.complexPaymentOptionId : undefined,
            payment_option_id: reusesOption ? data.paymentOptionId : undefined,
        };
        subscriptionMutation.mutate(request);
    };

    const togglePackageSession = (id: string) => {
        setSelectedPackageSessionIds((prev) =>
            prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
        );
    };

    const isPending = subscriptionMutation.isPending || simpleMutation.isPending;
    const paymentType = step3Form.watch('paymentType');

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) resetWizard();
                onOpenChange(o);
            }}
        >
            <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col overflow-hidden max-w-[425px] sm:max-w-[600px] md:max-w-[700px]">
                <DialogHeader className="shrink-0">
                    <DialogTitle>
                        {step === 1 && t('step1.title', { subOrgTerm })}
                        {step === 2 && t('step2.title')}
                        {step === 3 && t('step3.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 1 && t('step1.description', { subOrgTerm })}
                        {step === 2 && t('step2.description')}
                        {step === 3 && t('step3.description')}
                    </DialogDescription>
                </DialogHeader>

                {/* Step indicators */}
                <div className="flex shrink-0 items-center justify-center gap-2 py-2">
                    {[1, 2, 3].map((s) => (
                        <div
                            key={s}
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                                s < step
                                    ? 'bg-green-500 text-white'
                                    : s === step
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground'
                            }`}
                        >
                            {s < step ? <Check className="h-4 w-4" /> : s}
                        </div>
                    ))}
                </div>

                {/* Scrollable wizard body — wraps every step so a long Step 3 (with the
                    pricing options + admin roles + allowed team roles + summary + footer)
                    doesn't push the dialog past the viewport. Each step's <DialogFooter>
                    lives inside this scroll area too, matching the sub-org-detail modal. */}
                <div className="-mx-2 flex-1 overflow-y-auto px-2 pb-2">

                {/* STEP 1: Sub-Org Details */}
                {step === 1 && (
                    <Form {...step1Form}>
                        <form
                            onSubmit={step1Form.handleSubmit(handleStep1Next)}
                            className="space-y-4"
                        >
                            <div className="grid gap-6 sm:grid-cols-2">
                                <div className="flex flex-col items-center gap-2 sm:col-span-2">
                                    <Label className="text-sm font-medium">{t('logo.label')}</Label>
                                    <div className="relative flex h-28 w-28 flex-col items-center justify-center overflow-hidden rounded-full border border-input bg-muted">
                                        {logoPreview ? (
                                            <img
                                                src={logoPreview}
                                                alt={t('logo.alt')}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-muted-foreground">
                                                <UploadCloud size={36} />
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={handleFileChange}
                                        disabled={isUploading}
                                        aria-label={t('logo.ariaLabel')}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={isUploading}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {isUploading ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <UploadCloud className="mr-2 h-4 w-4" />
                                        )}
                                        {isUploading ? t('logo.uploading') : t('logo.upload')}
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="name">{t('step1.nameLabel')}</Label>
                                    <Input
                                        id="name"
                                        {...step1Form.register('instituteName')}
                                        placeholder={t('step1.namePlaceholder', { subOrgTerm })}
                                    />
                                    {step1Form.formState.errors.instituteName && (
                                        <p className="text-sm text-destructive">
                                            {step1Form.formState.errors.instituteName.message}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" disabled={isUploading}>
                                    {t('common.next')}
                                    <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}

                {/* STEP 2: Package Session Selection — flat checkbox list, grouped by package */}
                {step === 2 && (
                    <div className="space-y-4">
                        <ScrollArea className="h-[300px] rounded-md border p-3">
                            {isLoadingSessions && flatRows.length === 0 && (
                                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {t('step2.loading')}
                                </div>
                            )}
                            {!isLoadingSessions && flatRows.length === 0 && (
                                <p className="py-8 text-center text-sm text-muted-foreground">
                                    {t('step2.empty')}
                                </p>
                            )}
                            {(packagesSummary?.packages || []).map(
                                (pkg: { id: string; name: string }) => {
                                    const rows = flatRows.filter(
                                        (r) => r.packageId === pkg.id
                                    );
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
                                {t('step2.selectedCount', {
                                    count: selectedPackageSessionIds.length,
                                })}
                            </p>
                        )}

                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setStep(1)}
                            >
                                <ChevronLeft className="mr-1 h-4 w-4" />
                                {t('common.back')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleStep2Skip}
                                disabled={isPending}
                            >
                                {simpleMutation.isPending && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                {t('step2.skip')}
                            </Button>
                            <Button type="button" onClick={handleStep2Next}>
                                {t('common.next')}
                                <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {/* STEP 3: Pricing & Seats */}
                {step === 3 && (
                    <Form {...step3Form}>
                        <form
                            onSubmit={step3Form.handleSubmit(handleFinalSubmit)}
                            className="space-y-4"
                        >
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>{t('step3.paymentTypeLabel')}</Label>
                                    <Select
                                        value={paymentType}
                                        onValueChange={(v) => {
                                            step3Form.setValue(
                                                'paymentType',
                                                v as 'SUBSCRIPTION' | 'ONE_TIME' | 'FREE' | 'CPO'
                                            );
                                            // Selections are type-scoped — clear so a stale
                                            // pick from another type can't leak into the request.
                                            step3Form.setValue('paymentOptionId', undefined);
                                            step3Form.setValue('complexPaymentOptionId', undefined);
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="FREE">
                                                {t('step3.paymentTypeFree')}
                                            </SelectItem>
                                            <SelectItem value="ONE_TIME">
                                                {t('step3.paymentTypeOneTime')}
                                            </SelectItem>
                                            <SelectItem value="SUBSCRIPTION">
                                                {t('step3.paymentTypeSubscription')}
                                            </SelectItem>
                                            <SelectItem value="CPO">
                                                {t('step3.paymentTypeCpo')}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {paymentType === 'CPO' && (
                                    <div className="space-y-2 sm:col-span-2">
                                        <Label>{t('step3.cpoLabel')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('step3.cpoDescription')}
                                        </p>
                                        <Select
                                            value={step3Form.watch('complexPaymentOptionId') || ''}
                                            onValueChange={(v) =>
                                                step3Form.setValue('complexPaymentOptionId', v)
                                            }
                                            disabled={isLoadingCpos}
                                        >
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={
                                                        isLoadingCpos
                                                            ? t('step3.cpoLoading')
                                                            : cpoList.length === 0
                                                              ? t('step3.cpoEmpty')
                                                              : t('step3.cpoPlaceholder')
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {cpoList.map((cpo) => (
                                                    <SelectItem key={cpo.id} value={cpo.id}>
                                                        {cpo.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {(paymentType === 'ONE_TIME' ||
                                    paymentType === 'SUBSCRIPTION' ||
                                    paymentType === 'FREE') && (
                                    <div className="space-y-2 sm:col-span-2">
                                        <Label>{t('step3.paymentOptionLabel')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('step3.paymentOptionDescription', {
                                                subOrgTerm: subOrgTerm.toLowerCase(),
                                            })}
                                        </p>
                                        <Select
                                            value={step3Form.watch('paymentOptionId') || ''}
                                            onValueChange={(v) => {
                                                step3Form.setValue('paymentOptionId', v);
                                                const opt = optionsForType.find((o) => o.id === v);
                                                const cur = opt?.payment_plans?.[0]?.currency;
                                                if (cur) step3Form.setValue('currency', cur);
                                            }}
                                            disabled={isLoadingPaymentOptions}
                                        >
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={
                                                        isLoadingPaymentOptions
                                                            ? t('step3.paymentOptionLoading')
                                                            : optionsForType.length === 0
                                                              ? t('step3.paymentOptionEmpty')
                                                              : t('step3.paymentOptionPlaceholder')
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {optionsForType.map((o) => {
                                                    const plan = o.payment_plans?.[0];
                                                    const priceLabel =
                                                        o.type === 'FREE' || !plan
                                                            ? ''
                                                            : ` — ${formatPlanPrice(plan.actual_price)} ${plan.currency || ''}`;
                                                    return (
                                                        <SelectItem key={o.id} value={o.id}>
                                                            {o.name}
                                                            {priceLabel}
                                                        </SelectItem>
                                                    );
                                                })}
                                            </SelectContent>
                                        </Select>
                                        {!isLoadingPaymentOptions &&
                                            optionsForType.length === 0 && (
                                                <p className="text-sm text-amber-600">
                                                    {t('step3.paymentOptionNoneWarning', {
                                                        type: paymentType
                                                            .replace('_', '-')
                                                            .toLowerCase(),
                                                    })}
                                                </p>
                                            )}
                                    </div>
                                )}

                                {(paymentType === 'ONE_TIME' || paymentType === 'SUBSCRIPTION') && (
                                    <>
                                        <div className="space-y-2 sm:col-span-2">
                                            <Label>{t('step3.vendorLabel')}</Label>
                                            {vendorsList.length === 0 ? (
                                                <p className="text-sm text-amber-600">
                                                    {t('step3.vendorNoneConfigured')}
                                                </p>
                                            ) : vendorsList.length === 1 && vendorsList[0] ? (
                                                <Input
                                                    value={vendorsList[0].vendor}
                                                    disabled
                                                    className="bg-muted"
                                                />
                                            ) : (
                                                <Select
                                                    value={step3Form.watch('vendor') || ''}
                                                    onValueChange={(v) => {
                                                        const selected = vendorsList.find(vl => vl.vendor === v);
                                                        step3Form.setValue('vendor', v);
                                                        step3Form.setValue('vendorId', selected?.vendor_id || v);
                                                    }}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder={t('step3.vendorPlaceholder')} />
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
                                        </div>
                                    </>
                                )}

                                {/* Auth Roles for sub-org admin */}
                                <div className="space-y-2 sm:col-span-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label>{t('step3.adminRolesLabel')}</Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t('step3.adminRolesDescription')}
                                            </p>
                                        </div>
                                        {!showNewRoleInput && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setShowNewRoleInput(true)}
                                            >
                                                <Plus className="mr-1 h-3 w-3" />
                                                {t('step3.addNewRole')}
                                            </Button>
                                        )}
                                    </div>
                                    {showNewRoleInput && (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                placeholder={t('step3.roleNamePlaceholder')}
                                                value={newRoleName}
                                                onChange={(e) => setNewRoleName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleCreateRole();
                                                    }
                                                }}
                                                disabled={createRoleMutation.isPending}
                                                className="h-8"
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={handleCreateRole}
                                                disabled={createRoleMutation.isPending}
                                            >
                                                {createRoleMutation.isPending ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    t('step3.createRole')
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setShowNewRoleInput(false);
                                                    setNewRoleName('');
                                                }}
                                                disabled={createRoleMutation.isPending}
                                            >
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    )}
                                    <div className="flex flex-wrap gap-2 rounded-md border p-2">
                                        {rolesList.map((role) => (
                                            <label
                                                key={role.id}
                                                className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted"
                                            >
                                                <Checkbox
                                                    checked={selectedAuthRoles.includes(role.name)}
                                                    onCheckedChange={(checked) => {
                                                        setSelectedAuthRoles((prev) =>
                                                            checked
                                                                ? [...prev, role.name]
                                                                : prev.filter((r) => r !== role.name)
                                                        );
                                                    }}
                                                />
                                                {role.name}
                                            </label>
                                        ))}
                                        {rolesList.length === 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                {t('step3.noRolesFound')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Allowed team roles — restricts which custom roles the
                                    sub-org admin can assign on /manage-suborg-teams.
                                    Empty = no restriction. Editable later from the sub-org
                                    detail modal. */}
                                <div className="space-y-2 sm:col-span-2">
                                    <div>
                                        <Label>{t('step3.allowedTeamRolesLabel')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('step3.allowedTeamRolesDescription', {
                                                subOrgTerm: subOrgTerm.toLowerCase(),
                                            })}
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
                                                    onCheckedChange={(checked) => {
                                                        setSelectedTeamRoles((prev) =>
                                                            checked
                                                                ? [...prev, role.name]
                                                                : prev.filter((r) => r !== role.name)
                                                        );
                                                    }}
                                                />
                                                {role.name}
                                            </label>
                                        ))}
                                        {rolesList.length === 0 && (
                                            <span className="text-xs text-muted-foreground">
                                                {t('step3.noRolesFound')}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Admin permissions — stamped on the sub-org admin's FSPSSM
                                    rows. "FULL" grants every feature; "CREATE_COURSE" allows
                                    course creation when FULL is not selected. Empty falls
                                    back to "FULL" server-side. Editable later. */}
                                <div className="space-y-2 sm:col-span-2">
                                    <div>
                                        <Label>{t('step3.adminPermissionsLabel')}</Label>
                                        <p className="text-xs text-muted-foreground">
                                            {t('step3.adminPermissionsDescription', {
                                                subOrgTerm: subOrgTerm.toLowerCase(),
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 rounded-md border p-2">
                                        {(['FULL', 'CREATE_COURSE'] as const).map((perm) => (
                                            <label
                                                key={perm}
                                                className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-muted"
                                            >
                                                <Checkbox
                                                    checked={selectedAdminPermissions.includes(perm)}
                                                    onCheckedChange={(checked) => {
                                                        setSelectedAdminPermissions((prev) =>
                                                            checked
                                                                ? Array.from(new Set([...prev, perm]))
                                                                : prev.filter((p) => p !== perm)
                                                        );
                                                    }}
                                                />
                                                {perm}
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>{t('step3.seatLimitLabel')}</Label>
                                    <Input
                                        type="number"
                                        {...step3Form.register('memberCount', {
                                            valueAsNumber: true,
                                        })}
                                        placeholder={t('step3.seatLimitPlaceholder')}
                                    />
                                    {step3Form.formState.errors.memberCount && (
                                        <p className="text-sm text-destructive">
                                            {step3Form.formState.errors.memberCount.message}
                                        </p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('step3.validityLabel')}</Label>
                                    <Input
                                        type="number"
                                        {...step3Form.register('validityInDays', {
                                            valueAsNumber: true,
                                        })}
                                        placeholder={t('step3.validityPlaceholder')}
                                    />
                                    {step3Form.formState.errors.validityInDays && (
                                        <p className="text-sm text-destructive">
                                            {step3Form.formState.errors.validityInDays.message}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Summary */}
                            <div className="rounded-md border bg-muted/50 p-3 text-sm">
                                <p className="font-medium">{t('step3.summaryTitle')}</p>
                                <p>
                                    {t('step3.summaryOrganization', {
                                        name: step1Data?.instituteName,
                                    })}
                                </p>
                                <p>
                                    {t('step3.summaryPackageSessions', {
                                        count: selectedPackageSessionIds.length,
                                    })}
                                </p>
                                <p>
                                    {t('step3.summaryPayment', {
                                        type: paymentType,
                                        seats: step3Form.watch('memberCount'),
                                        days: step3Form.watch('validityInDays'),
                                    })}
                                </p>
                            </div>

                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setStep(2)}
                                    disabled={isPending}
                                >
                                    <ChevronLeft className="mr-1 h-4 w-4" />
                                    {t('common.back')}
                                </Button>
                                <Button type="submit" disabled={isPending}>
                                    {isPending && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    {t('step3.submit', { subOrgTerm })}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
