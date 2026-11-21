import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CaretRight } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useOfflinePaymentModes } from '@/services/offline-payment-modes';

interface RecordPaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const APPLIES_TO = ['Installment', 'Registration fee', 'Custom line item'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="text-caption font-medium text-neutral-600">{label}</label>
            {children}
        </div>
    );
}

function PillGroup({
    options,
    value,
    onChange,
}: {
    options: string[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((opt) => (
                <button
                    key={opt}
                    type="button"
                    onClick={() => onChange(opt)}
                    className={cn(
                        'rounded-full border px-3 py-1 text-caption font-medium transition-colors',
                        value === opt
                            ? 'border-primary-500 bg-primary-50 text-primary-600'
                            : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                    )}
                >
                    {opt}
                </button>
            ))}
        </div>
    );
}

/**
 * Two-step manual/offline payment recorder (cash, cheque, bank transfer collected offline). Front-end
 * only for now — recording against a learner's installment plan needs plan context that this list
 * view doesn't carry, so submitting confirms the entry without posting it.
 */
export function RecordPaymentModal({ open, onOpenChange }: RecordPaymentModalProps) {
    const [step, setStep] = useState(1);
    const [student, setStudent] = useState('');
    const [appliesTo, setAppliesTo] = useState(APPLIES_TO[0]!);
    const [amount, setAmount] = useState('');
    // The institute's own offline modes from Settings (custom ones included), not a fixed list.
    const { data: offlineModes } = useOfflinePaymentModes();
    const methods = useMemo(
        () => (offlineModes?.modes ?? []).filter((m) => m.active).map((m) => m.label),
        [offlineModes]
    );
    const defaultCode = offlineModes?.default_mode;
    const defaultMethod =
        (offlineModes?.modes ?? []).find((m) => m.active && m.code === defaultCode)?.label ??
        methods[0] ??
        '';
    const [pickedMethod, setMethod] = useState('');
    const method = pickedMethod || defaultMethod;
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');

    const reset = () => {
        setStep(1);
        setStudent('');
        setAppliesTo(APPLIES_TO[0]!);
        setAmount('');
        setMethod('');
        setReference('');
        setNote('');
    };

    const close = (o: boolean) => {
        if (!o) reset();
        onOpenChange(o);
    };

    const handlePrimary = () => {
        if (step === 1) {
            setStep(2);
            return;
        }
        close(false);
        toast.success('Manual payment recorded' + (student ? ` for ${student}` : ''));
    };

    return (
        <MyDialog
            heading={step === 1 ? 'Record a manual payment' : 'Amount & receipt'}
            open={open}
            onOpenChange={close}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex w-full items-center justify-between gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={() => close(false)}>
                        Cancel
                    </MyButton>
                    <div className="flex gap-2">
                        {step === 2 && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setStep(1)}
                            >
                                Back
                            </MyButton>
                        )}
                        <MyButton buttonType="primary" scale="medium" onClick={handlePrimary}>
                            {step === 1 ? 'Continue' : 'Record payment'}
                        </MyButton>
                    </div>
                </div>
            }
        >
            <div className="space-y-4 p-5">
                {/* Step indicator */}
                <div className="flex items-center gap-2 text-caption font-medium text-neutral-400">
                    <span className={cn(step === 1 && 'text-neutral-800')}>
                        1. Student &amp; plan
                    </span>
                    <CaretRight size={12} />
                    <span className={cn(step === 2 && 'text-neutral-800')}>
                        2. Amount &amp; receipt
                    </span>
                </div>

                {step === 1 ? (
                    <>
                        <Field label="Student">
                            <MyInput
                                inputType="text"
                                input={student}
                                onChangeFunction={(e) => setStudent(e.target.value)}
                                inputPlaceholder="Search by name, email or phone"
                            />
                        </Field>
                        <Field label="Applies to">
                            <PillGroup
                                options={APPLIES_TO}
                                value={appliesTo}
                                onChange={setAppliesTo}
                            />
                        </Field>
                        <p className="rounded-lg bg-neutral-50 p-3 text-caption text-neutral-500">
                            Recording a payment updates the learner&apos;s plan status
                            automatically.
                        </p>
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Amount received">
                                <MyInput
                                    inputType="text"
                                    input={amount}
                                    onChangeFunction={(e) => setAmount(e.target.value)}
                                    inputPlaceholder="0"
                                />
                            </Field>
                            <Field label="Date received">
                                <Input type="date" className="h-9" />
                            </Field>
                        </div>
                        <Field label="Method">
                            <PillGroup options={methods} value={method} onChange={setMethod} />
                        </Field>
                        <Field label="Reference / receipt no.">
                            <MyInput
                                inputType="text"
                                input={reference}
                                onChangeFunction={(e) => setReference(e.target.value)}
                                inputPlaceholder="e.g. NEFT-77120A"
                            />
                        </Field>
                        <Field label="Internal note">
                            <Textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={2}
                                placeholder="Collected at front desk"
                                className="text-body"
                            />
                        </Field>
                    </>
                )}
            </div>
        </MyDialog>
    );
}
