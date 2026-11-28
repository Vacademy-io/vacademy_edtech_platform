import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Registration } from '../../../-types/registration-types';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type {
    PaymentOptionDetails,
    PaymentLinkMethod,
    AppFeeReceiptData,
} from '../../../-services/applicant-services';
import { initiateManualPayment, generatePaymentLink } from '../../../-services/applicant-services';
import { CardholderIcon, GlobeIcon, ArrowSquareOut, EnvelopeSimple, SpinnerGap, DownloadSimple } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useTheme } from '@/providers/theme/theme-provider';
import { sendPaymentLinkEmail } from '@/services/manage-finances';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SectionProps {
    formData: Partial<Registration>;
    updateFormData: (data: Partial<Registration>) => void;
    paymentLink?: string;
    applicantId?: string;
    paymentOptionDetails?: PaymentOptionDetails | null;
}

type PaymentMethod = 'ONLINE' | 'CASH' | 'UPI' | 'CARD' | 'CHEQUE' | 'SEND_LINK';

// ─── Main Component ──────────────────────────────────────────────────────────

export const PaymentSection: React.FC<SectionProps> = ({
    formData,
    updateFormData,
    applicantId,
    paymentOptionDetails,
}) => {
    const { t } = useTranslation('admissionsPaymentSection');
    const isPaid = formData.feeStatus === 'PAID';
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | ''>('');
    const [qrImageUrl, setQrImageUrl] = useState<string>('');
    const [showQrOverlay, setShowQrOverlay] = useState(false);
    const [generatedParentLink, setGeneratedParentLink] = useState<string>('');
    const [activeTab, setActiveTab] = useState<'pay' | 'link'>('pay');

    // Manual payment state
    const [manualTxnId, setManualTxnId] = useState('');
    const [proofFileId, setProofFileId] = useState('');
    const [proofPreviewUrl, setProofPreviewUrl] = useState('');
    const [isUploadingProof, setIsUploadingProof] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const proofInputRef = useRef<HTMLInputElement>(null);

    // Receipt state (populated after successful manual payment)
    const [receiptData, setReceiptData] = useState<AppFeeReceiptData | null>(null);

    // Email sending state
    const [showEmailInput, setShowEmailInput] = useState(false);
    const [linkEmail, setLinkEmail] = useState('');
    const [isSendingLinkEmail, setIsSendingLinkEmail] = useState(false);

    // Get institute details for learner portal URL
    const { instituteDetails } = useInstituteDetailsStore();
    const { getPrimaryColorCode } = useTheme();
    const learnerPortalBaseUrl = instituteDetails?.learner_portal_base_url;
    const instituteId = instituteDetails?.id ?? '';

    useEffect(() => {
        if (!paymentOptionDetails?.qrCodeFileId) return;
        getPublicUrl(paymentOptionDetails.qrCodeFileId).then((url) => {
            if (url) setQrImageUrl(url);
        });
    }, [paymentOptionDetails?.qrCodeFileId]);

    const registrationFee = paymentOptionDetails?.amount ?? 0;
    const registrationFeeName = paymentOptionDetails?.name ?? t('defaults.feeName');
    const registrationFeeCurrency = paymentOptionDetails?.currency ?? 'INR';
    const currencySymbol = registrationFeeCurrency === 'INR' ? '₹' : registrationFeeCurrency;
    const paymentOptionId = paymentOptionDetails?.id ?? '';

    // Raw backend payment-mode enum (UPI/CASH/CARD/CHEQUE/ONLINE/SEND_LINK/MANUAL) →
    // translated display label. Falls back to the raw value for anything unrecognized
    // so unexpected/legacy values still render instead of disappearing.
    const paymentModeLabel = (mode?: string | null): string => {
        if (!mode) return t('common.notAvailable');
        const labels: Record<string, string> = {
            UPI: t('paymentModeLabels.upi'),
            CASH: t('paymentModeLabels.cash'),
            CARD: t('paymentModeLabels.card'),
            CHEQUE: t('paymentModeLabels.cheque'),
            ONLINE: t('paymentModeLabels.online'),
            SEND_LINK: t('paymentModeLabels.sendLink'),
            MANUAL: t('paymentModeLabels.manual'),
        };
        return labels[mode] ?? mode;
    };

    const buildUpiDeepLink = () => {
        const upiVpa = paymentOptionDetails?.upiVpa;
        if (!upiVpa) return '';

        const params = new URLSearchParams();
        params.set('pa', upiVpa);
        if (paymentOptionDetails?.upiPayeeName) params.set('pn', paymentOptionDetails.upiPayeeName);
        if (registrationFee) params.set('am', registrationFee.toFixed(2));
        params.set('cu', registrationFeeCurrency);
        params.set('tn', t('upiDeepLink.paymentNote', { feeName: registrationFeeName }));

        return `upi://pay?${params.toString()}`;
    };

    const generatedUpiDeepLink = buildUpiDeepLink();

    const handleGenerateParentLink = (method: PaymentLinkMethod) => {
        if (!applicantId) {
            toast.error(t('toast.linkRequiresApplication'));
            return;
        }
        if (!paymentOptionId) {
            toast.error(t('toast.paymentOptionNotConfigured'));
            return;
        }

        const link = generatePaymentLink(
            instituteId,
            applicantId,
            paymentOptionId,
            learnerPortalBaseUrl,
            method,
            paymentOptionDetails?.qrCodeFileId
        );
        setGeneratedParentLink(link);
        setLinkEmail(
            formData.fatherInfo?.email || formData.motherInfo?.email || formData.guardianInfo?.email || ''
        );
        setShowEmailInput(false);
        navigator.clipboard.writeText(link);
        toast.success(
            t('toast.linkCopied', {
                method:
                    method === 'ONLINE'
                        ? t('paymentMethodLabel.online')
                        : t('paymentMethodLabel.upi'),
            })
        );
    };

    const handleGenerateUpiDeepLink = () => {
        const deepLink = generatedUpiDeepLink;
        if (!deepLink) {
            toast.error(t('toast.upiNotConfigured'));
            return;
        }
        setGeneratedParentLink(deepLink);
        setLinkEmail(
            formData.fatherInfo?.email || formData.motherInfo?.email || formData.guardianInfo?.email || ''
        );
        setShowEmailInput(false);
        navigator.clipboard.writeText(deepLink);
        toast.success(t('toast.upiLinkCopied'));
    };

    const handleSendLinkEmail = async () => {
        if (!linkEmail.trim() || !generatedParentLink) return;
        setIsSendingLinkEmail(true);
        try {
            const recipientName =
                formData.fatherInfo?.name ||
                formData.motherInfo?.name ||
                formData.guardianInfo?.name ||
                t('defaults.recipientName');
            await sendPaymentLinkEmail(
                linkEmail.trim(),
                recipientName,
                generatedParentLink,
                registrationFeeName,
                registrationFee,
                registrationFeeCurrency,
                getPrimaryColorCode()
            );
            toast.success(t('toast.linkEmailSent'));
            setShowEmailInput(false);
        } catch {
            toast.error(t('toast.linkEmailFailed'));
        } finally {
            setIsSendingLinkEmail(false);
        }
    };

    const generateTxnId = () => {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        setManualTxnId(`RCPT-${ts}-${rand}`);
    };

    const handleProofUpload = async (file: File) => {
        setProofPreviewUrl(URL.createObjectURL(file));
        const fileId = await UploadFileInS3(
            file,
            setIsUploadingProof,
            applicantId ?? '',
            'INSTITUTE',
            applicantId ?? '',
            true
        );
        if (fileId) {
            setProofFileId(fileId);
            toast.success(t('toast.proofUploaded'));
        } else {
            toast.error(t('toast.proofUploadFailed'));
            setProofPreviewUrl('');
        }
    };

    const handleConfirmPayment = async () => {
        if (!applicantId) {
            toast.error(t('toast.applicationNotSubmitted'));
            return;
        }
        if (!manualTxnId.trim()) {
            toast.warning(t('toast.enterTransactionId'));
            return;
        }
        if (!paymentOptionId) {
            toast.error(t('toast.paymentOptionNotConfigured'));
            return;
        }
        setIsSubmitting(true);
        try {
            const email = formData.fatherInfo?.email || formData.motherInfo?.email || '';
            const receipt = await initiateManualPayment(applicantId, paymentOptionId, {
                vendor: 'MANUAL',
                amount: registrationFee,
                currency: registrationFeeCurrency,
                email,
                payment_type: 'APPLICATION_FEE',
                manual_request: {
                    file_id: proofFileId || null,
                    transaction_id: manualTxnId.trim(),
                },
            });
            if (receipt) {
                setReceiptData(receipt);
            }
            updateFormData({
                feeStatus: 'PAID',
                paymentMode: selectedPaymentMethod as string,
                transactionId: manualTxnId.trim(),
                paymentDate: new Date().toISOString().split('T')[0],
            });
            toast.success(t('toast.paymentRecorded'));
        } catch {
            toast.error(t('toast.paymentRecordFailed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectMethod = (method: PaymentMethod) => {
        setSelectedPaymentMethod(method);
        setManualTxnId('');
        setProofFileId('');
        setProofPreviewUrl('');
        if (method !== 'SEND_LINK') {
            updateFormData({ paymentMode: method });
        }
    };

    // ─── PAID state ─────────────────────────────────────────────────
    if (isPaid) {
        return (
            <div className="space-y-6">
                {/* Success banner */}
                <div className="overflow-hidden rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 shadow-sm">
                    <div className="flex items-center gap-4 p-5">
                        <div className="flex size-12 items-center justify-center rounded-full bg-green-100">
                            <span className="text-2xl">✅</span>
                        </div>
                        <div>
                            <h4 className="text-base font-semibold text-green-800">
                                {t('paid.title')}
                            </h4>
                            <p className="text-sm text-green-600">
                                {t('paid.summaryLine', {
                                    amount: `${currencySymbol}${registrationFee}`,
                                    mode: paymentModeLabel(formData.paymentMode),
                                    date: formData.paymentDate || t('paid.todayFallback'),
                                })}
                            </p>
                            {formData.transactionId && (
                                <p className="mt-0.5 font-mono text-xs text-green-500">
                                    {t('paid.refLabel', { transactionId: formData.transactionId })}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="border-t border-green-200 px-5 py-3">
                        <button
                            onClick={() => {
                                setReceiptData(null);
                                updateFormData({ feeStatus: 'PENDING' });
                            }}
                            className="text-xs text-green-600 underline underline-offset-2 hover:text-green-700"
                        >
                            {t('paid.undoButton')}
                        </button>
                    </div>
                </div>

                {/* Receipt card — always shown after payment */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {/* Receipt header */}
                    <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-6 py-4">
                        <div>
                            <p className="text-caption font-semibold uppercase tracking-wider text-gray-500">
                                {t('receipt.receiptNoLabel')}
                            </p>
                            <p className="text-sm text-gray-800">
                                {receiptData?.receipt_number ?? t('common.notAvailable')}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-caption font-semibold uppercase tracking-wider text-gray-500">
                                {t('receipt.dateLabel')}
                            </p>
                            <p className="text-sm text-gray-800">
                                {receiptData?.receipt_date ?? formData.paymentDate ?? t('common.notAvailable')}
                            </p>
                        </div>
                    </div>

                    {/* Receipt details */}
                    <div className="px-6 py-4 space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">{t('receipt.studentLabel')}</span>
                            <span className="font-extrabold text-lg text-gray-800">
                                {formData.studentName || t('common.notAvailable')}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">{t('receipt.feeDescriptionLabel')}</span>
                            <span className="font-medium text-gray-800">
                                {receiptData?.fee_description ?? registrationFeeName}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">{t('receipt.paymentModeLabel')}</span>
                            <span className="font-medium text-gray-800">
                                {paymentModeLabel(receiptData?.payment_mode ?? formData.paymentMode)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">{t('receipt.transactionIdLabel')}</span>
                            <span className="font-mono text-gray-800">
                                {receiptData?.transaction_id ?? formData.transactionId ?? t('common.notAvailable')}
                            </span>
                        </div>
                    </div>

                    {/* Amount */}
                    <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50/60 px-6 py-4">
                        <span className="text-sm font-semibold text-gray-700">{t('receipt.amountPaidLabel')}</span>
                        <span className="text-xl font-extrabold text-emerald-700">
                            {currencySymbol}{' '}
                            {receiptData?.amount_paid != null
                                ? typeof receiptData.amount_paid === 'number'
                                    ? receiptData.amount_paid.toLocaleString('en-IN')
                                    : receiptData.amount_paid
                                : registrationFee.toLocaleString('en-IN')}
                        </span>
                    </div>

                    {/* Download button */}
                    {receiptData?.download_url && (
                        <div className="border-t border-gray-100 px-6 py-4">
                            <a
                                href={receiptData.download_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                            >
                                <DownloadSimple size={16} weight="bold" />
                                {t('receipt.downloadButton')}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ─── PENDING state ──────────────────────────────────────────────
    return (
        <div className="space-y-5">
            {/* ── Page Header ───────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-xl font-bold text-neutral-900">{t('header.title')}</h2>
                    <p className="mt-1 text-sm text-neutral-500">
                        {t('header.subtitle')}
                    </p>
                </div>
            </div>

            {/* ── Invoice Card ──────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                {/* Invoice header */}
                <div className="flex items-center gap-3.5 border-b border-dashed border-neutral-200 px-6 py-5">
                    <div className="flex size-11 items-center justify-center rounded-lg bg-gradient-to-br from-primary-600 to-primary-400">
                        <CardholderIcon className="text-white" weight="bold" />
                    </div>
                    <div>
                        <h3 className="text-subtitle font-semibold text-neutral-900">{t('invoice.title')}</h3>
                    </div>
                </div>

                {/* Line items */}
                <div className="px-6 py-5">
                    <div className="flex items-center justify-between border-b border-neutral-100 py-2.5 text-sm">
                        <span className="text-neutral-500">{registrationFeeName}</span>
                        <span className="font-medium text-neutral-900">
                            {currencySymbol} {registrationFee.toFixed(2)}
                        </span>
                    </div>
                    <div className="flex items-center justify-between border-b border-neutral-100 py-2.5 text-sm">
                        <span className="text-neutral-500">{t('invoice.gstLabel')}</span>
                        <span className="font-medium text-neutral-900">₹ 0.00</span>
                    </div>
                    <div className="flex items-center justify-between py-2.5 text-sm">
                        <span className="text-neutral-500">{t('invoice.processingChargeLabel')}</span>
                        <span className="font-medium text-green-600">{t('invoice.waivedLabel')}</span>
                    </div>
                </div>

                {/* Total row */}
                <div className="flex items-center justify-between border-t border-dashed border-primary-200 bg-primary-50/60 px-6 py-4">
                    <span className="text-sm font-semibold text-primary-700">{t('invoice.totalDueLabel')}</span>
                    <span className="text-2xl font-bold tracking-tight text-primary-700">
                        {currencySymbol} {registrationFee}
                    </span>
                </div>
            </div>

            {/* ── Tab Toggle ────────────────────────────────────────── */}
            <div className="flex rounded-lg border border-primary-200 bg-primary-50 p-1">
                <button
                    type="button"
                    onClick={() => setActiveTab('pay')}
                    className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                        activeTab === 'pay'
                            ? 'bg-white text-primary-700 shadow-sm'
                            : 'text-primary-400 hover:text-primary-600'
                    }`}
                >
                    {t('tabs.payNow')}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('link')}
                    className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                        activeTab === 'link'
                            ? 'bg-white text-primary-700 shadow-sm'
                            : 'text-primary-400 hover:text-primary-600'
                    }`}
                >
                    {t('tabs.generateLink')}
                </button>
            </div>

            {activeTab === 'pay' && (
                <>
                    {/* ── Payment Methods ───────────────────────────────────── */}
                    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                            {t('methods.sectionTitle')}
                        </h4>

                        {/* Secondary grid */}
                        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                            {[
                                {
                                    value: 'UPI' as PaymentMethod,
                                    label: t('methods.upi.label'),
                                    desc: t('methods.upi.desc'),
                                },
                                {
                                    value: 'CASH' as PaymentMethod,
                                    label: t('methods.cash.label'),
                                    desc: t('methods.cash.desc'),
                                },
                            ].map(({ value, label, desc }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => selectMethod(value)}
                                    className={`relative flex flex-col items-center gap-1.5 rounded-lg border-2 p-4 text-center transition-all duration-200 ${
                                        selectedPaymentMethod === value
                                            ? 'border-primary-400 bg-primary-50 shadow-sm ring-2 ring-primary-200'
                                            : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
                                    }`}
                                >
                                    <span
                                        className={`text-xs font-semibold ${
                                            selectedPaymentMethod === value
                                                ? 'text-primary-700'
                                                : 'text-neutral-800'
                                        }`}
                                    >
                                        {label}
                                    </span>
                                    <span className="text-caption text-neutral-500">{desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {(['CASH'] as PaymentMethod[]).includes(
                        selectedPaymentMethod as PaymentMethod
                    ) && (
                        <div className="rounded-xl border border-neutral-200 p-5 shadow-sm">
                            <h4 className="mb-4 text-sm font-semibold">
                                {selectedPaymentMethod === 'CASH' && t('cashPanel.title')}
                            </h4>
                            <div className="mb-4 flex items-center justify-between rounded-lg border bg-white p-2">
                                <span className="text-sm font-medium text-neutral-700">
                                    {t('cashPanel.amountToReceiveLabel')}
                                </span>
                                <span className="text-xl font-bold text-green-700">
                                    {currencySymbol} {registrationFee.toLocaleString('en-IN')}
                                </span>
                            </div>

                            <div className="space-y-4">
                                {/* Proof upload */}
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-neutral-600">
                                        {t('cashPanel.proofLabel')}{' '}
                                        <span className="text-neutral-400">
                                            (
                                            {selectedPaymentMethod === 'CHEQUE'
                                                ? t('cashPanel.proofHintCheque')
                                                : t('cashPanel.proofHintReceipt')}
                                            )
                                        </span>
                                    </label>
                                    <input
                                        ref={proofInputRef}
                                        type="file"
                                        accept="image/*,application/pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleProofUpload(file);
                                        }}
                                    />
                                    {proofPreviewUrl ? (
                                        <div className="relative inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                                            <img
                                                src={proofPreviewUrl}
                                                alt="Proof"
                                                className="size-16 rounded object-cover"
                                            />
                                            {isUploadingProof && (
                                                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                                                    <span className="size-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setProofPreviewUrl('');
                                                    setProofFileId('');
                                                }}
                                                className="ml-1 text-xs text-red-500 hover:underline"
                                            >
                                                {t('common.remove')}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => proofInputRef.current?.click()}
                                            className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-neutral-400 hover:bg-neutral-100"
                                        >
                                            {t('cashPanel.uploadProofButton')}
                                        </button>
                                    )}
                                </div>

                                {/* Transaction ID + Generate */}
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-neutral-600">
                                        {selectedPaymentMethod === 'CHEQUE'
                                            ? t('cashPanel.txnLabelCheque')
                                            : t('cashPanel.txnLabelReceipt')}{' '}
                                        <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                            placeholder={
                                                selectedPaymentMethod === 'CHEQUE'
                                                    ? t('cashPanel.placeholderCheque')
                                                    : selectedPaymentMethod === 'CASH'
                                                      ? t('cashPanel.placeholderCash')
                                                      : t('cashPanel.placeholderDefault')
                                            }
                                            value={manualTxnId}
                                            onChange={(e) => setManualTxnId(e.target.value)}
                                        />
                                        {selectedPaymentMethod !== 'CHEQUE' && (
                                            <button
                                                type="button"
                                                onClick={generateTxnId}
                                                className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-600 transition hover:border-neutral-400 hover:bg-neutral-50"
                                            >
                                                {t('common.generateButton')}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center justify-end">
                                    <MyButton
                                        disabled={isSubmitting || isUploadingProof}
                                        onClick={handleConfirmPayment}
                                    >
                                        {isSubmitting ? (
                                            <span className="flex items-center gap-2">
                                                <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                {t('common.recordingEllipsis')}
                                            </span>
                                        ) : (
                                            t('common.confirmPaymentButton')
                                        )}
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── UPI / QR Code Detail ──────────────────────────────── */}
                    {selectedPaymentMethod === 'UPI' && (
                        <div className="rounded-xl border p-5 shadow-sm">
                            <h4 className="mb-3 text-sm font-semibold">{t('upiPanel.title')}</h4>
                            <div className="flex gap-6">
                                {/* QR Code image */}
                                {qrImageUrl ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowQrOverlay(true)}
                                        className="group relative flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-purple-300 bg-white shadow-sm transition hover:border-purple-400"
                                        title={t('upiPanel.clickToEnlargeTitle')}
                                    >
                                        <img
                                            src={qrImageUrl}
                                            alt="Payment QR Code"
                                            className="size-full object-contain p-1"
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-xs font-medium text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                                            {t('upiPanel.openHoverLabel')}
                                        </span>
                                    </button>
                                ) : (
                                    <div className="flex size-36 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-purple-300 bg-white px-2 text-center">
                                        {paymentOptionDetails?.upiVpa ? (
                                            <>
                                                {generatedUpiDeepLink && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowQrOverlay(true)}
                                                        className="mt-1 rounded-md border border-purple-100 bg-white p-1 transition hover:border-purple-300"
                                                        title={t('upiPanel.openLargeQrTitle')}
                                                    >
                                                        <QRCodeSVG
                                                            value={generatedUpiDeepLink}
                                                            size={88}
                                                            level="M"
                                                            includeMargin
                                                        />
                                                    </button>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <p className="mt-1 text-caption font-medium text-purple-500">
                                                    {t('upiPanel.qrCodeLabel')}
                                                </p>
                                                <p className="text-caption text-purple-400">
                                                    {t('upiPanel.notConfiguredLabel')}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                )}
                                <div className="flex-1 space-y-3">
                                    {/* Proof upload */}
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-neutral-600">
                                            {t('upiPanel.proofLabel')}{' '}
                                            <span className="text-neutral-400">{t('common.optionalLabel')}</span>
                                        </label>
                                        <input
                                            ref={proofInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleProofUpload(file);
                                            }}
                                        />
                                        {proofPreviewUrl ? (
                                            <div className="relative inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                                                <img
                                                    src={proofPreviewUrl}
                                                    alt="Proof"
                                                    className="size-16 rounded object-cover"
                                                />
                                                {isUploadingProof && (
                                                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                                                        <span className="size-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setProofPreviewUrl('');
                                                        setProofFileId('');
                                                    }}
                                                    className="ml-1 text-xs text-red-500 hover:underline"
                                                >
                                                    {t('common.remove')}
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => proofInputRef.current?.click()}
                                                className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-500 transition hover:border-neutral-400 hover:bg-neutral-100"
                                            >
                                                {t('upiPanel.uploadImageButton')}
                                            </button>
                                        )}
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-neutral-600">
                                            {t('upiPanel.transactionIdLabel')}
                                            <span className="text-red-500">*</span>
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
                                                placeholder={t('upiPanel.transactionIdPlaceholder')}
                                                value={manualTxnId}
                                                onChange={(e) => setManualTxnId(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={generateTxnId}
                                                className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-600 transition hover:border-neutral-400 hover:bg-neutral-50"
                                            >
                                                {t('common.generateButton')}
                                            </button>
                                        </div>
                                    </div>

                                    <MyButton
                                        disabled={isSubmitting || isUploadingProof}
                                        onClick={handleConfirmPayment}
                                    >
                                        {isSubmitting ? (
                                            <span className="flex items-center gap-2">
                                                <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                {t('common.recordingEllipsis')}
                                            </span>
                                        ) : (
                                            <>{t('common.confirmPaymentButton')}</>
                                        )}
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Generate Link for Parent ──────────────────────────── */}
            {activeTab === 'link' && applicantId && (
                <div className="rounded-xl border bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                        <div>
                            <h4 className="text-sm font-semibold">
                                {t('linkTab.title')}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                                {t('linkTab.subtitle')}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => handleGenerateParentLink('ONLINE')}
                            className="flex items-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-4 py-2 text-sm font-medium  transition hover:bg-primary-100"
                        >
                            <GlobeIcon className="size-4" weight="bold" />
                            {t('linkTab.onlineLinkButton')}
                        </button>

                        <button
                            type="button"
                            onClick={handleGenerateUpiDeepLink}
                            disabled={!paymentOptionDetails?.upiVpa}
                            title={
                                !paymentOptionDetails?.upiVpa
                                    ? t('linkTab.configureUpiTitle')
                                    : undefined
                            }
                            className="flex items-center gap-2 rounded-lg border border-primary-300 bg-primary-50 px-4 py-2 text-sm font-medium transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <ArrowSquareOut className="size-4" weight="bold" />
                            {t('linkTab.upiAppLinkButton')}
                        </button>
                    </div>

                    {generatedParentLink && (
                        <div className="mt-5 rounded-xl border border-primary-200 bg-primary-50/40 p-4">
                            <p className="flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-primary-700">
                                {t('linkTab.scanQrLabel')}
                            </p>
                            <div className="mt-3 flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start sm:gap-4">
                                <div className="rounded-lg border border-primary-100 bg-white p-2">
                                    <QRCodeSVG
                                        value={generatedParentLink}
                                        size={156}
                                        level="M"
                                        includeMargin
                                    />
                                </div>
                            </div>

                            {/* Send via Email */}
                            <div className="mt-4 border-t border-primary-200 pt-4">
                                {!showEmailInput ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowEmailInput(true)}
                                        className="flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800 transition"
                                    >
                                        <EnvelopeSimple size={16} weight="bold" />
                                        {t('linkTab.sendViaEmailButton')}
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="email"
                                            value={linkEmail}
                                            onChange={(e) => setLinkEmail(e.target.value)}
                                            placeholder={t('linkTab.emailPlaceholder')}
                                            className="h-9 text-sm flex-1"
                                            disabled={isSendingLinkEmail}
                                        />
                                        <button
                                            type="button"
                                            onClick={handleSendLinkEmail}
                                            disabled={!linkEmail.trim() || isSendingLinkEmail}
                                            className="flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                                        >
                                            {isSendingLinkEmail ? (
                                                <>
                                                    <SpinnerGap size={14} className="animate-spin" />
                                                    {t('linkTab.sendingEllipsis')}
                                                </>
                                            ) : (
                                                <>
                                                    <EnvelopeSimple size={14} weight="bold" />
                                                    {t('linkTab.sendButton')}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── QR Code Dialog Overlay ─────────────────────────── */}
            <Dialog open={showQrOverlay} onOpenChange={setShowQrOverlay}>
                <DialogContent className="w-full max-w-sm rounded-2xl p-6">
                    <p className="mb-4 text-center text-sm font-semibold text-neutral-700">
                        {t('qrDialog.scanToPayLabel', {
                            amount: `${currencySymbol}${registrationFee}`,
                        })}
                    </p>
                    {qrImageUrl && (
                        <img
                            src={qrImageUrl}
                            alt="Payment QR Code"
                            className="mx-auto max-h-96 max-w-96 rounded-lg object-contain"
                        />
                    )}
                    {!qrImageUrl && generatedUpiDeepLink && (
                        <div className="mx-auto w-fit rounded-lg border border-purple-100 bg-white p-2">
                            <QRCodeSVG
                                value={generatedUpiDeepLink}
                                size={256}
                                level="M"
                                includeMargin
                            />
                        </div>
                    )}
                    {!qrImageUrl && paymentOptionDetails?.upiVpa && (
                        <p className="mt-3 text-center text-xs font-medium text-neutral-600">
                            {t('qrDialog.upiIdLabel', { upiId: paymentOptionDetails.upiVpa })}
                        </p>
                    )}
                    <p className="mt-3 text-center text-xs text-neutral-400">
                        {t('qrDialog.closeHint')}
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );
};
