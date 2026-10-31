import { useEffect, useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { REJECT_REASONS } from '../-utils/lead-agent-options';

/** Asks why a lead (or several) is rejected; the reason feeds the agent's learning. */
export function RejectDialog({
    open,
    onOpenChange,
    count,
    pending,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    count: number;
    pending: boolean;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState('');
    const [other, setOther] = useState('');

    useEffect(() => {
        if (open) {
            setReason('');
            setOther('');
        }
    }, [open]);

    const finalReason =
        reason === 'Other' ? (other.trim() ? `Other: ${other.trim()}` : 'Other') : reason;

    return (
        <MyDialog
            heading={count > 1 ? `Reject ${count} leads` : 'Reject lead'}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-3">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        disable={pending}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        disable={!reason || pending}
                        onClick={() => onConfirm(finalReason)}
                    >
                        {pending ? 'Rejecting…' : 'Reject'}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">
                    Why? The agent uses this to find better leads.
                </p>
                <RadioGroup value={reason} onValueChange={setReason} aria-label="Reason">
                    {REJECT_REASONS.map((r) => {
                        const id = `la-reject-${r.replace(/\W+/g, '-').toLowerCase()}`;
                        return (
                            <div key={r} className="flex items-center gap-3">
                                <RadioGroupItem id={id} value={r} />
                                <Label htmlFor={id} className="cursor-pointer text-body">
                                    {r}
                                </Label>
                            </div>
                        );
                    })}
                </RadioGroup>
                {reason === 'Other' && (
                    <MyInput
                        input={other}
                        onChangeFunction={(e) => setOther(e.target.value.slice(0, 250))}
                        inputPlaceholder="Tell us more (optional)"
                        aria-label="Other reason"
                        className="sm:w-full"
                    />
                )}
            </div>
        </MyDialog>
    );
}
