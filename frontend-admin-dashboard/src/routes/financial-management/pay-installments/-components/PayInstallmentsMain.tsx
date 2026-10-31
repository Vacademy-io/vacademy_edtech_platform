import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { StudentFeePaymentRowDTO, StudentFeeDueDTO } from '@/types/manage-finances';
import { AllocatePaymentResponse } from '@/services/manage-finances';
import { StudentSearchStep } from './StudentSearchStep';
import { InstallmentSelectionStep } from './InstallmentSelectionStep';
import { PaymentDetailsStep } from './PaymentDetailsStep';
import { PaymentSuccessStep } from './PaymentSuccessStep';

type WizardStep = 'search' | 'select' | 'payment' | 'success';

function buildSteps(t: TFunction): { key: WizardStep; label: string }[] {
    return [
        { key: 'search', label: t('steps.searchStudent') },
        { key: 'select', label: t('steps.selectInstallments') },
        { key: 'payment', label: t('steps.paymentDetails') },
        { key: 'success', label: t('steps.done') },
    ];
}

export function PayInstallmentsMain() {
    const { t } = useTranslation('financialManagementPayInstallmentsMain');
    const STEPS = buildSteps(t);
    const [step, setStep] = useState<WizardStep>('search');
    const [selectedStudent, setSelectedStudent] = useState<StudentFeePaymentRowDTO | null>(null);
    const [selectedDues, setSelectedDues] = useState<StudentFeeDueDTO[]>([]);
    const [paidAmount, setPaidAmount] = useState<number>(0);
    const [receipt, setReceipt] = useState<AllocatePaymentResponse | undefined>();

    const handleSelectStudent = (student: StudentFeePaymentRowDTO) => {
        setSelectedStudent(student);
        setStep('select');
    };

    const handleProceedToPayment = (dues: StudentFeeDueDTO[]) => {
        setSelectedDues(dues);
        setStep('payment');
    };

    const handlePaymentSuccess = (amount: number, receiptData?: AllocatePaymentResponse) => {
        setPaidAmount(amount);
        setReceipt(receiptData);
        setStep('success');
    };

    const handleBackToSelect = () => {
        setStep('select');
    };

    const handleReset = () => {
        setSelectedStudent(null);
        setSelectedDues([]);
        setPaidAmount(0);
        setReceipt(undefined);
        setStep('search');
    };

    const stepIndex = STEPS.findIndex((s) => s.key === step);

    return (
        <div className="flex flex-col gap-6 flex-1 min-h-0">
            {/* Step Indicator */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-body font-medium shadow-sm">
                {STEPS.map((s, idx) => (
                    <div key={s.key} className="flex items-center gap-3">
                        {idx > 0 && (
                            <span
                                className={cn(
                                    'h-px w-8',
                                    idx <= stepIndex ? 'bg-success-300' : 'bg-neutral-200'
                                )}
                            />
                        )}
                        <span
                            className={cn(
                                'flex items-center gap-1.5',
                                idx === stepIndex
                                    ? 'text-primary-600'
                                    : idx < stepIndex
                                      ? 'text-neutral-500'
                                      : 'text-neutral-400'
                            )}
                        >
                            <span
                                className={cn(
                                    'flex size-6 items-center justify-center rounded-full text-caption font-bold',
                                    idx === stepIndex
                                        ? 'bg-primary-500 text-white'
                                        : idx < stepIndex
                                          ? 'bg-success-500 text-white'
                                          : 'bg-neutral-100 text-neutral-400'
                                )}
                            >
                                {idx < stepIndex ? <Check size={12} weight="bold" /> : idx + 1}
                            </span>
                            {s.label}
                        </span>
                    </div>
                ))}
            </div>

            {/* Step Content */}
            {step === 'search' && <StudentSearchStep onSelectStudent={handleSelectStudent} />}
            {step === 'select' && selectedStudent && (
                <InstallmentSelectionStep
                    student={selectedStudent}
                    onBack={handleReset}
                    onProceedToPayment={handleProceedToPayment}
                />
            )}
            {step === 'payment' && selectedStudent && selectedDues.length > 0 && (
                <PaymentDetailsStep
                    student={selectedStudent}
                    selectedDues={selectedDues}
                    onBack={handleBackToSelect}
                    onSuccess={handlePaymentSuccess}
                />
            )}
            {step === 'success' && selectedStudent && (
                <PaymentSuccessStep
                    studentName={selectedStudent.student_name}
                    receipt={receipt}
                    onPayAnother={handleReset}
                />
            )}
        </div>
    );
}
