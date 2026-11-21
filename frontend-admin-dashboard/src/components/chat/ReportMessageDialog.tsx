import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createReport, type ChatMessageResponse } from '@/services/chat/chatApi';

/**
 * The API stores `reason` as an enum (anything else is silently coerced to OTHER) and keeps the
 * free-text explanation in `details`. Sending the typed sentence as `reason` — which is what the
 * inline dialog used to do — landed every report in the queue as a bare "OTHER" with the reviewer's
 * only context thrown away, so the two fields are collected separately here.
 */
const REASONS = [
    { value: 'SPAM', label: 'Spam or advertising' },
    { value: 'ABUSE', label: 'Abusive language' },
    { value: 'HARASSMENT', label: 'Harassment or bullying' },
    { value: 'INAPPROPRIATE', label: 'Inappropriate content' },
    { value: 'OTHER', label: 'Something else' },
] as const;

interface ReportMessageDialogProps {
    /** The message being reported; null closes the dialog. */
    target: ChatMessageResponse | null;
    conversationId?: string;
    onClose: () => void;
}

export function ReportMessageDialog({ target, conversationId, onClose }: ReportMessageDialogProps) {
    const [reason, setReason] = useState<string>('SPAM');
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Reset per target so a previous report's text never carries into the next one.
    useEffect(() => {
        if (target) {
            setReason('SPAM');
            setDetails('');
        }
    }, [target]);

    const submit = async () => {
        const targetConversationId = conversationId ?? target?.conversationId;
        if (!target || !targetConversationId) return;
        if (reason === 'OTHER' && !details.trim()) {
            toast.error('Please describe the issue.');
            return;
        }
        setSubmitting(true);
        try {
            await createReport({
                conversationId: targetConversationId,
                messageId: target.id,
                reason,
                details: details.trim() || undefined,
            });
            toast.success('Report submitted for review.');
            onClose();
        } catch {
            toast.error('Failed to submit the report.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={target !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="w-full max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold text-neutral-700">
                        Report message
                    </DialogTitle>
                </DialogHeader>

                {target && (
                    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <div className="text-xs font-semibold text-neutral-500">
                            {target.senderName || 'Member'}
                        </div>
                        <p className="line-clamp-3 text-sm text-neutral-600">
                            {target.content || target.attachmentName || 'Attachment'}
                        </p>
                    </div>
                )}

                <div className="space-y-3 py-1">
                    <span className="text-sm font-medium text-neutral-600">
                        Why are you reporting this message?
                    </span>
                    <RadioGroup value={reason} onValueChange={setReason} className="gap-2">
                        {REASONS.map((r) => (
                            <div key={r.value} className="flex items-center gap-2">
                                <RadioGroupItem value={r.value} id={`chat-report-${r.value}`} />
                                <Label
                                    htmlFor={`chat-report-${r.value}`}
                                    className="text-sm font-normal text-neutral-600"
                                >
                                    {r.label}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>

                    <div className="space-y-1">
                        <Label
                            htmlFor="chat-report-details"
                            className="text-sm font-medium text-neutral-600"
                        >
                            Details {reason === 'OTHER' ? '' : '(optional)'}
                        </Label>
                        <Textarea
                            id="chat-report-details"
                            rows={3}
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            placeholder="Add anything the reviewer should know..."
                        />
                    </div>
                </div>

                <DialogFooter>
                    <MyButton buttonType="secondary" onClick={onClose}>
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disabled={submitting}
                        onClick={() => void submit()}
                    >
                        {submitting ? 'Submitting...' : 'Submit report'}
                    </MyButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
