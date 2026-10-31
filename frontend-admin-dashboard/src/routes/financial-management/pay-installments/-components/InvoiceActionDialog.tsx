import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DownloadSimple, EnvelopeSimple, SpinnerGap } from '@phosphor-icons/react';

interface InvoiceActionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    studentName: string;
    studentEmail: string | null;
    isGenerating: boolean;
    isSendingEmail: boolean;
    onDownload: () => void;
    onSendEmail: (email: string) => void;
}

export function InvoiceActionDialog({
    open,
    onOpenChange,
    studentName,
    studentEmail,
    isGenerating,
    isSendingEmail,
    onDownload,
    onSendEmail,
}: InvoiceActionDialogProps) {
    const { t } = useTranslation('financialManagementInvoiceActionDialog');
    const [email, setEmail] = useState(studentEmail || '');
    const [showEmailInput, setShowEmailInput] = useState(false);

    const isBusy = isGenerating || isSendingEmail;

    const handleSendEmail = () => {
        if (!email.trim()) return;
        onSendEmail(email.trim());
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!isBusy) {
                    onOpenChange(v);
                    if (!v) setShowEmailInput(false);
                }
            }}
        >
            <DialogContent className="max-w-sm rounded-xl p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
                    <DialogTitle className="text-lg font-bold text-gray-800">
                        {t('title')}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-sm text-gray-500">
                        {t('invoiceFor')} <strong>{studentName}</strong>
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-5 space-y-3">
                    {/* Download Invoice */}
                    <button
                        onClick={onDownload}
                        disabled={isBusy}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isGenerating ? (
                            <SpinnerGap size={20} className="animate-spin text-blue-600" />
                        ) : (
                            <DownloadSimple size={20} weight="bold" className="text-blue-600" />
                        )}
                        {isGenerating ? t('generating') : t('downloadInvoice')}
                    </button>

                    {/* Send via Email */}
                    {!showEmailInput ? (
                        <button
                            onClick={() => setShowEmailInput(true)}
                            disabled={isBusy}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <EnvelopeSimple size={20} weight="bold" className="text-emerald-600" />
                            {t('sendInvoiceViaEmail')}
                        </button>
                    ) : (
                        <div className="space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <label className="text-xs font-medium text-gray-500">
                                {t('recipientEmail')}
                            </label>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="student@example.com"
                                className="h-9 text-sm"
                                disabled={isBusy}
                            />
                            <button
                                onClick={handleSendEmail}
                                disabled={!email.trim() || isBusy}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isSendingEmail ? (
                                    <>
                                        <SpinnerGap size={16} className="animate-spin" />
                                        {t('sending')}
                                    </>
                                ) : (
                                    <>
                                        <EnvelopeSimple size={16} weight="bold" />
                                        {t('sendEmail')}
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
