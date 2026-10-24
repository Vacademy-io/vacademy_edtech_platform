import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

interface ConfirmPaymentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    studentName: string;
    amount: number;
    installmentCount: number;
    paymentMode?: string;
    transactionId?: string;
    isSubmitting: boolean;
    onConfirm: () => void;
}

export function ConfirmPaymentDialog({
    open,
    onOpenChange,
    studentName,
    amount,
    installmentCount,
    paymentMode,
    transactionId,
    isSubmitting,
    onConfirm,
}: ConfirmPaymentDialogProps) {
    const { t } = useTranslation('financialManagementConfirmPaymentDialog');
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md rounded-xl p-0 overflow-hidden">
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
                    <DialogTitle className="text-lg font-bold text-gray-800">
                        {t('title')}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-sm text-gray-500">
                        {t('description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="px-6 py-5 space-y-4">
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">{t('student')}</span>
                            <span className="font-semibold text-gray-800">{studentName}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">{t('installments')}</span>
                            <span className="font-semibold text-gray-800">
                                {installmentCount}
                            </span>
                        </div>
                        {paymentMode && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">{t('paymentMode')}</span>
                                <span className="font-semibold text-gray-800">
                                    {paymentMode}
                                </span>
                            </div>
                        )}
                        {transactionId && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-500">{t('transactionId')}</span>
                                <span className="font-semibold text-gray-800">
                                    {transactionId}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">{t('amount')}</span>
                            <span className="font-bold text-lg text-blue-600">
                                {formatCurrency(amount)}
                            </span>
                        </div>
                    </div>

                    <p className="text-xs text-gray-400">
                        {t('distributionNote')}
                    </p>
                </div>

                <div className="flex gap-3 px-6 pb-6">
                    <button
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {isSubmitting ? t('processing') : t('confirmPayment')}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
