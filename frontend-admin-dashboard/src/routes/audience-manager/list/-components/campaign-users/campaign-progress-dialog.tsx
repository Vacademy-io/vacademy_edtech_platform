import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, PhoneCall, Prohibit, Robot } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import {
    cancelBulkRun,
    fetchBulkRunItems,
    fetchBulkRunSummary,
    type BulkRunItem,
} from '@/components/shared/leads/services/start-ai-campaign';

interface CampaignProgressDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    audienceId: string;
    instituteId: string;
    /**
     * Leads this run queued, as the start call reported them. Only a seed for the
     * header — the authoritative total comes from the queue, which also knows about
     * leads that were dropped before dialling.
     */
    expectedTotal: number;
    /** responseId → lead name, for labeling rows (best-effort; falls back to number). */
    leadNames: Map<string, string>;
}

/** Queue states that will never change again. */
const QUEUE_DONE = new Set(['DIALED', 'FAILED', 'EXPIRED', 'CANCELLED']);

/** "1 h 40 min" reads better than "100 minutes" on a run that spans hours. */
function formatEta(minutes?: number | null): string {
    if (minutes == null || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** status → chip label + design-token classes (semantic tokens only). */
function buildChip(t: TFunction) {
    return function chip(status: string): { label: string; cls: string; live?: boolean } {
        switch (status) {
            case 'COMPLETED':
                return { label: t('status.completed'), cls: 'bg-success-50 text-success-700' };
            case 'NO_ANSWER':
                return { label: t('status.noAnswer'), cls: 'bg-warning-50 text-warning-700' };
            case 'BUSY':
                return { label: t('status.busy'), cls: 'bg-warning-50 text-warning-700' };
            case 'FAILED':
                return { label: t('status.failed'), cls: 'bg-danger-50 text-danger-700' };
            case 'CANCELLED':
                return { label: t('status.cancelled'), cls: 'bg-danger-50 text-danger-700' };
            case 'ANSWERED':
            case 'IN_PROGRESS':
                return { label: t('status.onCall'), cls: 'bg-info-50 text-info-700', live: true };
            case 'COUNSELLOR_RINGING':
                return { label: t('status.ringing'), cls: 'bg-info-50 text-info-700', live: true };
            default: // INITIATED / QUEUED
                return {
                    label: t('status.dialing'),
                    cls: 'bg-neutral-100 text-neutral-600',
                    live: true,
                };
        }
    };
}

/**
 * Live progress for a bulk AI-call run: one row per dialed lead, status updating
 * every few seconds (poll — call events land via provider webhooks server-side, so
 * closing this dialog never affects the run). Polling stops once every expected
 * call has reached a terminal state.
 */
export function CampaignProgressDialog({
    open,
    onOpenChange,
    audienceId,
    instituteId,
    expectedTotal,
    leadNames,
}: CampaignProgressDialogProps) {
    const { t } = useTranslation('audienceManagerCampaignProgressDialog');
    const chip = useMemo(() => buildChip(t), [t]);

    // Both reads come from the QUEUE, so a lead that has not dialled yet is still a
    // row here — on a fleet that carries a few calls at once, that is most of them.
    const summary = useQuery({
        queryKey: ['ai-bulk-run-summary', audienceId, instituteId],
        queryFn: () => fetchBulkRunSummary(audienceId, instituteId),
        enabled: open,
        // Stop polling once nothing can change again.
        refetchInterval: (query) => (query.state.data?.runFinished ? false : 4000),
        retry: false,
    });

    const itemsQuery = useQuery({
        queryKey: ['ai-bulk-run-items', audienceId, instituteId],
        queryFn: () => fetchBulkRunItems(audienceId, instituteId),
        enabled: open,
        refetchInterval: () => (summary.data?.runFinished ? false : 4000),
        retry: false,
    });

    const rows: BulkRunItem[] = itemsQuery.data ?? [];
    // The queue is the denominator: it counts leads dropped before dialling, which the
    // call log never sees, so the bar can actually reach 100%.
    const total = summary.data?.total ?? expectedTotal;
    const doneCount = summary.data?.finished ?? rows.filter((r) => QUEUE_DONE.has(r.status)).length;
    const waitingCount = summary.data?.waiting ?? 0;
    const liveCount = summary.data?.dialing ?? 0;
    const droppedCount = summary.data?.dropped ?? 0;
    const finished = summary.data?.runFinished ?? false;
    const etaText = formatEta(summary.data?.etaMinutes);

    const queryClient = useQueryClient();
    // A 100-lead run spans hours. Without a stop here the only control was the queue
    // tab's unscoped "cancel all waiting", which would also have killed other
    // campaigns, automations and counsellors' own calls.
    const cancelRun = useMutation({
        mutationFn: () => cancelBulkRun(audienceId, instituteId),
        onSuccess: (r) => {
            toast.success(`${r.cancelled} remaining call${r.cancelled === 1 ? '' : 's'} cancelled`);
            queryClient.invalidateQueries({ queryKey: ['ai-bulk-run-summary', audienceId] });
            queryClient.invalidateQueries({ queryKey: ['ai-bulk-run-items', audienceId] });
            queryClient.invalidateQueries({ queryKey: ['ai-call-queue-summary'] });
            queryClient.invalidateQueries({ queryKey: ['ai-call-queue-items'] });
        },
        onError: () => toast.error('Could not cancel the remaining calls'),
    });

    return (
        <MyDialog
            heading={t('dialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-lg"
        >
            <div className="space-y-3 text-body">
                <div className="flex items-center justify-between">
                    <p className="font-semibold">
                        {finished ? (
                            <span className="flex items-center gap-1.5 text-success-700">
                                <CheckCircle className="size-4" />{' '}
                                {t('header.allFinished', { count: total })}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5">
                                <Robot className="size-4 text-primary-500" />
                                {t('header.progress', { done: doneCount, total })}
                                {liveCount > 0 && t('header.liveSuffix', { count: liveCount })}
                            </span>
                        )}
                    </p>
                    {/* The wait, not a parallelism setting. The old "N in parallel" label
                        echoed a request field the queue ignores — how many run at once is
                        decided fleet-side — so it could read "1 in parallel" beside three
                        live calls. */}
                    {!finished && waitingCount > 0 && (
                        <span className="text-caption text-neutral-500">
                            {etaText
                                ? t('header.waitingWithEta', {
                                      count: waitingCount,
                                      eta: etaText,
                                  })
                                : t('header.waiting', { count: waitingCount })}
                        </span>
                    )}
                </div>

                {/* progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-lg bg-neutral-100">
                    <div
                        className="h-full rounded-lg bg-primary-500 transition-all"
                        // inline style: genuinely dynamic value (live completion %),
                        // not expressible as a token class
                        style={{
                            width: `${total ? Math.min(100, Math.round((doneCount / total) * 100)) : 0}%`,
                        }}
                    />
                </div>

                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                    {rows.length === 0 && (
                        <p className="flex items-center gap-1.5 py-3 text-neutral-500">
                            <PhoneCall className="size-4 animate-pulse" /> {t('list.dialingFirst')}
                        </p>
                    )}
                    {droppedCount > 0 && (
                        // Leads that will never be called. Without this the run just
                        // stops short of its total with nothing to explain the gap.
                        <p className="py-1 text-caption text-neutral-500">
                            {t('list.droppedNotice', { count: droppedCount })}
                        </p>
                    )}
                    {rows.map((r) => {
                        // A row's real state needs BOTH sides: the queue row says whether
                        // it has been handed over at all, the call log says what the call
                        // then did. A DIALED queue row never moves again on its own.
                        const waiting = r.status === 'QUEUED' || r.status === 'DISPATCHING';
                        const c = waiting
                            ? {
                                  label:
                                      r.aheadInLane != null && r.aheadInLane > 0
                                          ? t('status.waitingAt', { position: r.aheadInLane + 1 })
                                          : t('status.nextUp'),
                                  cls: 'bg-neutral-100 text-neutral-600',
                                  live: false,
                              }
                            : r.status === 'CANCELLED' || r.status === 'EXPIRED'
                              ? {
                                    label: t(`status.${r.status.toLowerCase()}`),
                                    cls: 'bg-neutral-100 text-neutral-500',
                                    live: false,
                                }
                              : chip(r.callStatus ?? r.status);
                        const sub = waiting
                            ? formatEta(r.etaMinutes)
                            : r.statusReason
                              ? r.statusReason
                              : r.callDurationSeconds
                                ? t('list.duration', {
                                      minutes: Math.floor(r.callDurationSeconds / 60),
                                      seconds: r.callDurationSeconds % 60,
                                  })
                                : '';
                        return (
                            <div
                                key={r.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2"
                            >
                                <div className="min-w-0">
                                    <p className="truncate text-body font-medium">
                                        {(r.responseId && leadNames.get(r.responseId)) ||
                                            r.phoneNumber ||
                                            t('list.defaultLeadName')}
                                    </p>
                                    <p className="truncate text-caption text-neutral-500">{sub}</p>
                                </div>
                                <span
                                    className={cn(
                                        'shrink-0 rounded-md px-2 py-0.5 text-caption font-medium',
                                        c.cls,
                                        c.live && 'animate-pulse'
                                    )}
                                >
                                    {c.label}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {(summary.isError || itemsQuery.isError) && (
                    <p className="text-caption text-warning-600">{t('error.pollPaused')}</p>
                )}
                {!finished && (
                    <div className="flex items-start justify-between gap-3">
                        <p className="text-caption text-neutral-500">
                            {t('footer.backgroundNotice')}
                        </p>
                        {waitingCount > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="shrink-0 gap-1.5 text-danger-600"
                                disabled={cancelRun.isPending}
                                onClick={() => {
                                    if (
                                        window.confirm(
                                            `Cancel the ${waitingCount} call(s) still waiting in this campaign? Calls already in progress are not affected.`
                                        )
                                    ) {
                                        cancelRun.mutate();
                                    }
                                }}
                            >
                                <Prohibit size={14} />
                                {t('footer.cancelRemaining')}
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
