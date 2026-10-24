/**
 * MigrateLeadsDialog — move selected leads into a different lead list.
 *
 * Two decisions, in the order they matter:
 *
 *  1. **Which list.** The current list is excluded (moving somewhere you already are is a no-op).
 *  2. **Whether the target list's automation should run.** This is the consequential one, so it
 *     is a visible choice rather than a hidden default. Workflows pick leads by list plus a date
 *     anchor that is only ever set when a lead is first created, so a move either leaves the lead
 *     out of automation entirely (`PRESERVE`) or re-anchors it and starts the target's sequence
 *     from day zero (`RESET_TO_TARGET`) — which sends real messages to real people.
 *
 * The result is partial by design: merging lists collides routinely, so the dialog reports what
 * moved and what did not rather than pretending the batch is all-or-nothing.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import {
    migrateAudienceLeads,
    MIGRATE_SKIP_LABELS,
    type LeadMigrateResult,
    type LeadWorkflowAnchor,
} from '@/routes/audience-manager/list/-services/migrate-audience-leads';
import { cn } from '@/lib/utils';

interface MigrateLeadsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    /** The responses to move. */
    responseIds: string[];
    /** The list they're currently in, excluded from the picker. Omitted on Recent Leads, where
     *  the selection can span several lists. */
    currentAudienceId?: string | null;
    /** Fired after a move that actually changed something (refetch + clear selection). */
    onSuccess?: (migrated: number) => void;
}

const ANCHOR_OPTIONS: { value: LeadWorkflowAnchor; label: string; hint: string }[] = [
    {
        value: 'PRESERVE',
        label: "Don't start the new list's automation",
        hint: 'The leads move, but no emails, WhatsApp messages or calls are triggered. Use this for fixing a wrong list, archiving, or clearing out junk.',
    },
    {
        value: 'RESET_TO_TARGET',
        label: "Start the new list's automation from day one",
        hint: 'Treats them as if they just joined: the list’s "Lead Submitted" automations fire now (AI calls, instant WhatsApp/email) and its sequence runs from the beginning. This will call and message them — use it for re-engagement campaigns.',
    },
];

export const MigrateLeadsDialog = ({
    open,
    onOpenChange,
    instituteId,
    responseIds,
    currentAudienceId,
    onSuccess,
}: MigrateLeadsDialogProps) => {
    const [targetAudienceId, setTargetAudienceId] = useState('');
    const [workflowAnchor, setWorkflowAnchor] = useState<LeadWorkflowAnchor>('PRESERVE');
    // "From day one" means all of it: the backend re-anchors the scheduled drip AND fires the
    // list's "Lead Submitted" workflows (AI calls, instant messages). Sent explicitly so the
    // request reads the same as the dialog, but the backend implies it from the anchor anyway.
    const runDestinationAutomations = workflowAnchor === 'RESET_TO_TARGET';
    const [result, setResult] = useState<LeadMigrateResult | null>(null);
    // How many leads were sent, captured at submit. The result line can't read
    // responseIds.length: onSuccess clears the parent's selection, so by the time the dialog is
    // held open to show skips the prop is [] and the line read "328 of 0 leads moved".
    const [requestedCount, setRequestedCount] = useState(0);

    // One page of lists, newest first. An institute with more lists than this would not see the
    // oldest ones in the picker — acceptable while the endpoint has no search, but it is the
    // reason this is a generous page size rather than the usual 20.
    const { data: campaigns, isLoading } = useQuery({
        ...handleFetchCampaignsList({
            institute_id: instituteId,
            page: 0,
            size: 500,
            sort_by: 'createdAt',
            sort_direction: 'DESC',
        }),
        enabled: open && !!instituteId,
    });

    // Moving into the list you're already in is a no-op the backend skips anyway; leaving it out
    // of the picker keeps the choice honest.
    const options = useMemo(
        () =>
            (campaigns?.content ?? [])
                .map((c) => ({ id: c.id || c.audience_id || c.campaign_id || '', name: c.campaign_name }))
                .filter((c) => c.id && c.id !== currentAudienceId),
        [campaigns, currentAudienceId]
    );

    const targetName = options.find((o) => o.id === targetAudienceId)?.name;

    const mutation = useMutation({
        mutationFn: () =>
            migrateAudienceLeads({
                responseIds,
                targetAudienceId,
                instituteId,
                workflowAnchor,
                runDestinationAutomations,
            }),
        onSuccess: (res) => {
            setResult(res);
            if (res.migrated > 0) {
                toast.success(
                    res.migrated === 1 ? 'Lead moved' : `${res.migrated} leads moved`
                );
                onSuccess?.(res.migrated);
            }
            // Held open when anything was skipped: the skips are the point of the response, and
            // closing would throw away the only place they're shown.
            if (!res.skipped?.length) {
                handleClose(false);
            }
        },
        onError: (error: unknown) => {
            const message =
                (error as { response?: { data?: { ex?: string; message?: string } } })?.response
                    ?.data?.ex ??
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message ??
                (error as Error)?.message ??
                'Failed to move leads. Please try again.';
            toast.error(message);
        },
    });

    const handleClose = (next: boolean) => {
        if (!next) {
            setTargetAudienceId('');
            setWorkflowAnchor('PRESERVE');
            setResult(null);
            setRequestedCount(0);
        }
        onOpenChange(next);
    };

    // Group the skips so a merge of thousands reports "1,204 already in this list", not 1,204 rows.
    const skipSummary = useMemo(() => {
        const counts = new Map<string, number>();
        (result?.skipped ?? []).forEach((s) => {
            counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
        });
        return Array.from(counts.entries());
    }, [result]);

    return (
        <MyDialog
            heading="Move to another list"
            open={open}
            onOpenChange={handleClose}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => handleClose(false)}
                        disable={mutation.isPending}
                    >
                        {result ? 'Close' : 'Cancel'}
                    </MyButton>
                    {!result && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setRequestedCount(responseIds.length);
                                mutation.mutate();
                            }}
                            disable={mutation.isPending || !targetAudienceId}
                        >
                            {mutation.isPending
                                ? 'Moving…'
                                : `Move ${responseIds.length} lead${responseIds.length === 1 ? '' : 's'}`}
                        </MyButton>
                    )}
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-4">
                {result ? (
                    <div className="flex flex-col gap-3">
                        <p className="text-subtitle font-semibold text-neutral-800">
                            {result.migrated} of {requestedCount} lead
                            {requestedCount === 1 ? '' : 's'} moved
                            {targetName ? ` to ${targetName}` : ''}.
                        </p>
                        {skipSummary.length > 0 && (
                            <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                <p className="text-caption font-medium uppercase tracking-wider text-neutral-500">
                                    Not moved
                                </p>
                                {skipSummary.map(([reason, count]) => (
                                    <span key={reason} className="text-caption text-neutral-700">
                                        · {count} —{' '}
                                        {MIGRATE_SKIP_LABELS[
                                            reason as keyof typeof MIGRATE_SKIP_LABELS
                                        ] ?? reason}
                                    </span>
                                ))}
                                <p className="mt-1 text-caption text-neutral-500">
                                    These leads stayed where they were. Nothing was lost.
                                </p>
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-2">
                            <p className="text-caption font-medium uppercase tracking-wider text-neutral-500">
                                Move to
                            </p>
                            <Select value={targetAudienceId} onValueChange={setTargetAudienceId}>
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={
                                            isLoading ? 'Loading lists…' : 'Select a lead list'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>
                                            {o.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-caption text-neutral-500">
                                Their history — status, follow-ups, calls and notes — moves with
                                them.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <p className="text-caption font-medium uppercase tracking-wider text-neutral-500">
                                Automation
                            </p>
                            <RadioGroup
                                value={workflowAnchor}
                                onValueChange={(v) => setWorkflowAnchor(v as LeadWorkflowAnchor)}
                                className="flex flex-col gap-2"
                            >
                                {ANCHOR_OPTIONS.map((opt) => (
                                    <label
                                        key={opt.value}
                                        htmlFor={`anchor-${opt.value}`}
                                        className={cn(
                                            'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                                            workflowAnchor === opt.value
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200 hover:bg-neutral-50'
                                        )}
                                    >
                                        <RadioGroupItem
                                            value={opt.value}
                                            id={`anchor-${opt.value}`}
                                            className="mt-0.5"
                                        />
                                        <div className="flex flex-col gap-0.5">
                                            <Label className="cursor-pointer text-body font-medium text-neutral-800">
                                                {opt.label}
                                            </Label>
                                            <span className="text-caption text-neutral-500">
                                                {opt.hint}
                                            </span>
                                        </div>
                                    </label>
                                ))}
                            </RadioGroup>
                        </div>

                        {workflowAnchor === 'RESET_TO_TARGET' && (
                            <div className="flex items-start gap-3 rounded-md border border-warning-200 bg-warning-50 p-3">
                                <Warning
                                    weight="fill"
                                    className="mt-0.5 size-5 shrink-0 text-warning-600"
                                />
                                <p className="text-caption text-warning-700">
                                    This will start {targetName || 'the new list'}&apos;s calls and
                                    messages for {responseIds.length} lead
                                    {responseIds.length === 1 ? '' : 's'}. Leads who opted out are
                                    never moved.
                                </p>
                            </div>
                        )}

                        <div className="flex items-center gap-2 text-caption text-neutral-500">
                            <span>{responseIds.length} selected</span>
                            <ArrowRight className="size-3.5" />
                            <span>{targetName || 'choose a list'}</span>
                        </div>
                    </>
                )}
            </div>
        </MyDialog>
    );
};

export default MigrateLeadsDialog;
