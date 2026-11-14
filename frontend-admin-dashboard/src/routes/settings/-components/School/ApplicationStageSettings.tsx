import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    FileText,
    CreditCard,
    GraduationCap,
    ArrowRight,
    UploadSimple,
    X,
} from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { MyDialog } from '@/components/design-system/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { ADD_APPLICATION_STAGE, GET_APPLICATION_STAGES } from '@/constants/urls';
import { getPaymentOptions } from '@/services/payment-options';
import { UploadFileInS3 } from '@/services/upload_file';
import { PaymentPlans } from '@/types/payment';
import { getInstituteId } from '@/constants/helper';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ApplicationStage {
    id: string;
    sequence: string;
    source: 'INSTITUTE' | 'LEVEL';
    type: 'FORM' | 'PAYMENT';
    stage_name: string;
    source_id: string;
    institute_id: string;
    config_json: string;
    workflow_type: string;
    is_first: boolean;
    is_last: boolean;
}

interface PaymentOption {
    id: string;
    name: string;
    type: string;
}

interface AddStageForm {
    stage_name: string;
    type: 'FORM' | 'PAYMENT';
    workflow_type: 'APPLICATION' | 'ADMISSION';
    sequence: string;
    is_first: boolean;
    is_last: boolean;
    // Payment-specific
    display_text: string;
    payment_option_id: string;
    payment_qr_code_file_id: string;
    // UPI details
    upi_vpa: string;
    upi_payee_name: string;
}

const DEFAULT_PAYMENT_CONFIG = (
    display_text: string,
    payment_option_id: string,
    payment_qr_code_file_id: string,
    upi_vpa?: string,
    upi_payee_name?: string
) => ({
    order_id: null,
    display_text,
    gateway_rules: { fallback: 'RAZORPAY', preferred: 'RAZORPAY' },
    payment_status: null,
    payment_option_id,
    payment_qr_code_file_id: payment_qr_code_file_id || null,
    upi_details:
        upi_vpa || upi_payee_name
            ? {
                  upi_vpa: upi_vpa || null,
                  upi_payee_name: upi_payee_name || null,
              }
            : null,
});

// ─── API Calls ─────────────────────────────────────────────────────────────

const fetchApplicationStages = async (instituteId: string): Promise<ApplicationStage[]> => {
    const response = await authenticatedAxiosInstance.get(GET_APPLICATION_STAGES, {
        params: { instituteId, source: 'INSTITUTE', sourceId: instituteId },
    });
    return response.data ?? [];
};

const addApplicationStage = async (payload: ApplicationStage): Promise<ApplicationStage> => {
    const response = await authenticatedAxiosInstance.post(ADD_APPLICATION_STAGE, payload);
    return response.data;
};

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
    const { t } = useTranslation('settingsApplicationStage');
    return (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-10 text-center">
            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-50">
                <GraduationCap className="size-6 text-primary-500" />
            </div>
            <p className="mb-1 text-sm font-medium text-gray-700">{t('emptyState.title')}</p>
            <p className="mb-4 text-xs text-gray-500">{t('emptyState.description')}</p>
            <MyButton buttonType="primary" scale="small" onClick={onAdd}>
                <Plus className="mr-1 size-3.5" />
                {t('emptyState.addFirstStage')}
            </MyButton>
        </div>
    );
}

// ─── Stage Card ─────────────────────────────────────────────────────────────

function StageCard({ stage, index }: { stage: ApplicationStage; index: number }) {
    const { t } = useTranslation('settingsApplicationStage');
    const isPayment = stage.type === 'PAYMENT';
    let paymentOptionId: string | null = null;
    if (isPayment && stage.config_json) {
        try {
            const parsed = JSON.parse(stage.config_json);
            paymentOptionId = parsed.payment_option_id ?? null;
        } catch {
            // ignore
        }
    }

    return (
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            {/* Sequence bubble */}
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
                {index + 1}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{stage.stage_name}</span>
                    <Badge
                        variant="outline"
                        className={
                            isPayment
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-blue-200 bg-blue-50 text-blue-700'
                        }
                    >
                        {isPayment ? (
                            <CreditCard className="mr-1 size-3" />
                        ) : (
                            <FileText className="mr-1 size-3" />
                        )}
                        {stage.type}
                    </Badge>
                    {stage.is_first && (
                        <Badge
                            variant="outline"
                            className="border-green-200 bg-green-50 text-green-700"
                        >
                            {t('stageCard.first')}
                        </Badge>
                    )}
                    {stage.is_last && (
                        <Badge
                            variant="outline"
                            className="border-purple-200 bg-purple-50 text-purple-700"
                        >
                            {t('stageCard.last')}
                        </Badge>
                    )}
                    <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700">
                        {stage.workflow_type || 'APPLICATION'}
                    </Badge>
                </div>
                {isPayment && paymentOptionId && (
                    <p className="mt-0.5 text-xs text-gray-500">
                        {t('stageCard.paymentOptionIdLabel')}{' '}
                        <span className="font-mono text-gray-600">{paymentOptionId}</span>
                    </p>
                )}
            </div>

            {/* Sequence arrow except last */}
            <ArrowRight className="mt-1 size-4 shrink-0 text-gray-300" />
        </div>
    );
}

// ─── Add Stage Dialog ────────────────────────────────────────────────────────

function AddStageDialog({
    open,
    onClose,
    onSuccess,
    paymentOptions,
    isLoadingPaymentOptions,
}: {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    paymentOptions: PaymentOption[];
    isLoadingPaymentOptions: boolean;
}) {
    const { t } = useTranslation('settingsApplicationStage');
    const instituteId = getCurrentInstituteId() ?? '';
    const defaultPaymentDisplayText = t('dialog.paymentSection.displayText.defaultValue');

    const [form, setForm] = useState<AddStageForm>({
        stage_name: '',
        type: 'FORM',
        workflow_type: 'APPLICATION',
        sequence: '1',
        is_first: false,
        is_last: false,
        display_text: defaultPaymentDisplayText,
        payment_option_id: '',
        payment_qr_code_file_id: '',
        upi_vpa: '',
        upi_payee_name: '',
    });
    const [isUploadingQr, setIsUploadingQr] = useState(false);
    const [qrPreviewUrl, setQrPreviewUrl] = useState<string>('');
    const qrInputRef = useRef<HTMLInputElement>(null);

    const handleQrUpload = async (file: File) => {
        setQrPreviewUrl(URL.createObjectURL(file));
        const fileId = await UploadFileInS3(
            file,
            setIsUploadingQr,
            instituteId,
            'INSTITUTE',
            instituteId,
            true
        );
        if (fileId) {
            update('payment_qr_code_file_id', fileId);
            toast.success(t('toast.qrUploadSuccess'));
        } else {
            toast.error(t('toast.qrUploadError'));
            setQrPreviewUrl('');
        }
    };

    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: addApplicationStage,
        onSuccess: () => {
            toast.success(t('toast.stageAddedSuccess'));
            queryClient.invalidateQueries({ queryKey: ['application-stages', instituteId] });
            onSuccess();
            resetForm();
        },
        onError: (error: any) => {
            toast.error(error?.response?.data?.message ?? t('toast.stageAddError'));
        },
    });

    const resetForm = () => {
        setForm({
            stage_name: '',
            type: 'FORM',
            workflow_type: 'APPLICATION',
            sequence: '1',
            is_first: false,
            is_last: false,
            display_text: defaultPaymentDisplayText,
            payment_option_id: '',
            payment_qr_code_file_id: '',
            upi_vpa: '',
            upi_payee_name: '',
        });
        setQrPreviewUrl('');
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = () => {
        if (!form.stage_name.trim()) {
            toast.error(t('toast.stageNameRequired'));
            return;
        }
        if (!form.sequence || isNaN(Number(form.sequence))) {
            toast.error(t('toast.sequenceInvalid'));
            return;
        }
        if (form.type === 'PAYMENT' && !form.payment_option_id) {
            toast.error(t('toast.paymentOptionRequired'));
            return;
        }

        const config_json =
            form.type === 'PAYMENT'
                ? JSON.stringify(
                      DEFAULT_PAYMENT_CONFIG(
                          form.display_text,
                          form.payment_option_id,
                          form.payment_qr_code_file_id,
                          form.upi_vpa,
                          form.upi_payee_name
                      )
                  )
                : '';

        const payload: ApplicationStage = {
            id: '',
            sequence: form.sequence,
            source: 'INSTITUTE',
            type: form.type,
            stage_name: form.stage_name.trim(),
            source_id: instituteId,
            institute_id: instituteId,
            config_json,
            workflow_type: form.workflow_type,
            is_first: form.is_first,
            is_last: form.is_last,
        };

        mutation.mutate(payload);
    };

    const update = (key: keyof AddStageForm, value: unknown) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    return (
        <MyDialog
            open={open}
            onOpenChange={(o) => !o && handleClose()}
            heading={t('dialog.heading')}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        onClick={handleClose}
                        disabled={mutation.isPending}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        onClick={handleSubmit}
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? t('dialog.adding') : t('dialog.addStage')}
                    </MyButton>
                </>
            }
        >
            <div className="space-y-5">
                {/* Stage Name */}
                <div className="space-y-1.5">
                    <Label htmlFor="stage_name">
                        {t('dialog.stageName.label')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                        id="stage_name"
                        placeholder={t('dialog.stageName.placeholder')}
                        value={form.stage_name}
                        onChange={(e) => update('stage_name', e.target.value)}
                    />
                </div>

                {/* Type + Sequence in a row */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="stage_type">
                            {t('dialog.stageType.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={form.type}
                            onValueChange={(v) => update('type', v as 'FORM' | 'PAYMENT')}
                        >
                            <SelectTrigger id="stage_type">
                                <SelectValue placeholder={t('dialog.stageType.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FORM">
                                    <span className="flex items-center gap-1.5">
                                        <FileText className="size-3.5" /> {t('dialog.stageType.form')}
                                    </span>
                                </SelectItem>
                                <SelectItem value="PAYMENT">
                                    <span className="flex items-center gap-1.5">
                                        <CreditCard className="size-3.5" /> {t('dialog.stageType.payment')}
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="sequence">
                            {t('dialog.sequence.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="sequence"
                            type="number"
                            min={1}
                            placeholder={t('dialog.sequence.placeholder')}
                            value={form.sequence}
                            onChange={(e) => update('sequence', e.target.value)}
                        />
                    </div>
                </div>

                {/* Type + Workflow + Sequence in a row */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="stage_type">
                            {t('dialog.stageType.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={form.type}
                            onValueChange={(v) => update('type', v as 'FORM' | 'PAYMENT')}
                        >
                            <SelectTrigger id="stage_type">
                                <SelectValue placeholder={t('dialog.stageType.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="FORM">
                                    <span className="flex items-center gap-1.5">
                                        <FileText className="size-3.5" /> {t('dialog.stageType.form')}
                                    </span>
                                </SelectItem>
                                <SelectItem value="PAYMENT">
                                    <span className="flex items-center gap-1.5">
                                        <CreditCard className="size-3.5" /> {t('dialog.stageType.payment')}
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="workflow_type">
                            {t('dialog.workflowType.label')}{' '}
                            <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={form.workflow_type}
                            onValueChange={(v) =>
                                update('workflow_type', v as 'APPLICATION' | 'ADMISSION')
                            }
                        >
                            <SelectTrigger id="workflow_type">
                                <SelectValue placeholder={t('dialog.workflowType.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="APPLICATION">APPLICATION</SelectItem>
                                <SelectItem value="ADMISSION">ADMISSION</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="sequence">
                            {t('dialog.sequence.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="sequence"
                            type="number"
                            min={1}
                            placeholder={t('dialog.sequence.placeholder')}
                            value={form.sequence}
                            onChange={(e) => update('sequence', e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                    <span className="text-sm font-medium text-gray-700">
                        {t('dialog.lastStage')}
                    </span>
                    <Switch checked={form.is_last} onCheckedChange={(v) => update('is_last', v)} />
                </div>

                {/* Payment-specific fields */}
                {form.type === 'PAYMENT' && (
                    <div className="space-y-4 rounded-lg border p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                            {t('dialog.paymentSection.heading')}
                        </p>

                        {/* Payment Option */}
                        <div className="space-y-1.5">
                            <Label htmlFor="payment_option">
                                {t('dialog.paymentSection.paymentOption.label')}{' '}
                                <span className="text-red-500">*</span>
                            </Label>
                            {isLoadingPaymentOptions ? (
                                <p className="text-sm text-gray-400">
                                    {t('dialog.paymentSection.paymentOption.loading')}
                                </p>
                            ) : paymentOptions.length === 0 ? (
                                <p className="text-sm text-amber-700">
                                    {t('dialog.paymentSection.paymentOption.empty')}
                                </p>
                            ) : (
                                <Select
                                    value={form.payment_option_id}
                                    onValueChange={(v) => update('payment_option_id', v)}
                                >
                                    <SelectTrigger id="payment_option">
                                        <SelectValue
                                            placeholder={t(
                                                'dialog.paymentSection.paymentOption.placeholder'
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {paymentOptions.map((opt) => (
                                            <SelectItem key={opt.id} value={opt.id}>
                                                {opt.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Display Text */}
                        <div className="space-y-1.5">
                            <Label htmlFor="display_text">
                                {t('dialog.paymentSection.displayText.label')}
                            </Label>
                            <Textarea
                                id="display_text"
                                rows={2}
                                placeholder={t('dialog.paymentSection.displayText.placeholder')}
                                value={form.display_text}
                                onChange={(e) => update('display_text', e.target.value)}
                            />
                        </div>

                        {/* QR Code Upload */}
                        <div className="space-y-1.5">
                            <Label>{t('dialog.paymentSection.qrCode.label')}</Label>
                            <input
                                ref={qrInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleQrUpload(file);
                                }}
                            />
                            {qrPreviewUrl ? (
                                <div className="relative inline-block">
                                    <img
                                        src={qrPreviewUrl}
                                        alt={t('dialog.paymentSection.qrCode.previewAlt')}
                                        className="h-32 w-32 rounded-lg border border-amber-200 bg-white object-contain p-1"
                                    />
                                    {isUploadingQr && (
                                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                                            <span className="size-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                                        </div>
                                    )}
                                    {!isUploadingQr && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setQrPreviewUrl('');
                                                update('payment_qr_code_file_id', '');
                                                if (qrInputRef.current)
                                                    qrInputRef.current.value = '';
                                            }}
                                            className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => qrInputRef.current?.click()}
                                    className="flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-amber-300 bg-white py-5 text-amber-600 transition hover:bg-amber-50"
                                >
                                    <UploadSimple className="size-6" />
                                    <span className="text-xs font-medium">
                                        {t('dialog.paymentSection.qrCode.uploadCta')}
                                    </span>
                                    <span className="text-2xs text-amber-400">
                                        {t('dialog.paymentSection.qrCode.uploadHint')}
                                    </span>
                                </button>
                            )}
                            {form.payment_qr_code_file_id && (
                                <p className="font-mono text-2xs text-green-600">
                                    ✓{' '}
                                    {t('dialog.paymentSection.qrCode.fileId', {
                                        fileId: form.payment_qr_code_file_id,
                                    })}
                                </p>
                            )}
                        </div>

                        {/* UPI Details */}
                        <div className="space-y-3 rounded-lg border border-amber-200 bg-white p-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="upi_vpa">
                                    {t('dialog.paymentSection.upi.vpaLabel')}
                                </Label>
                                <Input
                                    id="upi_vpa"
                                    placeholder={t('dialog.paymentSection.upi.vpaPlaceholder')}
                                    value={form.upi_vpa}
                                    onChange={(e) => update('upi_vpa', e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="upi_payee_name">
                                    {t('dialog.paymentSection.upi.payeeLabel')}
                                </Label>
                                <Input
                                    id="upi_payee_name"
                                    placeholder={t('dialog.paymentSection.upi.payeePlaceholder')}
                                    value={form.upi_payee_name}
                                    onChange={(e) => update('upi_payee_name', e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function ApplicationStageSettings() {
    const { t } = useTranslation('settingsApplicationStage');
    const instituteId = getCurrentInstituteId() ?? '';
    const fallbackInstituteId = getInstituteId() ?? instituteId;
    const effectiveInstituteId = fallbackInstituteId || instituteId;

    const [dialogOpen, setDialogOpen] = useState(false);

    // Fetch existing stages
    const { data: stages = [], isLoading: isLoadingStages } = useQuery<ApplicationStage[]>({
        queryKey: ['application-stages', effectiveInstituteId],
        queryFn: () => fetchApplicationStages(effectiveInstituteId),
        enabled: !!effectiveInstituteId,
        staleTime: 2 * 60 * 1000,
    });

    // Fetch payment options for the dialog
    const { data: rawPaymentOptions, isLoading: isLoadingPaymentOptions } = useQuery({
        queryKey: ['payment-options-for-stage'],
        queryFn: () =>
            getPaymentOptions({
                types: [PaymentPlans.UPFRONT, PaymentPlans.SUBSCRIPTION],
                source: 'INSTITUTE',
                source_id: effectiveInstituteId,
                require_approval: true,
                not_require_approval: true,
            }),
        staleTime: 5 * 60 * 1000,
        enabled: !!effectiveInstituteId,
    });

    const paymentOptions: PaymentOption[] = (rawPaymentOptions ?? []).map((opt: any) => ({
        id: opt.id ?? '',
        name: opt.name ?? opt.id,
        type: opt.type ?? '',
    }));

    // Sort stages by sequence
    const sortedStages = [...stages].sort((a, b) => Number(a.sequence) - Number(b.sequence));

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <GraduationCap className="size-5 text-primary-500" />
                                {t('main.title')}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {t('main.description')}
                            </CardDescription>
                        </div>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={() => setDialogOpen(true)}
                            disabled={isLoadingStages}
                        >
                            <Plus className="mr-1 size-3.5" />
                            {t('main.addStage')}
                        </MyButton>
                    </div>
                </CardHeader>

                <CardContent>
                    {isLoadingStages ? (
                        <div className="flex flex-col gap-3">
                            {[1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="h-16 animate-pulse rounded-lg bg-gray-100"
                                />
                            ))}
                        </div>
                    ) : sortedStages.length === 0 ? (
                        <EmptyState onAdd={() => setDialogOpen(true)} />
                    ) : (
                        <div className="flex flex-col gap-3">
                            {sortedStages.map((stage, idx) => (
                                <StageCard key={stage.id || idx} stage={stage} index={idx} />
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <AddStageDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSuccess={() => setDialogOpen(false)}
                paymentOptions={paymentOptions}
                isLoadingPaymentOptions={isLoadingPaymentOptions}
            />
        </>
    );
}
